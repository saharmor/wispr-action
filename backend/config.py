"""Configuration management for Wispr Action."""

import os
from pathlib import Path
from dotenv import load_dotenv

_loaded = False
_loaded_env_file: Path | None = None


def _project_root_path() -> Path:
    """Return the project root as a Path."""
    return Path(__file__).resolve().parent.parent


def _resolve_env_path(app_env: str | None) -> Path | None:
    """Resolve an environment-specific dotenv file from APP_ENV."""
    base_dir = _project_root_path()
    if not app_env:
        return None

    normalized = app_env.lower()
    if normalized in ("local", "dev", "development"):
        return base_dir / ".env.local"
    if normalized in ("prod", "production"):
        return base_dir / ".env.prod"
    if normalized in ("test", "testing"):
        return base_dir / ".env.test"
    return None


def load_env(force: bool = False) -> Path | None:
    """
    Load environment variables based on ENV_FILE or APP_ENV.

    Priority:
      1) ENV_FILE (explicit path)
      2) APP_ENV -> .env.local / .env.prod / .env.test
      3) project root .env
      4) default dotenv behavior
    """
    global _loaded, _loaded_env_file
    if _loaded and not force:
        return _loaded_env_file

    base_dir = _project_root_path()
    env_file = os.getenv("ENV_FILE")
    if env_file:
        resolved = Path(os.path.expanduser(env_file))
        if not resolved.is_absolute():
            resolved = base_dir / resolved
        load_dotenv(dotenv_path=resolved, override=True)
        _loaded_env_file = resolved if resolved.exists() else None
        _loaded = True
        return _loaded_env_file

    app_env = os.getenv("APP_ENV")
    resolved = _resolve_env_path(app_env)
    default_env = base_dir / ".env"

    if resolved and resolved.exists():
        load_dotenv(dotenv_path=resolved, override=True)
        _loaded_env_file = resolved
    elif default_env.exists():
        load_dotenv(dotenv_path=default_env, override=True)
        _loaded_env_file = default_env
    else:
        load_dotenv(override=True)
        _loaded_env_file = None

    _loaded = True
    return _loaded_env_file


def _refresh_config_values() -> None:
    """Refresh module-level config values from the current environment."""
    global ANTHROPIC_API_KEY
    global LLM_MODEL
    global WISPR_DB_PATH
    global ACTIVATION_WORD
    global OPTIMIZE_ACTIVATION_WORD
    global OPTIMIZE_LLM_MODEL
    global POLL_INTERVAL
    global WEB_PORT
    global CONFIRM_MODE
    global READ_COMMAND_ALOUD
    global ACTIVATION_SOUND_ENABLED
    global ACTIVATION_SOUND_PATH
    global PROJECT_ROOT
    global COMMANDS_FILE
    global DB_PATH
    global MCP_SERVERS_FILE
    global MCP_REGISTRY_BASE_URL
    global MCP_CATALOG_CACHE_FILE
    global MCP_CATALOG_CACHE_TTL
    global MCP_CATALOG_FETCH_LIMIT
    global MCP_REGISTRY_TIMEOUT
    global KEYRING_SERVICE
    global MCP_TOOL_CACHE_TTL
    global LOGS_DIR
    global TTS_PROVIDER
    global CARTESIA_API_KEY
    global CARTESIA_MODEL_ID
    global CARTESIA_VOICE_ID
    global WISPR_LOG_PATH
    global AUTO_VOLUME_REDUCTION_ENABLED
    global DICTATION_VOLUME_LEVEL

    # API Configuration
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")

    # Wispr Flow Database
    WISPR_DB_PATH = os.path.expanduser(
        os.getenv("WISPR_DB_PATH", "~/Library/Application Support/Wispr Flow/flow.sqlite")
    )

    # Activation word that triggers command processing
    ACTIVATION_WORD = os.getenv("ACTIVATION_WORD", "command").lower()

    # Optimize activation word that triggers prompt optimization
    OPTIMIZE_ACTIVATION_WORD = os.getenv("OPTIMIZE_ACTIVATION_WORD", "optimize").lower()

    # LLM model for prompt optimization (can be different from parsing model)
    OPTIMIZE_LLM_MODEL = os.getenv("OPTIMIZE_LLM_MODEL", "claude-sonnet-4-20250514")

    # Polling interval in seconds
    POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "1.5"))

    # Web UI port
    WEB_PORT = int(os.getenv("WEB_PORT", "9000"))

    # Confirmation mode for testing
    CONFIRM_MODE = os.getenv("CONFIRM_MODE", "false").lower() == "true"

    # Read command name aloud before execution (macOS voice)
    READ_COMMAND_ALOUD = os.getenv("READ_COMMAND_ALOUD", "true").lower() == "true"

    # Play a sound when the activation word is detected
    ACTIVATION_SOUND_ENABLED = os.getenv("ACTIVATION_SOUND_ENABLED", "true").lower() == "true"
    ACTIVATION_SOUND_PATH = os.getenv(
        "ACTIVATION_SOUND_PATH",
        "/System/Library/Sounds/Blow.aiff"
    )

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

    # Wispr Flow log file (used to detect dictation start/end)
    WISPR_LOG_PATH = os.path.expanduser(
        os.getenv("WISPR_LOG_PATH", "~/Library/Logs/Wispr Flow/main.log")
    )

    # Auto-reduce system volume while dictating
    AUTO_VOLUME_REDUCTION_ENABLED = os.getenv("AUTO_VOLUME_REDUCTION_ENABLED", "false").lower() == "true"
    DICTATION_VOLUME_LEVEL = int(os.getenv("DICTATION_VOLUME_LEVEL", "10"))


def reload_config() -> Path | None:
    """Force dotenv reload and refresh module-level config values."""
    env_path = load_env(force=True)
    _refresh_config_values()
    return env_path


def get_loaded_env_file() -> str | None:
    """Return the resolved dotenv path used for the current process."""
    return str(_loaded_env_file) if _loaded_env_file else None


load_env()
_refresh_config_values()

def validate_config():
    """
    Validate that required configuration is present and values are valid.
    
    Returns:
        List of error messages (empty if configuration is valid)
    """
    errors = []
    
    if not ANTHROPIC_API_KEY:
        errors.append("ANTHROPIC_API_KEY is not set")
    
    if not os.path.exists(WISPR_DB_PATH):
        errors.append(f"Wispr Flow database not found at: {WISPR_DB_PATH}")

    if not (0 <= DICTATION_VOLUME_LEVEL <= 100):
        errors.append(f"DICTATION_VOLUME_LEVEL must be 0-100, got: {DICTATION_VOLUME_LEVEL}")
    
    # Validate poll interval
    if POLL_INTERVAL <= 0:
        errors.append(f"POLL_INTERVAL must be positive, got: {POLL_INTERVAL}")
    elif POLL_INTERVAL < 0.1:
        errors.append(f"POLL_INTERVAL is too small (minimum 0.1 seconds), got: {POLL_INTERVAL}")
    
    # Validate web port
    if not (1 <= WEB_PORT <= 65535):
        errors.append(f"WEB_PORT must be between 1 and 65535, got: {WEB_PORT}")
    
    # Validate cache TTL values
    if MCP_TOOL_CACHE_TTL < 0:
        errors.append(f"MCP_TOOL_CACHE_TTL must be non-negative, got: {MCP_TOOL_CACHE_TTL}")
    
    if MCP_CATALOG_CACHE_TTL < 0:
        errors.append(f"MCP_CATALOG_CACHE_TTL must be non-negative, got: {MCP_CATALOG_CACHE_TTL}")
    
    # Validate timeout values
    if MCP_REGISTRY_TIMEOUT <= 0:
        errors.append(f"MCP_REGISTRY_TIMEOUT must be positive, got: {MCP_REGISTRY_TIMEOUT}")
    
    # Validate TTS provider
    if TTS_PROVIDER not in ('apple', 'cartesia'):
        errors.append(f"TTS_PROVIDER must be 'apple' or 'cartesia', got: {TTS_PROVIDER}")
    
    # Warn about missing Cartesia config if provider is cartesia
    if TTS_PROVIDER == 'cartesia' and not CARTESIA_API_KEY:
        errors.append("TTS_PROVIDER is set to 'cartesia' but CARTESIA_API_KEY is not set")
    
    return errors

def get_config_summary():
    """Get a summary of current configuration."""
    return {
        "env_file": get_loaded_env_file(),
        "wispr_db_path": WISPR_DB_PATH,
        "wispr_log_path": WISPR_LOG_PATH,
        "activation_word": ACTIVATION_WORD,
        "poll_interval": POLL_INTERVAL,
        "web_port": WEB_PORT,
        "confirm_mode": CONFIRM_MODE,
        "read_command_aloud": READ_COMMAND_ALOUD,
        "has_api_key": bool(ANTHROPIC_API_KEY),
        "llm_model": LLM_MODEL,
        "optimize_llm_model": OPTIMIZE_LLM_MODEL,
        "auto_volume_reduction": AUTO_VOLUME_REDUCTION_ENABLED,
        "dictation_volume_level": DICTATION_VOLUME_LEVEL,
    }

