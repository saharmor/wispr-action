"""macOS system volume controller for dictation-aware volume reduction."""

import atexit
import subprocess
import logging

logger = logging.getLogger(__name__)

_active_controllers: list["VolumeController"] = []


def _restore_all_volumes() -> None:
    """atexit hook: restore volume if the process exits mid-dictation."""
    for vc in _active_controllers:
        vc.on_dictation_end()


atexit.register(_restore_all_volumes)


def _run_osascript(script: str) -> str | None:
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
        logger.warning("osascript failed (rc=%d): %s", result.returncode, result.stderr.strip())
    except FileNotFoundError:
        logger.warning("osascript not found – volume control requires macOS")
    except subprocess.TimeoutExpired:
        logger.warning("osascript timed out")
    except Exception as e:
        logger.warning("osascript error: %s", e)
    return None


def get_system_volume() -> int | None:
    """Return current macOS output volume (0-100), or None on failure."""
    raw = _run_osascript("output volume of (get volume settings)")
    if raw is not None:
        try:
            return int(raw)
        except ValueError:
            pass
    return None


def set_system_volume(level: int) -> bool:
    """Set macOS output volume to *level* (0-100). Returns success."""
    level = max(0, min(100, level))
    return _run_osascript(f"set volume output volume {level}") is not None


class VolumeController:
    """Lower system volume while dictation is active, restore when done."""

    def __init__(self, dictation_volume: int = 10):
        self.dictation_volume = dictation_volume
        self._saved_volume: int | None = None
        _active_controllers.append(self)

    def on_dictation_start(self) -> None:
        current = get_system_volume()
        if current is None:
            logger.warning("Could not read system volume; skipping reduction")
            return

        if current <= self.dictation_volume:
            return

        self._saved_volume = current
        set_system_volume(self.dictation_volume)
        logger.info("Volume lowered: %d → %d", current, self.dictation_volume)

    def on_dictation_end(self) -> None:
        if self._saved_volume is None:
            return
        set_system_volume(self._saved_volume)
        logger.info("Volume restored: → %d", self._saved_volume)
        self._saved_volume = None
