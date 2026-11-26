"""
AURA Ambient Environment & Context Tools
========================================
Exposes ambient environmental awareness tools to the AURA agent, enabling it to
inspect the user's active application, window title, and clipboard contents.
"""

from typing import Dict, Any
from backend.ambient_sentinel import get_ambient_context as _fetch_ambient


def get_ambient_context() -> Dict[str, Any]:
    """Retrieves real-time ambient environment context from the user's PC.

    Returns the title and process of the active/foreground application, clipboard
    intel (content type, preview text, length), and contextual suggestions.

    Use this tool when:
    - The user refers to "what I'm looking at", "my current screen", or "what I'm working on"
    - The user asks you to "look at what I copied", "fix this error", or "review this snippet"
    - You need to determine what software (VS Code, Chrome, Terminal) the user has open
    """
    return _fetch_ambient(force_refresh=True)
