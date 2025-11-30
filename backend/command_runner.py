"""Helpers for executing commands while keeping execution history in sync."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
import threading
import subprocess

from command_manager import get_command_manager
from constants import ActionType
from executor import ExecutionResult, execute
from execution_history import start_execution_log, update_execution_log
from execution_watcher import start_script_completion_watcher
from result_speaker import process_and_speak_result
from config import READ_COMMAND_ALOUD


def speak_command_name(command_name: str) -> None:
    """
    Speak the command name aloud using macOS native voice.
    
    Args:
        command_name: Name of the command to speak
    """
    if not READ_COMMAND_ALOUD:
        return
    
    try:
        # Use macOS 'say' command to speak "Executing [command name]"
        message = f"Executing {command_name}"
        subprocess.run(['say', message], check=False, timeout=5)
    except subprocess.TimeoutExpired:
        print(f"Warning: Speaking command name timed out")
    except FileNotFoundError:
        print(f"Warning: 'say' command not found (macOS only)")
    except Exception as e:
        print(f"Warning: Failed to speak command name: {e}")


def execute_with_logging(
    command_id: str,
    parameters: Dict[str, Any],
    *,
    command: Optional[Dict[str, Any]] = None,
    timeout: Optional[int] = None,
    confirm_mode: bool = False,
    original_transcript: Optional[str] = None,
) -> Tuple[ExecutionResult, int, Optional[Dict[str, Any]]]:
    """
    Execute a command and synchronize the execution_history table.

    Args:
        command_id: ID of the command to execute
        parameters: Command parameters
        command: Optional pre-loaded command dict
        timeout: Optional timeout override
        confirm_mode: Whether to request confirmation
        original_transcript: Original user command transcript for read-aloud feature

    Returns:
        (ExecutionResult, log_id, command dict)
    """
    manager = get_command_manager()
    command_obj = command or manager.get_command(command_id)
    command_name = command_obj['name'] if command_obj else 'Unknown Command'

    # Speak command name aloud before execution (if enabled)
    speak_command_name(command_name)

    command_timeout = command_obj.get('timeout') if command_obj else None
    effective_timeout = timeout if timeout is not None else command_timeout

    log_id = start_execution_log(command_id, command_name, parameters)
    result = execute(
        command_id=command_id,
        parameters=parameters,
        confirm_mode=confirm_mode,
        timeout=effective_timeout,
        original_transcript=original_transcript,
    )

    is_async_script = bool(command_obj and command_obj.get('action', {}).get('type') == ActionType.SCRIPT)
    update_execution_log(log_id, result.to_dict(), keep_running=is_async_script)
    if is_async_script:
        start_script_completion_watcher(log_id, result.to_dict())

    # Check if we should read results out loud
    if command_obj and command_obj.get('read_aloud', False) and original_transcript:
        # Run text-to-speech in a background thread so it doesn't block
        def speak_in_background():
            try:
                process_and_speak_result(
                    original_command=original_transcript,
                    execution_result=result.to_dict(),
                    command_name=command_name
                )
            except Exception as e:
                print(f"Error in read-aloud background thread: {e}")
        
        thread = threading.Thread(target=speak_in_background, daemon=True)
        thread.start()

    return result, log_id, command_obj

