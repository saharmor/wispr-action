"""Configuration management for Wispr Action."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# API Configuration
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-haiku-4-5")

# Wispr Flow Database
WISPR_DB_PATH = os.path.expanduser(
    os.getenv("WISPR_DB_PATH", "~/Library/Application Support/Wispr Flow/flow.sqlite")
)

# Activation word that triggers command processing
ACTIVATION_WORD = os.getenv("ACTIVATION_WORD", "command").lower()

# Polling interval in seconds
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "1.5"))

# Web UI port
WEB_PORT = int(os.getenv("WEB_PORT", "9000"))

# Confirmation mode for testing
CONFIRM_MODE = os.getenv("CONFIRM_MODE", "false").lower() == "true"

# Read command name aloud before execution (macOS voice)
READ_COMMAND_ALOUD = os.getenv("READ_COMMAND_ALOUD", "true").lower() == "true"

# Project root helper
PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))

# Commands storage file (in project root)
COMMANDS_FILE = os.path.join(PROJECT_ROOT, "commands.json")

# Database file (execution history, MCP catalog cache, etc.)
DB_PATH = os.path.join(PROJECT_ROOT, "wispr_act.db")

# MCP server config file (no plaintext secrets)
MCP_SERVERS_FILE = os.path.join(PROJECT_ROOT, "mcp_servers.json")

# Catalog + registry
MCP_REGISTRY_BASE_URL = os.getenv(
    "MCP_REGISTRY_BASE_URL", "https://registry.modelcontextprotocol.io"
)
MCP_CATALOG_CACHE_FILE = os.path.join(PROJECT_ROOT, "catalog_cache.json")
MCP_CATALOG_CACHE_TTL = int(os.getenv("MCP_CATALOG_CACHE_TTL", "300"))
MCP_CATALOG_FETCH_LIMIT = int(os.getenv("MCP_CATALOG_FETCH_LIMIT", "100"))
MCP_REGISTRY_TIMEOUT = float(os.getenv("MCP_REGISTRY_TIMEOUT", "10.0"))

# Secrets storage (macOS Keychain via keyring)
KEYRING_SERVICE = os.getenv("KEYRING_SERVICE", "wispr-action")

# Caching for MCP tool discovery (seconds)
MCP_TOOL_CACHE_TTL = int(os.getenv("MCP_TOOL_CACHE_TTL", "300"))

# Logs directory (in project root)
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

# Text-to-Speech Configuration
TTS_PROVIDER = os.getenv("TTS_PROVIDER", "apple").lower()  # "apple" or "cartesia"
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY", "")
CARTESIA_MODEL_ID = os.getenv("CARTESIA_MODEL_ID", "sonic-3")
CARTESIA_VOICE_ID = os.getenv("CARTESIA_VOICE_ID", "a0e99841-438c-4a64-b679-ae501e7d6091")

def validate_config():
    """Validate that required configuration is present."""
    errors = []
    
    if not ANTHROPIC_API_KEY:
        errors.append("ANTHROPIC_API_KEY is not set")
    
    if not os.path.exists(WISPR_DB_PATH):
        errors.append(f"Wispr Flow database not found at: {WISPR_DB_PATH}")
    
    return errors

def get_config_summary():
    """Get a summary of current configuration."""
    return {
        "wispr_db_path": WISPR_DB_PATH,
        "activation_word": ACTIVATION_WORD,
        "poll_interval": POLL_INTERVAL,
        "web_port": WEB_PORT,
        "confirm_mode": CONFIRM_MODE,
        "read_command_aloud": READ_COMMAND_ALOUD,
        "has_api_key": bool(ANTHROPIC_API_KEY),
        "llm_model": LLM_MODEL,
    }

