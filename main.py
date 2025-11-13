"""Main entry point for Wispr Action."""

import sys
import threading
import signal
import time

from config import validate_config, get_config_summary
from web_server import run_server
from tray_app import run_tray_app


def print_banner():
    """Print startup banner."""
    print("""
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                  WISPR ACTION SYSTEM                         ║
║                                                              ║
║              Voice Command Automation Platform               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
""")


def check_configuration():
    """Check and display configuration."""
    print("\nChecking configuration...")
    
    errors = validate_config()
    
    if errors:
        print("\nConfiguration errors:")
        for error in errors:
            print(f"   - {error}")
        print("\nPlease check your .env file or environment variables.")
        return False
    
    config = get_config_summary()
    print("\nConfiguration valid:")
    print(f"   - Database: {config['wispr_db_path']}")
    print(f"   - Activation word: '{config['activation_word']}'")
    print(f"   - Poll interval: {config['poll_interval']}s")
    print(f"   - Web port: {config['web_port']}")
    print(f"   - API key configured: {'Yes' if config['has_api_key'] else 'No'}")
    
    return True


def run_web_server_thread():
    """Run web server in a background thread."""
    try:
        run_server(debug=False)
    except Exception as e:
        print(f"Web server error: {e}")


def main():
    """Main entry point."""
    print_banner()
    
    # Check configuration
    if not check_configuration():
        sys.exit(1)
    
    print("\nStarting Wispr Action...")
    
    # Start web server in background thread
    web_thread = threading.Thread(target=run_web_server_thread, daemon=True)
    web_thread.start()
    
    # Give web server a moment to start
    time.sleep(1)
    
    # Run system tray app (blocks until quit)
    try:
        run_tray_app()
    except KeyboardInterrupt:
        print("\n\nShutting down...")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
    
    print("Wispr Action stopped.\n")


if __name__ == '__main__':
    main()

