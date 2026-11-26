"""
AURA Ambient Context Sentinel
=============================
Passively monitors foreground window, active application, and clipboard state
to provide real-time environmental context and proactive workflow suggestions.
"""

import os
import sys
import time
import datetime
import logging
import json
import re
from typing import Dict, Any, List, Optional
import psutil

try:
    import pyperclip
except ImportError:
    pyperclip = None

_cached_ambient: Optional[Dict[str, Any]] = None
_last_poll_time: float = 0.0
_CACHE_TTL_SECONDS: float = 1.0

# Process name to friendly application mapping
APP_FRIENDLY_NAMES = {
    "code.exe": "Visual Studio Code",
    "devenv.exe": "Visual Studio",
    "msedge.exe": "Microsoft Edge",
    "chrome.exe": "Google Chrome",
    "firefox.exe": "Mozilla Firefox",
    "brave.exe": "Brave Browser",
    "notepad.exe": "Notepad",
    "notepad++.exe": "Notepad++",
    "explorer.exe": "File Explorer",
    "windowsterminal.exe": "Windows Terminal",
    "powershell.exe": "PowerShell",
    "cmd.exe": "Command Prompt",
    "slack.exe": "Slack",
    "discord.exe": "Discord",
    "spotify.exe": "Spotify",
    "pycharm64.exe": "PyCharm",
    "sublime_text.exe": "Sublime Text",
    "vlc.exe": "VLC Media Player",
    "taskmgr.exe": "Task Manager",
    "systemsettings.exe": "Windows Settings"
}


def _get_active_application_info() -> Dict[str, Any]:
    """Retrieves title, process name, and friendly name of the foreground window."""
    info = {
        "hwnd": 0,
        "title": "Desktop / No Active Window",
        "process_name": "unknown",
        "app_name": "Desktop",
        "is_fullscreen": False
    }

    try:
        import win32gui
        import win32process

        hwnd = win32gui.GetForegroundWindow()
        if hwnd:
            info["hwnd"] = hwnd
            title = win32gui.GetWindowText(hwnd).strip()
            if title:
                info["title"] = title

            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid:
                try:
                    proc = psutil.Process(pid)
                    pname = proc.name().lower()
                    info["process_name"] = pname
                    info["app_name"] = APP_FRIENDLY_NAMES.get(pname, pname.replace(".exe", "").capitalize())
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    except Exception as e:
        logging.debug(f"[Sentinel] Active window query note: {e}")
        # Fallback to pygetwindow if available
        try:
            import pygetwindow as gw
            active = gw.getActiveWindow()
            if active and active.title.strip():
                info["title"] = active.title.strip()
                info["app_name"] = "Application"
        except Exception:
            pass

    return info


def _get_clipboard_intel() -> Dict[str, Any]:
    """Safely inspects clipboard text and classifies its semantic content type."""
    intel = {
        "has_content": False,
        "content_type": "none",
        "char_count": 0,
        "preview": "",
        "content": ""
    }

    if not pyperclip:
        return intel

    try:
        text = pyperclip.paste()
        if not text or not isinstance(text, str):
            return intel

        stripped = text.strip()
        length = len(stripped)
        if length == 0:
            return intel

        intel["has_content"] = True
        intel["char_count"] = length
        intel["preview"] = stripped[:120].replace("\r", "").replace("\n", " ") + ("..." if length > 120 else "")
        # Keep full text capped to 3000 chars for context injection
        intel["content"] = stripped[:3000]

        # Content classification
        if "Traceback (most recent call last):" in stripped or ("Error:" in stripped and "File \"" in stripped):
            intel["content_type"] = "error_traceback"
        elif re.match(r"^https?://[^\s]+$", stripped):
            intel["content_type"] = "url"
        elif stripped.startswith("{") and stripped.endswith("}"):
            try:
                json.loads(stripped)
                intel["content_type"] = "json_data"
            except Exception:
                intel["content_type"] = "code"
        elif any(marker in stripped for marker in ["def ", "import ", "const ", "let ", "function ", "class ", "=>", "</", "public static void"]):
            intel["content_type"] = "code"
        elif "\n" in stripped and len(stripped.splitlines()) > 3:
            intel["content_type"] = "multiline_text"
        else:
            intel["content_type"] = "plain_text"

    except Exception as e:
        logging.debug(f"[Sentinel] Clipboard read note: {e}")

    return intel


def _generate_suggestions(app_info: Dict[str, Any], clip_info: Dict[str, Any]) -> List[Dict[str, str]]:
    """Synthesizes dynamic proactive action chips based on ambient state."""
    suggestions = []

    # Priority 1: High-entropy clipboard context
    c_type = clip_info.get("content_type", "none")
    if c_type == "error_traceback":
        suggestions.append({
            "title": "Fix Copied Error",
            "prompt": "I noticed an error traceback on my clipboard. Can you analyze what caused it and tell me how to resolve it?",
            "category": "debug"
        })
    elif c_type == "code":
        suggestions.append({
            "title": "Review Copied Code",
            "prompt": "Review the code snippet currently on my clipboard. Check for potential bugs, security issues, or optimizations.",
            "category": "code"
        })
    elif c_type == "url":
        suggestions.append({
            "title": "Summarize Copied URL",
            "prompt": f"Summarize the key information or purpose of this URL: {clip_info.get('preview', '')}",
            "category": "web"
        })

    # Priority 2: Active application context
    app_name = app_info.get("app_name", "")
    pname = app_info.get("process_name", "")

    if "code" in pname or "visual studio" in app_name.lower():
        suggestions.append({
            "title": "Inspect Active Project",
            "prompt": "I am working in Visual Studio Code. What tools or diagnostic commands can help with this project?",
            "category": "code"
        })
    elif any(b in pname for b in ["chrome", "msedge", "firefox", "brave"]):
        suggestions.append({
            "title": "Web Assistant",
            "prompt": "Need research or summarization assistance related to my current web browsing session.",
            "category": "web"
        })
    elif "terminal" in pname or "powershell" in pname or "cmd" in pname:
        suggestions.append({
            "title": "Terminal Helper",
            "prompt": "I'm in the command line terminal. Can you help me formulate a command or diagnose an output?",
            "category": "system"
        })

    # Fallback default suggestions
    if len(suggestions) < 3:
        suggestions.append({
            "title": "System Health Check",
            "prompt": "Run a comprehensive diagnostic sweep on CPU, memory, and thermals.",
            "category": "system"
        })
    if len(suggestions) < 3:
        suggestions.append({
            "title": "Query Desktop Knowledge",
            "prompt": "Search my indexed desktop documents for notes on this project.",
            "category": "search"
        })

    return suggestions[:3]


def get_ambient_context(force_refresh: bool = False) -> Dict[str, Any]:
    """Returns the consolidated ambient context including active window, clipboard intel, and suggestions."""
    global _cached_ambient, _last_poll_time
    now = time.time()

    if not force_refresh and _cached_ambient is not None and (now - _last_poll_time) < _CACHE_TTL_SECONDS:
        return _cached_ambient

    app_info = _get_active_application_info()
    clip_info = _get_clipboard_intel()
    suggestions = _generate_suggestions(app_info, clip_info)

    _cached_ambient = {
        "timestamp": datetime.datetime.now().isoformat(),
        "active_window": app_info,
        "clipboard": {
            "has_content": clip_info["has_content"],
            "content_type": clip_info["content_type"],
            "char_count": clip_info["char_count"],
            "preview": clip_info["preview"]
        },
        "clipboard_content": clip_info.get("content", ""),
        "suggestions": suggestions
    }
    _last_poll_time = now
    return _cached_ambient
