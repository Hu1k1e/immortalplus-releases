"""
Finds and captures the actual Dota 2 game window, instead of guessing
which physical monitor it's on. This is what makes the percentage-based
regions in regions.py actually portable across different users' setups:
percentages are of the GAME WINDOW, not the monitor, so one correct
calibration works regardless of monitor count/arrangement, window vs.
fullscreen, or resolution — as long as Dota's own UI scale is left at
default (see regions.py's docstring for that one remaining caveat).
"""

import ctypes
import logging
import threading

import mss
import numpy as np
import cv2
import win32gui

logger = logging.getLogger("draft-scanner.window_capture")

_DOTA_WINDOW_TITLES = ("Dota 2",)

# Windows scales window coordinates down for non-DPI-aware processes, which
# would silently misalign every capture on a scaled display (125%/150%/etc
# — extremely common). Force per-monitor DPI awareness so GetWindowRect
# returns real physical pixels, matching what mss actually captures.
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        logger.warning("Could not set DPI awareness — captures may misalign on a scaled display")


def find_dota_window_rect() -> tuple[int, int, int, int] | None:
    """Returns (left, top, width, height) of the Dota 2 window in real
    screen pixels, or None if it isn't currently running/visible."""
    for title in _DOTA_WINDOW_TITLES:
        hwnd = win32gui.FindWindow(None, title)
        if hwnd and win32gui.IsWindowVisible(hwnd) and not win32gui.IsIconic(hwnd):   # a minimised window has nothing to read
            # The part the game draws into: in a bordered window that leaves out the title bar and frame (which would shift every region),
            # in fullscreen it is the whole screen.
            try:
                cl, ct, cr, cb = win32gui.GetClientRect(hwnd)
                if cr - cl > 0 and cb - ct > 0:
                    x, y = win32gui.ClientToScreen(hwnd, (0, 0))
                    return (x, y, cr - cl, cb - ct)
            except Exception:
                pass
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
            width, height = right - left, bottom - top
            if width > 0 and height > 0:
                return (left, top, width, height)
    return None


_local = threading.local()


def _grabber():
    """One screen grabber per thread, kept open: creating one for every capture is the slow part."""
    sct = getattr(_local, "sct", None)
    if sct is None:
        sct = _local.sct = mss.mss()
    return sct


def capture_dota_window() -> np.ndarray | None:
    """Returns a BGR numpy array of just the Dota 2 window, or None if the
    window can't be found (e.g. game isn't running)."""
    rect = find_dota_window_rect()
    if rect is None:
        return None
    left, top, width, height = rect
    region = {"left": left, "top": top, "width": width, "height": height}
    try:
        shot = np.array(_grabber().grab(region))
    except Exception:
        _local.sct = None          # the grabber can go stale (display change); make a new one next time
        raise
    return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)


def capture_dota_region(x: int, y: int, w: int, h: int) -> np.ndarray | None:
    """Just a small part of the Dota window (x, y relative to the window): far cheaper than the whole window,
    so it is what the always-on checks use."""
    rect = find_dota_window_rect()
    if rect is None:
        return None
    left, top, width, height = rect
    x, y = max(0, x), max(0, y)
    w, h = min(w, width - x), min(h, height - y)
    if w <= 0 or h <= 0:
        return None
    try:
        shot = np.array(_grabber().grab({"left": left + x, "top": top + y, "width": w, "height": h}))
    except Exception:
        _local.sct = None
        raise
    return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)


def capture_primary_monitor() -> np.ndarray:
    """Fallback only — used when the Dota window can't be found, so the
    tool (e.g. calibrate.py) still works for testing without the game
    open. Live scanning (main.py) should treat a missing window as
    "not in a draft" instead of falling back to this."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        shot = np.array(sct.grab(monitor))
        return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)
