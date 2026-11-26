"""
AURA Windows UI Automation (UIA) Tools
======================================
Provides structured, deterministic inspection and interaction with native
Windows desktop controls via Microsoft UI Automation (UIA) and pywinauto,
bypassing fragile pixel-coordinate guessing.
"""

import logging
import time
from typing import Dict, List, Optional, Any

_desktop_attached = False


def _attach_user_desktop():
    """Ensure the current thread is attached to the active user interactive window station and desktop."""
    global _desktop_attached
    try:
        import ctypes
        user32 = ctypes.windll.user32
        h_winsta = user32.OpenWindowStationW("WinSta0", False, 0x10000000)
        if h_winsta:
            user32.SetProcessWindowStation(h_winsta)
            h_desk = user32.OpenDesktopW("Default", 0, False, 0x10000000)
            if h_desk:
                user32.SetThreadDesktop(h_desk)
                _desktop_attached = True
    except Exception as e:
        logging.debug(f"[UIA] Note on desktop station attach: {e}")


def list_open_windows() -> List[Dict[str, Any]]:
    """Returns a list of all visible, top-level application windows on the desktop.

    Returns:
        List of dicts containing 'title', 'handle' (HWND), and 'class_name'.
    """
    _attach_user_desktop()
    results = []
    try:
        import win32gui

        def _enum_callback(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd).strip()
                if title:
                    class_name = win32gui.GetClassName(hwnd)
                    results.append({
                        "title": title,
                        "hwnd": hwnd,
                        "class_name": class_name,
                    })

        win32gui.EnumWindows(_enum_callback, None)
    except Exception as e:
        logging.warning(f"[UIA] list_open_windows fallback error: {e}")

    # Fallback to pygetwindow if win32gui returned empty
    if not results:
        try:
            import pygetwindow as gw
            for w in gw.getAllWindows():
                if w.visible and w.title.strip():
                    results.append({
                        "title": w.title.strip(),
                        "hwnd": getattr(w, "_hWnd", 0),
                        "class_name": "Window",
                    })
        except Exception:
            pass

    return results


def get_window_controls(window_title: Optional[str] = None, max_controls: int = 40) -> Dict[str, Any]:
    """Inspects the native UI Automation (UIA) tree of a target application window.

    Extracts interactive buttons, input fields, menus, checkboxes, tabs, and links.

    Args:
        window_title: Window title or substring (e.g. 'Notepad', 'Edge', 'Settings').
                      If omitted or None, inspects the foreground/active window.
        max_controls: Maximum number of interactive controls to return (default: 40).

    Returns:
        Dict with 'window_title', 'hwnd', and list of 'controls'.
    """
    _attach_user_desktop()
    try:
        from pywinauto import Desktop
        desktop = Desktop(backend="uia")

        target_window = None
        if window_title:
            needle = window_title.lower().strip()
            for win in desktop.windows():
                if win.is_visible() and needle in win.window_text().lower():
                    target_window = win
                    break
        else:
            # Active/foreground window
            import win32gui
            fg_hwnd = win32gui.GetForegroundWindow()
            if fg_hwnd:
                for win in desktop.windows():
                    if getattr(win, "handle", 0) == fg_hwnd or win.handle == fg_hwnd:
                        target_window = win
                        break
            if not target_window:
                # Top visible window
                visible_wins = [w for w in desktop.windows() if w.is_visible() and w.window_text().strip()]
                if visible_wins:
                    target_window = visible_wins[0]

        if not target_window:
            return {
                "status": "not_found",
                "message": f"Window matching '{window_title}' not found.",
                "open_windows": [w["title"] for w in list_open_windows()[:10]],
                "controls": []
            }

        real_title = target_window.window_text()
        hwnd = getattr(target_window, "handle", 0)

        interactive_types = {
            "Button", "Edit", "MenuItem", "CheckBox", "RadioButton",
            "TabItem", "ComboBox", "Hyperlink", "Document", "ListItem", "TreeItem"
        }

        controls_list = []
        try:
            descendants = target_window.descendants()
            for ctrl in descendants:
                try:
                    info = ctrl.element_info
                    c_type = info.control_type or "Unknown"
                    c_name = info.name or ""
                    auto_id = getattr(info, "automation_id", "") or ""

                    # Filter for interactive or named controls
                    if c_type in interactive_types or (c_name and len(c_name.strip()) > 0):
                        rect = info.rectangle
                        controls_list.append({
                            "name": c_name.strip(),
                            "control_type": c_type,
                            "automation_id": auto_id,
                            "is_enabled": getattr(info, "enabled", True),
                            "is_visible": getattr(info, "visible", True),
                            "bounds": [rect.left, rect.top, rect.right, rect.bottom] if rect else None
                        })
                        if len(controls_list) >= max_controls:
                            break
                except Exception:
                    continue
        except Exception as e:
            logging.debug(f"[UIA] Descendants extraction warning: {e}")

        return {
            "status": "success",
            "window_title": real_title,
            "hwnd": hwnd,
            "count": len(controls_list),
            "controls": controls_list
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"Error querying UI automation tree: {e}",
            "controls": []
        }


def click_ui_element(
    window_title: Optional[str] = None,
    element_name: Optional[str] = None,
    control_type: Optional[str] = None,
    automation_id: Optional[str] = None
) -> str:
    """Clicks an interactive UI element directly via Windows UI Automation.

    Deterministic invocation with zero pixel-coordinate drift.

    Args:
        window_title: Window title or substring to target.
        element_name: Name or label of the control (e.g. 'Save', 'Close', 'Submit').
        control_type: Optional control type filter (e.g. 'Button', 'MenuItem', 'TabItem').
        automation_id: Optional specific developer automation ID.

    Returns:
        Human-readable outcome string.
    """
    _attach_user_desktop()
    try:
        from pywinauto import Desktop
        desktop = Desktop(backend="uia")

        target_window = None
        if window_title:
            needle = window_title.lower().strip()
            for win in desktop.windows():
                if win.is_visible() and needle in win.window_text().lower():
                    target_window = win
                    break
        else:
            visible_wins = [w for w in desktop.windows() if w.is_visible() and w.window_text().strip()]
            if visible_wins:
                target_window = visible_wins[0]

        if not target_window:
            return f"Error: Window '{window_title}' not found."

        # Search matching child control
        name_needle = (element_name or "").lower().strip()
        type_needle = (control_type or "").lower().strip()
        id_needle = (automation_id or "").strip()

        matched_control = None
        for ctrl in target_window.descendants():
            try:
                info = ctrl.element_info
                c_name = (info.name or "").lower().strip()
                c_type = (info.control_type or "").lower().strip()
                c_id = getattr(info, "automation_id", "") or ""

                if id_needle and c_id == id_needle:
                    matched_control = ctrl
                    break
                if name_needle and (name_needle == c_name or name_needle in c_name):
                    if not type_needle or type_needle in c_type:
                        matched_control = ctrl
                        break
            except Exception:
                continue

        if not matched_control:
            return f"Error: UI element matching name='{element_name}' type='{control_type}' not found in '{target_window.window_text()}'."

        # Attempt invoke or click
        try:
            matched_control.click_input()
        except Exception:
            try:
                matched_control.invoke()
            except Exception as e:
                return f"Error clicking element: {e}"

        return f"Successfully clicked '{matched_control.element_info.name or element_name}' ({matched_control.element_info.control_type}) in '{target_window.window_text()}'."

    except Exception as e:
        return f"Failed to click UI element: {e}"


def set_ui_element_text(
    window_title: Optional[str] = None,
    element_name: Optional[str] = None,
    text: str = "",
    clear_first: bool = True
) -> str:
    """Enters text directly into an Edit, TextBox, or Document control using UI Automation.

    Args:
        window_title: Window title or substring to target.
        element_name: Name or label of the edit field.
        text: Text string to input.
        clear_first: Whether to clear existing text before entering (default: True).

    Returns:
        Status description string.
    """
    _attach_user_desktop()
    try:
        from pywinauto import Desktop
        desktop = Desktop(backend="uia")

        target_window = None
        if window_title:
            needle = window_title.lower().strip()
            for win in desktop.windows():
                if win.is_visible() and needle in win.window_text().lower():
                    target_window = win
                    break
        else:
            visible_wins = [w for w in desktop.windows() if w.is_visible() and w.window_text().strip()]
            if visible_wins:
                target_window = visible_wins[0]

        if not target_window:
            return f"Error: Window '{window_title}' not found."

        name_needle = (element_name or "").lower().strip()
        matched_edit = None

        # Look for edit/document controls
        for ctrl in target_window.descendants():
            try:
                info = ctrl.element_info
                c_type = (info.control_type or "")
                c_name = (info.name or "").lower()

                if c_type in ("Edit", "Document"):
                    if not name_needle or name_needle in c_name:
                        matched_edit = ctrl
                        break
            except Exception:
                continue

        if not matched_edit:
            return f"Error: No editable input field matching '{element_name}' found in '{target_window.window_text()}'."

        if clear_first:
            try:
                matched_edit.set_text("")
            except Exception:
                pass

        try:
            matched_edit.set_text(text)
        except Exception:
            matched_edit.type_keys(text, with_spaces=True)

        return f"Successfully set text in '{matched_edit.element_info.name or 'Edit'}' ({len(text)} characters entered)."

    except Exception as e:
        return f"Failed to set text in UI element: {e}"
