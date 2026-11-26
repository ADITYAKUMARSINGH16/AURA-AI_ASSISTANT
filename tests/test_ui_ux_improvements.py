"""
Comprehensive test suite for AURA Modern UI/UX Enhancements.
Verifies:
- Phase 1: Design tokens, glassmorphism, Amber theme palette
- Phase 2: Dual-pane workspace canvas, HITL permission cards, slash commands autocomplete
- Phase 3: Tactical HUD modular deck, optical reticle overlay, multi-mode visualizer (Reactor/Hologram/Spectrum)
- Phase 4: Ambient intelligence dock action pills, dynamic voice overlay states (listening, processing, speaking, interrupted)
- Phase 5: Complete frontend asset delivery via FastAPI
"""

import os
import sys

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from fastapi.testclient import TestClient
from api import app

client = TestClient(app, raise_server_exceptions=False)


def test_hud_html_components():
    """Verify static/hud.html contains modern UI/UX markup."""
    hud_path = os.path.join(_PROJECT_ROOT, "static", "hud.html")
    with open(hud_path, "r", encoding="utf-8") as f:
        html = f.read()

    # 1. Command Palette Spotlight Modal & Topbar SFX
    assert 'id="command-palette-overlay"' in html, "Missing #command-palette-overlay in hud.html"
    assert 'id="palette-input"' in html, "Missing #palette-input in hud.html"
    assert 'id="palette-results"' in html, "Missing #palette-results in hud.html"
    assert 'id="btn-spotlight"' in html, "Missing #btn-spotlight in hud.html"
    assert 'id="hud-latency"' in html, "Missing #hud-latency in hud.html"
    assert 'id="btn-audio-sfx"' in html, "Missing #btn-audio-sfx in hud.html"

    # 2. Phase 1 Theming: Amber theme dot
    assert "theme-dot-amber" in html, "Missing .theme-dot-amber in hud.html appearance settings"

    # 3. Phase 2: Dual-Pane Workspace Canvas & Slash Autocomplete
    assert 'id="btn-toggle-canvas"' in html, "Missing #btn-toggle-canvas in hud.html"
    assert "chat-viewport-split" in html, "Missing .chat-viewport-split in hud.html"
    assert 'id="workspace-canvas-pane"' in html, "Missing #workspace-canvas-pane in hud.html"
    assert 'id="canvas-body"' in html, "Missing #canvas-body in hud.html"
    assert 'id="canvas-copy-btn"' in html, "Missing #canvas-copy-btn in hud.html"
    assert 'id="canvas-close-btn"' in html, "Missing #canvas-close-btn in hud.html"
    assert 'id="slash-popup"' in html, "Missing #slash-popup in hud.html"
    assert "data-cmd=\"/search \"" in html, "Missing /search slash popup item"
    assert "data-cmd=\"/security\"" in html, "Missing /security slash popup item"

    # 4. Phase 3: Visualizer Modes & Optical Targeting HUD Overlay
    assert "reactor-mode-selector" in html, "Missing .reactor-mode-selector in hud.html"
    assert 'id="btn-vis-reactor"' in html, "Missing #btn-vis-reactor in hud.html"
    assert 'id="btn-vis-hologram"' in html, "Missing #btn-vis-hologram in hud.html"
    assert 'id="btn-vis-oscilloscope"' in html, "Missing #btn-vis-oscilloscope in hud.html"
    assert "webcam-hud-overlay" in html, "Missing .webcam-hud-overlay in hud.html"
    assert "hud-crosshair-center" in html, "Missing .hud-crosshair-center in hud.html"
    assert "hud-target-corner" in html, "Missing .hud-target-corner in hud.html"
    assert "hud-target-label" in html, "Missing .hud-target-label in hud.html"

    # 5. Phase 3: HUD Widgets Customization Card
    assert "hud-widgets-card" in html, "Missing .hud-widgets-card in hud.html settings"
    assert 'id="widget-toggle-media"' in html, "Missing #widget-toggle-media in hud.html"
    assert 'id="widget-toggle-plan"' in html, "Missing #widget-toggle-plan in hud.html"
    assert 'id="widget-toggle-schedule"' in html, "Missing #widget-toggle-schedule in hud.html"
    assert 'id="widget-toggle-ambient"' in html, "Missing #widget-toggle-ambient in hud.html"

    # 6. Phase 4: Dynamic Voice Wave Canvas in Jarvis Overlay & Ambient Dock
    assert 'id="voice-overlay-wave"' in html, "Missing #voice-overlay-wave in hud.html"
    assert 'id="ambient-bar"' in html, "Missing #ambient-bar in hud.html"
    assert 'id="ambient-suggestions"' in html, "Missing #ambient-suggestions in hud.html"


def test_design_tokens_and_style_css():
    """Verify static/tokens.css and static/style.css implement required design system rules."""
    tokens_path = os.path.join(_PROJECT_ROOT, "static", "tokens.css")
    with open(tokens_path, "r", encoding="utf-8") as f:
        tokens = f.read()

    assert "--glass-surface" in tokens, "Missing --glass-surface in tokens.css"
    assert "--glass-border" in tokens, "Missing --glass-border in tokens.css"
    assert "html.theme-amber" in tokens, "Missing html.theme-amber in tokens.css"

    css_path = os.path.join(_PROJECT_ROOT, "static", "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()

    # Theming & Command Palette
    assert ".theme-dot-amber" in css, "Missing .theme-dot-amber in style.css"
    assert ".palette-overlay" in css, "Missing .palette-overlay in style.css"
    assert ".palette-modal" in css, "Missing .palette-modal in style.css"

    # Reasoning, Tool Chips, Code blocks
    assert ".aura-thinking-block" in css, "Missing .aura-thinking-block in style.css"
    assert ".tool-chip" in css, "Missing .tool-chip in style.css"
    assert ".code-block-header" in css, "Missing .code-block-header in style.css"

    # Phase 2: Dual Pane Workspace & HITL & Slash Popup
    assert ".chat-viewport-split" in css, "Missing .chat-viewport-split in style.css"
    assert ".workspace-canvas-pane" in css, "Missing .workspace-canvas-pane in style.css"
    assert ".canvas-toggle-btn" in css, "Missing .canvas-toggle-btn in style.css"
    assert ".hitl-permission-card" in css, "Missing .hitl-permission-card in style.css"
    assert ".slash-popup" in css, "Missing .slash-popup in style.css"
    assert ".slash-item" in css, "Missing .slash-item in style.css"

    # Phase 3: Visualizer Mode Selector & Optical HUD Overlay & Widget Toggles
    assert ".reactor-mode-selector" in css, "Missing .reactor-mode-selector in style.css"
    assert ".webcam-hud-overlay" in css, "Missing .webcam-hud-overlay in style.css"
    assert ".hud-crosshair-center" in css, "Missing .hud-crosshair-center in style.css"
    assert ".hud-target-corner" in css, "Missing .hud-target-corner in style.css"
    assert ".hud-widgets-card" in css, "Missing .hud-widgets-card in style.css"
    assert ".hud-widget-hidden" in css, "Missing .hud-widget-hidden in style.css"

    # Phase 4: Ambient dock pills & Voice overlay dynamic theming
    assert ".ambient-pill" in css, "Missing .ambient-pill in style.css"
    assert ".voice-overlay.state-listening" in css, "Missing .voice-overlay.state-listening in style.css"
    assert ".voice-overlay.state-processing" in css, "Missing .voice-overlay.state-processing in style.css"
    assert ".voice-overlay.state-speaking" in css, "Missing .voice-overlay.state-speaking in style.css"
    assert ".voice-overlay.state-interrupted" in css, "Missing .voice-overlay.state-interrupted in style.css"


def test_script_js_logic():
    """Verify static/script.js implements command palette, canvas, slash commands, HITL, and widgets."""
    js_path = os.path.join(_PROJECT_ROOT, "static", "script.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()

    # 1. Palette & Theming
    assert "PALETTE_COMMANDS" in js, "Missing PALETTE_COMMANDS in script.js"
    assert "theme-amber" in js, "Missing theme-amber command in PALETTE_COMMANDS"

    # 2. Phase 2: Dual-Pane Workspace Canvas & HITL & Slash
    assert "window.AuraWorkspace" in js, "Missing AuraWorkspace in script.js"
    assert "initWorkspaceCanvas" in js, "Missing initWorkspaceCanvas in script.js"
    assert "renderHitlPermissionCard" in js, "Missing renderHitlPermissionCard in script.js"
    assert "initSlashCommands" in js, "Missing initSlashCommands in script.js"

    # 3. Phase 3 & 4: HUD Customization & Ambient Dock Pills & Voice Overlay States
    assert "initHudCustomization" in js, "Missing initHudCustomization in script.js"
    assert "aura_widget_visibility" in js, "Missing aura_widget_visibility in script.js"
    assert "applyAmbient" in js, "Missing applyAmbient in script.js"
    assert "ambient-pill" in js, "Missing ambient-pill creation in script.js"
    assert "setVoiceOverlayStatus" in js, "Missing setVoiceOverlayStatus in script.js"
    assert "state-interrupted" in js, "Missing state-interrupted in script.js"


def test_reactor_js_multi_modes():
    """Verify static/reactor.js implements Reactor, 3D Hologram, and Oscilloscope modes."""
    reactor_path = os.path.join(_PROJECT_ROOT, "static", "reactor.js")
    with open(reactor_path, "r", encoding="utf-8") as f:
        reactor_js = f.read()

    assert "aura_visualizer_mode" in reactor_js, "Missing aura_visualizer_mode storage key in reactor.js"
    assert "setMode" in reactor_js, "Missing setMode function in reactor.js"
    assert "getMode" in reactor_js, "Missing getMode function in reactor.js"
    assert "drawHologramMode" in reactor_js, "Missing drawHologramMode in reactor.js"
    assert "drawOscilloscopeMode" in reactor_js, "Missing drawOscilloscopeMode in reactor.js"
    assert "initModeButtons" in reactor_js, "Missing initModeButtons in reactor.js"


def test_frontend_routes_serve_updated_assets():
    """Verify FastAPI serves the updated frontend files with 200 OK."""
    res_hud = client.get("/hud.html")
    assert res_hud.status_code == 200
    assert 'id="command-palette-overlay"' in res_hud.text
    assert 'id="workspace-canvas-pane"' in res_hud.text
    assert 'id="btn-vis-reactor"' in res_hud.text
    assert 'id="widget-toggle-media"' in res_hud.text

    res_tokens = client.get("/tokens.css")
    assert res_tokens.status_code == 200
    assert "--glass-surface" in res_tokens.text
    assert "html.theme-amber" in res_tokens.text

    res_css = client.get("/style.css")
    assert res_css.status_code == 200
    assert ".chat-viewport-split" in res_css.text
    assert ".reactor-mode-selector" in res_css.text
    assert ".webcam-hud-overlay" in res_css.text

    res_js = client.get("/script.js")
    assert res_js.status_code == 200
    assert "AuraWorkspace" in res_js.text
    assert "initHudCustomization" in res_js.text

    res_reactor = client.get("/reactor.js")
    assert res_reactor.status_code == 200
    assert "drawHologramMode" in res_reactor.text


if __name__ == "__main__":
    print("Running Modern UI/UX Improvements test suite...")
    test_hud_html_components()
    print("  [PASS] test_hud_html_components")
    test_design_tokens_and_style_css()
    print("  [PASS] test_design_tokens_and_style_css")
    test_script_js_logic()
    print("  [PASS] test_script_js_logic")
    test_reactor_js_multi_modes()
    print("  [PASS] test_reactor_js_multi_modes")
    test_frontend_routes_serve_updated_assets()
    print("  [PASS] test_frontend_routes_serve_updated_assets")
    print("\nALL MODERN UI/UX IMPROVEMENT TESTS PASSED SUCCESSFULLY!")
