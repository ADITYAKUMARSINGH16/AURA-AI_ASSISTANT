"""
Test suite verifying that all configuration settings can be managed,
retrieved, and updated directly in/from the .env file.
"""

import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from fastapi.testclient import TestClient
from api import app
import dotenv

client = TestClient(app, raise_server_exceptions=False)


def test_get_env_settings():
    """Verify GET /api/settings/env returns .env key-value pairs, discovered options, and exact schema."""
    res = client.get("/api/settings/env")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    data = res.json()
    assert data.get("status") == "success"
    env = data.get("env", {})
    assert "OLLAMA_MODEL" in env, "OLLAMA_MODEL must be in .env"
    assert "AURA_TTS_BACKEND" in env, "AURA_TTS_BACKEND must be in .env"
    assert "AURA_TTS_VOICE" in env, "AURA_TTS_VOICE must be in .env"
    assert "AURA_STT_BACKEND" in env, "AURA_STT_BACKEND must be in .env"
    assert "available_models" in data, "available_models list should be present in response"
    assert "options" in data and "schema" in data, "options and schema should be returned"

    schema = data["schema"]
    for k in env.keys():
        assert k in schema, f"{k} should have exact option metadata in schema"
        if schema[k].get("type") != "password":
            assert schema[k].get("options"), f"{k} schema must define exact options"

    opts = data["options"]
    assert "audio_input_devices" in opts
    assert "wakeword_models" in opts
    assert "tts_voices" in opts and "edge" in opts["tts_voices"] and "kokoro" in opts["tts_voices"]
    assert "wiz_broadcasts" in opts


def test_extract_ollama_model_names():
    """Verify _extract_ollama_model_names handles both modern ListResponse objects and legacy dicts."""
    from types import SimpleNamespace
    from api import _extract_ollama_model_names

    # Modern ollama>=0.4 ListResponse shape
    modern = SimpleNamespace(models=[SimpleNamespace(model="gemma4:e2b"), SimpleNamespace(model="qwen3-vl:4b")])
    assert _extract_ollama_model_names(modern) == ["gemma4:e2b", "qwen3-vl:4b"]

    # Legacy dict shape
    legacy = {"models": [{"name": "llama3:8b"}, {"model": "phi3:mini"}]}
    assert _extract_ollama_model_names(legacy) == ["llama3:8b", "phi3:mini"]

    assert _extract_ollama_model_names(None) == []


def test_update_env_settings_persistence():
    """Verify POST /api/settings/env writes changes directly to .env file and updates runtime."""
    dotenv_path = str(_PROJECT_ROOT / ".env")
    original_rate = dotenv.get_key(dotenv_path, "AURA_TTS_RATE") or "+0%"
    original_ka = dotenv.get_key(dotenv_path, "OLLAMA_KEEP_ALIVE") or "5m"

    try:
        test_rate = "+15%"
        test_ka = "10m"
        res = client.post("/api/settings/env", json={"settings": {"AURA_TTS_RATE": test_rate, "OLLAMA_KEEP_ALIVE": test_ka}})
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        data = res.json()
        assert data.get("status") == "success"
        assert data.get("updated", {}).get("AURA_TTS_RATE") == test_rate
        assert data.get("updated", {}).get("OLLAMA_KEEP_ALIVE") == test_ka

        # Verify directly from .env file on disk
        assert dotenv.get_key(dotenv_path, "AURA_TTS_RATE") == test_rate
        assert dotenv.get_key(dotenv_path, "OLLAMA_KEEP_ALIVE") == test_ka

        # Verify os.environ & live modules updated
        assert os.environ.get("AURA_TTS_RATE") == test_rate
        assert os.environ.get("OLLAMA_KEEP_ALIVE") == test_ka
        import config, agent
        assert config.OLLAMA_KEEP_ALIVE == test_ka
        assert agent.OLLAMA_KEEP_ALIVE == test_ka
    finally:
        client.post("/api/settings/env", json={"settings": {"AURA_TTS_RATE": original_rate, "OLLAMA_KEEP_ALIVE": original_ka}})


def test_hud_html_env_components():
    """Verify static/hud.html contains all .env configuration UI components with exact options."""
    hud_path = _PROJECT_ROOT / "static" / "hud.html"
    html = hud_path.read_text(encoding="utf-8")

    assert "llm-settings-card" in html, "Missing .llm-settings-card in hud.html"
    assert 'id="env-ollama-model"' in html, "Missing #env-ollama-model in hud.html"
    assert 'id="env-vision-model"' in html, "Missing #env-vision-model in hud.html"
    assert 'id="env-num-ctx"' in html, "Missing #env-num-ctx in hud.html"
    assert 'id="env-keep-alive"' in html, "Missing #env-keep-alive in hud.html"
    assert 'id="btn-save-llm-env"' in html, "Missing #btn-save-llm-env in hud.html"

    assert "stt-settings-card" in html, "Missing .stt-settings-card in hud.html"
    assert 'id="env-stt-backend"' in html, "Missing #env-stt-backend in hud.html"
    assert 'id="env-stt-compute-type"' in html, "Missing #env-stt-compute-type in hud.html"
    assert 'id="env-wakeword-model"' in html, "Missing #env-wakeword-model in hud.html"
    assert 'id="env-wakeword-device"' in html, "Missing #env-wakeword-device in hud.html"
    assert 'id="env-wakeword-thresh-slider"' in html, "Missing #env-wakeword-thresh-slider in hud.html"
    assert 'id="env-wakeword-cooldown"' in html, "Missing #env-wakeword-cooldown in hud.html"
    assert 'id="env-wakeword-persistence"' in html, "Missing #env-wakeword-persistence in hud.html"
    assert 'id="env-wakeword-vad"' in html, "Missing #env-wakeword-vad in hud.html"
    assert 'id="env-speaker-verification"' in html, "Missing #env-speaker-verification in hud.html"
    assert 'id="btn-save-stt-env"' in html, "Missing #btn-save-stt-env in hud.html"

    assert "system-env-card" in html, "Missing .system-env-card in hud.html"
    assert 'id="env-visual-timeout"' in html, "Missing #env-visual-timeout in hud.html"
    assert 'id="env-wiz-broadcast"' in html, "Missing #env-wiz-broadcast in hud.html"
    assert 'id="env-sse-heartbeat"' in html, "Missing #env-sse-heartbeat in hud.html"
    assert 'id="btn-save-system-env"' in html, "Missing #btn-save-system-env in hud.html"

    assert "env-editor-card" in html, "Missing .env-editor-card in hud.html"
    assert 'id="env-table-body"' in html, "Missing #env-table-body in hud.html"
    assert 'id="env-filter-input"' in html, "Missing #env-filter-input in hud.html"
    assert 'id="btn-save-all-env"' in html, "Missing #btn-save-all-env in hud.html"

    assert 'id="env-llm-provider"' in html, "Missing #env-llm-provider in hud.html"
    assert "cloud-keys-card" in html, "Missing .cloud-keys-card in hud.html"
    for prov in ("groq", "nvidia", "gemini", "openai", "openrouter"):
        assert f'id="env-{prov}-api-key"' in html, f"Missing #env-{prov}-api-key in hud.html"
        assert f'id="env-{prov}-model"' in html, f"Missing #env-{prov}-model in hud.html"
    assert 'id="btn-save-cloud-env"' in html, "Missing #btn-save-cloud-env in hud.html"


def test_hud_js_and_css_env_rules():
    """Verify static/script.js and static/style.css implement .env management and settings fixes."""
    js_path = _PROJECT_ROOT / "static" / "script.js"
    js = js_path.read_text(encoding="utf-8")
    assert "initEnvSettings" in js, "Missing initEnvSettings in script.js"
    assert "loadEnvSettings" in js, "Missing loadEnvSettings in script.js"
    assert "/api/settings/env" in js, "Missing /api/settings/env in script.js"
    assert "/api/settings/provider/test" in js, "Missing /api/settings/provider/test in script.js"
    assert "CLOUD_PROVIDER_DEFAULTS" in js, "Missing CLOUD_PROVIDER_DEFAULTS in script.js"
    assert "env-inline-select" in js, "Missing exact-options select rendering in script.js"
    assert "updateVoiceSelectForBackend" in js, "Missing backend-aware TTS voice switcher in script.js"
    assert "DEFAULT_EDGE_VOICES" in js and "DEFAULT_KOKORO_VOICES" in js, "Missing static voice fallbacks in script.js"
    assert "_pendingVoiceByBackend" in js, "Missing per-backend voice memory in script.js"
    assert "FALLBACK_ENV_SCHEMA" in js, "Missing fallback .env option schema in script.js"
    assert "'theme-amber'" in js and "applyPreset" in js, "Missing theme-amber in applyPreset"
    assert "_quickActionButtonsBound" in js, "Missing duplicate-listener guard for quick actions"

    css_path = _PROJECT_ROOT / "static" / "style.css"
    css = css_path.read_text(encoding="utf-8")
    assert ".env-table-wrap" in css, "Missing .env-table-wrap in style.css"
    assert ".env-table-row" in css, "Missing .env-table-row in style.css"
    assert ".setting-text-input" in css, "Missing .setting-text-input in style.css"
    assert ".env-inline-select" in css, "Missing .env-inline-select in style.css"
    assert ".cloud-provider-grid" in css, "Missing .cloud-provider-grid in style.css"


def test_cloud_providers_and_api_keys():
    """Verify Groq, NVIDIA NIM, Gemini, and OpenAI provider config, schema, and OpenAI tool translation."""
    import llm_provider

    for prov in ("ollama", "groq", "nvidia", "gemini", "openai", "openrouter"):
        assert prov in llm_provider.PROVIDERS

    def sample_tool(city: str, units: str = "celsius") -> str:
        """Look up weather."""
        return city

    oai_tools = llm_provider.functions_to_openai_tools([sample_tool])
    assert oai_tools and oai_tools[0]["function"]["name"] == "sample_tool"
    assert oai_tools[0]["function"]["parameters"]["required"] == ["city"]

    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "sample_tool", "arguments": {"city": "NYC"}}}]},
        {"role": "tool", "name": "sample_tool", "content": "72F"},
    ]
    norm = llm_provider.normalize_messages_for_openai(msgs)
    assert norm[1]["tool_calls"][0]["id"] == norm[2]["tool_call_id"]

    # Missing API key should fail fast cleanly both in llm_provider and /api/settings/provider/test
    res = client.post("/api/settings/provider/test", json={"provider": "groq", "api_key": ""})
    assert res.status_code == 200
    assert res.json().get("ok") is False

    env_res = client.get("/api/settings/env").json()
    for key in ("AURA_LLM_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "NVIDIA_API_KEY", "NVIDIA_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"):
        assert key in env_res["env"], f"Missing {key} in GET /api/settings/env"
        assert key in env_res["schema"], f"Missing {key} in schema"


def test_fetch_provider_models_live_and_search():
    """Verify live model fetching, filtering, Gemini prefix stripping, OpenRouter /key check, and search UI."""
    from unittest.mock import patch
    import llm_provider

    class _FakeResp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload
            self.text = str(payload)

        def json(self):
            return self._payload

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None):
            if "groq.com" in url:
                return _FakeResp(200, {"data": [{"id": "llama-3.3-70b-versatile"}, {"id": "whisper-large-v3"}, {"id": "qwen/qwen3-32b"}]})
            if "nvidia.com" in url:
                return _FakeResp(200, {"data": [{"id": "meta/llama-3.3-70b-instruct"}, {"id": "deepseek-ai/deepseek-r1"}]})
            if "generativelanguage.googleapis.com" in url:
                return _FakeResp(200, {"data": [{"id": "models/gemini-2.5-flash"}, {"id": "models/embedding-001"}]})
            if "api.openai.com" in url:
                return _FakeResp(200, {"data": [{"id": "gpt-4o"}, {"id": "whisper-1"}, {"id": "text-embedding-3-small"}, {"id": "o4-mini"}]})
            if "openrouter.ai" in url and url.endswith("/key"):
                if (headers or {}).get("Authorization") == "Bearer bad-key":
                    return _FakeResp(401, {"error": "Invalid key"})
                return _FakeResp(200, {"data": {"label": "ok"}})
            if "openrouter.ai" in url and url.endswith("/models"):
                return _FakeResp(200, {"data": [{"id": "anthropic/claude-sonnet-4"}, {"id": "openai/gpt-4o-mini"}]})
            return _FakeResp(404, {})

    with patch("llm_provider.httpx.Client", _FakeClient):
        g = llm_provider.fetch_provider_models("groq", "gsk_test_123456")
        assert g["ok"] is True and g["models"] == ["llama-3.3-70b-versatile", "qwen/qwen3-32b"]

        nv = llm_provider.fetch_provider_models("nvidia", "nvapi_test_123456")
        assert nv["ok"] is True and "meta/llama-3.3-70b-instruct" in nv["models"]

        gem = llm_provider.fetch_provider_models("gemini", "AIza_test_123456")
        assert gem["ok"] is True and gem["models"] == ["gemini-2.5-flash"]

        oai = llm_provider.fetch_provider_models("openai", "sk-test-123456")
        assert oai["ok"] is True and oai["models"] == ["gpt-4o", "o4-mini"]

        or_bad = llm_provider.fetch_provider_models("openrouter", "bad-key")
        assert or_bad["ok"] is False

        or_ok = llm_provider.fetch_provider_models("openrouter", "sk-or-v1-good")
        assert or_ok["ok"] is True and "anthropic/claude-sonnet-4" in or_ok["models"]

    hud_html = (_PROJECT_ROOT / "static" / "hud.html").read_text(encoding="utf-8")
    for prov in ("groq", "nvidia", "gemini", "openai", "openrouter"):
        assert f'id="env-{prov}-model-search"' in hud_html, f"Missing model search input for {prov}"

    js = (_PROJECT_ROOT / "static" / "script.js").read_text(encoding="utf-8")
    assert "fetchLiveModelsForProvider" in js
    assert "refreshCloudModelSelect" in js
    assert "aura_live_models_cache" in js


def test_voice_kokoro_and_edge_safety_helpers():
    """Verify Kokoro rate-to-speed conversion and Edge voice sanitization."""
    import voice
    assert voice._tts_rate_to_speed("+0%") == 1.0
    assert voice._tts_rate_to_speed("+20%") == 1.2
    assert voice._tts_rate_to_speed("-20%") == 0.8
    # Kokoro voice IDs must never be forwarded to Edge-TTS
    resolved = voice._resolve_edge_voice("af_bella")
    assert "-" in resolved and resolved != "af_bella"
    assert voice._resolve_edge_voice("en-GB-SoniaNeural") == "en-GB-SoniaNeural"


def test_frontend_no_cache_headers():
    """Verify HTML and JS responses include Cache-Control: no-cache headers."""
    res_hud = client.get("/hud")
    assert res_hud.status_code == 200
    assert "no-cache" in res_hud.headers.get("cache-control", "").lower()

    res_js = client.get("/script.js")
    assert res_js.status_code == 200
    assert "no-cache" in res_js.headers.get("cache-control", "").lower()


def test_reset_env_endpoint():
    """Verify POST /api/settings/env/reset restores defaults and creates .env.bak."""
    dotenv_path = _PROJECT_ROOT / ".env"
    original_content = dotenv_path.read_text(encoding="utf-8") if dotenv_path.exists() else None
    try:
        res = client.post("/api/settings/env/reset")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        data = res.json()
        assert data.get("status") == "success"
        assert "env" in data
        assert (_PROJECT_ROOT / ".env.bak").exists(), ".env.bak backup must exist"
    finally:
        if original_content is not None:
            dotenv_path.write_text(original_content, encoding="utf-8")
            client.post("/api/settings/env", json={"settings": dict(dotenv.dotenv_values(str(dotenv_path)))})


def test_settings_nav_tabs_and_data_cat():
    """Verify static/hud.html has category tabs and data-cat attributes on settings cards."""
    hud_path = _PROJECT_ROOT / "static" / "hud.html"
    html = hud_path.read_text(encoding="utf-8")

    assert "settings-nav-bar" in html, "Missing .settings-nav-bar in hud.html"
    assert 'data-cat="all"' in html, "Missing 'all' category tab"
    assert 'data-cat="ai"' in html, "Missing 'ai' category tab"
    assert 'data-cat="audio"' in html, "Missing 'audio' category tab"
    assert 'data-cat="ui"' in html, "Missing 'ui' category tab"
    assert 'data-cat="env"' in html, "Missing 'env' category tab"
    assert 'id="btn-reset-env"' in html, "Missing #btn-reset-env button in hud.html"

    # Verify cards have data-cat
    assert 'llm-settings-card" data-cat="ai"' in html
    assert 'voice-settings-card" data-cat="audio"' in html
    assert 'stt-settings-card" data-cat="audio"' in html
    assert 'env-editor-card span-2" data-cat="env"' in html


def test_dirty_and_tab_css_rules():
    """Verify static/style.css defines category navigation and dirty highlight rules."""
    css_path = _PROJECT_ROOT / "static" / "style.css"
    css = css_path.read_text(encoding="utf-8")
    assert ".settings-nav-bar" in css, "Missing .settings-nav-bar in style.css"
    assert ".settings-tab" in css, "Missing .settings-tab in style.css"
    assert ".card.card-cat-hidden" in css, "Missing .card.card-cat-hidden in style.css"
    assert ".env-table-row.dirty" in css, "Missing .env-table-row.dirty in style.css"


if __name__ == "__main__":
    test_get_env_settings()
    print("  [PASS] test_get_env_settings")
    test_extract_ollama_model_names()
    print("  [PASS] test_extract_ollama_model_names")
    test_update_env_settings_persistence()
    print("  [PASS] test_update_env_settings_persistence")
    test_hud_html_env_components()
    print("  [PASS] test_hud_html_env_components")
    test_hud_js_and_css_env_rules()
    print("  [PASS] test_hud_js_and_css_env_rules")
    test_reset_env_endpoint()
    print("  [PASS] test_reset_env_endpoint")
    test_settings_nav_tabs_and_data_cat()
    print("  [PASS] test_settings_nav_tabs_and_data_cat")
    test_dirty_and_tab_css_rules()
    print("  [PASS] test_dirty_and_tab_css_rules")
    test_voice_kokoro_and_edge_safety_helpers()
    print("  [PASS] test_voice_kokoro_and_edge_safety_helpers")
    test_frontend_no_cache_headers()
    print("  [PASS] test_frontend_no_cache_headers")
    test_cloud_providers_and_api_keys()
    print("  [PASS] test_cloud_providers_and_api_keys")
    test_fetch_provider_models_live_and_search()
    print("  [PASS] test_fetch_provider_models_live_and_search")
    print("\nALL .ENV SETTINGS TESTS PASSED SUCCESSFULLY!")
