"""Helpers to create MCP server configs from catalog entries."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from catalog_service import get_catalog_service
from constants import TransportType
from mcp_client import MCPConfigError, get_mcp_manager


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _transport_from_entry(entry: Dict[str, Any], override: Optional[str]) -> str:
    if override:
        return override
    endpoint = entry.get("defaultEndpoint") or {}
    transport = endpoint.get("transport") or (entry.get("transports") or [None])[0]
    return transport or "streamable-http"


def _map_transport(value: str) -> str:
    mapping = {
        "streamable-http": TransportType.HTTP,
        "streamable_http": TransportType.HTTP,
        "http": TransportType.HTTP,
        "sse": TransportType.SSE,
        "stdio": TransportType.STDIO,
    }
    normalized = (value or "").lower()
    if normalized not in mapping:
        raise MCPConfigError(f"Unsupported transport '{value}' for catalog entry")
    return mapping[normalized]


def _placeholder(key: str) -> str:
    return f"{{{{{key}}}}}"


class CatalogConfigurator:
    """Installs catalog entries into local MCP server configs."""

    def __init__(self, catalog_service=None, manager=None) -> None:
        self.catalog_service = catalog_service or get_catalog_service()
        self.manager = manager or get_mcp_manager()

    def install_from_catalog(self, entry_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        entry = self.catalog_service.get_entry(
            entry_id,
            force_refresh=bool(payload.get("forceRefresh")),
        )
        if not entry:
            raise MCPConfigError(f"Catalog entry not found: {entry_id}")

        # Check for duplicate connections - prevent multiple connections to the same MCP server
        # unless we're updating an existing server (payload has an 'id')
        if not payload.get("id"):
            existing_servers = self.manager.list_servers()
            for server in existing_servers:
                source = server.get("source", {})
                if source.get("type") == "catalog" and source.get("catalogId") == entry_id:
                    raise MCPConfigError(
                        f"You already have a connection to {entry.get('name', entry_id)}. "
                        f"Please edit the existing connection instead of creating a new one."
                    )

        server_payload = self._build_server_payload(entry, payload)
        saved = self.manager.upsert_server(server_payload)

        secrets = payload.get("secrets")
        if isinstance(secrets, dict) and secrets:
            self.manager.update_secrets(saved["id"], secrets)

        return saved

    # ------------------------------------------------------------------ #
    # Payload building
    # ------------------------------------------------------------------ #
    def _build_server_payload(self, entry: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        transport = _map_transport(
            _transport_from_entry(entry, payload.get("transport")),
        )

        name = (payload.get("name") or entry.get("name") or "MCP Server").strip()
        enabled = payload.get("enabled", True)

        secret_fields = self._build_secret_fields(entry)

        server: Dict[str, Any] = {
            "id": payload.get("id") or uuid.uuid4().hex,
            "name": name,
            "enabled": enabled,
            "transport": transport,
            "secret_fields": secret_fields,
            "auth": entry.get("auth"),
            "source": {
                "type": "catalog",
                "catalogId": entry.get("id"),
                "slug": entry.get("slug"),
                "name": entry.get("name"),
            },
            "metadata": {
                "tags": entry.get("tags"),
                "publisher": entry.get("publisher"),
                "description": entry.get("description"),
                "logoUrl": entry.get("logoUrl"),
                "classification": entry.get("classification"),
            },
            "createdAt": payload.get("createdAt") or _utc_now_iso(),
            "updatedAt": _utc_now_iso(),
        }

        if transport == TransportType.HTTP:
            server["http"] = self._build_http_config(entry, payload)
            server["sse"] = None
            server["stdio"] = None
        elif transport == TransportType.SSE:
            server["sse"] = self._build_sse_config(entry, payload)
            server["http"] = None
            server["stdio"] = None
        elif transport == TransportType.STDIO:
            server["stdio"] = self._build_stdio_config(payload)
            server["http"] = None
            server["sse"] = None
        else:
            raise MCPConfigError(f"Unsupported transport '{transport}'")

        return server

    def _build_secret_fields(self, entry: Dict[str, Any]) -> List[Dict[str, Any]]:
        auth = entry.get("auth") or {}
        fields = auth.get("fields") or []
        secret_fields: List[Dict[str, Any]] = []
        for field in fields:
            key = field.get("key")
            if not key:
                continue
            secret_fields.append(
                {
                    "key": key,
                    "label": field.get("label", key),
                    "description": field.get("hint", ""),
                    "required": field.get("required", True),
                }
            )
        return secret_fields

    def _build_http_config(self, entry: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        default_endpoint = entry.get("defaultEndpoint") or {}
        url = (payload.get("endpoint") or default_endpoint.get("url") or "").strip()
        if not url:
            raise MCPConfigError("Catalog entry does not provide an HTTP endpoint URL")

        headers, query_params = self._build_auth_templates(entry)

        extra_headers = payload.get("headers") or []
        if extra_headers:
            headers.extend(extra_headers)

        extra_query_params = payload.get("query_params") or payload.get("queryParams") or []
        if extra_query_params:
            query_params.extend(extra_query_params)

        http_config: Dict[str, Any] = {"url": url, "headers": headers}
        if query_params:
            http_config["query_params"] = query_params
        return http_config

    def _build_sse_config(self, entry: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        default_endpoint = entry.get("defaultEndpoint") or {}
        url = (payload.get("endpoint") or default_endpoint.get("url") or "").strip()
        if not url:
            raise MCPConfigError("Catalog entry does not provide an SSE endpoint URL")

        headers, query_params = self._build_auth_templates(entry)
        extra_headers = payload.get("headers") or []
        if extra_headers:
            headers.extend(extra_headers)
        extra_query_params = payload.get("query_params") or payload.get("queryParams") or []
        if extra_query_params:
            query_params.extend(extra_query_params)

        sse_config: Dict[str, Any] = {"url": url, "headers": headers}
        if query_params:
            sse_config["query_params"] = query_params
        return sse_config

    def _build_stdio_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        command = (payload.get("command") or "").strip()
        if not command:
            raise MCPConfigError("STDIO transports require a command to run")
        return {
            "command": command,
            "args": payload.get("args") or [],
            "cwd": payload.get("cwd"),
            "env": payload.get("env") or [],
        }

    def _build_auth_templates(self, entry: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        auth = entry.get("auth") or {}
        auth_type = auth.get("type", "none")
        headers: List[Dict[str, Any]] = []
        query_params: List[Dict[str, Any]] = []

        for field in auth.get("fields") or []:
            key = field.get("key")
            if not key:
                continue
            location = (field.get("location") or ("query" if auth_type == "queryParam" else "header")).lower()
            target = field.get("target")
            scheme = field.get("scheme")
            placeholder = _placeholder(key)

            if location == "header":
                header_name = target or ("Authorization" if auth_type == "bearerHeader" else "X-API-Key")
                if auth_type == "bearerHeader" or scheme:
                    prefix = scheme or "Bearer"
                    value = f"{prefix} {placeholder}".strip()
                else:
                    value = placeholder
                headers.append({"key": header_name, "value": value})
            elif location == "query":
                param_name = target or key.lower()
                query_params.append({"key": param_name, "value": placeholder})

        return headers, query_params


_catalog_configurator: Optional[CatalogConfigurator] = None


def get_catalog_configurator() -> CatalogConfigurator:
    global _catalog_configurator
    if _catalog_configurator is None:
        _catalog_configurator = CatalogConfigurator()
    return _catalog_configurator


