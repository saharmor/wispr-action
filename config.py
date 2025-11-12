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

# Commands storage file
COMMANDS_FILE = os.path.join(os.path.dirname(__file__), "commands.json")

# Logs directory
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

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
        "has_api_key": bool(ANTHROPIC_API_KEY),
        "llm_model": LLM_MODEL,
    }

