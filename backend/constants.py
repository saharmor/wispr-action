"""Central constants and enums to eliminate magic strings throughout the codebase."""

from enum import Enum


class ActionType(str, Enum):
    """Command action types."""
    SCRIPT = "script"
    HTTP = "http"
    MCP = "mcp"


class TransportType(str, Enum):
    """MCP transport types."""
    SSE = "sse"
    HTTP = "http"
    STDIO = "stdio"


class HTTPMethod(str, Enum):
    """HTTP request methods."""
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


class ExecutionStatus(str, Enum):
    """Execution log status."""
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class MCPAuthType(str, Enum):
    """MCP authentication types."""
    NONE = "none"
    API_KEY_HEADER = "apiKeyHeader"
    BEARER_HEADER = "bearerHeader"
    QUERY_PARAM = "queryParam"
    OAUTH = "oauth"
    CUSTOM = "custom"


class MCPSourceType(str, Enum):
    """MCP server source types."""
    CATALOG = "catalog"
    COMPOSIO = "composio"
    CUSTOM = "custom"


class OAuthStatus(str, Enum):
    """OAuth connection status."""
    PENDING = "pending"
    ACTIVE = "active"
    FAILED = "failed"
    ERROR = "error"


# HTTP Status Codes (commonly used ones)
class HTTPStatus:
    """HTTP status codes."""
    OK = 200
    CREATED = 201
    BAD_REQUEST = 400
    NOT_FOUND = 404
    INTERNAL_ERROR = 500


# Special keychain identifiers
COMPOSIO_API_KEY_USERNAME = "__composio__:api_key"

# Regex patterns (compiled once for performance)
import re

TEMPLATE_PATTERN = re.compile(r"\{\{([^}]+)\}\}")
PLACEHOLDER_PATTERN = re.compile(r"\$\{([A-Za-z0-9_]+)\}|\{\{([A-Za-z0-9_]+)\}\}|\{([A-Za-z0-9_]+)\}")
SLUG_PATTERN = re.compile(r"[^a-z0-9]+")

