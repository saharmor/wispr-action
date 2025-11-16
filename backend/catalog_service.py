"""Catalog service for discovering MCP servers from public registries."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import requests

from catalog_auth_overrides import apply_auth_override
from catalog_database import (
    clear_catalog_cache,
    get_catalog_entry,
    get_catalog_entry_count,
    get_catalog_last_refresh,
    is_catalog_expired,
    save_catalog_entries,
    search_catalog_entries,
    set_catalog_last_refresh,
)
from config import (
    MCP_CATALOG_CACHE_FILE,
    MCP_CATALOG_CACHE_TTL,
    MCP_CATALOG_FETCH_LIMIT,
    MCP_REGISTRY_BASE_URL,
    MCP_REGISTRY_TIMEOUT,
)
from constants import PLACEHOLDER_PATTERN, SLUG_PATTERN, MCPAuthType

logger = logging.getLogger(__name__)
REGISTRY_MAX_LIMIT = 100


def _slugify(value: str) -> str:
    value = (value or "").strip().lower()
    if not value:
        return ""
    slug = SLUG_PATTERN.sub("-", value).strip("-")
    return slug or value


def _titleize_env(var_name: str) -> str:
    return var_name.replace("_", " ").strip().capitalize()


def _auth_type_map(raw_type: Optional[str]) -> str:
    if not raw_type:
        return MCPAuthType.NONE
    normalized = raw_type.lower()
    mapping = {
        "apikey": MCPAuthType.API_KEY_HEADER,
        "api_key": MCPAuthType.API_KEY_HEADER,
        "header_api_key": MCPAuthType.API_KEY_HEADER,
        "bearer": MCPAuthType.BEARER_HEADER,
        "bearerheader": MCPAuthType.BEARER_HEADER,
        "bearer_token": MCPAuthType.BEARER_HEADER,
        "oauthbearer": MCPAuthType.OAUTH,
        "oauth": MCPAuthType.OAUTH,
        "oauth2": MCPAuthType.OAUTH,
        "oauth2.0": MCPAuthType.OAUTH,
        "queryparam": MCPAuthType.QUERY_PARAM,
        "query_param": MCPAuthType.QUERY_PARAM,
        "none": MCPAuthType.NONE,
    }
    return mapping.get(normalized, MCPAuthType.CUSTOM)


@dataclass
class AuthField:
    key: str
    label: str
    required: bool = True
    hint: Optional[str] = None
    location: str = "header"  # header | query | custom
    target: Optional[str] = None  # header or param name
    scheme: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "key": self.key,
            "label": self.label,
            "required": self.required,
            "location": self.location,
        }
        if self.hint:
            data["hint"] = self.hint
        if self.target:
            data["target"] = self.target
        if self.scheme:
            data["scheme"] = self.scheme
        return data


@dataclass
class CatalogEntry:
    id: str
    slug: str
    name: str
    description: str
    tags: List[str]
    transports: List[str]
    publisher: Optional[str] = None
    logo_url: Optional[str] = None
    default_endpoint: Optional[Dict[str, str]] = None
    auth_type: str = "none"
    auth_fields: List[AuthField] = field(default_factory=list)
    popularity: Optional[float] = None
    classification: Optional[str] = None
    source: Dict[str, Optional[str]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "tags": self.tags,
            "logoUrl": self.logo_url,
            "publisher": self.publisher,
            "transports": self.transports,
            "defaultEndpoint": self.default_endpoint,
            "auth": {
                "type": self.auth_type,
                "fields": [field.to_dict() for field in self.auth_fields],
            },
            "popularity": self.popularity,
            "classification": self.classification,
            "source": self.source,
        }


class CatalogService:
    """Fetches, caches, and searches MCP catalog entries."""

    def __init__(
        self,
        base_url: str = MCP_REGISTRY_BASE_URL,
        cache_file: str = MCP_CATALOG_CACHE_FILE,
        cache_ttl: int = MCP_CATALOG_CACHE_TTL,
        fetch_limit: int = MCP_CATALOG_FETCH_LIMIT,
        timeout: float = MCP_REGISTRY_TIMEOUT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cache_file = cache_file
        self.cache_ttl = cache_ttl
        self.fetch_limit = max(1, min(fetch_limit, REGISTRY_MAX_LIMIT))
        self.timeout = timeout

        self._lock = threading.RLock()
        self._last_refresh_error: Optional[str] = None
        self._is_refreshing = False
        self._refresh_progress = {"page": 0, "total": 0}

        # Auto-refresh if expired on initialization
        if is_catalog_expired():
            logger.info("Catalog expired, scheduling background refresh")
            threading.Thread(target=self._refresh_in_background, daemon=True).start()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def search_entries(
        self,
        query: Optional[str] = None,
        tag: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        with self._lock:
            if force_refresh and not self._is_refreshing:
                self._refresh_all_entries()
            elif is_catalog_expired() and not self._is_refreshing:
                logger.info("Catalog expired, refreshing in background")
                threading.Thread(target=self._refresh_in_background, daemon=True).start()

        # Search from database
        result = search_catalog_entries(query=query, tag=tag, limit=limit, offset=offset)
        
        # Add refresh status
        result["isRefreshing"] = self._is_refreshing
        result["refreshProgress"] = self._refresh_progress.copy()
        
        return result

    def get_entry(self, entry_id: str, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
        if not entry_id:
            return None
        
        with self._lock:
            if force_refresh:
                self._refresh_all_entries()
        
        # Get from database
        entry = get_catalog_entry(entry_id)
        
        # Apply auth override if available
        if entry:
            entry = apply_auth_override(entry, entry_id)
        
        return entry

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #
    def _refresh_in_background(self) -> None:
        """Refresh entries in a background thread."""
        try:
            self._is_refreshing = True
            self._refresh_all_entries()
        except Exception as exc:
            logger.error(f"Background catalog refresh failed: {exc}")
        finally:
            self._is_refreshing = False

    def _refresh_all_entries(self) -> None:
        """Fetch all catalog entries from registry using cursor-based pagination."""
        try:
            self._is_refreshing = True
            logger.info("🔄 Starting full catalog refresh")
            all_entries = []
            cursor = None
            page = 0
            max_pages = 20  # Safety limit (100 servers/page = 2000 max)
            
            while page < max_pages:
                page += 1
                self._refresh_progress = {"page": page, "total": len(all_entries)}
                logger.info(f"📥 Fetching page {page} (cursor: {cursor[:50] if cursor else 'none'}...)")
                
                batch, next_cursor = self._fetch_registry_entries(cursor=cursor)
                
                if not batch:
                    logger.info("No more entries to fetch")
                    break
                
                all_entries.extend(batch)
                logger.info(f"✓ Got {len(batch)} entries (total: {len(all_entries)})")
                
                if not next_cursor:
                    logger.info("✓ Reached end of catalog (no next cursor)")
                    break
                
                cursor = next_cursor
            
            if all_entries:
                # Convert to dict format for database
                logger.info(f"💾 Saving {len(all_entries)} entries to database...")
                entries_dict = [entry.to_dict() for entry in all_entries]
                
                # Apply auth overrides for known servers with incomplete registry data
                for entry_dict in entries_dict:
                    entry_id = entry_dict.get("id")
                    if entry_id:
                        apply_auth_override(entry_dict, entry_id)
                
                save_catalog_entries(entries_dict, replace_all=True)
                set_catalog_last_refresh()
                self._last_refresh_error = None
                logger.info(f"✅ Catalog refresh complete: {len(all_entries)} entries saved")
            else:
                raise RuntimeError("Registry returned no entries")
                
        except Exception as exc:
            self._last_refresh_error = str(exc)
            logger.error(f"❌ Failed to refresh MCP catalog: {exc}")
        finally:
            self._is_refreshing = False
            self._refresh_progress = {"page": 0, "total": 0}

    def _fetch_registry_entries(
        self, cursor: Optional[str] = None
    ) -> Tuple[List[CatalogEntry], Optional[str]]:
        """
        Fetch a batch of registry entries using cursor-based pagination.
        
        Returns:
            Tuple of (entries, next_cursor)
        """
        params = {"limit": 100}  # Registry max
        if cursor:
            params["cursor"] = cursor
            
        url = f"{self.base_url}/v0/servers"
        
        logger.debug(f"Fetching from {url} with cursor: {cursor[:50] if cursor else 'none'}...")
        response = requests.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        payload = response.json()

        # Get servers array
        items = payload.get("servers", [])
        if not isinstance(items, list):
            raise ValueError("Unexpected registry response format")

        # Get next cursor from metadata
        metadata = payload.get("metadata", {})
        next_cursor = metadata.get("nextCursor")

        # Parse entries
        entries: List[CatalogEntry] = []
        for raw in items:
            normalized = self._normalize_registry_entry(raw)
            if normalized:
                entries.append(normalized)
        
        logger.debug(f"Fetched {len(entries)} entries, next_cursor: {next_cursor[:50] if next_cursor else 'none'}")
        return entries, next_cursor

    def _normalize_registry_entry(self, data: Dict[str, Any]) -> Optional[CatalogEntry]:
        if not isinstance(data, dict):
            return None

        meta = data.get("_meta") or {}
        server_data = data.get("server") if "server" in data else data
        if not isinstance(server_data, dict):
            return None

        entry_id = (
            server_data.get("id")
            or server_data.get("slug")
            or server_data.get("name")
        )
        name = server_data.get("name") or entry_id
        if not entry_id or not name:
            return None

        slug = _slugify(server_data.get("slug") or name)
        description = server_data.get("description") or ""
        tags = self._extract_tags(server_data)
        publisher = server_data.get("publisher") or server_data.get("repository", {}).get("source")

        transports = self._collect_transports(server_data)

        default_endpoint = self._pick_default_endpoint(
            server_data.get("endpoints"),
            transports,
            server_data.get("remotes"),
        )

        auth_type, auth_fields = self._build_auth(server_data)

        metadata = server_data.get("metadata") or {}
        logo_url = metadata.get("logo") or metadata.get("logoUrl")

        return CatalogEntry(
            id=str(entry_id),
            slug=slug or _slugify(str(entry_id)),
            name=name,
            description=description,
            tags=tags,
            transports=transports,
            publisher=publisher,
            logo_url=logo_url,
            default_endpoint=default_endpoint,
            auth_type=auth_type,
            auth_fields=auth_fields,
            classification=self._classification_from_meta(meta),
            source={"registryId": entry_id},
        )

    def _pick_default_endpoint(
        self,
        endpoints: Optional[List[Dict[str, Any]]],
        transports: List[str],
        remotes: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, str]]:
        for remote in remotes or []:
            if not isinstance(remote, dict):
                continue
            url = remote.get("url")
            transport = remote.get("type") or remote.get("transport")
            if url and transport:
                return {"url": url, "transport": transport}
        if endpoints:
            for endpoint in endpoints:
                url = endpoint.get("url")
                transport = endpoint.get("transport") or endpoint.get("type")
                if url and transport:
                    return {"url": url, "transport": transport}
        if transports:
            return {"transport": transports[0]}
        return None

    def _build_auth(self, data: Dict[str, Any]) -> Tuple[str, List[AuthField]]:
        auth_meta = data.get("authentication") or {}
        auth_type = _auth_type_map(auth_meta.get("type"))

        fields: Dict[str, AuthField] = {}

        def add_field(
            key: str,
            label: Optional[str] = None,
            required: bool = True,
            hint: Optional[str] = None,
            location: Optional[str] = None,
            target: Optional[str] = None,
            scheme: Optional[str] = None,
        ) -> None:
            normalized_key = (key or "").strip().upper()
            if not normalized_key or normalized_key in fields:
                return
            resolved_location = (location or "").lower()
            if resolved_location not in {"header", "query"}:
                resolved_location = "query" if auth_type == "queryParam" else "header"
            fields[normalized_key] = AuthField(
                key=normalized_key,
                label=label or _titleize_env(normalized_key),
                required=required,
                hint=hint,
                location=resolved_location,
                target=target,
                scheme=scheme,
            )

        for param in auth_meta.get("parameters") or []:
            key = param.get("key") or param.get("env") or param.get("name")
            if not key:
                continue
            label = param.get("label") or param.get("description") or _titleize_env(key)
            hint = param.get("hint")
            required = bool(param.get("required", True))
            location = param.get("in") or param.get("location") or param.get("placement")
            target = param.get("name") or param.get("header") or param.get("param")
            scheme = param.get("scheme") or param.get("prefix")
            add_field(
                key,
                label=label,
                required=required,
                hint=hint,
                location=location,
                target=target,
                scheme=scheme,
            )

        # Scan for placeholders like ${VAR}, {{var}}, {var}
        for key in self._extract_env_placeholders(data):
            add_field(key, required=True)

        for env_var in self._collect_environment_variables(data):
            env_key = env_var.get("name")
            if not env_key:
                continue
            add_field(
                env_key,
                label=env_var.get("description") or _titleize_env(env_key),
                required=env_var.get("isRequired", True),
                hint=env_var.get("hint") or env_var.get("description"),
            )

        if not fields and auth_type == MCPAuthType.NONE:
            return MCPAuthType.NONE, []

        return auth_type, list(fields.values())

    def _extract_env_placeholders(self, data: Any) -> List[str]:
        placeholders: List[str] = []

        def _scan(value: Any) -> None:
            if isinstance(value, str):
                for match in PLACEHOLDER_PATTERN.finditer(value):
                    for group in match.groups():
                        if group:
                            placeholders.append(group.upper())
            elif isinstance(value, dict):
                for nested in value.values():
                    _scan(nested)
            elif isinstance(value, list):
                for item in value:
                    _scan(item)

        _scan(data)
        seen = set()
        unique: List[str] = []
        for item in placeholders:
            if item not in seen:
                seen.add(item)
                unique.append(item)
        return unique

    def _collect_environment_variables(self, data: Any) -> List[Dict[str, Any]]:
        variables: List[Dict[str, Any]] = []

        def _scan(node: Any) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "environmentVariables" and isinstance(value, list):
                        variables.extend([item for item in value if isinstance(item, dict)])
                    else:
                        _scan(value)
            elif isinstance(node, list):
                for item in node:
                    _scan(item)

        _scan(data)
        return variables

    def _collect_transports(self, server_data: Dict[str, Any]) -> List[str]:
        transports: List[str] = []
        for entry in server_data.get("transports") or []:
            if isinstance(entry, str):
                transports.append(entry)
        for remote in server_data.get("remotes") or []:
            if isinstance(remote, dict):
                transport = remote.get("type") or remote.get("transport")
                if transport:
                    transports.append(transport)
        for package in server_data.get("packages") or []:
            if isinstance(package, dict):
                transport = package.get("transport")
                if isinstance(transport, dict):
                    transport_type = transport.get("type")
                    if transport_type:
                        transports.append(transport_type)
        seen = set()
        ordered: List[str] = []
        for transport in transports or ["http"]:
            normalized = str(transport)
            if normalized not in seen:
                seen.add(normalized)
                ordered.append(normalized)
        return ordered

    def _extract_tags(self, server_data: Dict[str, Any]) -> List[str]:
        tags = server_data.get("tags") or server_data.get("categories") or []
        if not isinstance(tags, list):
            return []
        cleaned = [str(tag) for tag in tags if isinstance(tag, (str, int))]
        return cleaned[:8]

    def _classification_from_meta(self, meta: Dict[str, Any]) -> Optional[str]:
        if not meta:
            return None
        for key in meta.keys():
            if "official" in key.lower():
                return "official"
        return "community"


_catalog_service: Optional[CatalogService] = None


def get_catalog_service() -> CatalogService:
    global _catalog_service
    if _catalog_service is None:
        _catalog_service = CatalogService()
    return _catalog_service


