import webbrowser
import urllib.parse
import time
import pyautogui

def search_spotify(query: str) -> str:
    """
    Searches for a song, artist, or playlist on Spotify and opens the Spotify desktop app.
    Use this when the user asks you to find or play specific music.
    :param query: The name of the song, artist, or playlist.
    """
    try:
        safe_query = urllib.parse.quote(query)
        # Using the spotify: URI scheme will open the desktop app directly to the search page.
        webbrowser.open(f"spotify:search:{safe_query}")

        # Give Spotify a moment to open and load the search page
        time.sleep(2)

        # Only send keystrokes if Spotify actually has focus, otherwise Enter
        # fires into whatever window the user is typing in.
        try:
            import pygetwindow as gw
            active = gw.getActiveWindow()
            if not active or 'spotify' not in (active.title or "").lower():
                return (f"Opened Spotify and searched for '{query}', "
                        f"but Spotify does not have keyboard focus (active window: "
                        f"'{active.title if active else 'unknown'}'). Press Enter there manually to play.")
        except Exception:
            pass  # pygetwindow unavailable - keep legacy behavior

        # Press enter twice to start playing the top result
        pyautogui.press('enter')
        time.sleep(0.5)
        pyautogui.press('enter')

        return f"Opened Spotify and searched for '{query}'"
    except Exception as e:
        return f"Failed to open Spotify: {e}"

def play_spotify_music() -> str:
    """
    Simulates pressing the 'play/pause' media key to toggle Spotify playback.
    Use this to pause or resume music.
    """
    try:
        pyautogui.press('playpause')
        return "Toggled media playback."
    except Exception as e:
        return f"Failed to toggle media playback: {e}"
