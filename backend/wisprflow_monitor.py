"""Monitor Wispr Flow SQLite database for new transcriptions and auto-process them."""

import time
import sqlite3
import json
import os
from datetime import datetime
from parser import parse_command
from config import CONFIRM_MODE, WISPR_DB_PATH
from executor import execute
from execution_history import start_execution_log, update_execution_log
from execution_watcher import start_script_completion_watcher

def get_db_connection():
    """Get a connection to the Wispr Flow database.
    
    Returns:
        sqlite3.Connection: Database connection
    """
    try:
        conn = sqlite3.connect(os.path.expanduser(WISPR_DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"❌ Error connecting to database: {e}")
        return None


def get_latest_transcript(conn, last_timestamp=None):
    """Get the latest transcript from the History table.
    
    Args:
        conn: Database connection
        last_timestamp: Only get transcripts newer than this timestamp
        
    Returns:
        dict: Transcript data or None
    """
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
        print(f"❌ Error querying database: {e}")
        return None


def get_transcript_text(transcript):
    """Get the text content from a transcript, preferring editedText over formattedText.
    
    Args:
        transcript: Transcript dictionary
        
    Returns:
        str: The text content
    """
    # Prefer editedText if available, otherwise use formattedText
    text = transcript.get('editedText') or transcript.get('formattedText') or ""
    return text.strip()


def is_wispr_flow_command(asr_text, formatted_text=None):
    """Check if transcript looks like a Wispr Flow command.
    
    Args:
        asr_text: Raw ASR text to check for "command" prefix
        formatted_text: Optional formatted text for keyword checking
        
    Returns:
        bool: True if it looks like a command
    """
    # Check ASR text for explicit "command" prefix (highest priority)
    if asr_text:
        asr_lower = asr_text.lower().strip()
        if asr_lower.startswith("command"):
            return True
    
    # Check formatted text for common action keywords
    text_to_check = formatted_text or asr_text
    if not text_to_check:
        return False
    
    text_lower = text_to_check.lower().strip()
    
    # Common action keywords and patterns
    keywords = [
        "email",
        "send to chatgpt",
        "send to claude",
        "send to gpt",
        "ask chatgpt",
        "ask claude",
        "ask gpt",
        "note:",
        "write a note",
        "remind me",
        "create note",
        "make a note"
    ]
    
    return any(keyword in text_lower for keyword in keywords)


def process_command(text, personalization_style=None):
    """Process a detected command.
    
    Args:
        text: Command text to process
        personalization_style: Optional style preference (e.g., "formal", "casual")
    """
    print(f"\n{'='*60}")
    print(f"📋 Detected command: {text}")
    if personalization_style:
        print(f"✨ Personalization style: {personalization_style}")
    print(f"{'='*60}\n")
    
    result = parse_command(text)
    
    if not result.get('success'):
        print(f"❌ Unable to parse command: {result.get('error', 'Unknown error')}")
        return False
    
    print(f"✅ Parsed successfully")
    print(f"📋 Command: {result.get('command_name')}")
    print(f"📋 Parameters: {json.dumps(result.get('parameters', {}), indent=2)}")
    
    # Execute the command
    print("\n🚀 Executing action...")
    
    # Get command to check for custom timeout
    from command_manager import get_command_manager
    manager = get_command_manager()
    command = manager.get_command(result['command_id'])
    command_name = command['name'] if command else result.get('command_name')
    timeout = command.get('timeout') if command else None
    
    # Create log entry with "running" status BEFORE execution
    log_id = start_execution_log(
        result['command_id'],
        command_name,
        result['parameters']
    )
    print(f"📝 Created history log entry (ID: {log_id})")
    
    exec_result = execute(
        command_id=result['command_id'],
        parameters=result['parameters'],
        confirm_mode=CONFIRM_MODE,
        timeout=timeout
    )
    
    # Update the log entry with the result
    # Keep scripts marked as 'running' since they are launched asynchronously
    is_async_script = bool(command and command.get('action', {}).get('type') == 'script')
    update_execution_log(log_id, exec_result.to_dict(), keep_running=is_async_script)
    
    # Show execution result
    if exec_result.success:
        print(f"✅ Execution succeeded: {exec_result.output}")
    else:
        print(f"❌ Execution failed: {exec_result.error}")
    
    # Log status message according to async nature
    if is_async_script:
        print(f"📝 Updated history log entry (status: running)")
    else:
        print(f"📝 Updated history log entry (status: {'completed' if exec_result.success else 'failed'})")
    
    # Start watcher for async scripts to finalize and set accurate duration
    if is_async_script:
        start_script_completion_watcher(log_id, exec_result.to_dict())
    print(f"\n{'='*60}\n")
    return True


def monitor_database(interval=1.0):
    """Monitor Wispr Flow database for new transcripts.
    
    Args:
        interval: How often to check database (seconds)
    """
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║         Wispr Flow Database Monitor - RUNNING                ║
╚══════════════════════════════════════════════════════════════╝

👀 Watching Wispr Flow database for new transcripts...
📁 Database: {os.path.expanduser(WISPR_DB_PATH)}
⏱️  Check interval: {interval}s

Configuration:
  • Confirm Mode: {CONFIRM_MODE}

How to use:
  1. Use Wispr Flow to dictate a command
  2. This script will auto-detect new transcripts in the database
  3. Commands will be automatically processed

Press Ctrl+C to stop monitoring
""")
    
    # Check if database exists
    if not os.path.exists(os.path.expanduser(WISPR_DB_PATH)):
        print(f"❌ Database not found at: {os.path.expanduser(WISPR_DB_PATH)}")
        print("Please make sure Wispr Flow is installed and has been used at least once.")
        return
    
    # Get initial state
    conn = get_db_connection()
    if not conn:
        return
    
    # Get the latest transcript to establish baseline
    latest = get_latest_transcript(conn)
    last_timestamp = latest['timestamp'] if latest else None
    processed_ids = set()  # Track processed transcript IDs to avoid duplicates
    
    if latest:
        processed_ids.add(latest['id'])
        print(f"✅ Connected to database")
        print(f"📍 Starting from timestamp: {last_timestamp}\n")
    else:
        print(f"✅ Connected to database")
        print(f"📍 Waiting for first transcript...\n")
    
    conn.close()
    
    try:
        while True:
            # Get new connection for each check
            conn = get_db_connection()
            if not conn:
                time.sleep(interval)
                continue
            
            # Check for new transcripts
            new_transcript = get_latest_transcript(conn, last_timestamp)
            conn.close()
            
            if new_transcript and new_transcript['id'] not in processed_ids:
                asr_text = new_transcript.get('asrText', '')
                formatted_text = get_transcript_text(new_transcript)
                
                # Extract personalization style from settings
                personalization_style = None
                style_settings = new_transcript.get('personalizationStyleSettings')
                if style_settings:
                    try:
                        import json as json_module
                        settings_json = json_module.loads(style_settings) if isinstance(style_settings, str) else style_settings
                        personalization_style = settings_json.get('personalizationStyle')
                    except (json_module.JSONDecodeError, AttributeError):
                        pass
                
                # Use asrText to check for "command" prefix, formatted_text for LLM parsing
                if is_wispr_flow_command(asr_text, formatted_text):
                    print(f"\n🆕 New transcript detected!")
                    print(f"   ID: {new_transcript['id']}")
                    print(f"   Timestamp: {new_transcript['timestamp']}")
                    print(f"   App: {new_transcript.get('app', 'N/A')}")
                    print(f"   ASR Text: {asr_text[:50]}..." if len(asr_text) > 50 else f"   ASR Text: {asr_text}")
                    
                    # Process the command using formatted text for LLM with personalization
                    process_command(formatted_text, personalization_style=personalization_style)
                    
                    # Mark as processed
                    processed_ids.add(new_transcript['id'])
                    last_timestamp = new_transcript['timestamp']
                elif formatted_text:
                    # New transcript but not a command
                    print(f"💬 New transcript (not a command): {formatted_text[:50]}...")
                    processed_ids.add(new_transcript['id'])
                    last_timestamp = new_transcript['timestamp']
            
            time.sleep(interval)
            
    except KeyboardInterrupt:
        print("\n\n👋 Stopping database monitor...")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    import sys
    
    interval = 1.0
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        try:
            interval = float(sys.argv[1])
        except ValueError:
            print(f"Invalid interval: {sys.argv[1]}")
            sys.exit(1)
    
    monitor_database(interval)

