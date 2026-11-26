"""
Comprehensive system health and regression test suite for AURA AI Assistant.
Verifies backend endpoints, routes, tray URLs, tool registries, and static assets.
"""
import os
import sys
try:
    import pytest
except ImportError:
    pytest = None

# Ensure project root is in sys.path
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from fastapi.testclient import TestClient
from api import app
import tray
import tools
from agent import create_agent, available_tools, tool_map


client = TestClient(app, raise_server_exceptions=False)


def test_last_screen_head_and_get():
    """Verify HEAD and GET on /api/captures/last_screen never throw NameError 500."""
    res_head = client.head("/api/captures/last_screen")
    assert res_head.status_code in (200, 404), f"Expected 200 or 404, got {res_head.status_code}"

    res_get = client.get("/api/captures/last_screen")
    assert res_get.status_code in (200, 404), f"Expected 200 or 404, got {res_get.status_code}"


def test_routes_accessibility():
    """Verify landing page, HUD, and legacy routes all resolve successfully."""
    # Root / -> landing page
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert "AURA" in res_root.text

    # /welcome -> landing page
    res_welcome = client.get("/welcome")
    assert res_welcome.status_code == 200
    assert "AURA" in res_welcome.text

    # /hud -> HUD application
    res_hud = client.get("/hud")
    assert res_hud.status_code == 200
    assert "arc-reactor" in res_hud.text or "onboard-overlay" in res_hud.text


def test_core_health_endpoints():
    """Verify health probes and core read endpoints respond correctly."""
    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    assert res_health.json() == {"ok": True}

    res_ollama = client.get("/api/health/ollama")
    assert res_ollama.status_code == 200
    data = res_ollama.json()
    assert "ok" in data
    assert "latency_ms" in data

    res_ww = client.get("/api/wakeword/status")
    assert res_ww.status_code == 200
    ww_data = res_ww.json()
    assert "enabled" in ww_data
    assert "threshold" in ww_data
    assert "persistence" in ww_data
    assert "stt_backend" in ww_data, "Missing stt_backend in /api/wakeword/status"
    assert "stt_model" in ww_data, "Missing stt_model in /api/wakeword/status"
    assert isinstance(ww_data["persistence"], int) and ww_data["persistence"] > 0
    assert isinstance(ww_data["threshold"], (int, float)) and 0.0 < ww_data["threshold"] <= 1.0

    res_telemetry = client.get("/api/telemetry")
    assert res_telemetry.status_code == 200

    # Verify server and agent logs endpoints respond
    res_logs_server = client.get("/api/logs?source=server")
    assert res_logs_server.status_code == 200
    assert "lines" in res_logs_server.json()

    res_logs_agent = client.get("/api/logs?source=agent")
    assert res_logs_agent.status_code == 200
    assert "lines" in res_logs_agent.json()

    res_ui = client.get("/api/config/ui")
    assert res_ui.status_code == 200
    assert "quick_actions" in res_ui.json()

    # Verify TTS endpoint returns 204 for empty input
    res_tts_empty = client.get("/api/tts?text=")
    assert res_tts_empty.status_code == 204, f"Expected 204 for empty TTS, got {res_tts_empty.status_code}"

    # Verify voice.generate_tts_file includes rate=EDGE_TTS_RATE parameter
    import inspect
    import voice
    tts_src = inspect.getsource(voice.generate_tts_file)
    assert "rate=EDGE_TTS_RATE" in tts_src, "generate_tts_file must pass rate=EDGE_TTS_RATE to Communicate"


def test_system_tray_urls():
    """Verify tray menu functions route to /hud and / respectively."""
    import inspect
    lines_hud = inspect.getsource(tray.on_open_hud)
    lines_landing = inspect.getsource(tray.on_open_landing)
    assert "/hud" in lines_hud, "on_open_hud must open /hud"
    assert "http://127.0.0.1:8000/" in lines_landing, "on_open_landing must open root landing page"


def test_tools_and_agent_integrity():
    """Verify tool counts, docstrings, and agent instantiation."""
    tool_funcs = [getattr(tools, a) for a in dir(tools) if callable(getattr(tools, a)) and not a.startswith("_")]
    assert len(tool_funcs) >= 50, f"Expected >= 50 tools, found {len(tool_funcs)}"

    for fn in tool_funcs:
        assert fn.__doc__, f"Tool {fn.__name__} is missing a docstring"

    assert len(available_tools) == len(tool_map), "Mismatch between available_tools and tool_map"

    agent = create_agent()
    assert agent is not None


def test_gpu_telemetry_resilience():
    """Verify GPU telemetry returns structured data and handles sleep/fallback states cleanly."""
    from api import _telemetry_payload, _get_gpu_telemetry, _last_gpu_telemetry
    import time

    payload = _telemetry_payload()
    assert "gpu_temp" in payload
    assert "gpu_mem" in payload
    assert "gpu_fan" in payload

    # If NVIDIA GPU is installed, verify parsed memory format
    if _last_gpu_telemetry.get("total_mb"):
        assert "/" in payload["gpu_mem"]
        assert _last_gpu_telemetry["total_mb"] > 0
        if payload["gpu_temp"] is not None:
            assert isinstance(payload["gpu_temp"], int)
            assert 0 <= payload["gpu_temp"] <= 120

    # Test cache fallback behavior during transient dGPU sleep
    now = time.time()
    _last_gpu_telemetry["temp"] = 52
    _last_gpu_telemetry["mem"] = "150 / 4096 MB"
    _last_gpu_telemetry["fan"] = "AUTO"
    _last_gpu_telemetry["last_seen"] = now - 5.0  # 5 seconds ago (< 30s TTL)

    temp, mem, fan = _get_gpu_telemetry()
    assert mem != "N/A"
    assert "MB" in mem


if __name__ == "__main__":
    print("Running system health tests...")
    test_last_screen_head_and_get()
    print("  [PASS] test_last_screen_head_and_get")
    test_routes_accessibility()
    print("  [PASS] test_routes_accessibility")
    test_core_health_endpoints()
    print("  [PASS] test_core_health_endpoints")
    test_system_tray_urls()
    print("  [PASS] test_system_tray_urls")
    test_tools_and_agent_integrity()
    print("  [PASS] test_tools_and_agent_integrity")
    test_gpu_telemetry_resilience()
    print("  [PASS] test_gpu_telemetry_resilience")
    print("\nALL SYSTEM HEALTH TESTS PASSED!")
