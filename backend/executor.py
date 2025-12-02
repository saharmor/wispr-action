"""Action execution engine for script and HTTP commands."""

import subprocess
import json
import os
import re
import requests
import threading
from typing import Dict, Any, Optional, Tuple
from datetime import datetime
from command_manager import get_command_manager
from config import CONFIRM_MODE
from constants import ActionType, HTTPMethod
from dotenv import dotenv_values
from mcp_client import MCPConfigError, MCPExecutionError, get_mcp_manager
from typing import Optional as TypingOptional, Dict as TypingDict

# ===== Constants =====
TERMINAL_LAUNCH_TIMEOUT = 10  # Seconds to wait for terminal launch
RESPONSE_TEXT_LIMIT = 500     # Character limit for HTTP response text
MONITOR_DELAY = 0.5            # Seconds between terminal monitor checks
TERMINAL_CLOSE_DELAY = 5       # Grace period before closing the terminal window


class ExecutionResult:
    """Result of command execution."""
    
    def __init__(
        self,
        success: bool,
        command_id: str,
        command_name: str,
        output: str = "",
        error: str = "",
        duration: float = 0.0,
        meta: TypingOptional[TypingDict[str, Any]] = None
    ):
        self.success = success
        self.command_id = command_id
        self.command_name = command_name
        self.output = output
        self.error = error
        self.duration = duration
        self.timestamp = datetime.now().isoformat()
        self.meta = meta or {}
    
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            "success": self.success,
            "command_id": self.command_id,
            "command_name": self.command_name,
            "output": self.output,
            "error": self.error,
            "duration": self.duration,
            "timestamp": self.timestamp,
            "meta": self.meta
        }


# ===== Utility Functions =====

def create_result(command: Dict, success: bool, start_time: datetime, 
                  output: str = "", error: str = "", 
                  meta: TypingOptional[TypingDict[str, Any]] = None) -> ExecutionResult:
    """Factory function to create ExecutionResult with calculated duration."""
    duration = (datetime.now() - start_time).total_seconds()
    return ExecutionResult(
        success=success,
        command_id=command['id'],
        command_name=command['name'],
        output=output,
        error=error,
        duration=duration,
        meta=meta
    )


def resolve_path(path: str, working_directory: Optional[str] = None) -> str:
    """
    Resolve a path with tilde expansion and relative path handling.
    
    Args:
        path: Path to resolve
        working_directory: Optional working directory for relative paths
        
    Returns:
        Resolved absolute path
    """
    resolved = os.path.expanduser(path)
    if not os.path.isabs(resolved) and working_directory:
        resolved = os.path.join(working_directory, resolved)
    return resolved


def load_env_vars(env_file: str) -> Dict[str, str]:
    """
    Load environment variables from a .env file.
    
    Args:
        env_file: Path to .env file
        
    Returns:
        Dictionary of environment variables (empty if file not found)
    """
    env_file_path = os.path.expanduser(env_file)
    if os.path.exists(env_file_path):
        print(f"Loaded environment from: {env_file_path}")
        return dict(dotenv_values(env_file_path))
    else:
        print(f"Warning: Environment file not found: {env_file_path}")
        return {}


def request_confirmation() -> bool:
    """
    Request user confirmation for execution.
    
    Returns:
        True if user confirms, False otherwise
    """
    response = input("Execute? (y/n): ")
    return response.lower() == 'y'


def escape_for_applescript(text: str, for_double_quotes: bool = False) -> str:
    """
    Escape text for use in AppleScript.
    
    Args:
        text: Text to escape
        for_double_quotes: If True, escape for use inside double quotes
        
    Returns:
        Escaped text
    """
    if for_double_quotes:
        # Escape backslashes first, then double quotes
        return text.replace('\\', '\\\\').replace('"', '\\"')
    else:
        # Escape single quotes for shell
        return text.replace("'", "'\\''")


def build_command_string(script_path: str, python_interpreter: str = "", 
                        args_str: str = "") -> str:
    """
    Build command string with proper quoting.
    
    Args:
        script_path: Path to script
        python_interpreter: Optional Python interpreter path
        args_str: Optional argument string
        
    Returns:
        Complete command string
    """
    if python_interpreter:
        base_cmd = f'"{python_interpreter}" "{script_path}"'
        print(f"Using virtual environment: {python_interpreter}")
    else:
        base_cmd = f'"{script_path}"'
        print(f"Using script directly (no virtualenv specified)")
    
    return f"{base_cmd} {args_str}" if args_str else base_cmd


def prepare_execution_environment(action: Dict, parameters: Dict, command: Dict) -> Tuple[str, str, str, Dict, Dict]:
    """
    Prepare all execution parameters (paths, command, environment).
    
    Args:
        action: Action definition from command
        parameters: Command parameters
        command: Full command definition
        
    Returns:
        Tuple of (script_path, full_command, cwd, env_dict, env_vars_only)
    """
    # Get working directory first (needed for resolving relative paths)
    cwd = action.get('working_directory')
    if cwd:
        cwd = os.path.expanduser(cwd)
        if os.path.exists(cwd):
            print(f"Working directory: {cwd}")
        else:
            print(f"WARNING: Working directory not found: {cwd}")
            print(f"         Using current directory instead")
            cwd = None
    else:
        print(f"Working directory: {os.getcwd()} (current directory)")
    
    # Resolve script path
    script_path = resolve_path(action['script_path'], cwd)
    print(f"Resolved script path: {script_path}")
    
    # Resolve Python interpreter if specified
    python_interpreter = action.get('python_interpreter', '')
    if python_interpreter:
        python_interpreter = resolve_path(python_interpreter, cwd)
        print(f"Resolved Python interpreter: {python_interpreter}")
        
        # Validate Python interpreter
        if not os.path.exists(python_interpreter):
            print(f"WARNING: Python interpreter not found at: {python_interpreter}")
            print(f"         Command may fail or use system Python instead!")
        elif not os.access(python_interpreter, os.X_OK):
            print(f"WARNING: Python interpreter not executable: {python_interpreter}")
    
    # Build arguments and command
    args_template = action.get('args_template', '')
    args_str = interpolate_parameters(args_template, parameters, command)
    full_command = build_command_string(script_path, python_interpreter, args_str)
    
    print(f"Executing: {full_command}")
    
    # Load environment variables
    env = os.environ.copy()
    env_vars = {}
    env_file = action.get('env_file', '')
    if env_file:
        env_vars = load_env_vars(env_file)
        env.update(env_vars)
    
    return script_path, full_command, cwd, env, env_vars


def generate_terminal_applescript(full_command: str, cwd: Optional[str], 
                                  env_vars: Dict[str, str]) -> str:
    """
    Generate AppleScript to launch command in Terminal.
    
    Args:
        full_command: Complete command to execute
        cwd: Optional working directory
        env_vars: Environment variables to export
        
    Returns:
        AppleScript code as string
    """
    # Escape command for AppleScript
    escaped_command = escape_for_applescript(full_command)
    
    # Build cd command if working directory is specified
    cd_command = f"cd '{cwd}' && " if cwd else ""
    
    # Build export commands for environment variables
    env_commands = ""
    for key, value in env_vars.items():
        escaped_value = escape_for_applescript(value) if value else ""
        env_commands += f"export {key}='{escaped_value}'; "
    
    # Combine all commands
    terminal_command = f"{cd_command}{env_commands}{escaped_command}"
    terminal_command_escaped = escape_for_applescript(terminal_command, for_double_quotes=True)
    
    # AppleScript that launches the terminal and returns the window ID
    return f'''tell application "Terminal"
    activate
    set newTab to do script "{terminal_command_escaped}"
    set newWindow to first window whose tabs contains newTab
    set index of newWindow to 1
    return id of newWindow
end tell'''


def generate_monitor_applescript(window_id: str) -> str:
    """
    Generate AppleScript to monitor and close terminal window.
    
    Args:
        window_id: Terminal window ID to monitor
        
    Returns:
        AppleScript code as string
    """
    return f'''tell application "Terminal"
    repeat
        try
            set targetWindow to window id {window_id}
            set isWindowBusy to busy of selected tab of targetWindow
            if not isWindowBusy then
                delay {TERMINAL_CLOSE_DELAY}
                set stillBusy to busy of selected tab of targetWindow
                if not stillBusy then
                    close targetWindow
                    exit repeat
                end if
            end if
        on error
            exit repeat
        end try
        delay {MONITOR_DELAY}
    end repeat
end tell'''


def execute_in_foreground(full_command: str, cwd: Optional[str], env_vars: Dict,
                         command: Dict, start_time: datetime) -> ExecutionResult:
    """
    Execute command in foreground (visible terminal window).
    
    Args:
        full_command: Complete command string
        cwd: Working directory
        env_vars: Environment variables to export in terminal
        command: Command definition
        start_time: Execution start time
        
    Returns:
        ExecutionResult
    """
    # Generate AppleScript
    applescript = generate_terminal_applescript(full_command, cwd, env_vars)
    
    print(f"Running in foreground terminal (will auto-close when done)...")
    
    try:
        result = subprocess.run(
            ['osascript', '-e', applescript],
            capture_output=True,
            text=True,
            timeout=TERMINAL_LAUNCH_TIMEOUT
        )

        if result.returncode == 0:
            # Get the window ID and start monitor
            window_id = result.stdout.strip()
            monitor_script = generate_monitor_applescript(window_id)
            
            # Run monitor script in background
            subprocess.Popen(
                ['osascript', '-e', monitor_script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True
            )
            
            return create_result(
                command, True, start_time,
                output="Command launched in foreground terminal window",
                meta={"terminal_window_id": window_id, "mode": "foreground"}
            )
        else:
            return create_result(
                command, False, start_time,
                error=f"Failed to open terminal: {result.stderr}"
            )
    
    except subprocess.TimeoutExpired:
        return create_result(
            command, False, start_time,
            error="Terminal launch timed out"
        )
    except Exception as e:
        return create_result(
            command, False, start_time,
            error=f"Foreground execution error: {str(e)}"
        )


def execute_in_background(full_command: str, cwd: Optional[str], env: Dict,
                         command: Dict, start_time: datetime) -> ExecutionResult:
    """
    Execute command in background (fire and forget).
    
    Args:
        full_command: Complete command string
        cwd: Working directory
        env: Environment variables
        command: Command definition
        start_time: Execution start time
        
    Returns:
        ExecutionResult
    """
    try:
        process = subprocess.Popen(
            full_command,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            env=env,
            cwd=cwd,
            start_new_session=True  # Detach from parent process
        )
        
        return create_result(
            command, True, start_time,
            output=f"Command launched successfully (PID: {process.pid})",
            meta={"pid": process.pid, "mode": "background"}
        )
    
    except Exception as e:
        return create_result(
            command, False, start_time,
            error=f"Background execution error: {str(e)}"
        )


def interpolate_parameters(template: str, parameters: Dict[str, Any], command: Optional[Dict] = None) -> str:
    """
    Interpolate parameters into a template string with optional sections.
    
    Replaces {param_name} with parameter values. Handles both original and sanitized parameter names.
    
    Optional sections can be denoted with square brackets []. If any parameter within a bracketed
    section is missing or None, the entire section is omitted from the result.
    
    Examples:
        "[--id={id}]" → "--id=5" if id=5, "" if id is missing
        "required [--optional={opt}]" → "required --optional=foo" or just "required"
        "[--calendar-id={calendar_id}] [--days={days}]" → includes only provided params
    
    Args:
        template: Template string with {param} placeholders and optional [...] sections
        parameters: Dictionary of parameter values (may use sanitized names)
        command: Optional command definition to map original names to sanitized names
        
    Returns:
        Interpolated string with optional sections processed
    """
    result = template
    
    # Build mapping from original names to sanitized parameter values
    if command:
        manager = get_command_manager()
        param_map = manager.build_parameter_map(command, parameters)
    else:
        param_map = parameters
    
    # Process conditional sections first: [...] where content may contain {param} placeholders
    def process_conditional(match):
        """Process a single conditional section."""
        content = match.group(1)
        
        # Find all {param} placeholders in this section
        params_in_section = re.findall(r'\{([^}]+)\}', content)
        
        # Check if all parameters in this section are available and non-empty
        all_present = True
        for param_name in params_in_section:
            value = param_map.get(param_name)
            if value is None or value == '':
                all_present = False
                break
        
        # If all present, interpolate and return; otherwise return empty string
        if all_present:
            interpolated = content
            for param_name in params_in_section:
                value = param_map[param_name]
                placeholder = "{" + param_name + "}"
                
                # Convert value to string
                if isinstance(value, (int, float, bool)):
                    str_value = str(value)
                elif isinstance(value, str):
                    str_value = value
                else:
                    str_value = json.dumps(value)
                
                interpolated = interpolated.replace(placeholder, str_value)
            return interpolated
        else:
            return ''
    
    # Process all conditional sections (non-nested only)
    result = re.sub(r'\[([^\[\]]+)\]', process_conditional, result)
    
    # Now interpolate remaining (required) parameters outside of brackets
    for key, value in param_map.items():
        if value is None:
            continue
        placeholder = "{" + key + "}"
        
        # Convert value to string appropriately
        if isinstance(value, (int, float, bool)):
            str_value = str(value)
        elif isinstance(value, str):
            str_value = value
        else:
            str_value = json.dumps(value)
        
        result = result.replace(placeholder, str_value)
    
    # Clean up extra whitespace that may have been left by removed sections
    result = ' '.join(result.split())
    
    # Remove any unreplaced placeholders (parameters that were None or not provided)
    # This handles cases where optional parameters in non-bracketed sections weren't replaced
    result = re.sub(r'\{[^}]+\}', '', result)
    
    # Clean up whitespace again after removing placeholders
    result = ' '.join(result.split())
    
    return result


def execute_script(
    command: Dict,
    parameters: Dict[str, Any],
    confirm_mode: bool = False,
    timeout: int = 0
) -> ExecutionResult:
    """
    Execute a script-based command.
    
    Supports:
    - Custom Python interpreters (virtualenv)
    - Environment files (.env)
    - Working directory
    - Foreground execution (visible terminal window)
    - Background execution (fire and forget, returns immediately)
    
    Args:
        command: Command definition
        parameters: Extracted parameters
        confirm_mode: Whether to ask for confirmation
        timeout: Execution timeout in seconds (default: 0 = no timeout, only applies to 
                 foreground AppleScript launch)
        
    Returns:
        ExecutionResult with success status and PID
        
    Note:
        Scripts are launched asynchronously and return immediately without waiting
        for completion. This prevents timeout errors for long-running scripts.
    """
    start_time = datetime.now()
    action = command['action']
    run_foreground = command.get('run_foreground', False)
    
    try:
        # Prepare all execution parameters
        script_path, full_command, cwd, env, env_vars = prepare_execution_environment(
            action, parameters, command
        )
        
        # Request confirmation if needed
        if confirm_mode and not request_confirmation():
            return create_result(
                command, False, start_time,
                error="Execution cancelled by user"
            )
        
        # Execute based on mode
        if run_foreground:
            return execute_in_foreground(full_command, cwd, env_vars, command, start_time)
        else:
            return execute_in_background(full_command, cwd, env, command, start_time)
    
    except subprocess.TimeoutExpired:
        return create_result(
            command, False, start_time,
            error="Script execution timed out"
        )
    except Exception as e:
        return create_result(
            command, False, start_time,
            error=f"Script execution error: {str(e)}"
        )


def prepare_http_request(action: Dict, parameters: Dict, command: Dict) -> Tuple[str, str, Dict, Any]:
    """
    Prepare HTTP request parameters.
    
    Args:
        action: Action definition from command
        parameters: Command parameters
        command: Full command definition
        
    Returns:
        Tuple of (url, method, headers, body)
    """
    # Interpolate URL
    url = interpolate_parameters(action['url'], parameters, command)
    method = action.get('method', 'POST').upper()
    
    # Build headers
    headers = {}
    if 'headers' in action:
        for header in action['headers']:
            key = header['key']
            value = interpolate_parameters(header['value'], parameters, command)
            headers[key] = value
    
    # Build body
    body = None
    if 'body_template' in action and action['body_template']:
        body_template = action['body_template']
        body_str = interpolate_parameters(body_template, parameters, command)
        
        # Try to parse as JSON
        try:
            body = json.loads(body_str)
        except json.JSONDecodeError:
            # Use as string
            body = body_str
    
    print(f"HTTP {method}: {url}")
    if body:
        print(f"Body: {json.dumps(body, indent=2) if isinstance(body, dict) else body}")
    
    return url, method, headers, body


def make_http_request(method: str, url: str, headers: Dict, body: Any, timeout: int):
    """
    Make HTTP request using appropriate method.
    
    Args:
        method: HTTP method
        url: Request URL
        headers: Request headers
        body: Request body (for POST/PUT)
        timeout: Request timeout (None for no timeout)
        
    Returns:
        Response object
        
    Raises:
        ValueError: If method is unsupported
    """
    request_timeout = None if timeout == 0 else timeout
    
    # HTTP method dispatch
    http_methods = {
        'GET': lambda: requests.get(url, headers=headers, timeout=request_timeout),
        'POST': lambda: requests.post(url, headers=headers, json=body, timeout=request_timeout),
        'PUT': lambda: requests.put(url, headers=headers, json=body, timeout=request_timeout),
        'DELETE': lambda: requests.delete(url, headers=headers, timeout=request_timeout)
    }
    
    if method not in http_methods:
        raise ValueError(f"Unsupported HTTP method: {method}")
    
    return http_methods[method]()


def execute_http(
    command: Dict,
    parameters: Dict[str, Any],
    confirm_mode: bool = False,
    timeout: int = 0
) -> ExecutionResult:
    """
    Execute an HTTP-based command.
    
    Args:
        command: Command definition
        parameters: Extracted parameters
        confirm_mode: Whether to ask for confirmation
        timeout: HTTP request timeout in seconds (default: 0 = no timeout)
        
    Returns:
        ExecutionResult
    """
    start_time = datetime.now()
    action = command['action']
    
    try:
        # Prepare request
        url, method, headers, body = prepare_http_request(action, parameters, command)
        
        # Request confirmation if needed
        if confirm_mode and not request_confirmation():
            return create_result(
                command, False, start_time,
                error="Execution cancelled by user"
            )
        
        # Make request
        response = make_http_request(method, url, headers, body, timeout)
        
        # Check response
        if response.status_code < 400:
            return create_result(
                command, True, start_time,
                output=f"Status: {response.status_code}\n{response.text[:RESPONSE_TEXT_LIMIT]}"
            )
        else:
            return create_result(
                command, False, start_time,
                output=response.text[:RESPONSE_TEXT_LIMIT],
                error=f"HTTP error: {response.status_code}"
            )
    
    except requests.Timeout:
        return create_result(
            command, False, start_time,
            error="HTTP request timed out"
        )
    except Exception as e:
        return create_result(
            command, False, start_time,
            error=f"HTTP request error: {str(e)}"
        )


def execute(
    command_id: str,
    parameters: Dict[str, Any],
    confirm_mode: Optional[bool] = None,
    timeout: Optional[int] = None,
    original_transcript: Optional[str] = None
) -> ExecutionResult:
    """
    Execute a command with the given parameters.
    
    Args:
        command_id: ID of the command to execute
        parameters: Extracted parameters
        confirm_mode: Override global CONFIRM_MODE if provided
        timeout: Execution timeout in seconds (default: 0 = no timeout)
        original_transcript: Original user command transcript for read-aloud feature
        
    Returns:
        ExecutionResult
    """
    # Use global CONFIRM_MODE if not specified
    if confirm_mode is None:
        confirm_mode = CONFIRM_MODE
    
    # Get command
    manager = get_command_manager()
    command = manager.get_command(command_id)
    
    if not command:
        return ExecutionResult(
            success=False,
            command_id=command_id,
            command_name="Unknown",
            error=f"Command not found: {command_id}"
        )
    
    # Check if command is enabled
    if not command.get('enabled', True):
        return ExecutionResult(
            success=False,
            command_id=command_id,
            command_name=command['name'],
            error="Command is disabled"
        )
    
    # Execute based on action type
    action_type = command['action']['type']
    effective_timeout = timeout if timeout is not None else 0
    
    if action_type == ActionType.SCRIPT:
        return execute_script(command, parameters, confirm_mode, effective_timeout)
    elif action_type == ActionType.HTTP:
        return execute_http(command, parameters, confirm_mode, effective_timeout)
    elif action_type == ActionType.MCP:
        return execute_mcp(command, parameters, confirm_mode, effective_timeout, original_transcript)
    else:
        return ExecutionResult(
            success=False,
            command_id=command_id,
            command_name=command['name'],
            error=f"Unknown action type: {action_type}"
        )


def execute_mcp(
    command: Dict,
    parameters: Dict[str, Any],
    confirm_mode: bool = False,
    timeout: int = 0,
    original_transcript: Optional[str] = None
) -> ExecutionResult:
    """Execute an MCP tool call."""
    start_time = datetime.now()
    action = command['action']
    server_id = action['server_id']
    tool_name = action['tool']

    manager = get_command_manager()
    param_map = manager.build_parameter_map(command, parameters)

    args = dict(action.get('default_args', {}))
    defined_names = {param.get('name') for param in command.get('parameters', []) if param.get('name')}
    for name in defined_names:
        value = param_map.get(name)
        if value not in (None, ""):
            args[name] = value

    # Include any remaining parameters that are not explicitly defined (failsafe)
    for key, value in param_map.items():
        if key in args or value in (None, ""):
            continue
        if not defined_names or key in defined_names:
            args[key] = value

    if confirm_mode and not request_confirmation():
        return create_result(
            command, False, start_time,
            error="Execution cancelled by user"
        )

    try:
        mcp_result = get_mcp_manager().call_tool(
            server_id=server_id,
            tool_name=tool_name,
            arguments=args or None,
            timeout_seconds=timeout if timeout else None
        )
    except (MCPConfigError, MCPExecutionError) as exc:
        return create_result(command, False, start_time, error=str(exc))
    except Exception as exc:
        return create_result(command, False, start_time, error=f"MCP execution error: {exc}")

    if mcp_result.get("isError"):
        result = create_result(
            command,
            False,
            start_time,
            error="MCP tool returned an error",
            output=json.dumps(mcp_result, indent=2)
        )
        
        # Check if we should read results out loud for MCP server
        if original_transcript:
            try_speak_mcp_result(command, server_id, original_transcript, result)
        
        return result

    output_sections = []
    if mcp_result.get("structuredContent"):
        output_sections.append(json.dumps(mcp_result["structuredContent"], indent=2))
    if mcp_result.get("content"):
        output_sections.append(json.dumps(mcp_result["content"], indent=2))

    output_text = "\n".join(output_sections).strip() or "MCP tool executed successfully."

    result = create_result(
        command,
        True,
        start_time,
        output=output_text
    )
    
    # Check if we should read results out loud for MCP server
    if original_transcript:
        try_speak_mcp_result(command, server_id, original_transcript, result)
    
    return result


def try_speak_mcp_result(
    command: Dict,
    server_id: str,
    original_transcript: str,
    result: ExecutionResult
) -> None:
    """Try to speak MCP result if server has read_aloud enabled."""
    try:
        # Import here to avoid circular dependency
        from mcp_client import get_mcp_manager
        from result_speaker import process_and_speak_result
        
        mcp_manager = get_mcp_manager()
        server = mcp_manager.get_server(server_id)
        
        if server and server.get('read_aloud', False):
            # Run text-to-speech in a background thread so it doesn't block
            def speak_in_background():
                try:
                    process_and_speak_result(
                        original_command=original_transcript,
                        execution_result=result.to_dict(),
                        command_name=command.get('name', 'MCP command')
                    )
                except Exception as e:
                    print(f"Error in MCP read-aloud background thread: {e}")
            
            thread = threading.Thread(target=speak_in_background, daemon=True)
            thread.start()
    except Exception as e:
        print(f"Error checking MCP read_aloud setting: {e}")


def log_execution(result: ExecutionResult, log_file: Optional[str] = None) -> None:
    """
    Log execution result to file.
    
    Args:
        result: ExecutionResult to log
        log_file: Optional log file path
    """
    if log_file:
        try:
            with open(log_file, 'a') as f:
                f.write(json.dumps(result.to_dict()) + "\n")
        except IOError as e:
            print(f"Warning: Could not write to log file: {e}")

