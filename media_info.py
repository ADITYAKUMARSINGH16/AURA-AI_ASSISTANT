"""Now-playing metadata via Windows System Media Transport Controls (SMTC).

Two WinRT projections are supported, tried in order:
  1. legacy `winsdk` package (`winsdk.windows.media.control`)
  2. modern `winrt-*` package family (`winrt.windows.media.control`) —
     these ship wheels for current Python builds; requires
     winrt-Windows.Media.Control, winrt-Windows.Foundation,
     winrt-Windows.Storage.Streams, winrt-Windows.Foundation.Collections.
If neither imports, the feature degrades to available:false.
"""
import base64
import asyncio
import os

from pathlib import Path

_wmc = None
PROJECTION = None
try:  # legacy projection first
    import winsdk.windows.media.control as _wmc
    PROJECTION = "winsdk"
except ImportError:
    try:  # modern per-namespace packages (current Python wheels)
        import winrt.windows.media.control as _wmc
        PROJECTION = "winrt"
    except ImportError:
        _wmc = None

WINSDK_AVAILABLE = PROJECTION is not None

_UNAVAILABLE_SHAPE = {
    "available": False,
    "playing": False,
    "title": None,
    "artist": None,
    "album": None,
    "album_art": None,
    "app": None,
    "position_s": None,
    "duration_s": None,
}


def _unavailable(reason: str) -> dict:
    out = dict(_UNAVAILABLE_SHAPE)
    out["reason"] = reason
    return out


def _streams_module():
    """Buffer lives under whichever projection imported successfully."""
    name = f"{PROJECTION}.windows.storage.streams"
    import importlib
    return importlib.import_module(name)


def _empty_session() -> dict:
    out = {
        "available": True,
        "playing": False,
        "title": None,
        "artist": None,
        "album": None,
        "album_art": None,
        "app": None,
        "position_s": None,
        "duration_s": None,
    }
    return out


def _app_display_name(app_id: str):
    if not app_id:
        return None
    # SourceAppUserModelId looks like "Spotify.exe" or a full package id;
    # the trailing name segment is the friendliest thing we have.
    return os.path.basename(str(app_id).split("!")[0])


def _status_name(playback_info):
    try:
        return playback_info.playback_status.name  # winsdk enum projection
    except Exception:
        try:
            return str(playback_info.playback_status).split(".")[-1].rstrip(">")
        except Exception:
            return ""


async def _album_art_data_uri(props):
    """Best-effort thumbnail → base64 data URI; None on any failure."""
    try:
        thumb = getattr(props, "thumbnail", None)
        if not thumb:
            return None
        streams = _streams_module()
        stream = await thumb.open_read_async()
        buf = streams.Buffer(stream.size)
        await stream.read_async(buf, stream.size, 1)  # 1 = READ_AHEAD
        b64 = base64.b64encode(bytes(buf.data)).decode("ascii")
        return f"data:{stream.content_type or 'image/png'};base64,{b64}"
    except Exception:
        return None


async def get_now_playing() -> dict:
    """Snapshot of the system media session (SMTC). Never raises.

    The WinRT awaits deadlock when run directly on a foreign event loop
    (observed: uvicorn's loop froze on the first query), so the query runs
    on a worker thread with its own asyncio.run, under a timeout so a hung
    COM call can never stall the API.
    """
    if not WINSDK_AVAILABLE:
        return _unavailable(
            "no WinRT projection installed (need winsdk or the winrt-* packages)"
        )
    try:
        return await asyncio.wait_for(asyncio.to_thread(_query_sync), timeout=8)
    except asyncio.TimeoutError:
        return _unavailable("SMTC query timed out")
    except Exception as e:
        return _unavailable(f"SMTC query failed: {e}")


def _query_sync() -> dict:
    return asyncio.run(_query_impl())


async def _query_impl() -> dict:
    manager = await _wmc.GlobalSystemMediaTransportControlsSessionManager.request_async()
    sessions = list(manager.get_sessions())
    if not sessions:
        return _empty_session()

    # Prefer a session that is actively playing over background ones.
    session = sessions[0]
    for s in sessions:
        try:
            if _status_name(s.get_playback_info()) == "PLAYING":
                session = s
                break
        except Exception:
            continue

    props = await session.try_get_media_properties_async()
    playback = session.get_playback_info()
    timeline = session.get_timeline_properties()

    playing = _status_name(playback) == "PLAYING"

    def _seconds(value):
        try:
            return int(value.total_seconds()) if value else None
        except Exception:
            return None

    out = _empty_session()
    out.update({
        "playing": playing,
        "title": props.title or None,
        "artist": props.artist or None,
        "album": props.album_title or None,
        "app": _app_display_name(session.source_app_user_model_id),
        "position_s": _seconds(timeline.position),
        "duration_s": _seconds(timeline.end_time),
    })
    if playing or out["title"]:
        out["album_art"] = await _album_art_data_uri(props)
    return out
