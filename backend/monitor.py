"""Monitor Wispr Flow log file for dictation events and process commands."""

import time
import sqlite3
import os
import json
import re
import subprocess
from typing import Optional, Dict
import threading

from config import (
    WISPR_DB_PATH,
    WISPR_LOG_PATH,
    ACTIVATION_WORD,
    OPTIMIZE_ACTIVATION_WORD,
    POLL_INTERVAL,
    WEB_PORT,
    LOGS_DIR,
    ACTIVATION_SOUND_ENABLED,
    ACTIVATION_SOUND_PATH,
    AUTO_VOLUME_REDUCTION_ENABLED,
    DICTATION_VOLUME_LEVEL,
)
from parser import parse_command
from executor import log_execution, ExecutionResult
from command_manager import get_command_manager
from command_runner import execute_with_logging
from prompt_optimizer import process_optimize
from bounded_set import BoundedSet
from volume_controller import VolumeController
from contextlib import contextmanager

_LOG_START_RE = re.compile(r"updateDictationStatus: listening")
_LOG_END_RE = re.compile(r"updateDictationStatus: idle")
_LOG_DISMISSED_RE = re.compile(r"updateDictationStatus: dismissed")

_DB_SETTLE_DELAY = 0.15
_DB_FLUSH_TIMEOUT = 2.0
_DB_FLUSH_POLL_INTERVAL = 0.25
_WISPR_APP_PATH = "/Applications/Wispr Flow.app"


class WisprMonitor:
    """Monitor Wispr Flow via log-file tailing for dictation events."""

    def __init__(self, db_path: str = WISPR_DB_PATH, log_path: str = WISPR_LOG_PATH):
        self.db_path = os.path.expanduser(db_path)
        self.log_path = os.path.expanduser(log_path)
        self.activation_word = ACTIVATION_WORD.lower()
        self.optimize_activation_word = OPTIMIZE_ACTIVATION_WORD.lower()
        self.poll_interval = POLL_INTERVAL
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.last_timestamp: Optional[float] = None
        self.processed_ids: BoundedSet[str] = BoundedSet(max_size=1000)
        self._stop_event = threading.Event()
        self._activation_sound_warned = False
        self._dictation_active = False

        self._volume_controller: Optional[VolumeController] = None
        if AUTO_VOLUME_REDUCTION_ENABLED:
            self._volume_controller = VolumeController(dictation_volume=DICTATION_VOLUME_LEVEL)

    # ------------------------------------------------------------------
    # Database helpers (still needed to fetch transcript content)
    # ------------------------------------------------------------------

    @contextmanager
    def get_db_connection(self):
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            yield conn
        except sqlite3.Error as e:
            print(f"Error connecting to database: {e}")
            raise
        finally:
            if conn:
                conn.close()

    def get_latest_transcript(self, conn, last_timestamp: Optional[float] = None) -> Optional[Dict]:
        """Get the latest transcript from the History table."""
        try:
            cursor = conn.cursor()

            if last_timestamp:
                query = """
                    SELECT transcriptEntityId, timestamp, asrText, formattedText, editedText, 
                           status, app, url, personalizationStyleSettings
                    FROM History 
                    WHERE timestamp > ? 
                    ORDER BY timestamp DESC 
                    LIMIT 1
                """
                cursor.execute(query, (last_timestamp,))
            else:
                query = """
                    SELECT transcriptEntityId, timestamp, asrText, formattedText, editedText,
                           status, app, url, personalizationStyleSettings
                    FROM History 
                    ORDER BY timestamp DESC 
                    LIMIT 1
                """
                cursor.execute(query)

            row = cursor.fetchone()

            if row:
                return {
                    'id': row['transcriptEntityId'],
                    'timestamp': row['timestamp'],
                    'asrText': row['asrText'],
                    'formattedText': row['formattedText'],
                    'editedText': row['editedText'],
                    'status': row['status'],
                    'app': row['app'],
                    'url': row['url'],
                    'personalizationStyleSettings': row['personalizationStyleSettings']
                }

            return None

        except sqlite3.Error as e:
            print(f"Error querying database: {e}")
            return None

    # ------------------------------------------------------------------
    # Text helpers
    # ------------------------------------------------------------------

    def get_transcript_text(self, transcript: Dict) -> str:
        text = transcript.get('editedText') or transcript.get('formattedText') or ""
        return text.strip()

    def contains_activation_word(self, text: str) -> bool:
        if not text:
            return False
        words = text.split()
        if not words:
            return False
        first_word_normalized = ''.join(c for c in words[0].lower() if c.isalnum())
        return first_word_normalized == self.activation_word

    def contains_optimize_activation_word(self, text: str) -> bool:
        if not text:
            return False
        words = text.split()
        if not words:
            return False
        first_word_normalized = ''.join(c for c in words[0].lower() if c.isalnum())
        return first_word_normalized == self.optimize_activation_word

    def remove_activation_word(self, text: str, activation_word: str) -> str:
        if not text:
            return text
        words = text.split()
        if not words:
            return text
        first_word_normalized = ''.join(c for c in words[0].lower() if c.isalnum())
        if first_word_normalized == activation_word.lower():
            return ' '.join(words[1:]).strip()
        return text

    # ------------------------------------------------------------------
    # Sound
    # ------------------------------------------------------------------

    def play_activation_sound(self) -> None:
        if not ACTIVATION_SOUND_ENABLED:
            return

        sound_path = os.path.expanduser(ACTIVATION_SOUND_PATH)
        if not os.path.exists(sound_path):
            if not self._activation_sound_warned:
                print(f"Warning: Activation sound file not found: {sound_path}")
                self._activation_sound_warned = True
            return

        try:
            subprocess.Popen(
                ["afplay", sound_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                start_new_session=True
            )
        except FileNotFoundError:
            if not self._activation_sound_warned:
                print("Warning: 'afplay' command not found (macOS only)")
                self._activation_sound_warned = True
        except Exception as e:
            if not self._activation_sound_warned:
                print(f"Warning: Failed to play activation sound: {e}")
                self._activation_sound_warned = True

    # ------------------------------------------------------------------
    # Dictation lifecycle callbacks
    # ------------------------------------------------------------------

    def _on_dictation_start(self) -> None:
        """Called when the user begins dictating."""
        self._dictation_active = True
        print("\n🎙️  Dictation started")
        if self._volume_controller:
            self._volume_controller.on_dictation_start()

    def _on_dictation_dismissed(self) -> None:
        """Called when the user cancels dictation (e.g. presses Esc)."""
        self._dictation_active = False
        print("⏹️  Dictation cancelled")
        if self._volume_controller:
            self._volume_controller.on_dictation_end()

    def _on_dictation_end(self) -> None:
        """Called when dictation finishes — fetch transcript and process."""
        self._dictation_active = False
        print("✅  Dictation ended")

        if self._volume_controller:
            self._volume_controller.on_dictation_end()

        # Wait for the transcript to appear in the DB, retrying over
        # _DB_FLUSH_TIMEOUT seconds.  Wispr occasionally fails to flush
        # the record; when that happens we restart the app to recover.
        time.sleep(_DB_SETTLE_DELAY)

        transcript = self._wait_for_transcript()
        if transcript:
            self._process_transcript(transcript)
        else:
            print(f"⚠️  No new transcript found in DB after {_DB_FLUSH_TIMEOUT}s — Wispr may be stuck")
            self._restart_wispr()

    def _wait_for_transcript(self) -> Optional[Dict]:
        """Poll the DB for a new transcript, returning it or None on timeout."""
        deadline = time.monotonic() + _DB_FLUSH_TIMEOUT
        while time.monotonic() < deadline:
            try:
                with self.get_db_connection() as conn:
                    new = self.get_latest_transcript(conn, self.last_timestamp)
                if new and new['id'] not in self.processed_ids:
                    return new
            except sqlite3.Error as e:
                print(f"Database error while waiting for transcript: {e}")
            time.sleep(_DB_FLUSH_POLL_INTERVAL)
        return None

    # ------------------------------------------------------------------
    # Wispr Flow restart
    # ------------------------------------------------------------------

    def _restart_wispr(self) -> None:
        """Kill Wispr Flow and relaunch it from /Applications."""
        print("🔄  Restarting Wispr Flow...")
        try:
            subprocess.run(
                ["osascript", "-e", 'tell application "Wispr Flow" to quit'],
                capture_output=True, timeout=5,
            )
            # Give the process time to fully exit
            time.sleep(2)
        except Exception as e:
            print(f"   Graceful quit failed ({e}), force-killing...")
            subprocess.run(["pkill", "-x", "Wispr Flow"], capture_output=True)
            time.sleep(1)

        try:
            subprocess.Popen(
                ["open", _WISPR_APP_PATH],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print("   Wispr Flow relaunched — waiting for it to initialise...")
            time.sleep(5)
            print("   Wispr Flow should be ready now")
        except Exception as e:
            print(f"   Failed to relaunch Wispr Flow: {e}")
            print(f"   Please start it manually from {_WISPR_APP_PATH}")

    # ------------------------------------------------------------------
    # Command processing
    # ------------------------------------------------------------------

    def _process_transcript(self, new_transcript: Dict) -> None:
        """Route a transcript to the right handler (command / optimize / skip)."""
        text = self.get_transcript_text(new_transcript)
        asr_text_raw = new_transcript.get('asrText')
        asr_text = asr_text_raw.strip() if asr_text_raw and isinstance(asr_text_raw, str) else ''

        if self.contains_optimize_activation_word(asr_text):
            print(f"\nNew optimize request detected!")
            print(f"   ID: {new_transcript['id']}")
            print(f"   Timestamp: {new_transcript['timestamp']}")
            print(f"   App: {new_transcript.get('app', 'N/A')}")

            transcript_without_activation = self.remove_activation_word(
                text, self.optimize_activation_word
            )
            process_optimize(transcript_without_activation)

        elif self.contains_activation_word(asr_text):
            print(f"\nNew command transcript detected!")
            print(f"   ID: {new_transcript['id']}")
            print(f"   Timestamp: {new_transcript['timestamp']}")
            print(f"   App: {new_transcript.get('app', 'N/A')}")

            self.play_activation_sound()
            self.process_command(text)

        elif text:
            print(f"New transcript (no activation word): {text[:50]}...")

        self.processed_ids.add(new_transcript['id'])
        self.last_timestamp = new_transcript['timestamp']

    def process_command(self, text: str) -> Optional[ExecutionResult]:
        print(f"\n{'='*60}")
        print(f"Detected command: {text}")
        print(f"{'='*60}\n")

        parse_result = parse_command(text)

        if not parse_result.get('success'):
            print(f"Unable to parse command: {parse_result.get('error', 'Unknown error')}")
            if parse_result.get('response_text'):
                print(f"Claude says: {parse_result['response_text']}")
            return None

        print(f"Matched command: {parse_result['command_name']}")
        print(f"Parameters: {json.dumps(parse_result['parameters'], indent=2)}")

        print("\nExecuting action...")

        manager = get_command_manager()
        command = manager.get_command(parse_result['command_id'])
        result, _, _ = execute_with_logging(
            parse_result['command_id'],
            parse_result['parameters'],
            command=command,
            original_transcript=text,
        )

        if result.success:
            print(f"Execution successful ({result.duration:.2f}s)")
            if result.output:
                print(f"Output: {result.output[:200]}")
        else:
            print(f"Execution failed: {result.error}")
            if result.output:
                print(f"Output: {result.output[:200]}")

        print(f"\n{'='*60}\n")

        log_execution(result, os.path.join(LOGS_DIR, 'executions.log'))

        return result

    # ------------------------------------------------------------------
    # Main monitor loop — tails the Wispr log file
    # ------------------------------------------------------------------

    def _get_file_inode(self, path: str) -> Optional[int]:
        try:
            return os.stat(path).st_ino
        except OSError:
            return None

    def _monitor_loop(self):
        """Tail Wispr Flow's main.log to detect dictation start/end."""
        try:
            f = open(self.log_path, "r")
        except OSError as e:
            print(f"Error opening log file {self.log_path}: {e}")
            print("Falling back to database polling...")
            self._monitor_loop_db_fallback()
            return

        try:
            f.seek(0, 2)
            current_inode = self._get_file_inode(self.log_path)

            while not self._stop_event.is_set():
                line = f.readline()
                if not line:
                    self._stop_event.wait(0.05)

                    # Check for log rotation every idle cycle
                    new_inode = self._get_file_inode(self.log_path)
                    if new_inode is not None and new_inode != current_inode:
                        print("Log file rotated, reopening...")
                        f.close()
                        try:
                            f = open(self.log_path, "r")
                        except OSError:
                            self._stop_event.wait(1)
                            continue
                        current_inode = new_inode
                    continue

                if _LOG_START_RE.search(line) and not self._dictation_active:
                    self._on_dictation_start()
                elif _LOG_DISMISSED_RE.search(line) and self._dictation_active:
                    self._on_dictation_dismissed()
                elif _LOG_END_RE.search(line) and self._dictation_active:
                    self._on_dictation_end()
        finally:
            f.close()

    def _monitor_loop_db_fallback(self):
        """Legacy DB-polling fallback in case the log file is unavailable."""
        while not self._stop_event.is_set():
            try:
                try:
                    with self.get_db_connection() as conn:
                        new_transcript = self.get_latest_transcript(conn, self.last_timestamp)
                except sqlite3.Error as e:
                    print(f"Database error in monitor loop: {e}")
                    self._stop_event.wait(self.poll_interval)
                    continue

                if new_transcript and new_transcript['id'] not in self.processed_ids:
                    self._process_transcript(new_transcript)

                self._stop_event.wait(self.poll_interval)

            except Exception as e:
                print(f"\nMonitor error: {e}")
                import traceback
                traceback.print_exc()
                self._stop_event.wait(self.poll_interval)

    # ------------------------------------------------------------------
    # Start / stop / status
    # ------------------------------------------------------------------

    def start(self):
        """Start monitoring in a background thread."""
        if self.is_running:
            print("Warning: Monitor is already running")
            return

        use_log_tailing = os.path.exists(self.log_path)
        mode = "log-file tailing" if use_log_tailing else "database polling (log file not found)"

        print(f"""
╔══════════════════════════════════════════════════════════════╗
║         Wispr Action Monitor - STARTING                      ║
╚══════════════════════════════════════════════════════════════╝

Watching Wispr Flow for new transcripts via {mode}
Log file: {self.log_path}
Database: {self.db_path}
Command activation word: "{self.activation_word}"
Optimize activation word: "{self.optimize_activation_word}"
Volume reduction: {"ON (→ " + str(DICTATION_VOLUME_LEVEL) + "%)" if self._volume_controller else "OFF"}

How to use:
  1. Say the activation word followed by your command
  2. Example: "Command, run email processor for sahar@gmail.com"
  3. Or use optimize mode: "Optimize, I want to build a feature that..."
  4. The system will automatically detect and execute the command or optimize the prompt
""")

        if not os.path.exists(self.db_path):
            print(f"Error: Database not found at: {self.db_path}")
            print("Please make sure Wispr Flow is installed and has been used at least once.")
            return

        manager = get_command_manager()
        enabled = manager.get_enabled_commands()
        if not enabled:
            print("Warning: No enabled commands configured!")
            print(f"   Please add commands via the web UI at http://localhost:{WEB_PORT}")
        else:
            print(f"Loaded {len(enabled)} enabled command(s):")
            for cmd in enabled:
                print(f"   - {cmd['name']}")

        try:
            with self.get_db_connection() as conn:
                latest = self.get_latest_transcript(conn)
                self.last_timestamp = latest['timestamp'] if latest else None

                if latest:
                    self.processed_ids.add(latest['id'])
                    print(f"\nConnected to database")
                    print(f"Starting from timestamp: {self.last_timestamp}\n")
                else:
                    print("\nConnected to database")
                    print("Waiting for first transcript...\n")
        except sqlite3.Error as e:
            print(f"Error connecting to database: {e}")
            return

        self.is_running = True
        self._stop_event.clear()
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()

        print("Monitor is now running!\n")

    def stop(self):
        """Stop monitoring."""
        if not self.is_running:
            print("Warning: Monitor is not running")
            return

        print("\nStopping monitor...")
        self.is_running = False
        self._stop_event.set()

        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)

        print("Monitor stopped\n")

    def get_status(self) -> Dict:
        """Get current monitor status."""
        return {
            "running": self.is_running,
            "db_path": self.db_path,
            "log_path": self.log_path,
            "activation_word": self.activation_word,
            "poll_interval": self.poll_interval,
            "last_timestamp": self.last_timestamp,
            "processed_count": len(self.processed_ids),
            "dictation_active": self._dictation_active,
            "volume_reduction": AUTO_VOLUME_REDUCTION_ENABLED,
        }


# Global monitor instance
_monitor = None

def get_monitor() -> WisprMonitor:
    """Get the global WisprMonitor instance."""
    global _monitor
    if _monitor is None:
        _monitor = WisprMonitor()
    return _monitor


if __name__ == '__main__':
    """Run monitor standalone."""
    import sys

    monitor = get_monitor()

    try:
        monitor.start()

        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n\nReceived interrupt signal...")
        monitor.stop()
        sys.exit(0)
