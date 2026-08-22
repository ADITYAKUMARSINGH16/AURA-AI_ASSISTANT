import os
import sys
import json
import urllib.request
import urllib.error
import platform

def run_aura_diagnostics() -> str:
    """Runs a comprehensive self-diagnostic test on AURA's core systems and returns a markdown report."""
    report = ["# AURA Self-Diagnostic Report\n"]
    
    def add_result(category: str, status: str, message: str, fix: str = ""):
        color_map = {"PASS": "🟢", "WARNING": "🟡", "FAIL": "🔴"}
        icon = color_map.get(status, "⚪")
        res = f"### {category}\n**Status:** {icon} {status}\n**Details:** {message}\n"
        if fix:
            res += f"**Recommended Fix:** {fix}\n"
        report.append(res)

    # 1. SYSTEM
    try:
        py_ver = sys.version.split()[0]
        os_info = platform.system() + " " + platform.release()
        add_result("SYSTEM", "PASS", f"Python {py_ver} on {os_info}.")
    except Exception as e:
        add_result("SYSTEM", "FAIL", f"System check failed: {e}", "Check environment permissions.")

    # 2. OLLAMA
    ollama_models = []
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags")
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode())
            ollama_models = [m.get("name") for m in data.get("models", [])]
            add_result("OLLAMA", "PASS", "Ollama daemon is reachable on port 11434.")
    except Exception as e:
        add_result("OLLAMA", "FAIL", f"Ollama daemon unreachable: {e}", "Ensure Ollama is installed and running in the background.")

    # 3. MODELS
    from config import OLLAMA_MODEL, OLLAMA_VISION_MODEL
    if not OLLAMA_MODEL:
        add_result("MODELS", "FAIL", "OLLAMA_MODEL is not defined in .env.", "Set OLLAMA_MODEL in .env.")
    elif ollama_models and OLLAMA_MODEL not in ollama_models:
        add_result("MODELS", "FAIL", f"Configured model '{OLLAMA_MODEL}' not found in Ollama.", f"Run `ollama pull {OLLAMA_MODEL}`.")
    elif ollama_models:
        add_result("MODELS", "PASS", f"Primary model '{OLLAMA_MODEL}' is downloaded and ready.")
    else:
        add_result("MODELS", "WARNING", "Could not verify model because Ollama is unreachable.", "Start Ollama.")

    # 4. VISION
    if not OLLAMA_VISION_MODEL:
        add_result("VISION", "FAIL", "OLLAMA_VISION_MODEL is not defined in .env.", "Set OLLAMA_VISION_MODEL in .env.")
    elif ollama_models and OLLAMA_VISION_MODEL not in ollama_models:
        add_result("VISION", "FAIL", f"Configured vision model '{OLLAMA_VISION_MODEL}' not found in Ollama.", f"Run `ollama pull {OLLAMA_VISION_MODEL}`.")
    elif ollama_models:
        add_result("VISION", "PASS", f"Vision model '{OLLAMA_VISION_MODEL}' is downloaded and ready.")
    else:
        add_result("VISION", "WARNING", "Could not verify vision model because Ollama is unreachable.", "Start Ollama.")

    # 5. GPU
    import subprocess
    try:
        gpu_result = subprocess.check_output(
            "nvidia-smi --query-gpu=memory.total,memory.used --format=csv,noheader,nounits",
            shell=True, text=True, stderr=subprocess.DEVNULL
        ).strip()
        if gpu_result:
            parts = gpu_result.split(',')
            add_result("GPU", "PASS", f"NVIDIA GPU detected. VRAM: {parts[1].strip()} MB / {parts[0].strip()} MB used.")
        else:
            add_result("GPU", "WARNING", "nvidia-smi returned empty. Running on CPU?", "Check NVIDIA drivers if you have a GPU.")
    except Exception:
        add_result("GPU", "WARNING", "NVIDIA GPU not detected. Inference will be slow (CPU mode).", "If you have an AMD/Mac GPU, ensure correct Ollama build. If CPU-only, expect high latency.")

    # 6. VOICE
    voice_msgs = []
    voice_status = "PASS"
    voice_fix = []
    
    try:
        import speech_recognition
    except ImportError:
        voice_status = "FAIL"
        voice_msgs.append("speech_recognition missing.")
        voice_fix.append("pip install SpeechRecognition")
        
    try:
        import edge_tts
    except ImportError:
        try:
            import pyttsx3
            voice_msgs.append("edge_tts missing, falling back to pyttsx3.")
            if voice_status == "PASS": voice_status = "WARNING"
            voice_fix.append("pip install edge-tts")
        except ImportError:
            voice_status = "FAIL"
            voice_msgs.append("No TTS engine installed (missing edge_tts and pyttsx3).")
            voice_fix.append("pip install edge-tts pyttsx3")

    if voice_status == "PASS":
        add_result("VOICE", "PASS", "Audio dependencies (STT/TTS) are installed.")
    else:
        add_result("VOICE", voice_status, " ".join(voice_msgs), " and ".join(voice_fix))

    # 7. TOOLS
    try:
        import agent
        tools_len = len(agent.available_tools)
        if tools_len > 0:
            add_result("TOOLS", "PASS", f"{tools_len} tools registered in tool_map.")
        else:
            add_result("TOOLS", "FAIL", "0 tools registered.", "Check tools import in agent.py.")
    except Exception as e:
        add_result("TOOLS", "FAIL", f"Failed to inspect agent tools: {e}", "Check agent.py syntax.")

    # 8. MEMORY
    ltm_path = "ltm_db.json"
    if os.path.exists(ltm_path):
        try:
            with open(ltm_path, 'r') as f:
                data = json.load(f)
                keys = list(data.keys())
                if "semantic" in keys and "episodic" in keys and "procedural" in keys:
                    add_result("MEMORY", "PASS", "ltm_db.json exists and contains 3-layer structure.")
                else:
                    add_result("MEMORY", "WARNING", "ltm_db.json exists but is missing expected layers.", "Verify memory migration.")
        except Exception as e:
            add_result("MEMORY", "FAIL", f"Cannot read ltm_db.json: {e}", "Check JSON formatting.")
    else:
        add_result("MEMORY", "WARNING", "ltm_db.json not found.", "It will be created on first memory save.")

    # 9. NETWORK
    try:
        urllib.request.urlopen("http://8.8.8.8", timeout=2)
        add_result("NETWORK", "PASS", "Internet uplink is active.")
    except Exception:
        add_result("NETWORK", "WARNING", "Could not reach 8.8.8.8. Internet might be down.", "Check network connection.")

    # 10. SECURITY
    if os.path.exists("permissions.py"):
        try:
            from permissions import TOOL_RISK_MAP
            if TOOL_RISK_MAP:
                add_result("SECURITY", "PASS", f"Permission registry loaded with {len(TOOL_RISK_MAP)} tool policies.")
            else:
                add_result("SECURITY", "FAIL", "TOOL_RISK_MAP is empty.", "Check permissions.py.")
        except Exception as e:
            add_result("SECURITY", "FAIL", f"Error loading permissions: {e}", "Check permissions.py syntax.")
    else:
        add_result("SECURITY", "FAIL", "permissions.py not found.", "System is vulnerable! Restore permissions.py.")

    return "\n".join(report)
