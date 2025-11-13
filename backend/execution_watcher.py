"""Background watchers to finalize async script executions and set accurate duration."""

import threading
import time
import os
import subprocess
from datetime import datetime
from typing import Dict, Optional

from execution_history import update_execution_log, get_db_connection


def _get_log_start_timestamp_iso(log_id: int) -> Optional[str]:
    """Fetch the original timestamp (ISO) of a log entry."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT timestamp FROM execution_history WHERE id = ?
            """, (log_id,))
            row = cursor.fetchone()
            if row and row['timestamp']:
                return row['timestamp']
    except Exception:
        pass
    return None


def _compute_duration_seconds(start_iso: Optional[str]) -> float:
    """Compute seconds elapsed since start_iso until now."""
    if not start_iso:
        return 0.0
    try:
        start_dt = datetime.fromisoformat(start_iso)
        return max(0.0, (datetime.now() - start_dt).total_seconds())
    except Exception:
        return 0.0


def _finalize_log(log_id: int, base_result: Dict, success: Optional[bool] = None):
    """Update the DB log to completed/failed and set accurate duration."""
    start_iso = _get_log_start_timestamp_iso(log_id)
    duration = _compute_duration_seconds(start_iso)

    # Build final result dict based on base_result
    final = dict(base_result)
    final['duration'] = duration
    if success is not None:
        final['success'] = success

    # Mark completed/failed based on success
    update_execution_log(log_id, final, keep_running=False)


def _wait_for_pid(log_id: int, base_result: Dict, pid: int):
    """Wait for a given PID to exit; then finalize log with duration and success if known."""
    # Try to wait using waitpid (works for child processes)
    try:
        pid_ret, status = os.waitpid(pid, 0)
        if pid_ret == pid:
            # Determine success by exit status if available
            exited_successfully = os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
            _finalize_log(log_id, base_result, success=exited_successfully)
            return
    except ChildProcessError:
        # Not a direct child; fall back to polling
        pass
    except Exception:
        # Unknown error; fall back to polling
        pass

    # Fallback: poll for process existence using os.kill(pid, 0)
    # Note: This cannot determine success/failure; we assume success when it ends
    while True:
        try:
            # Signal 0 just checks existence
            os.kill(pid, 0)
            time.sleep(0.5)
        except ProcessLookupError:
            # Process no longer exists
            _finalize_log(log_id, base_result, success=True)
            return
        except PermissionError:
            # We cannot signal it; assume it exists, keep polling
            time.sleep(0.5)
        except Exception:
            # Unknown error, finalize optimistically
            _finalize_log(log_id, base_result, success=True)
            return


def _wait_for_terminal_window(log_id: int, base_result: Dict, window_id: str):
    """Poll Terminal window busy status via osascript; finalize when not busy or window missing."""
    def is_window_busy(win_id: str) -> Optional[bool]:
        try:
            script = f'tell application "Terminal" to get busy of selected tab of (window id {win_id})'
            proc = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=3)
            if proc.returncode != 0:
                return None  # window not found or error
            out = (proc.stdout or '').strip().lower()
            if out in ('true', 'false'):
                return out == 'true'
            return None
        except Exception:
            return None

    # Poll
    idle_checks = 0
    while True:
        busy = is_window_busy(window_id)
        # If not busy or window missing, we consider it finished
        if busy is False or busy is None:
            _finalize_log(log_id, base_result, success=True)
            return
        time.sleep(0.6)
        idle_checks += 1
        # Safety: do not spin forever; after long periods finalize anyway
        if idle_checks > 10000:  # ~100 minutes
            _finalize_log(log_id, base_result, success=True)
            return


def start_script_completion_watcher(log_id: int, result: Dict):
    """
    Start a background watcher to finalize 'running' script executions.
    - Background: waits for PID to exit
    - Foreground (Terminal): polls window busy state
    """
    meta = (result or {}).get('meta') or {}
    pid = meta.get('pid')
    window_id = meta.get('terminal_window_id')

    if pid:
        t = threading.Thread(target=_wait_for_pid, args=(log_id, result, int(pid)), daemon=True)
        t.start()
        return

    if window_id:
        t = threading.Thread(target=_wait_for_terminal_window, args=(log_id, result, str(window_id)), daemon=True)
        t.start()
        return

    # If no meta to track, nothing to do
    return


