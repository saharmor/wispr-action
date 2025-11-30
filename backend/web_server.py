"""Flask web server for command management UI."""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from functools import wraps
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Tuple
from flask_compress import Compress

from catalog_configurator import get_catalog_configurator
from catalog_service import get_catalog_service
from command_manager import get_command_manager
from composio_client import ComposioClient, ComposioError
from constants import HTTPStatus
from parser import parse_command
from executor import execute
from monitor import get_monitor
from config import WEB_PORT
from mcp_client import MCPConfigError, get_mcp_manager
from execution_history import get_execution_logs, get_execution_count
from command_runner import execute_with_logging
from secret_store import (
    delete_composio_api_key,
    get_composio_api_key,
    is_composio_configured,
    set_composio_api_key,
)


app = Flask(__name__, static_folder='../web', static_url_path='')
CORS(app)

# ===== Performance & Compression =====
# Disable jsonify pretty printing in production responses
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
# Encourage browser caching for static files; index is handled separately
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 60 * 60 * 24 * 30  # 30 days
# Enable gzip compression for responses (including static assets)
Compress(app)

# ===== Constants (using shared HTTPStatus class) =====
HTTP_OK = HTTPStatus.OK
HTTP_CREATED = HTTPStatus.CREATED
HTTP_BAD_REQUEST = HTTPStatus.BAD_REQUEST
HTTP_NOT_FOUND = HTTPStatus.NOT_FOUND
HTTP_INTERNAL_ERROR = HTTPStatus.INTERNAL_ERROR


# ===== Response Utilities =====

def success_response(data: Optional[Dict[str, Any]] = None, status_code: int = HTTP_OK) -> Tuple[Dict, int]:
    """
    Create a standardized success response.
    
    Args:
        data: Optional data to include in response
        status_code: HTTP status code
        
    Returns:
        Tuple of (response_dict, status_code)
    """
    response = {"success": True}
    if data:
        response.update(data)
    return jsonify(response), status_code


def error_response(error: str, status_code: int = HTTP_INTERNAL_ERROR) -> Tuple[Dict, int]:
    """
    Create a standardized error response.
    
    Args:
        error: Error message
        status_code: HTTP status code
        
    Returns:
        Tuple of (response_dict, status_code)
    """
    return jsonify({
        "success": False,
        "error": error
    }), status_code


def handle_errors(f):
    """
    Decorator to handle exceptions in route handlers.
    
    Catches exceptions and returns standardized error responses.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except MCPConfigError as e:
            return error_response(str(e), HTTP_BAD_REQUEST)
        except ValueError as e:
            return error_response(str(e), HTTP_BAD_REQUEST)
        except Exception as e:
            app.logger.exception("Unhandled error in route %s", f.__name__)
            root_error = e
            if isinstance(e, BaseExceptionGroup) and getattr(e, "exceptions", None):
                root_error = e.exceptions[0]
                app.logger.error(
                    "ExceptionGroup encountered in %s with %d sub-exceptions; returning first: %s",
                    f.__name__,
                    len(e.exceptions),
                    root_error,
                )
            return error_response(str(root_error), HTTP_INTERNAL_ERROR)
    return decorated_function


class HealthCheckFilter(logging.Filter):
    """Filter out health check requests from logs."""
    
    def filter(self, record):
        # Filter out GET requests to /api/monitor/status
        return not (hasattr(record, 'getMessage') and 
                   '/api/monitor/status' in record.getMessage())

@app.after_request
def add_security_and_cache_headers(response):
    """
    Add basic security and caching headers.
    - Cache static assets aggressively
    - Avoid caching index (so UI updates are picked up)
    """
    try:
        path = request.path or ""
        # Do not cache the main HTML shell
        if path == "/" or path.endswith("/index.html"):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        else:
            # Cache static assets longer and mark immutable for better performance
            if path.endswith(('.js', '.css', '.png', '.ico', '.svg', '.jpg', '.jpeg', '.webp')):
                response.headers.setdefault('Cache-Control', 'public, max-age=604800, immutable')  # 7 days
        # Light hardening
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    except Exception:
        # Never fail the request on header addition
        pass
    return response


@app.route('/')
def index():
    """Serve the main UI."""
    return send_from_directory('../web', 'index.html')


@app.route('/api/commands', methods=['GET'])
@handle_errors
def get_commands():
    """Get all commands."""
    manager = get_command_manager()
    commands = manager.get_all_commands()
    return success_response({"commands": commands})


@app.route('/api/commands', methods=['POST'])
@handle_errors
def create_command():
    """Create a new command."""
    data = request.json
    manager = get_command_manager()
    command = manager.add_command(data)
    return success_response({"command": command}, HTTP_CREATED)


@app.route('/api/commands/<command_id>', methods=['GET'])
@handle_errors
def get_command(command_id):
    """Get a specific command."""
    manager = get_command_manager()
    command = manager.get_command(command_id)
    
    if not command:
        return error_response("Command not found", HTTP_NOT_FOUND)
    
    return success_response({"command": command})


@app.route('/api/commands/<command_id>', methods=['PUT'])
@handle_errors
def update_command(command_id):
    """Update a command."""
    data = request.json
    manager = get_command_manager()
    command = manager.update_command(command_id, data)
    
    if not command:
        return error_response("Command not found", HTTP_NOT_FOUND)
    
    return success_response({"command": command})


@app.route('/api/commands/<command_id>', methods=['DELETE'])
@handle_errors
def delete_command(command_id):
    """Delete a command."""
    manager = get_command_manager()
    success = manager.delete_command(command_id)
    
    if not success:
        return error_response("Command not found", HTTP_NOT_FOUND)
    
    return success_response({"message": "Command deleted"})


@app.route('/api/mcp/servers', methods=['GET'])
@handle_errors
def list_mcp_servers():
    manager = get_mcp_manager()
    return success_response({"servers": manager.list_servers()})


@app.route('/api/mcp/servers', methods=['POST'])
@handle_errors
def upsert_mcp_server():
    data = request.json or {}
    manager = get_mcp_manager()
    server = manager.upsert_server(data)
    status = HTTP_CREATED if not data.get('id') else HTTP_OK
    return success_response({"server": server}, status)


@app.route('/api/mcp/servers/<server_id>', methods=['DELETE'])
@handle_errors
def delete_mcp_server(server_id):
    manager = get_mcp_manager()
    removed = manager.delete_server(server_id)
    if not removed:
        return error_response("Server not found", HTTP_NOT_FOUND)
    return success_response({"message": "Server deleted"})


@app.route('/api/mcp/servers/<server_id>/secrets', methods=['PUT'])
@handle_errors
def update_mcp_secrets(server_id):
    data = request.json or {}
    if not isinstance(data, dict):
        raise ValueError("Secrets payload must be an object")
    manager = get_mcp_manager()
    flags = manager.update_secrets(server_id, data)
    return success_response({"secretsSet": flags})


@app.route('/api/mcp/servers/<server_id>/test', methods=['POST'])
@handle_errors
def test_mcp_server(server_id):
    manager = get_mcp_manager()
    tools = manager.list_tools(server_id, force_refresh=True)
    return success_response({
        "toolsCount": len(tools),
        "message": f"Connected successfully. {len(tools)} tool(s) available."
    })


@app.route('/api/mcp/servers/<server_id>/tools', methods=['GET'])
@handle_errors
def list_mcp_server_tools(server_id):
    manager = get_mcp_manager()
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    tools = manager.list_tools(server_id, force_refresh=force_refresh)
    return success_response({"tools": tools})


@app.route('/api/mcp/tools', methods=['GET'])
@handle_errors
def list_all_mcp_tools():
    manager = get_mcp_manager()
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    tools = manager.list_tools(force_refresh=force_refresh)
    return success_response({"tools": tools})


@app.route('/api/mcp/catalog', methods=['GET'])
@handle_errors
def list_mcp_catalog():
    catalog = get_catalog_service()
    query = request.args.get('search')
    tag = request.args.get('tag')
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    limit = request.args.get('limit', 25, type=int)
    offset = request.args.get('offset', 0, type=int)
    result = catalog.search_entries(
        query=query,
        tag=tag,
        limit=limit,
        offset=offset,
        force_refresh=force_refresh,
    )
    return success_response(result)


@app.route('/api/mcp/catalog/<path:entry_id>', methods=['GET'])
@handle_errors
def get_mcp_catalog_entry(entry_id):
    catalog = get_catalog_service()
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    entry = catalog.get_entry(entry_id, force_refresh=force_refresh)
    if not entry:
        return error_response("Catalog entry not found", HTTP_NOT_FOUND)
    return success_response({"entry": entry})


@app.route('/api/mcp/catalog/<path:entry_id>/configure', methods=['POST'])
@handle_errors
def configure_mcp_from_catalog(entry_id):
    configurator = get_catalog_configurator()
    payload = request.json or {}
    server = configurator.install_from_catalog(entry_id, payload)
    return success_response({"server": server}, HTTP_CREATED)


@app.route('/api/commands/<command_id>/toggle', methods=['PATCH'])
@handle_errors
def toggle_command(command_id):
    """Toggle command enabled status."""
    manager = get_command_manager()
    new_status = manager.toggle_command(command_id)
    
    if new_status is None:
        return error_response("Command not found", HTTP_NOT_FOUND)
    
    return success_response({"enabled": new_status})


@app.route('/api/commands/test', methods=['POST'])
@handle_errors
def test_command():
    """Test parsing a command phrase."""
    data = request.json
    text = data.get('text', '')
    
    if not text:
        return error_response("No text provided", HTTP_BAD_REQUEST)
    
    # Parse the command
    result = parse_command(text)
    return success_response({"parse_result": result})


@app.route('/api/commands/execute', methods=['POST'])
@handle_errors
def execute_command():
    """Execute a command with given parameters."""
    data = request.json
    command_id = data.get('command_id')
    parameters = data.get('parameters', {})
    timeout = data.get('timeout')  # Optional timeout in seconds
    original_transcript = data.get('original_transcript')  # Original user command for read-aloud
    
    if not command_id:
        return error_response("No command_id provided", HTTP_BAD_REQUEST)
    
    manager = get_command_manager()
    command = manager.get_command(command_id)
    
    result, log_id, _ = execute_with_logging(
        command_id,
        parameters,
        command=command,
        timeout=timeout,
        confirm_mode=False,
        original_transcript=original_transcript,
    )
    
    return success_response({"result": result.to_dict(), "log_id": log_id})


@app.route('/api/monitor/status', methods=['GET'])
@handle_errors
def monitor_status():
    """Get monitor status."""
    monitor = get_monitor()
    status = monitor.get_status()
    return success_response({"status": status})


@app.route('/api/monitor/start', methods=['POST'])
@handle_errors
def monitor_start():
    """Start the monitor."""
    monitor = get_monitor()
    
    if monitor.is_running:
        return error_response("Monitor is already running", HTTP_BAD_REQUEST)
    
    monitor.start()
    return success_response({"message": "Monitor started"})


@app.route('/api/monitor/stop', methods=['POST'])
@handle_errors
def monitor_stop():
    """Stop the monitor."""
    monitor = get_monitor()
    
    if not monitor.is_running:
        return error_response("Monitor is not running", HTTP_BAD_REQUEST)
    
    monitor.stop()
    return success_response({"message": "Monitor stopped"})


@app.route('/api/logs', methods=['GET'])
@handle_errors
def get_logs():
    """Get recent execution logs from database."""
    limit = request.args.get('limit', 20, type=int)
    offset = request.args.get('offset', 0, type=int)
    
    logs = get_execution_logs(limit=limit, offset=offset)
    total_count = get_execution_count()
    
    return success_response({
        "logs": logs,
        "total": total_count,
        "has_more": (offset + len(logs)) < total_count
    })


# ===== Path Validation Utilities =====

PATH_TYPE_MESSAGES = {
    'script_path': 'Script not found at: {}',
    'python_interpreter': 'Python interpreter not found at: {}',
    'working_directory': 'Directory not found: {}',
    'env_file': 'Environment file not found: {}'
}


def resolve_validation_path(path: str, key: str, working_dir: Optional[str]) -> Optional[str]:
    """
    Resolve and validate a path.
    
    Args:
        path: Path to resolve
        key: Path type key
        working_dir: Optional working directory for relative paths
        
    Returns:
        Resolved path or None if cannot be validated
    """
    expanded_path = os.path.expanduser(path)
    is_relative = not os.path.isabs(expanded_path)
    
    # For relative paths (except working_directory), we need a working directory
    if is_relative and key != 'working_directory':
        if working_dir:
            return os.path.join(os.path.expanduser(working_dir), expanded_path)
        else:
            return None  # Cannot validate without working directory
    
    return expanded_path


def create_validation_result(valid: bool, message: str, resolved_path: Optional[str] = None) -> Dict:
    """
    Create a validation result dictionary.
    
    Args:
        valid: Whether the path is valid
        message: Validation message
        resolved_path: Optional resolved path
        
    Returns:
        Validation result dictionary
    """
    result = {"valid": valid, "message": message}
    if resolved_path:
        result["resolved_path"] = resolved_path
    return result


def validate_single_path(key: str, path: str, working_dir: Optional[str]) -> Dict:
    """
    Validate a single path.
    
    Args:
        key: Path type key
        path: Path to validate
        working_dir: Optional working directory for relative paths
        
    Returns:
        Validation result dictionary
    """
    # Empty paths are allowed (they're optional)
    if not path:
        return create_validation_result(True, "")
    
    # Resolve path
    full_path = resolve_validation_path(path, key, working_dir)
    
    if full_path is None:
        return create_validation_result(
            False, 
            "Cannot validate relative path without a working directory"
        )
    
    # Check if path exists
    if os.path.exists(full_path):
        return create_validation_result(True, "✓ Path exists", full_path)
    
    # Generate error message based on path type
    error_template = PATH_TYPE_MESSAGES.get(key, "Path not found: {}")
    return create_validation_result(False, error_template.format(full_path))


@app.route('/api/validate-paths', methods=['POST'])
@handle_errors
def validate_paths():
    """Validate that file paths exist."""
    data = request.json
    paths = data.get('paths', {})
    
    # Get working directory for resolving relative paths
    working_dir = paths.get('working_directory', '')
    
    # Validate each path
    validation_results = {
        key: validate_single_path(key, path, working_dir)
        for key, path in paths.items()
    }
    
    # Overall validation status
    all_valid = all(result["valid"] for result in validation_results.values())
    
    return success_response({
        "all_valid": all_valid,
        "results": validation_results
    })


# ===== Composio OAuth Integration Endpoints =====

@app.route('/api/composio/settings', methods=['GET'])
@handle_errors
def get_composio_settings():
    """Check if Composio API key is configured."""
    configured = is_composio_configured()
    return success_response({"configured": configured})


@app.route('/api/composio/settings', methods=['PUT'])
@handle_errors
def update_composio_settings():
    """Store or update Composio API key."""
    data = request.json or {}
    api_key = data.get('apiKey', '').strip()
    
    if not api_key:
        return error_response("API key is required", HTTP_BAD_REQUEST)
    
    # Validate API key by attempting to create a client
    try:
        client = ComposioClient(api_key)
        if not client.validate_api_key():
            return error_response("Invalid Composio API key", HTTP_BAD_REQUEST)
    except ComposioError as exc:
        return error_response(f"Invalid API key: {exc}", HTTP_BAD_REQUEST)
    
    # Store API key
    set_composio_api_key(api_key)
    
    return success_response({"message": "Composio API key saved successfully"})


@app.route('/api/composio/settings', methods=['DELETE'])
@handle_errors
def delete_composio_settings():
    """Delete stored Composio API key."""
    delete_composio_api_key()
    return success_response({"message": "Composio API key deleted"})


@app.route('/api/composio/apps', methods=['GET'])
@handle_errors
def list_composio_apps():
    """List available Composio apps/integrations."""
    api_key = get_composio_api_key()
    if not api_key:
        return error_response("Composio API key not configured", HTTP_BAD_REQUEST)
    
    try:
        client = ComposioClient(api_key)
        apps = client.list_apps()
        return success_response({"apps": apps})
    except ComposioError as exc:
        return error_response(str(exc), HTTP_INTERNAL_ERROR)


@app.route('/api/composio/auth/initiate', methods=['POST'])
@handle_errors
def initiate_oauth():
    """Initiate OAuth flow for a Composio app."""
    data = request.json or {}
    app_name = data.get('appName')
    entity_id = data.get('entityId', 'default')
    auth_config = data.get('authConfig') or {}
    connection_name = data.get('connectionName')
    
    if not app_name:
        return error_response("App name is required", HTTP_BAD_REQUEST)
    
    api_key = get_composio_api_key()
    if not api_key:
        return error_response("Composio API key not configured", HTTP_BAD_REQUEST)
    
    try:
        client = ComposioClient(api_key)
        result = client.initiate_connection(
            app_name,
            entity_id=entity_id,
            auth_config=auth_config,
            connection_name=connection_name,
        )
        return success_response(result)
    except ComposioError as exc:
        return error_response(str(exc), HTTP_INTERNAL_ERROR)


@app.route('/api/composio/auth/status/<connection_id>', methods=['GET'])
@handle_errors
def check_oauth_status(connection_id):
    """Check OAuth connection status."""
    api_key = get_composio_api_key()
    if not api_key:
        return error_response("Composio API key not configured", HTTP_BAD_REQUEST)
    
    try:
        client = ComposioClient(api_key)
        connection = client.get_connection(connection_id)
        return success_response(connection)
    except ComposioError as exc:
        return error_response(str(exc), HTTP_INTERNAL_ERROR)


@app.route('/api/composio/auth/<connection_id>', methods=['DELETE'])
@handle_errors
def revoke_oauth(connection_id):
    """Revoke OAuth connection."""
    api_key = get_composio_api_key()
    if not api_key:
        return error_response("Composio API key not configured", HTTP_BAD_REQUEST)
    
    try:
        client = ComposioClient(api_key)
        success = client.delete_connection(connection_id)
        
        if not success:
            return error_response("Failed to revoke connection", HTTP_INTERNAL_ERROR)
        
        return success_response({"message": "OAuth connection revoked"})
    except ComposioError as exc:
        return error_response(str(exc), HTTP_INTERNAL_ERROR)


def run_server(port: int = WEB_PORT, debug: bool = False):
    """Run the Flask server."""
    # Apply health check filter to suppress /api/monitor/status logs
    log = logging.getLogger('werkzeug')
    log.addFilter(HealthCheckFilter())
    log.setLevel(logging.WARNING)
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║         Wispr Action Web Server - STARTING                   ║
╚══════════════════════════════════════════════════════════════╝

Server running at: http://localhost:{port}
Open this URL in your browser to configure commands

""")
    app.run(host='0.0.0.0', port=port, debug=debug, use_reloader=False)


if __name__ == '__main__':
    run_server()

