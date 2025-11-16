"""MCP Catalog database management using SQLite."""

import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from config import DB_PATH

logger = logging.getLogger(__name__)

# Cache expiry: 7 days
CATALOG_CACHE_EXPIRY_DAYS = 7


@contextmanager
def get_db_connection():
    """Context manager for database connections."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_catalog_database():
    """Initialize the MCP catalog cache database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Create catalog entries table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS mcp_catalog_entries (
                id TEXT PRIMARY KEY,
                entry_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create catalog metadata table (tracks last refresh time)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS mcp_catalog_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create indexes for faster queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_catalog_updated 
            ON mcp_catalog_entries(updated_at)
        """)
        
        logger.info("MCP catalog database initialized")


def get_catalog_last_refresh() -> Optional[float]:
    """Get the timestamp of the last catalog refresh."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT value FROM mcp_catalog_metadata 
            WHERE key = 'last_refresh'
        """)
        row = cursor.fetchone()
        if row:
            return float(row["value"])
        return None


def set_catalog_last_refresh(timestamp: Optional[float] = None):
    """Set the timestamp of the last catalog refresh."""
    if timestamp is None:
        timestamp = time.time()
    
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO mcp_catalog_metadata (key, value, updated_at)
            VALUES ('last_refresh', ?, CURRENT_TIMESTAMP)
        """, (str(timestamp),))


def is_catalog_expired() -> bool:
    """Check if the catalog cache has expired (> 7 days old)."""
    last_refresh = get_catalog_last_refresh()
    if last_refresh is None:
        return True
    
    age_seconds = time.time() - last_refresh
    age_days = age_seconds / (24 * 60 * 60)
    
    return age_days > CATALOG_CACHE_EXPIRY_DAYS


def get_catalog_entry_count() -> int:
    """Get the total number of catalog entries in the database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM mcp_catalog_entries")
        row = cursor.fetchone()
        return row["count"] if row else 0


def save_catalog_entries(entries: List[Dict], replace_all: bool = False):
    """
    Save catalog entries to the database.
    
    Args:
        entries: List of catalog entry dictionaries
        replace_all: If True, delete all existing entries first
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        if replace_all:
            cursor.execute("DELETE FROM mcp_catalog_entries")
            logger.info("Cleared existing catalog entries")
        
        for entry in entries:
            entry_id = entry.get("id")
            if not entry_id:
                continue
            
            entry_json = json.dumps(entry)
            cursor.execute("""
                INSERT OR REPLACE INTO mcp_catalog_entries (id, entry_data, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (entry_id, entry_json))
        
        logger.info(f"Saved {len(entries)} catalog entries to database")


def _build_search_filters(query: Optional[str], tag: Optional[str]) -> Tuple[str, List[str]]:
    clauses: List[str] = []
    params: List[str] = []

    if query:
        like = f"%{query.lower()}%"
        clauses.append(
            """
            (
                LOWER(COALESCE(json_extract(entry_data, '$.name'), '')) LIKE ?
                OR LOWER(COALESCE(json_extract(entry_data, '$.description'), '')) LIKE ?
                OR EXISTS (
                    SELECT 1
                    FROM json_each(json_extract(entry_data, '$.tags')) AS tag_search
                    WHERE LOWER(COALESCE(tag_search.value, '')) LIKE ?
                )
            )
            """
        )
        params.extend([like, like, like])

    if tag:
        clauses.append(
            """
            EXISTS (
                SELECT 1
                FROM json_each(json_extract(entry_data, '$.tags')) AS tag_exact
                WHERE LOWER(COALESCE(tag_exact.value, '')) = ?
            )
            """
        )
        params.append(tag.lower())

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where_sql, params


def search_catalog_entries(
    query: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict:
    """
    Search catalog entries in the database.
    
    Args:
        query: Search query (searches name, description, tags)
        tag: Filter by tag
        limit: Maximum number of results
        offset: Offset for pagination
    
    Returns:
        Dictionary with entries, total count, and metadata
    """
    where_sql, where_params = _build_search_filters(query, tag)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        count_query = f"SELECT COUNT(*) as count FROM mcp_catalog_entries {where_sql}"
        cursor.execute(count_query, where_params)
        row = cursor.fetchone()
        total = row["count"] if row else 0

        limit_clause = "LIMIT ? OFFSET ?"
        limit_params: List[int] = []
        if limit and limit > 0:
            limit_params = [limit, offset]
        else:
            limit_clause = "LIMIT -1 OFFSET ?"
            limit_params = [offset]

        data_query = f"""
            SELECT entry_data
            FROM mcp_catalog_entries
            {where_sql}
            ORDER BY LOWER(COALESCE(json_extract(entry_data, '$.name'), '')) ASC
            {limit_clause}
        """
        cursor.execute(data_query, where_params + limit_params)
        rows = cursor.fetchall()

    entries: List[Dict] = []
    for db_row in rows:
        try:
            entries.append(json.loads(db_row["entry_data"]))
        except json.JSONDecodeError as exc:
            logger.warning(f"Failed to parse catalog entry: {exc}")

    last_refresh = get_catalog_last_refresh()

    return {
        "entries": entries,
        "total": total,
        "cached": True,
        "lastUpdated": last_refresh,
        "error": None,
    }


def get_catalog_entry(entry_id: str) -> Optional[Dict]:
    """Get a specific catalog entry by ID."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT entry_data FROM mcp_catalog_entries
            WHERE id = ?
        """, (entry_id,))
        row = cursor.fetchone()
        
        if row:
            try:
                return json.loads(row["entry_data"])
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse catalog entry {entry_id}: {e}")
        
        return None


def clear_catalog_cache():
    """Clear all catalog entries from the database."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM mcp_catalog_entries")
        cursor.execute("DELETE FROM mcp_catalog_metadata WHERE key = 'last_refresh'")
        logger.info("Cleared catalog cache")


# Initialize database on module import
init_catalog_database()

