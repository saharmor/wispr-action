"""Monitor Wispr Flow database for new transcriptions and execute commands."""

import time
import sqlite3
import os
import json
from datetime import datetime
from typing import Optional, Dict, Set
import threading

from config import WISPR_DB_PATH, ACTIVATION_WORD, POLL_INTERVAL, WEB_PORT
from parser import parse_command
from executor import execute, log_execution, ExecutionResult
from command_manager import get_command_manager


class WisprMonitor:
    """Monitor Wispr Flow database for new transcriptions."""
    
    def __init__(self, db_path: str = WISPR_DB_PATH):
        self.db_path = os.path.expanduser(db_path)
        self.activation_word = ACTIVATION_WORD.lower()
        self.poll_interval = POLL_INTERVAL
        self.is_running = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.last_timestamp: Optional[float] = None
        self.processed_ids: Set[str] = set()
        self._stop_event = threading.Event()
    
    def get_db_connection(self):
        """Get a connection to the Wispr Flow database."""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            return conn
        except sqlite3.Error as e:
            print(f"Error connecting to database: {e}")
            return None
    
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
    
    def get_transcript_text(self, transcript: Dict) -> str:
        """Get the text content from a transcript."""
        text = transcript.get('editedText') or transcript.get('formattedText') or ""
        return text.strip()
    
    def contains_activation_word(self, text: str) -> bool:
        """Check if the text starts with the activation word (first word)."""
        if not text:
            return False
        
        # Split into words and normalize
        words = text.lower().split()
        if words:
            # Remove punctuation from first word
            words[0] = ''.join(c for c in words[0] if c.isalnum())
        if not words:
            return False
        
        if len(words) >= 1 and words[0] == self.activation_word:
            return True
        
        return False
    
    def process_command(self, text: str) -> Optional[ExecutionResult]:
        """
        Process a detected command.
        
        Args:
            text: Command text to process
            
        Returns:
            ExecutionResult or None if parsing failed
        """
        print(f"\n{'='*60}")
        print(f"Detected command: {text}")
        print(f"{'='*60}\n")
        
        # Parse command using Claude
        parse_result = parse_command(text)
        
        if not parse_result.get('success'):
            print(f"Unable to parse command: {parse_result.get('error', 'Unknown error')}")
            if parse_result.get('response_text'):
                print(f"Claude says: {parse_result['response_text']}")
            return None
        
        print(f"Matched command: {parse_result['command_name']}")
        print(f"Parameters: {json.dumps(parse_result['parameters'], indent=2)}")
        
        # Execute the command
        print("\nExecuting action...")
        
        # Get command to check for custom timeout
        manager = get_command_manager()
        command = manager.get_command(parse_result['command_id'])
        timeout = command.get('timeout') if command else None
        
        result = execute(
            command_id=parse_result['command_id'],
            parameters=parse_result['parameters'],
            timeout=timeout
        )
        
        # Display result
        if result.success:
            print(f"Execution successful ({result.duration:.2f}s)")
            if result.output:
                print(f"Output: {result.output[:200]}")
        else:
            print(f"Execution failed: {result.error}")
            if result.output:
                print(f"Output: {result.output[:200]}")
        
        print(f"\n{'='*60}\n")
        
        # Log execution
        log_execution(result, os.path.join(os.path.dirname(__file__), 'logs', 'executions.log'))
        
        return result
    
    def _monitor_loop(self):
        """Internal monitoring loop (runs in thread)."""
        while not self._stop_event.is_set():
            try:
                # Get new connection for each check
                conn = self.get_db_connection()
                if not conn:
                    time.sleep(self.poll_interval)
                    continue
                
                # Check for new transcripts
                new_transcript = self.get_latest_transcript(conn, self.last_timestamp)
                conn.close()
                
                if new_transcript and new_transcript['id'] not in self.processed_ids:
                    text = self.get_transcript_text(new_transcript)
                    
                    # Check for activation word
                    if self.contains_activation_word(text):
                        print(f"\nNew command transcript detected!")
                        print(f"   ID: {new_transcript['id']}")
                        print(f"   Timestamp: {new_transcript['timestamp']}")
                        print(f"   App: {new_transcript.get('app', 'N/A')}")
                        
                        # Process the command
                        self.process_command(text)
                        
                        # Mark as processed
                        self.processed_ids.add(new_transcript['id'])
                        self.last_timestamp = new_transcript['timestamp']
                    elif text:
                        # New transcript but not a command
                        print(f"New transcript (no activation word): {text[:50]}...")
                        self.processed_ids.add(new_transcript['id'])
                        self.last_timestamp = new_transcript['timestamp']
                
                time.sleep(self.poll_interval)
                
            except Exception as e:
                print(f"\nMonitor error: {e}")
                import traceback
                traceback.print_exc()
                time.sleep(self.poll_interval)
    
    def start(self):
        """Start monitoring in a background thread."""
        if self.is_running:
            print("Warning: Monitor is already running")
            return
        
        print(f"""
╔══════════════════════════════════════════════════════════════╗
║         Wispr Action Monitor - STARTING                      ║
╚══════════════════════════════════════════════════════════════╝

Watching Wispr Flow database for new transcripts...
Database: {self.db_path}
Activation word: "{self.activation_word}"
Check interval: {self.poll_interval}s

How to use:
  1. Say the activation word followed by your command
  2. Example: "Command, run email processor for sahar@gmail.com"
  3. The system will automatically detect and execute the command
""")
        
        # Check if database exists
        if not os.path.exists(self.db_path):
            print(f"Error: Database not found at: {self.db_path}")
            print("Please make sure Wispr Flow is installed and has been used at least once.")
            return
        
        # Check if there are any enabled commands
        manager = get_command_manager()
        enabled = manager.get_enabled_commands()
        if not enabled:
            print("Warning: No enabled commands configured!")
            print(f"   Please add commands via the web UI at http://localhost:{WEB_PORT}")
        else:
            print(f"Loaded {len(enabled)} enabled command(s):")
            for cmd in enabled:
                print(f"   - {cmd['name']}")
        
        # Get initial state
        conn = self.get_db_connection()
        if not conn:
            return
        
        # Get the latest transcript to establish baseline
        latest = self.get_latest_transcript(conn)
        self.last_timestamp = latest['timestamp'] if latest else None
        
        if latest:
            self.processed_ids.add(latest['id'])
            print(f"\nConnected to database")
            print(f"Starting from timestamp: {self.last_timestamp}\n")
        else:
            print(f"\nConnected to database")
            print(f"Waiting for first transcript...\n")
        
        conn.close()
        
        # Start monitoring thread
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
            "activation_word": self.activation_word,
            "poll_interval": self.poll_interval,
            "last_timestamp": self.last_timestamp,
            "processed_count": len(self.processed_ids)
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
        
        # Keep running until interrupted
        while True:
            time.sleep(1)
    
    except KeyboardInterrupt:
        print("\n\nReceived interrupt signal...")
        monitor.stop()
        sys.exit(0)

