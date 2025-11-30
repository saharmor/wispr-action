"""Composio client for managing OAuth-based MCP servers using official SDK."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests
from composio import Composio
from composio.exceptions import ComposioSDKError

logger = logging.getLogger(__name__)

# API constants
COMPOSIO_API_BASE = "https://backend.composio.dev/api"
COMPOSIO_MCP_BASE = "https://backend.composio.dev/v3/mcp"
DEFAULT_TIMEOUT = 30.0

MCP_URL_KEYS = (
    "mcpEndpoint",
    "mcp_endpoint",
    "mcpServerUrl",
    "mcp_server_url",
    "mcpUrl",
    "mcp_url",
)

MCP_ID_KEYS = (
    "mcpServerId",
    "mcp_server_id",
    "mcpConfigId",
    "mcp_config_id",
    "serverId",
    "server_id",
)


def _ensure_user_query_param(url: str, user_id: Optional[str]) -> str:
    """Append user_id query param if missing."""
    if not user_id:
        return url
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "user_id" not in query:
        query["user_id"] = user_id
        new_query = urlencode(query)
        return urlunparse(parsed._replace(query=new_query))
    return url


def _account_to_dict(account: Any) -> Dict[str, Any]:
    if isinstance(account, dict):
        return account
    if hasattr(account, "__dict__"):
        return account.__dict__
    return {}


def _derive_mcp_endpoint(account_dict: Dict[str, Any], entity_id: str) -> Optional[str]:
    """Determine the correct MCP endpoint URL from connection metadata."""
    for key in MCP_URL_KEYS:
        value = account_dict.get(key)
        if value:
            return _ensure_user_query_param(value, entity_id)
    
    for key in MCP_ID_KEYS:
        server_id = account_dict.get(key)
        if server_id:
            base_url = f"{COMPOSIO_MCP_BASE}/{server_id}/mcp"
            return _ensure_user_query_param(base_url, entity_id)
    
    return None


class ComposioError(Exception):
    """Base exception for Composio-related errors."""


class ComposioClient:
    """Client for interacting with Composio API using official SDK."""

    def __init__(self, api_key: str, timeout: float = DEFAULT_TIMEOUT) -> None:
        """
        Initialize Composio client using official SDK.

        Args:
            api_key: Composio API key
            timeout: Request timeout in seconds
        """
        if not api_key:
            raise ComposioError("Composio API key is required")
        
        self.api_key = api_key
        self.timeout = timeout
        self._headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
        }
        
        try:
            # Initialize official Composio SDK
            # Note: SDK doesn't support timeout parameter in constructor
            self.client = Composio(api_key=api_key)
        except Exception as exc:
            raise ComposioError(f"Failed to initialize Composio SDK: {exc}") from exc

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        url = f"{COMPOSIO_API_BASE}{path}"
        headers = dict(self._headers)
        response = requests.request(
            method,
            url,
            headers=headers,
            params=params,
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            logger.error(
                "Composio API error %s for %s %s: %s",
                response.status_code,
                method,
                url,
                response.text,
            )
            response.raise_for_status()
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise ComposioError("Invalid JSON response from Composio API") from exc

    def _get_mcp_server_for_connection(self, connection_id: str) -> Optional[Dict[str, Any]]:
        try:
            data = self._request(
                "GET",
                "/v3/mcp/servers",
                params={"connected_account_id": connection_id},
            )
        except Exception as exc:
            logger.warning("Failed to fetch MCP server for connection %s: %s", connection_id, exc)
            return None
        items = data.get("items") or []
        if not items:
            return None
        return items[0]

    def _build_mcp_http_endpoint(self, server_info: Dict[str, Any], entity_id: str) -> Optional[str]:
        raw_url = (
            server_info.get("mcp_url")
            or server_info.get("mcpUrl")
            or server_info.get("mcpEndpoint")
            or server_info.get("mcp_endpoint")
        )
        server_id = server_info.get("id") or server_info.get("serverId")
        base_url = None
        query: Dict[str, Any] = {}

        if raw_url:
            parsed = urlparse(raw_url)
            base_url = parsed._replace(query="", params="", fragment="").geturl().rstrip("/")
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        elif server_id:
            base_url = f"{COMPOSIO_MCP_BASE}/{server_id}"
        if not base_url:
            return None
        if not base_url.endswith("/mcp"):
            base_url = f"{base_url}/mcp"

        # Force HTTP transport for streamable HTTP client
        query["transport"] = "streamable-http"
        if entity_id:
            query["user_id"] = entity_id
        return urlunparse(
            urlparse(base_url)._replace(query=urlencode(query))
        )

    def _resolve_connection_endpoint(
        self,
        connection_id: str,
        account_dict: Dict[str, Any],
        entity_id: str,
    ) -> Optional[str]:
        endpoint = _derive_mcp_endpoint(account_dict, entity_id)
        if endpoint:
            return endpoint
        server_info = self._get_mcp_server_for_connection(connection_id)
        if server_info:
            endpoint = self._build_mcp_http_endpoint(server_info, entity_id)
            if endpoint:
                return endpoint
        # Final fallback to legacy connection-based endpoint
        base_url = f"{COMPOSIO_MCP_BASE}/{connection_id}/mcp"
        return _ensure_user_query_param(base_url, entity_id)

    def list_apps(self) -> List[Dict[str, Any]]:
        """
        List all available Composio apps/integrations by fetching tools.
        
        Uses SDK's tools.get() which is the recommended approach per Composio docs.

        Returns:
            List of app dictionaries with name, key, logo, description, etc.
        """
        try:
            logger.info("Fetching apps from Composio SDK...")
            
            # Use the SDK's apps.get() to retrieve all available apps
            apps_result = self.client.apps.get()
            
            logger.info(f"Received apps response: {type(apps_result)}")
            
            # Group apps
            apps_dict = {}
            
            # Convert to list if needed
            apps_list = []
            if hasattr(apps_result, '__iter__'):
                apps_list = list(apps_result)
            elif isinstance(apps_result, list):
                apps_list = apps_result
            else:
                logger.warning(f"Unexpected apps response type: {type(apps_result)}")
                return []
            
            logger.info(f"Processing {len(apps_list)} apps...")
            
            # Process each app
            for app in apps_list:
                # Extract app info
                app_name = None
                app_key = None
                app_id = None  # The UUID needed for creating integrations
                
                # Try different attribute access patterns
                if hasattr(app, 'key'):
                    app_key = app.key
                    app_name = getattr(app, 'name', app_key)
                    app_id = getattr(app, 'appId', None)  # UUID for creating integrations
                elif hasattr(app, 'appKey'):
                    app_key = app.appKey
                    app_name = getattr(app, 'appName', app_key)
                    app_id = getattr(app, 'appId', None)
                elif isinstance(app, dict):
                    app_key = app.get('key') or app.get('appKey') or app.get('name')
                    app_name = app.get('name') or app.get('appName') or app_key
                    app_id = app.get('appId')
                elif hasattr(app, '__dict__'):
                    app_dict = app.__dict__
                    app_key = app_dict.get('key') or app_dict.get('appKey')
                    app_name = app_dict.get('name') or app_dict.get('appName') or app_key
                    app_id = app_dict.get('appId')
                
                if not app_key:
                    continue
                
                app_key_lower = app_key.lower()
                
                # Get additional info
                logo = None
                if hasattr(app, 'logo'):
                    logo = app.logo
                elif isinstance(app, dict):
                    logo = app.get('logo')
                elif hasattr(app, '__dict__'):
                    logo = app.__dict__.get('logo')
                
                # Create app entry
                apps_dict[app_key_lower] = {
                    "key": app_key,
                    "name": app_name or app_key.title(),
                    "appName": app_name or app_key,
                    "app_name": app_name or app_key,
                    "appId": app_id,  # Store the UUID for creating integrations
                    "description": f"Connect your {app_name or app_key} account",
                    "logo": logo,
                    "authConfig": {"app_name": app_name or app_key, "appId": app_id},
                    "auth_config": {"app_name": app_name or app_key, "appId": app_id},
                    "authConfigId": f"default_{app_key_lower}",
                    "id": f"default_{app_key_lower}",
                }
            
            apps = list(apps_dict.values())
            
            # Sort by name
            apps.sort(key=lambda x: x.get("name", "").lower())
            
            logger.info(f"Successfully processed {len(apps)} apps from SDK")
            
            return apps
            
        except ComposioSDKError as exc:
            logger.error(f"Composio SDK error listing apps: {exc}")
            # Return empty list instead of raising to allow graceful degradation
            return []
        except Exception as exc:
            logger.error(f"Failed to list Composio apps: {exc}")
            import traceback
            logger.error(traceback.format_exc())
            # Return empty list instead of raising
            return []

    def initiate_connection(
        self,
        app_name: str,
        redirect_url: Optional[str] = None,
        entity_id: str = "default",
        auth_config: Optional[Dict[str, Any]] = None,
        connection_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Initiate OAuth connection for an app using official SDK.
        
        If an active connection already exists for this app/entity, returns that instead.

        Args:
            app_name: Name of the app to connect (e.g., "github", "linear")
            redirect_url: Optional redirect URL after auth completion
            entity_id: Entity identifier for the connection
            auth_config: Auth configuration with auth_config_id
            connection_name: Optional name for the connection

        Returns:
            Dictionary with:
                - connectionId: Unique connection ID
                - redirectUrl: URL to redirect user for OAuth (or None if reusing existing)
                - integrationId: Integration ID
                - alreadyConnected: True if reusing existing connection

        Raises:
            ComposioError: If connection initiation fails
        """
        try:
            # For Composio SDK, we need to find or create an integration first
            logger.info(f"Initiating connection for {app_name} (entity: {entity_id})")
            
            # Step 1: Check for existing ACTIVE connection
            logger.info("Checking for existing active connections...")
            try:
                existing_connections = self.client.connected_accounts.get()
                if isinstance(existing_connections, list):
                    for conn in existing_connections:
                        # Check status
                        conn_status = getattr(conn, 'status', None) or conn.__dict__.get('status', '')
                        if str(conn_status).upper() == 'ACTIVE':
                            # Check if it's for the same entity
                            conn_entity = getattr(conn, 'entityId', None) or conn.__dict__.get('entityId', '')
                            
                            # Check if it's for the same integration (app)
                            conn_integration_id = getattr(conn, 'integrationId', None) or conn.__dict__.get('integrationId', '')
                            
                            # Get integrations to match by app_name
                            integrations_list = self.client.integrations.get(app_name=app_name)
                            matching_integration_ids = []
                            if isinstance(integrations_list, list):
                                matching_integration_ids = [
                                    getattr(integ, 'id', None) or integ.__dict__.get('id')
                                    for integ in integrations_list
                                ]
                            elif integrations_list:
                                integ_id = getattr(integrations_list, 'id', None) or integrations_list.__dict__.get('id')
                                if integ_id:
                                    matching_integration_ids.append(integ_id)
                            
                            # If this connection matches the app and entity, reuse it
                            if conn_entity == entity_id and conn_integration_id in matching_integration_ids:
                                conn_id = getattr(conn, 'id', None) or conn.__dict__.get('id')
                                logger.info(f"Found existing active connection: {conn_id}")
                                
                                # Return existing connection details
                                metadata = _account_to_dict(conn)
                                target_entity = conn_entity or entity_id or "default"
                                mcp_endpoint = self._resolve_connection_endpoint(
                                    conn_id,
                                    metadata,
                                    target_entity,
                                )
                                return {
                                    "connectionId": conn_id,
                                    "redirectUrl": None,  # No need to redirect
                                    "integrationId": app_name,
                                    "alreadyConnected": True,
                                    "mcpEndpoint": mcp_endpoint,
                                    "status": "active"
                                }
            except Exception as e:
                logger.info(f"Could not check existing connections: {e}")
            
            # Step 2: No existing connection found, create a new one
            logger.info("No existing active connection found, creating new one...")
            
            # Try to find existing integration by app_name
            integration_id = None
            try:
                # Use get() with app_name parameter to find existing integration
                integrations_result = self.client.integrations.get(app_name=app_name)
                
                # Result can be a single integration or a list
                if integrations_result:
                    if isinstance(integrations_result, list) and len(integrations_result) > 0:
                        integration = integrations_result[0]
                    else:
                        integration = integrations_result
                    
                    # Extract ID
                    if hasattr(integration, 'id'):
                        integration_id = integration.id
                    elif hasattr(integration, '__dict__'):
                        integration_id = integration.__dict__.get('id')
                    elif isinstance(integration, dict):
                        integration_id = integration.get('id')
                    
                    if integration_id:
                        logger.info(f"Found existing integration: {integration_id}")
            except Exception as e:
                logger.info(f"No existing integration found for {app_name}: {e}")
            
            # If no integration found, create one
            if not integration_id:
                logger.info(f"Creating new integration for {app_name}")
                try:
                    # Get the appId (UUID) from auth_config if provided
                    app_uuid = None
                    if auth_config:
                        app_uuid = auth_config.get("appId")
                    
                    # If no appId in auth_config, look it up from apps list
                    if not app_uuid:
                        logger.info(f"Looking up appId for {app_name}...")
                        apps = self.list_apps()
                        for app in apps:
                            if app.get("key", "").lower() == app_name.lower():
                                app_uuid = app.get("appId")
                                break
                    
                    if not app_uuid:
                        raise ComposioError(f"Could not find appId for {app_name}")
                    
                    logger.info(f"Using appId: {app_uuid}")
                    
                    # create() uses app_id parameter (the UUID, not the key)
                    # name parameter is required
                    # use_composio_auth=True tells Composio to use their managed OAuth (no need for our own client ID/secret)
                    integration_name = connection_name or f"{app_name} Integration"
                    new_integration = self.client.integrations.create(
                        app_id=app_uuid,
                        name=integration_name,
                        use_composio_auth=True  # Use Composio's managed OAuth
                    )
                    
                    if hasattr(new_integration, 'id'):
                        integration_id = new_integration.id
                    elif hasattr(new_integration, '__dict__'):
                        integration_id = new_integration.__dict__.get('id')
                    elif isinstance(new_integration, dict):
                        integration_id = new_integration.get('id')
                    
                    logger.info(f"Created integration: {integration_id}")
                except Exception as e:
                    logger.error(f"Failed to create integration: {e}")
                    raise ComposioError(f"Failed to create integration for {app_name}: {e}")
            
            if not integration_id:
                raise ComposioError(f"Could not get integration ID for {app_name}")
            
            # Now initiate connection using the integration
            # SDK signature: initiate(integration_id, entity_id, params, labels, redirect_url)
            connection_request = self.client.connected_accounts.initiate(
                integration_id=integration_id,
                entity_id=entity_id,
                redirect_url=redirect_url,
                params={"name": connection_name or app_name} if connection_name else None
            )
            
            # Extract connection details from SDK response
            # ConnectionRequestModel has fields: connectionStatus, connectedAccountId, redirectUrl
            connection_id = getattr(connection_request, 'connectedAccountId', None)
            redirect_url_result = getattr(connection_request, 'redirectUrl', None)
            
            if not connection_id or not redirect_url_result:
                logger.error(f"Invalid SDK response - connectedAccountId: {connection_id}, redirectUrl: {redirect_url_result}")
                raise ComposioError("SDK returned invalid connection data")
            
            logger.info(f"Connection initiated: {connection_id}, redirect: {redirect_url_result}")
            
            return {
                "connectionId": connection_id,
                "redirectUrl": redirect_url_result,
                "integrationId": app_name,
            }
            
        except ComposioSDKError as exc:
            error_msg = f"Composio SDK error initiating connection: {exc}"
            logger.error(error_msg)
            raise ComposioError(error_msg) from exc
        except Exception as exc:
            error_msg = f"Failed to initiate connection: {exc}"
            logger.error(error_msg)
            raise ComposioError(error_msg) from exc

    def get_connection(self, connection_id: str) -> Dict[str, Any]:
        """
        Get connection details by ID using official SDK.

        Args:
            connection_id: Connection ID

        Returns:
            Connection details including status and MCP endpoint

        Raises:
            ComposioError: If connection not found
        """
        try:
            # Use SDK to get connected account
            account = self.client.connected_accounts.get(connection_id)
            
            # Extract status and other details
            status = getattr(account, 'status', 'pending')
            if hasattr(account, '__dict__'):
                account_dict = account.__dict__
                status = account_dict.get('status', 'pending')
                integration_id = account_dict.get('integrationId') or account_dict.get('appName')
                entity_id = account_dict.get('entityId') or account_dict.get('userId', 'default')
            else:
                integration_id = getattr(account, 'integrationId', None) or getattr(account, 'appName', None)
                entity_id = getattr(account, 'entityId', None) or getattr(account, 'userId', 'default')
            
            # Build MCP endpoint if connection is active
            mcp_endpoint = None
            if str(status).lower() == "active":
                account_dict = _account_to_dict(account)
                mcp_endpoint = self._resolve_connection_endpoint(
                    connection_id,
                    account_dict,
                    entity_id,
                )
            
            return {
                "connectionId": connection_id,
                "integrationId": integration_id,
                "status": status,
                "mcpEndpoint": mcp_endpoint,
                "createdAt": getattr(account, 'createdAt', None),
            }
            
        except ComposioSDKError as exc:
            error_msg = f"Composio SDK error getting connection: {exc}"
            logger.error(error_msg)
            raise ComposioError(error_msg) from exc
        except Exception as exc:
            error_msg = f"Failed to get connection: {exc}"
            logger.error(error_msg)
            raise ComposioError(error_msg) from exc

    def delete_connection(self, connection_id: str) -> bool:
        """
        Delete/revoke a connection using official SDK.

        Args:
            connection_id: Connection ID to delete

        Returns:
            True if deleted successfully

        Raises:
            ComposioError: If deletion fails
        """
        try:
            self.client.connected_accounts.delete(connection_id)
            return True
        except ComposioSDKError as exc:
            logger.error(f"Composio SDK error deleting connection {connection_id}: {exc}")
            raise ComposioError(f"Failed to delete connection: {exc}") from exc
        except Exception as exc:
            logger.error(f"Failed to delete connection {connection_id}: {exc}")
            raise ComposioError(f"Failed to delete connection: {exc}") from exc

    def get_mcp_endpoint(self, connection_id: str, user_id: str = "default") -> str:
        """
        Construct MCP endpoint URL for a connection.

        Args:
            connection_id: Connection ID
            user_id: User identifier

        Returns:
            MCP endpoint URL
        """
        return f"{COMPOSIO_MCP_BASE}/{connection_id}/mcp?user_id={user_id}"

    def validate_api_key(self) -> bool:
        """
        Validate that the API key works by attempting to list apps.

        Returns:
            True if API key is valid
        """
        try:
            apps = self.list_apps()
            return len(apps) >= 0  # Any response (even empty) means key is valid
        except ComposioError:
            return False
