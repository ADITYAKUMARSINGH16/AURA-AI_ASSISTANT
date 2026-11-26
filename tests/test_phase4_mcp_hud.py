"""
Comprehensive test suite for Phase 4: Open Ecosystem & HUD Polish.
Tests native Model Context Protocol (MCP) JSON-RPC client, tool discovery,
tool execution, API endpoints, 3D holographic reactor canvas, and voice overlay.
"""

import os
import sys
import json

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from fastapi.testclient import TestClient
from api import app
from agent import tool_map, available_tools, TOOL_CATEGORIES
from mcp.client import get_mcp_manager, MCPServerConnection
from tools.mcp_tools import list_mcp_servers, reload_mcp_servers, call_mcp_tool

client = TestClient(app, raise_server_exceptions=False)


def test_mcp_tool_registration():
    """Verify MCP management tools are registered and documented."""
    mcp_tools = ["list_mcp_servers", "reload_mcp_servers", "call_mcp_tool"]
    for name in mcp_tools:
        assert name in tool_map, f"Tool {name} missing from agent.tool_map"
        fn = tool_map[name]
        assert callable(fn), f"Tool {name} is not callable"
        assert fn.__doc__, f"Tool {name} missing docstring"

    assert len(available_tools) == len(tool_map), "Mismatch between available_tools and tool_map"
    assert "list_mcp_servers" in [t.__name__ for t in TOOL_CATEGORIES["SYSTEM"]]
    assert "call_mcp_tool" in [t.__name__ for t in TOOL_CATEGORIES["COMPUTER_CONTROL"]]


def test_mcp_direct_json_rpc_handshake():
    """Verify stdio JSON-RPC handshake, tool discovery, and execution with echo server."""
    conn = MCPServerConnection("test_helper", {
        "command": sys.executable,
        "args": [os.path.join(_PROJECT_ROOT, "mcp", "servers", "echo_server.py")]
    })
    try:
        ok = conn.connect()
        assert ok is True, "Failed to connect to reference echo MCP server"
        assert conn.is_connected is True
        assert conn.server_info.get("name") == "aura-echo-mcp"
        assert len(conn.tools) >= 2, f"Expected at least 2 tools, got {len(conn.tools)}"

        tool_names = [t["name"] for t in conn.tools]
        assert "mcp_ping" in tool_names
        assert "mcp_system_eval" in tool_names

        # Call mcp_ping
        res_ping = conn.call_tool("mcp_ping", {"message": "Hello AURA"})
        assert "content" in res_ping, f"Expected content in res: {res_ping}"
        assert "[MCP PONG] Hello AURA" in res_ping["content"][0]["text"]

        # Call mcp_system_eval
        res_eval = conn.call_tool("mcp_system_eval", {"expression": "25 * 4"})
        assert "[MCP EVAL RESULT] 100" in res_eval["content"][0]["text"]

    finally:
        conn.disconnect()


def test_mcp_manager_and_agent_tools():
    """Verify MCPManager loads config/mcp_servers.json and agent tools invoke properly."""
    mgr = get_mcp_manager()
    servers = mgr.list_servers_info()
    assert len(servers) > 0, "No MCP servers configured or active in MCPManager"

    # Test list_mcp_servers tool
    list_res = list_mcp_servers()
    assert list_res.get("status") == "success"
    assert list_res.get("active_servers_count") >= 1

    # Test call_mcp_tool
    out = call_mcp_tool("local_helper", "mcp_ping", {"message": "Gravitas Verification"})
    assert "[MCP PONG] Gravitas Verification" in out

    # Test reload_mcp_servers
    reload_res = reload_mcp_servers()
    assert reload_res.get("status") == "success"


def test_mcp_api_endpoints():
    """Verify REST API endpoints for MCP servers and reload."""
    res_servers = client.get("/api/mcp/servers")
    assert res_servers.status_code == 200
    s_data = res_servers.json()
    assert "servers" in s_data
    assert s_data.get("active_servers_count") >= 1

    res_reload = client.post("/api/mcp/reload")
    assert res_reload.status_code == 200
    assert res_reload.json().get("status") == "success"


def test_3d_hologram_reactor_upgrade():
    """Verify static/reactor.js contains audio-reactive 3D holographic particle mesh engine."""
    reactor_js_path = os.path.join(_PROJECT_ROOT, "static", "reactor.js")
    with open(reactor_js_path, "r", encoding="utf-8") as f:
        src = f.read()

    assert "drawHoloMesh" in src, "drawHoloMesh function missing from reactor.js"
    assert "HOLO_POINTS" in src, "HOLO_POINTS missing from reactor.js"
    assert "ICOS" in src, "Icosahedral geometric coordinates missing from reactor.js"
    assert "drawHoloMesh(cx, cy, R, t)" in src, "drawHoloMesh not invoked in render loop"


def test_jarvis_voice_overlay_components():
    """Verify static/hud.html and static/style.css include JARVIS fullscreen voice overlay."""
    hud_html_path = os.path.join(_PROJECT_ROOT, "static", "hud.html")
    with open(hud_html_path, "r", encoding="utf-8") as f:
        hud_src = f.read()

    assert 'id="voice-overlay"' in hud_src, "voice-overlay element missing from hud.html"
    assert 'id="voice-overlay-status"' in hud_src, "voice-overlay-status missing from hud.html"
    assert 'id="voice-overlay-transcript"' in hud_src, "voice-overlay-transcript missing from hud.html"

    style_css_path = os.path.join(_PROJECT_ROOT, "static", "style.css")
    with open(style_css_path, "r", encoding="utf-8") as f:
        style_src = f.read()

    assert ".voice-overlay" in style_src, ".voice-overlay CSS missing from style.css"
    assert "backdrop-filter: blur(20px)" in style_src, "Backdrop blur missing from voice-overlay CSS"
    assert "overlayRingPulse" in style_src, "Holographic ring pulse animation missing from style.css"

    script_js_path = os.path.join(_PROJECT_ROOT, "static", "script.js")
    with open(script_js_path, "r", encoding="utf-8") as f:
        script_src = f.read()

    assert "openVoiceOverlay" in script_src, "openVoiceOverlay missing from script.js"
    assert "closeVoiceOverlay" in script_src, "closeVoiceOverlay missing from script.js"
    assert "initVoiceOverlay" in script_src, "initVoiceOverlay missing from script.js"


if __name__ == "__main__":
    print("Running Phase 4 Open Ecosystem & HUD Polish tests...")
    test_mcp_tool_registration()
    print("  [PASS] test_mcp_tool_registration")
    test_mcp_direct_json_rpc_handshake()
    print("  [PASS] test_mcp_direct_json_rpc_handshake")
    test_mcp_manager_and_agent_tools()
    print("  [PASS] test_mcp_manager_and_agent_tools")
    test_mcp_api_endpoints()
    print("  [PASS] test_mcp_api_endpoints")
    test_3d_hologram_reactor_upgrade()
    print("  [PASS] test_3d_hologram_reactor_upgrade")
    test_jarvis_voice_overlay_components()
    print("  [PASS] test_jarvis_voice_overlay_components")
    print("\nALL PHASE 4 TESTS PASSED!")
