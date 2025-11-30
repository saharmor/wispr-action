"""MCP client manager: server config CRUD, secret handling, tool discovery, execution."""

from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import anyio
from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.shared.exceptions import McpError
from mcp.types import CallToolResult

from composio_client import ComposioClient, ComposioError
from config import MCP_SERVERS_FILE, MCP_TOOL_CACHE_TTL
from constants import TEMPLATE_PATTERN, TransportType
from secret_store import (
    delete_secret,
    get_composio_api_key,
    get_secret,
    list_secret_flags,
    set_secret,
)


class MCPConfigError(Exception):
    """Configuration errors for MCP servers."""


class MCPExecutionError(Exception):
    """Raised when a call to an MCP tool fails."""


def _render_template(value: str, context: Dict[str, str]) -> str:
    """Replace {{placeholders}} in the provided value with context values."""

    def replace(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        return context.get(key, "")

    return TEMPLATE_PATTERN.sub(replace, value)


def _secret_keys(server: Dict[str, Any]) -> List[str]:
    keys: List[str] = []
    for entry in server.get("secret_fields", []):
        if isinstance(entry, str):
            keys.append(entry)
        elif isinstance(entry, dict) and entry.get("key"):
            keys.append(entry["key"])
    return keys


class MCPClientManager:
    """Singleton manager for MCP server configs, tool discovery, and execution."""

    def __init__(self, config_path: str = MCP_SERVERS_FILE) -> None:
        self.config_path = config_path
        self._servers: Dict[str, Dict[str, Any]] = {}
        self._tool_cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._load_servers()

    # ------------------------------------------------------------------
    # Config persistence
    # ------------------------------------------------------------------
    def _load_servers(self) -> None:
        if not os.path.exists(self.config_path):
            data = {"servers": []}
            self._write_servers(data)
        with open(self.config_path, "r", encoding="utf-8") as fh:
            try:
                data = json.load(fh) if fh.readable() else {"servers": []}
            except json.JSONDecodeError:
                data = {"servers": []}

        servers = data.get("servers", [])
        self._servers = {srv["id"]: srv for srv in servers if "id" in srv}

    def _write_servers(self, data: Dict[str, Any]) -> None:
        directory = os.path.dirname(self.config_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)

    def _persist(self) -> None:
        with self._lock:
            data = {"servers": list(self._servers.values())}
            self._write_servers(data)

    # ------------------------------------------------------------------
    # Public config helpers
    # ------------------------------------------------------------------
    def list_servers(self) -> List[Dict[str, Any]]:
        with self._lock:
            servers = []
            for server in self._servers.values():
                copy_server = copy.deepcopy(server)
                secret_flags = list_secret_flags(copy_server["id"], _secret_keys(copy_server))
                copy_server["secretsSet"] = secret_flags
                servers.append(copy_server)
            return servers

    def get_server(self, server_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            server = self._servers.get(server_id)
            if not server:
                return None
            copy_server = copy.deepcopy(server)
            copy_server["secretsSet"] = list_secret_flags(server_id, _secret_keys(server))
            # Add OAuth connection status if available
            if copy_server.get("oauth_connection_id"):
                copy_server["oauthConnected"] = True
            return copy_server

    def upsert_server(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if "name" not in payload:
            raise MCPConfigError("Server name is required")
        if "transport" not in payload:
            raise MCPConfigError("Server transport is required")

        server_id = payload.get("id") or uuid.uuid4().hex
        payload["id"] = server_id

        with self._lock:
            self._servers[server_id] = payload
            # Invalidate tool cache when server config changes
            self._tool_cache.pop(server_id, None)
            self._persist()

        return self.get_server(server_id) or payload

    def delete_server(self, server_id: str) -> bool:
        with self._lock:
            existed = server_id in self._servers
            server = self._servers.pop(server_id, None)
            if existed:
                self._persist()

        if server:
            for key in _secret_keys(server):
                delete_secret(server_id, key)
            self._tool_cache.pop(server_id, None)

        return bool(server)

    def update_secrets(self, server_id: str, secrets: Dict[str, Optional[str]]) -> Dict[str, bool]:
        with self._lock:
            if server_id not in self._servers:
                raise MCPConfigError(f"Server not found: {server_id}")

        for key, value in secrets.items():
            set_secret(server_id, key, value)

        # Invalidate tool cache when secrets change (new credentials may affect available tools)
        with self._lock:
            self._tool_cache.pop(server_id, None)

        return list_secret_flags(server_id, list(secrets.keys()))

    def secret_status(self, server_id: str) -> Dict[str, bool]:
        with self._lock:
            server = self._servers.get(server_id)
        if not server:
            raise MCPConfigError(f"Server not found: {server_id}")
        return list_secret_flags(server_id, _secret_keys(server))

    # ------------------------------------------------------------------
    # Tool discovery
    # ------------------------------------------------------------------
    def list_tools(self, server_id: Optional[str] = None, force_refresh: bool = False) -> List[Dict[str, Any]]:
        if server_id:
            server = self._servers.get(server_id)
            if not server:
                raise MCPConfigError(f"Server not found: {server_id}")
            return self._get_tools_for_server(server, force_refresh)

        tools: List[Dict[str, Any]] = []
        for server in self._servers.values():
            if not server.get("enabled", True):
                continue
            tools.extend(self._get_tools_for_server(server, force_refresh))
        return tools

    def _get_tools_for_server(self, server: Dict[str, Any], force_refresh: bool) -> List[Dict[str, Any]]:
        server_id = server["id"]
        
        # Check cache with lock
        with self._lock:
            cache_entry = self._tool_cache.get(server_id)
            if (
                cache_entry
                and not force_refresh
                and (time.time() - cache_entry["timestamp"] < MCP_TOOL_CACHE_TTL)
            ):
                return cache_entry["tools"]

        # Fetch tools outside the lock (can be slow)
        tools = self._run(self._list_tools_async, server)
        
        # Update cache with lock
        with self._lock:
            self._tool_cache[server_id] = {
                "timestamp": time.time(),
                "tools": tools,
            }
        return tools

    async def _list_tools_async(self, server: Dict[str, Any]) -> List[Dict[str, Any]]:
        async with self._open_session(server) as session:
            result = await session.list_tools()
            serialized = []
            for tool in result.tools:
                serialized.append(
                    {
                        "server_id": server["id"],
                        "server_name": server.get("name", server["id"]),
                        "tool": tool.model_dump(mode="json", exclude_none=True),
                    }
                )
            return serialized

    # ------------------------------------------------------------------
    # Tool execution
    # ------------------------------------------------------------------
    def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        timeout_seconds: Optional[int] = None,
    ) -> Dict[str, Any]:
        server = self._servers.get(server_id)
        if not server:
            raise MCPConfigError(f"Server not found: {server_id}")
        return self._run(self._call_tool_async, server, tool_name, arguments or {}, timeout_seconds)

    async def _call_tool_async(
        self,
        server: Dict[str, Any],
        tool_name: str,
        arguments: Dict[str, Any],
        timeout_seconds: Optional[int],
    ) -> Dict[str, Any]:
        async with self._open_session(server) as session:
            timeout = timedelta(seconds=timeout_seconds) if timeout_seconds else None
            try:
                result: CallToolResult = await session.call_tool(
                    tool_name,
                    arguments=arguments or None,
                    read_timeout_seconds=timeout,
                )
            except McpError as exc:
                raise MCPExecutionError(exc.error.message) from exc
            return result.model_dump(mode="json", exclude_none=True)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _run(self, func, *args, **kwargs):
        return anyio.run(func, *args, **kwargs)

    def _get_secret_values(self, server_id: str, server: Dict[str, Any]) -> Dict[str, str]:
        values: Dict[str, str] = {}
        missing_secrets = []
        for key in _secret_keys(server):
            secret = get_secret(server_id, key)
            if secret:
                values[key] = secret
            else:
                missing_secrets.append(key)
        
        if missing_secrets:
            print(f"Warning: Missing secrets for server '{server.get('name', server_id)}': {', '.join(missing_secrets)}")
        
        return values

    def _build_headers(
        self,
        header_entries: Optional[List[Dict[str, Any]]],
        secrets: Dict[str, str],
    ) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        for header in header_entries or []:
            key = header.get("key")
            value = header.get("value", "")
            if not key:
                continue
            headers[key] = _render_template(value, secrets)
        return headers

    def _build_sse_headers(self, server: Dict[str, Any], secrets: Dict[str, str]) -> Dict[str, str]:
        return self._build_headers(server.get("sse", {}).get("headers"), secrets)

    def _build_http_headers(self, server: Dict[str, Any], secrets: Dict[str, str]) -> Dict[str, str]:
        return self._build_headers(server.get("http", {}).get("headers"), secrets)

    def _build_sse_query_params(self, server: Dict[str, Any], secrets: Dict[str, str]) -> Dict[str, str]:
        return self._build_query_params(server.get("sse", {}).get("query_params"), secrets)

    def _build_http_query_params(self, server: Dict[str, Any], secrets: Dict[str, str]) -> Dict[str, str]:
        return self._build_query_params(server.get("http", {}).get("query_params"), secrets)

    def _build_stdio_env(self, server: Dict[str, Any], secrets: Dict[str, str]) -> Dict[str, str]:
        env = {}
        for env_var in server.get("stdio", {}).get("env", []):
            key = env_var.get("key")
            value = env_var.get("value", "")
            if not key:
                continue
            env[key] = _render_template(value, secrets)
        return env

    def _build_query_params(
        self,
        param_entries: Optional[List[Dict[str, Any]]],
        secrets: Dict[str, str],
    ) -> Dict[str, str]:
        params: Dict[str, str] = {}
        for param in param_entries or []:
            key = param.get("key")
            value = param.get("value", "")
            if not key:
                continue
            params[key] = _render_template(value, secrets)
        return params

    def _apply_query_params(self, url: str, params: Dict[str, str]) -> str:
        if not params:
            return url
        parsed = urlparse(url)
        existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
        existing.update({k: v for k, v in params.items() if v is not None})
        new_query = urlencode(existing)
        return urlunparse(parsed._replace(query=new_query))

    def _get_composio_headers(self, server: Dict[str, Any]) -> Optional[Dict[str, str]]:
        """
        Get Composio authentication headers if server uses OAuth via Composio.
        
        Returns:
            Headers dict with x-api-key, or None if not OAuth/Composio
        """
        oauth_connection_id = server.get("oauth_connection_id")
        if not oauth_connection_id:
            return None
        
        # Get Composio API key
        composio_api_key = get_composio_api_key()
        if not composio_api_key:
            raise MCPConfigError("Composio API key not configured. Please set it in Settings.")
        
        return {"x-api-key": composio_api_key}

    def _get_composio_mcp_url(self, server: Dict[str, Any]) -> Optional[str]:
        """
        Get the Composio MCP endpoint URL if server uses OAuth via Composio.
        
        Returns:
            Composio MCP endpoint URL, or None if not OAuth/Composio
        """
        oauth_connection_id = server.get("oauth_connection_id")
        if not oauth_connection_id:
            return None
        
        composio_api_key = get_composio_api_key()
        if not composio_api_key:
            raise MCPConfigError("Composio API key not configured")
        
        try:
            client = ComposioClient(composio_api_key)
            connection = client.get_connection(oauth_connection_id)
            
            # Status can be "active", "ACTIVE", etc. - compare case-insensitively
            status = str(connection.get("status", "")).lower()
            if status != "active":
                raise MCPConfigError(f"OAuth connection not active: {connection['status']}")
            
            return connection["mcpEndpoint"]
        except ComposioError as exc:
            raise MCPConfigError(f"Failed to get Composio connection: {exc}") from exc

    @asynccontextmanager
    async def _open_session(self, server: Dict[str, Any]):
        transport = server.get("transport")
        
        if not server.get("enabled", True):
            raise MCPConfigError(f"Server '{server['name']}' is disabled")
        
        # Check if this is an OAuth-based server using Composio
        oauth_connection_id = server.get("oauth_connection_id")
        if oauth_connection_id:
            # Override URL and headers with Composio MCP endpoint
            composio_url = self._get_composio_mcp_url(server)
            composio_headers = self._get_composio_headers(server)
            
            if not composio_url or not composio_headers:
                raise MCPConfigError(f"Failed to get Composio MCP endpoint for '{server['name']}'")
            
            # Use HTTP transport with Composio endpoint
            async with streamablehttp_client(url=composio_url, headers=composio_headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
            return
        
        # Standard flow for non-OAuth servers
        secrets = self._get_secret_values(server["id"], server)

        if transport == TransportType.SSE:
            sse_config = server.get("sse") or {}
            url = sse_config.get("url")
            if not url:
                raise MCPConfigError(f"SSE server '{server['name']}' is missing a URL")

            headers = self._build_sse_headers(server, secrets) or None
            query_params = self._build_sse_query_params(server, secrets)
            url = self._apply_query_params(url, query_params)
            async with sse_client(url=url, headers=headers) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
        elif transport == TransportType.HTTP:
            http_config = server.get("http") or {}
            url = http_config.get("url")
            if not url:
                raise MCPConfigError(f"HTTP server '{server['name']}' is missing a URL")

            headers = self._build_http_headers(server, secrets) or None
            query_params = self._build_http_query_params(server, secrets)
            url = self._apply_query_params(url, query_params)
            async with streamablehttp_client(url=url, headers=headers) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
        elif transport == TransportType.STDIO:
            stdio_config = server.get("stdio") or {}
            command = stdio_config.get("command")
            if not command:
                raise MCPConfigError(f"STDIO server '{server['name']}' is missing a command")

            parameters = StdioServerParameters(
                command=command,
                args=stdio_config.get("args", []),
                cwd=stdio_config.get("cwd"),
                env=self._build_stdio_env(server, secrets) or None,
            )
            async with stdio_client(parameters) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    yield session
        else:
            raise MCPConfigError(f"Unsupported transport '{transport}' for server '{server['name']}'")


_mcp_manager: Optional[MCPClientManager] = None


def get_mcp_manager() -> MCPClientManager:
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPClientManager()
    return _mcp_manager

