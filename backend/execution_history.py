"""Execution history database management using SQLite."""

import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Optional
from contextlib import contextmanager


# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "execution_history.db")


@contextmanager
def get_db_connection():
    """Context manager for database connections."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Enable column access by name
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    """Initialize the execution history database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS execution_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                command_id TEXT NOT NULL,
                command_name TEXT NOT NULL,
                parameters TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                success INTEGER,
                output TEXT,
                error TEXT,
                duration REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Add status column if it doesn't exist (for existing databases)
        try:
            cursor.execute("ALTER TABLE execution_history ADD COLUMN status TEXT NOT NULL DEFAULT 'running'")
        except:
            pass  # Column already exists
        
        # Create index on timestamp for faster queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_timestamp 
            ON execution_history(timestamp DESC)
        """)
        
        print(f"✓ Execution history database initialized at: {DB_PATH}")


def add_execution_log(log_entry: Dict, status: str = 'completed') -> int:
    """
    Add an execution log entry to the database.
    
    Args:
        log_entry: Dictionary containing:
            - timestamp: ISO format timestamp
            - command_id: Command ID
            - parameters: Dictionary of parameters
            - result: ExecutionResult dict with success, output, error, etc.
        status: Execution status ('running', 'completed', 'failed')
    
    Returns:
        ID of the inserted record
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        result = log_entry.get('result', {})
        
        cursor.execute("""
            INSERT INTO execution_history 
            (timestamp, command_id, command_name, parameters, status, success, output, error, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            log_entry['timestamp'],
            log_entry['command_id'],
            result.get('command_name', ''),
            json.dumps(log_entry.get('parameters', {})),
            status,
            1 if result.get('success') else 0,
            result.get('output', ''),
            result.get('error', ''),
            result.get('duration', 0.0)
        ))
        
        return cursor.lastrowid


def start_execution_log(command_id: str, command_name: str, parameters: Dict) -> int:
    """
    Create a log entry for a command that just started executing.
    
    Args:
        command_id: Command ID
        command_name: Command name
        parameters: Dictionary of parameters
    
    Returns:
        ID of the inserted record
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO execution_history 
            (timestamp, command_id, command_name, parameters, status, success, output, error, duration)
            VALUES (?, ?, ?, ?, 'running', NULL, '', '', 0.0)
        """, (
            datetime.now().isoformat(),
            command_id,
            command_name,
            json.dumps(parameters)
        ))
        
        return cursor.lastrowid


def update_execution_log(log_id: int, result: Dict, keep_running: bool = False) -> bool:
    """
    Update an execution log with the final result.
    
    Args:
        log_id: ID of the log entry to update
        result: ExecutionResult dict with success, output, error, duration
        keep_running: If True, keep status as 'running' (for async commands)
    
    Returns:
        True if updated successfully
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        if keep_running:
            status = 'running'
        else:
            status = 'completed' if result.get('success') else 'failed'
        
        cursor.execute("""
            UPDATE execution_history 
            SET status = ?,
                success = ?,
                output = ?,
                error = ?,
                duration = ?
            WHERE id = ?
        """, (
            status,
            1 if result.get('success') else 0,
            result.get('output', ''),
            result.get('error', ''),
            result.get('duration', 0.0),
            log_id
        ))
        
        return cursor.rowcount > 0


def get_execution_logs(limit: int = 20, offset: int = 0) -> List[Dict]:
    """
    Get execution logs from the database.
    
    Args:
        limit: Maximum number of logs to retrieve
        offset: Number of logs to skip
    
    Returns:
        List of log entries as dictionaries
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                id,
                timestamp,
                command_id,
                command_name,
                parameters,
                status,
                success,
                output,
                error,
                duration
            FROM execution_history
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        
        rows = cursor.fetchall()
        
        logs = []
        for row in rows:
            logs.append({
                'id': row['id'],
                'timestamp': row['timestamp'],
                'command_id': row['command_id'],
                'parameters': json.loads(row['parameters']) if row['parameters'] else {},
                'result': {
                    'command_id': row['command_id'],
                    'command_name': row['command_name'],
                    'status': row['status'],
                    'success': bool(row['success']) if row['success'] is not None else None,
                    'output': row['output'] or '',
                    'error': row['error'] or '',
                    'duration': row['duration'] or 0.0,
                    'timestamp': row['timestamp']
                }
            })
        
        return logs


def get_execution_log_by_id(log_id: int) -> Optional[Dict]:
    """Get a single execution log by ID."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                id,
                timestamp,
                command_id,
                command_name,
                parameters,
                status,
                success,
                output,
                error,
                duration
            FROM execution_history
            WHERE id = ?
        """, (log_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            'id': row['id'],
            'timestamp': row['timestamp'],
            'command_id': row['command_id'],
            'parameters': json.loads(row['parameters']) if row['parameters'] else {},
            'result': {
                'command_id': row['command_id'],
                'command_name': row['command_name'],
                'status': row['status'],
                'success': bool(row['success']) if row['success'] is not None else None,
                'output': row['output'] or '',
                'error': row['error'] or '',
                'duration': row['duration'] or 0.0,
                'timestamp': row['timestamp']
            }
        }


def get_execution_count() -> int:
    """Get total count of execution logs."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM execution_history")
        row = cursor.fetchone()
        return row['count'] if row else 0


def clear_old_logs(keep_count: int = 1000):
    """
    Clear old execution logs, keeping only the most recent ones.
    
    Args:
        keep_count: Number of most recent logs to keep
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM execution_history
            WHERE id NOT IN (
                SELECT id FROM execution_history
                ORDER BY timestamp DESC
                LIMIT ?
            )
        """, (keep_count,))
        
        deleted_count = cursor.rowcount
        if deleted_count > 0:
            print(f"Cleared {deleted_count} old execution logs")


# Initialize database on module import
init_database()

