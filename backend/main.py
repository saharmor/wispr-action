"""Main entry point for Wispr Action."""

import sys
import threading
import signal
import time
import os
import schedule

from config import validate_config, get_config_summary
from web_server import run_server
from tray_app import run_tray_app
from monitor import get_monitor
from execution_history import clear_old_logs
from logger_config import setup_logging


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
    print(f"   - Env file: {config['env_file'] or 'default dotenv resolution'}")
    print(f"   - Database: {config['wispr_db_path']}")
    print(f"   - Log file: {config.get('wispr_log_path', 'N/A')}")
    print(f"   - Activation word: '{config['activation_word']}'")
    print(f"   - Volume reduction: {'ON' if config.get('auto_volume_reduction') else 'OFF'}")
    print(f"   - Web port: {config['web_port']}")
    print(f"   - API key configured: {'Yes' if config['has_api_key'] else 'No'}")
    print(f"   - Command model: {config['llm_model']}")
    print(f"   - Optimize model: {config['optimize_llm_model']}")
    
    return True


def run_web_server_thread():
    """Run web server in a background thread."""
    try:
        run_server(debug=False)
    except Exception as e:
        print(f"Web server error: {e}")


def cleanup_old_logs_job():
    """Scheduled job to clean up old execution logs."""
    try:
        clear_old_logs(keep_count=1000)
    except Exception as e:
        print(f"Error cleaning up old logs: {e}")


def run_scheduler():
    """Run the scheduled tasks in a background thread."""
    # Schedule daily cleanup of old logs at 2 AM
    schedule.every().day.at("02:00").do(cleanup_old_logs_job)
    
    # Run scheduler loop
    while True:
        schedule.run_pending()
        time.sleep(60)  # Check every minute


def main():
    """Main entry point."""
    # Setup logging first
    log_level = os.getenv('LOG_LEVEL', 'INFO')
    setup_logging(log_level)
    
    print_banner()
    
    # Check configuration
    if not check_configuration():
        sys.exit(1)
    
    print("\nStarting Wispr Action...")
    
    # Start scheduler for periodic tasks
    scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
    scheduler_thread.start()
    
    # Start web server in background thread
    web_thread = threading.Thread(target=run_web_server_thread, daemon=True)
    web_thread.start()
    
    # Give web server a moment to start
    time.sleep(1)
    
    # Auto-start the monitor
    print("\nAuto-starting monitor...")
    monitor = get_monitor()
    monitor.start()
    
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

