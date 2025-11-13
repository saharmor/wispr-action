"""System tray application for Wispr Action."""

import webbrowser
import threading
from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem as item

from monitor import get_monitor
from config import WEB_PORT


class TrayApp:
    """System tray application for controlling Wispr Action."""
    
    def __init__(self):
        self.icon = None
        self.monitor = get_monitor()
        self.web_url = f"http://localhost:{WEB_PORT}"
    
    def create_icon_image(self):
        """Create a simple icon image for the system tray."""
        # Create a 64x64 image with a microphone icon
        width = 64
        height = 64
        image = Image.new('RGB', (width, height), color=(79, 70, 229))  # Primary color
        
        dc = ImageDraw.Draw(image)
        
        # Draw a simple microphone shape
        # Microphone body (rounded rectangle)
        dc.ellipse([20, 15, 44, 35], fill='white')
        dc.rectangle([20, 25, 44, 40], fill='white')
        
        # Microphone stand
        dc.rectangle([30, 40, 34, 50], fill='white')
        dc.rectangle([22, 48, 42, 52], fill='white')
        
        return image
    
    def open_dashboard(self, icon=None, item=None):
        """Open the web dashboard in browser."""
        webbrowser.open(self.web_url)
    
    def start_monitor(self, icon=None, item=None):
        """Start the monitor."""
        if not self.monitor.is_running:
            # Run in thread to avoid blocking
            thread = threading.Thread(target=self.monitor.start)
            thread.start()
            # Update icon menu
            if self.icon:
                self.icon.update_menu()
    
    def stop_monitor(self, icon=None, item=None):
        """Stop the monitor."""
        if self.monitor.is_running:
            self.monitor.stop()
            # Update icon menu
            if self.icon:
                self.icon.update_menu()
    
    def get_status_text(self):
        """Get current status text."""
        if self.monitor.is_running:
            return "Running"
        else:
            return "Stopped"
    
    def quit_app(self, icon=None, item=None):
        """Quit the application."""
        # Stop monitor if running
        if self.monitor.is_running:
            self.monitor.stop()
        
        # Stop icon
        if self.icon:
            self.icon.stop()
    
    def create_menu(self):
        """Create the system tray menu."""
        return pystray.Menu(
            item(
                'Open Dashboard',
                self.open_dashboard,
                default=True
            ),
            item(
                'Start Monitor',
                self.start_monitor,
                visible=lambda item: not self.monitor.is_running
            ),
            item(
                'Stop Monitor',
                self.stop_monitor,
                visible=lambda item: self.monitor.is_running
            ),
            item(
                lambda text: self.get_status_text(),
                lambda icon, item: None,
                enabled=False
            ),
            pystray.Menu.SEPARATOR,
            item(
                'Exit',
                self.quit_app
            )
        )
    
    def run(self):
        """Run the system tray application."""
        # Create icon image
        icon_image = self.create_icon_image()
        
        # Create menu
        menu = self.create_menu()
        
        # Create icon
        self.icon = pystray.Icon(
            "wispr_action",
            icon_image,
            "Wispr Action",
            menu
        )
        
        print("""
╔══════════════════════════════════════════════════════════════╗
║         Wispr Action - System Tray                          ║
╚══════════════════════════════════════════════════════════════╝

System tray app is running
Click the tray icon to:
   - Open Dashboard
   - Start/Stop Monitor
   - Exit the application

Dashboard URL: {url}
""".format(url=self.web_url))
        
        # Run icon (blocks until quit)
        self.icon.run()


def run_tray_app():
    """Run the system tray application."""
    app = TrayApp()
    app.run()


if __name__ == '__main__':
    run_tray_app()

