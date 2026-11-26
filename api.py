from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, Response
from pydantic import BaseModel
import warnings

# Suppress standard warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

# ─── CRITICAL: Import onnxruntime/openwakeword BEFORE any WinRT/COM modules ───
# WinRT (winsdk/winrt) initializes COM which breaks onnxruntime's DLL loading on Windows.
# Importing onnxruntime first ensures its native libraries load correctly.
import onnxruntime  # noqa: F401
try:
    import openwakeword  # noqa: F401
except Exception as _oww_err:
    import logging as _logging
    _logging.warning(f"Optional openwakeword top-level import skipped: {_oww_err}")

import psutil
import logging
import os

# Ensure server-side logs are persistently captured to aura_backend_console.log
_console_log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aura_backend_console.log")
try:
    _server_file_handler = logging.FileHandler(_console_log_path, encoding="utf-8")
    _server_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logging.getLogger().addHandler(_server_file_handler)
    logging.getLogger().setLevel(logging.INFO)
except Exception as _log_setup_err:
    pass

from agent import create_agent
from voice import speak, listen, generate_tts_file, start_wakeword_listener

import asyncio
import hashlib
import json as _json
from contextlib import asynccontextmanager
from pathlib import Path

from media_info import get_now_playing

from backend.event_bus import bus, format_sse, publish_now
import backend.event_bus as event_bus


async def lifespan(app):
    """Start/stop the SSE change-detectors with the server lifecycle."""
    event_bus.bind_loop(asyncio.get_running_loop())
    detectors = [
        # refresh_after ≈ 3x cadence: lets clients treat silence as staleness.
        # Heavy OS/PowerShell sweeps are staggered so startup & /hud load stay fast.
        asyncio.create_task(_detect_loop("telemetry", 3, collect_telemetry_data, refresh_after=10)),
        asyncio.create_task(_detect_loop("threats_update", 10, collect_threats_data, refresh_after=30, initial_delay=3.5)),
        asyncio.create_task(_detect_loop("permissions_update", 3, collect_permissions_data, refresh_after=10)),
        asyncio.create_task(_notifications_detector()),
        asyncio.create_task(_detect_loop("logs_append", 10, collect_logs_data, refresh_after=30, initial_delay=1.5)),
        asyncio.create_task(_detect_loop("schedule_update", 30, collect_schedule_data, refresh_after=90, initial_delay=4.0)),
        asyncio.create_task(_detect_loop("processes_update", 5, collect_processes_data, refresh_after=15, initial_delay=2.5)),
        asyncio.create_task(_detect_loop("security_update", 30, collect_security_data, refresh_after=90, initial_delay=5.0)),
        asyncio.create_task(_detect_loop("ambient_update", 3, collect_ambient_data, refresh_after=10)),
        asyncio.create_task(_media_detector()),
    ]
    yield
    for task in detectors:
        task.cancel()


app = FastAPI(title="AURA API", lifespan=lifespan)

@app.middleware("http")
async def _no_cache_frontend_assets(request: Request, call_next):
    """Ensure HTML/JS/CSS updates are immediately revalidated by the browser."""
    response = await call_next(request)
    path = request.url.path.lower()
    if path in ("/", "/welcome", "/hud") or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

import threading
import time

# Initialize global agent
agent = create_agent()
agent_lock = threading.Lock()

from notifications import push_notification
import queue as _queue

# Data files live in the project root. Every path is normalized and verified
# to stay inside that directory, so a crafted name can never escape it.
_PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))

def _safe_data_path(name: str) -> str:
    path = os.path.normpath(os.path.join(_PROJECT_ROOT, name))
    if not path.startswith(_PROJECT_ROOT + os.sep):
        raise ValueError(f"path escapes project root: {name!r}")
    return path

PROACTIVE_CONFIG_FILE = _safe_data_path("proactive_config.json")
QUICK_ACTIONS_CONFIG_FILE = _safe_data_path("config/quick_actions.json")

# Timestamps paired 1:1 with queued wake-word signals (FIFO, same order).
_wake_signal_times = _queue.Queue()

WAKE_SIGNAL_MAX_AGE = 10  # seconds

def wake_word_callback():
    # If no HUD is open when "Hey Aura" is heard, the signal would otherwise
    # sit in the queue and replay much later - making AURA start listening
    # out of nowhere the next time a HUD tab loads.
    _wake_signal_times.put(time.time())
    push_notification("__WAKE_WORD__")
    try:
        from backend.event_bus import publish_now
        publish_now("notifications_update", {"available": True})
    except Exception:
        pass

# Start background wake word listener
start_wakeword_listener(wake_word_callback)

from typing import List, Optional, Dict

class ChatRequest(BaseModel):
    message: str
    use_voice_output: bool = True
    images: Optional[List[str]] = None
    file_texts: Optional[List[Dict[str, str]]] = None

@app.get("/api/history")
async def get_history():
    # Filter out system and tool messages for the frontend
    history = [msg for msg in agent.messages if msg.get("role") in ("user", "assistant")]
    return history  # Return as a plain JSON array

def _logs_payload(source: str = "server"):
    import os
    if source.lower() == "agent":
        log_file = "aura_agent.log"
    else:
        # Default to server console log, with fallbacks
        candidates = ["aura_backend_console.log", "uvicorn_run.log", "aura_agent.log"]
        log_file = next((f for f in candidates if os.path.exists(f) and os.path.getsize(f) > 0), "aura_backend_console.log")

    if not os.path.exists(log_file):
        return {"status": "error", "source": source, "message": f"Log file '{log_file}' not found.", "lines": []}
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        # Return last 100 lines stripped of trailing CRLF
        clean_lines = [line.rstrip("\r\n") for line in lines[-100:]]
        return {"status": "success", "source": source, "file": log_file, "lines": clean_lines}
    except Exception as e:
        return {"status": "error", "source": source, "message": str(e), "lines": []}

async def collect_logs_data():
    return await asyncio.to_thread(_logs_payload, "server")

@app.get("/api/logs")
async def get_logs(source: str = "server"):
    return await asyncio.to_thread(_logs_payload, source)

# Cached GPU telemetry to prevent flickering during transient Optimus D3 sleep states
_last_gpu_telemetry = {
    "temp": None,
    "mem": "N/A",
    "fan": "AUTO",
    "total_mb": None,
    "last_seen": 0.0
}
_NVIDIA_SMI_BIN = None

def _find_nvidia_smi():
    global _NVIDIA_SMI_BIN
    if _NVIDIA_SMI_BIN and os.path.exists(_NVIDIA_SMI_BIN):
        return _NVIDIA_SMI_BIN
    import shutil
    found = shutil.which("nvidia-smi")
    if found:
        _NVIDIA_SMI_BIN = found
        return _NVIDIA_SMI_BIN
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(system_root, "System32", "nvidia-smi.exe"),
        os.path.join(program_files, "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
        r"C:\Windows\System32\nvidia-smi.exe",
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            _NVIDIA_SMI_BIN = c
            return _NVIDIA_SMI_BIN
    return "nvidia-smi"

def _get_gpu_telemetry():
    global _last_gpu_telemetry
    import subprocess
    gpu_temp = None
    gpu_mem = "N/A"
    gpu_fan = "AUTO"
    total_vram_mb = _last_gpu_telemetry.get("total_mb")
    
    smi_bin = _find_nvidia_smi()
    creationflags = 0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW
    
    try:
        gpu_result = subprocess.check_output(
            [smi_bin, "--query-gpu=temperature.gpu,memory.used,memory.total,fan.speed", "--format=csv,noheader,nounits"],
            text=True, stderr=subprocess.DEVNULL, timeout=2.0, creationflags=creationflags
        )
        for line in gpu_result.strip().splitlines():
            parts = [p.strip() for p in line.split(',')]
            if len(parts) >= 3:
                # 1. Temperature (isolated try to prevent cascading failure)
                temp_str = parts[0].strip()
                if temp_str.lower() not in ("[not supported]", "[n/a]", "n/a", "err!", ""):
                    try:
                        gpu_temp = round(float(temp_str))
                    except (ValueError, TypeError):
                        pass

                # 2. VRAM usage and total
                used_str = parts[1].strip()
                total_str = parts[2].strip()
                try:
                    total_mb = int(float(total_str))
                    used_mb = int(float(used_str))
                    if total_mb > 0:
                        total_vram_mb = total_mb
                        gpu_mem = f"{used_mb} / {total_mb} MB"
                except (ValueError, TypeError):
                    pass

                # 3. Fan speed
                if len(parts) >= 4:
                    fan_str = parts[3].strip()
                    if fan_str.lower() not in ("[not supported]", "[n/a]", "n/a", "err!", ""):
                        try:
                            gpu_fan = f"{round(float(fan_str))} %"
                        except (ValueError, TypeError):
                            gpu_fan = "AUTO"
                    else:
                        gpu_fan = "AUTO"
                break
    except Exception:
        # nvidia-smi timed out, exited with error, or GPU is in RTD3 sleep
        pass

    now = time.time()
    if gpu_temp is not None or gpu_mem != "N/A":
        if gpu_temp is not None:
            _last_gpu_telemetry["temp"] = gpu_temp
        if gpu_mem != "N/A":
            _last_gpu_telemetry["mem"] = gpu_mem
        if total_vram_mb:
            _last_gpu_telemetry["total_mb"] = total_vram_mb
        _last_gpu_telemetry["fan"] = gpu_fan
        _last_gpu_telemetry["last_seen"] = now
    else:
        # Fallback to cache if GPU is in transient D3 sleep (< 30s)
        time_since_last = now - _last_gpu_telemetry.get("last_seen", 0.0)
        if time_since_last < 30.0 and _last_gpu_telemetry.get("last_seen", 0.0) > 0:
            gpu_temp = _last_gpu_telemetry.get("temp")
            gpu_mem = _last_gpu_telemetry.get("mem", "N/A")
            gpu_fan = _last_gpu_telemetry.get("fan", "AUTO")
        elif total_vram_mb:
            # If discrete GPU is asleep, report 0 used out of detected total VRAM
            gpu_mem = f"0 / {total_vram_mb} MB"
            gpu_fan = "AUTO"

    return gpu_temp, gpu_mem, gpu_fan

def _get_uplink_signal():
    try:
        import subprocess
        import re
        creationflags = 0x08000000 if os.name == 'nt' else 0
        result = subprocess.check_output(
            ["netsh", "wlan", "show", "interfaces"],
            text=True, stderr=subprocess.DEVNULL, timeout=1.5, creationflags=creationflags
        )
        match = re.search(r"Signal\s*:\s*(\d+)%", result)
        return int(match.group(1)) if match else 0
    except Exception:
        return 0

def _get_cpu_temp():
    try:
        import wmi
        w = wmi.WMI(namespace="root\\wmi")
        temperature_info = w.MSAcpi_ThermalZoneTemperature()
        if temperature_info:
            return int((temperature_info[0].CurrentTemperature / 10.0) - 273.15)
    except Exception:
        pass
    return None

def _telemetry_payload():
    from concurrent.futures import ThreadPoolExecutor
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory().percent
    battery = psutil.sensors_battery()
    power = battery.percent if battery else 100

    # Run slow OS probes (netsh, WMI, nvidia-smi) concurrently instead of sequentially.
    with ThreadPoolExecutor(max_workers=3) as pool:
        f_uplink = pool.submit(_get_uplink_signal)
        f_cpu_temp = pool.submit(_get_cpu_temp)
        f_gpu = pool.submit(_get_gpu_telemetry)
        uplink = f_uplink.result()
        cpu_temp = f_cpu_temp.result()
        gpu_temp, gpu_mem, gpu_fan = f_gpu.result()

    # Win32_Fan is rarely populated on Windows without ring-0 kernel drivers;
    # report 'AUTO' to indicate automated firmware/EC cooling curve
    cpu_fan = "AUTO"
    
    try:
        from llm_provider import get_active_provider, get_active_model
        active_prov = get_active_provider()
        active_model_label = get_active_model(active_prov).upper().split(':')[0]
        if active_prov != "ollama":
            active_model_label = f"{active_prov.upper()}:{active_model_label}"
    except Exception:
        try:
            from config import OLLAMA_MODEL
            active_model_label = OLLAMA_MODEL.upper().split(':')[0]
        except ImportError:
            active_model_label = "UNKNOWN"
        
    vram_gb = "0.0"
    if gpu_mem != "N/A" and gpu_mem != "0 / 0 MB":
        try:
            # gpu_mem format is "XXXX / YYYY MB"
            used_mb = float(gpu_mem.split('/')[0].strip())
            vram_gb = f"{used_mb / 1024:.1f}"
        except Exception:
            pass

    return {
        "cpu": int(cpu),
        "memory": int(mem),
        "power": int(power),
        "uplink": uplink,
        "tasks": len(psutil.pids()),
        "threats": "00",
        "cpu_temp": cpu_temp,
        "cpu_fan": cpu_fan,
        "gpu_temp": gpu_temp,
        "gpu_mem": gpu_mem,
        "gpu_fan": gpu_fan,
        "ambient": (lambda: _safe_get_ambient())(),
        "ai": {
            "model": active_model_label,
            "vram": vram_gb,
            "telemetry": agent.ai_telemetry
        }
    }

def _safe_get_ambient():
    try:
        from backend.ambient_sentinel import get_ambient_context
        return get_ambient_context()
    except Exception:
        return None

async def collect_ambient_data():
    return await asyncio.to_thread(_safe_get_ambient)

async def collect_telemetry_data():
    # netsh/WMI/nvidia-smi block for tens of ms; keep them off the event loop
    # so the SSE bus and other requests stay responsive.
    return await asyncio.to_thread(_telemetry_payload)

@app.get("/api/telemetry")
async def get_telemetry():
    return await collect_telemetry_data()

@app.get("/api/ambient")
async def get_ambient():
    return await collect_ambient_data()

@app.get("/api/rag/documents")
async def get_rag_documents():
    from tools.rag_tools import list_indexed_documents
    return await asyncio.to_thread(list_indexed_documents)

@app.post("/api/rag/index")
async def index_rag_folder(req: Request):
    from tools.rag_tools import index_desktop_directory
    body = await req.json()
    folder = body.get("directory", "")
    max_files = body.get("max_files", 40)
    return await asyncio.to_thread(index_desktop_directory, folder, max_files)

@app.post("/api/rag/query")
async def query_rag_knowledge(req: Request):
    from tools.rag_tools import query_desktop_knowledge
    body = await req.json()
    q = body.get("query", "")
    top_k = body.get("top_k", 5)
    return await asyncio.to_thread(query_desktop_knowledge, q, top_k)

@app.get("/api/mcp/servers")
async def get_mcp_servers():
    from tools.mcp_tools import list_mcp_servers
    return await asyncio.to_thread(list_mcp_servers)

@app.post("/api/mcp/reload")
async def reload_mcp():
    from tools.mcp_tools import reload_mcp_servers
    return await asyncio.to_thread(reload_mcp_servers)

@app.post("/api/chat")
def chat(req: ChatRequest, background_tasks: BackgroundTasks):
    # Runs as a sync handler (threadpool) because agent.send_message blocks for a long time.
    # Send message and get response
    with agent_lock:
        response_text = agent.send_message(req.message, images=req.images, file_texts=req.file_texts)
    
    # We no longer speak locally via background_tasks if use_voice_output is true.
    # The frontend will hit /api/tts to fetch the audio and play it.
        
    return {"status": "success", "response": response_text}

@app.post("/api/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """SSE transport over the same pipeline as /api/chat.

    Emits meta/token/tool_start/tool_result/permission_request/done events; any
    pipeline error becomes an error event before the stream closes.
    """
    async def event_source():
        try:
            async for event in agent.chat_stream(req.message, images=req.images, file_texts=req.file_texts):
                yield f"data: {_json.dumps(event, default=str)}\n\n"
        except Exception as e:
            logging.error(f"/api/chat/stream failed: {e}")
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

@app.api_route("/api/captures/last_screen", methods=["GET", "HEAD"])
async def get_last_screen(request: Request):
    """Serves the last screen capture from outside the web-served static directory."""
    import os
    path = os.path.join("captures", "last_screen.png")
    if os.path.exists(path):
        if request.method == "HEAD":
            return Response(status_code=200)
        return FileResponse(path, media_type="image/png")
    if request.method == "HEAD":
        return Response(status_code=404)
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="No screen capture available yet.")

def _permissions_payload():
    from permissions import get_pending_actions, TRUSTED_AUTOMATION_ENABLED
    return {
        "status": "success",
        "pending": get_pending_actions(),
        "trusted_automation": TRUSTED_AUTOMATION_ENABLED
    }

async def collect_permissions_data():
    return _permissions_payload()

@app.get("/api/permissions/pending")
async def get_pending_permissions():
    return await collect_permissions_data()

@app.post("/api/permissions/confirm/{action_id}")
async def confirm_permission(action_id: str):
    from permissions import confirm_pending_action
    result = confirm_pending_action(action_id)
    # Push immediately so the HUD clears the card without waiting for the
    # next detector sweep.
    await bus.publish("permissions_update", await collect_permissions_data())
    return {"status": "success", "message": result}

@app.post("/api/permissions/reject/{action_id}")
async def reject_permission(action_id: str):
    from permissions import reject_pending_action
    result = reject_pending_action(action_id)
    await bus.publish("permissions_update", await collect_permissions_data())
    return {"status": "success", "message": result}

@app.post("/api/permissions/trusted_mode")
async def set_trusted_mode(req: Request):
    data = await req.json()
    enabled = data.get("enabled", False)
    from permissions import toggle_trusted_automation
    toggle_trusted_automation(enabled)
    await bus.publish("permissions_update", await collect_permissions_data())
    return {"status": "success", "enabled": enabled}

class VoiceSettingsRequest(BaseModel):
    voice: Optional[str] = None
    rate: Optional[str] = None

@app.get("/api/tts")
def tts(text: str, voice: Optional[str] = None, rate: Optional[str] = None, backend: Optional[str] = None):
    import os
    if not text:
        return Response(status_code=204)
    if len(text) > 2000:
        # Bound synthesis time and temp-file size; spoken replies don't need
        # unbounded input from a query parameter.
        text = text[:2000]
    
    try:
        # Generate the TTS file (blocking, so this endpoint runs in a threadpool)
        filepath = generate_tts_file(text, voice=voice, rate=rate, backend=backend)
        if filepath and os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            media_type = "audio/mpeg" if filepath.lower().endswith(".mp3") else "audio/wav"
            return FileResponse(filepath, media_type=media_type)
    except Exception as e:
        logging.error(f"TTS endpoint error: {e}")

    return Response(status_code=204)

_EDGE_TTS_VOICES = [
    {"id": "en-US-AvaNeural", "name": "Ava (Ultra-Realistic Conversational Female)", "gender": "Female", "locale": "en-US", "recommended": True},
    {"id": "en-US-AndrewNeural", "name": "Andrew (Warm Natural Conversational Male)", "gender": "Male", "locale": "en-US", "recommended": True},
    {"id": "en-US-EmmaNeural", "name": "Emma (Expressive Natural Female)", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-JennyNeural", "name": "Jenny (Warm & Friendly Female)", "gender": "Female", "locale": "en-US"},
    {"id": "en-US-BrianNeural", "name": "Brian (Deep Articulate Male)", "gender": "Male", "locale": "en-US"},
    {"id": "en-US-GuyNeural", "name": "Guy (Casual American Male)", "gender": "Male", "locale": "en-US"},
    {"id": "en-GB-SoniaNeural", "name": "Sonia (Sophisticated British Female - Jarvis/Friday)", "gender": "Female", "locale": "en-GB"},
    {"id": "en-GB-RyanNeural", "name": "Ryan (Intellectual British Male)", "gender": "Male", "locale": "en-GB"},
    {"id": "en-US-AriaNeural", "name": "Aria (Classic Tactical Assistant)", "gender": "Female", "locale": "en-US"},
    {"id": "en-IN-NeerjaNeural", "name": "Neerja (Natural Indian English Female)", "gender": "Female", "locale": "en-IN"},
    {"id": "en-IN-PrabhatNeural", "name": "Prabhat (Natural Indian English Male)", "gender": "Male", "locale": "en-IN"},
]

_KOKORO_VOICE_LABELS = {
    "af": "af (American Female - Flagship Default)",
    "af_heart": "af_heart (American Female - Expressive Warm)",
    "af_bella": "af_bella (American Female - Warm Expressive)",
    "af_nicole": "af_nicole (American Female - Soft Whispery)",
    "af_sarah": "af_sarah (American Female - Clear Professional)",
    "af_sky": "af_sky (American Female - Bright Casual)",
    "am_adam": "am_adam (American Male - Steady Narrator)",
    "am_michael": "am_michael (American Male - Deep Broadcast)",
    "bf_emma": "bf_emma (British Female - Clear)",
    "bf_isabella": "bf_isabella (British Female - Refined)",
    "bm_george": "bm_george (British Male - Warm)",
    "bm_lewis": "bm_lewis (British Male - Articulate)",
}


def _extract_ollama_model_names(res) -> list[str]:
    """Extract model names from ollama.list() across ollama SDK 0.3 (dict) and 0.4+/0.6+ (ListResponse)."""
    if res is None:
        return []
    models_seq = getattr(res, "models", None)
    if models_seq is None and isinstance(res, dict):
        models_seq = res.get("models", [])
    if not models_seq:
        return []
    names = []
    for m in models_seq:
        name = getattr(m, "model", None) or getattr(m, "name", None)
        if not name and isinstance(m, dict):
            name = m.get("model") or m.get("name")
        if name:
            names.append(str(name))
    return names


def _discover_kokoro_voices() -> list[dict]:
    """Read available voice IDs from local models/kokoro/voices.json if present."""
    import json as _json_local
    voices_path = os.path.join(_PROJECT_ROOT, "models", "kokoro", "voices.json")
    keys = []
    if os.path.exists(voices_path):
        try:
            with open(voices_path, "r", encoding="utf-8") as f:
                data = _json_local.load(f)
            if isinstance(data, dict):
                keys = sorted(data.keys())
        except Exception:
            pass
    if not keys:
        keys = ["af", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]
    return [{"id": k, "name": _KOKORO_VOICE_LABELS.get(k, k), "backend": "kokoro"} for k in keys]


def _discover_audio_input_devices() -> list[dict]:
    """Enumerate available microphone input devices via sounddevice."""
    devices = [{"value": "", "label": "System Default Microphone"}]
    try:
        import sounddevice as sd
        seen_names = {}
        for idx, d in enumerate(sd.query_devices()):
            if d.get("max_input_channels", 0) > 0:
                name = str(d.get("name", f"Device {idx}")).strip()
                seen_names[name] = seen_names.get(name, 0) + 1
                devices.append({
                    "value": str(idx),
                    "label": f"[{idx}] {name} ({d.get('max_input_channels')}ch)",
                })
    except Exception:
        pass
    return devices


def _discover_wakeword_models() -> list[dict]:
    """Discover local ONNX/TFLite wake word models inside models/."""
    models_dir = os.path.join(_PROJECT_ROOT, "models")
    found = []
    if os.path.isdir(models_dir):
        for fname in sorted(os.listdir(models_dir)):
            low = fname.lower()
            if low.endswith(".onnx") or low.endswith(".tflite"):
                rel = f"models/{fname}"
                found.append({"value": rel, "label": rel})
    if not any(m["value"] == "models/hey_aura.onnx" for m in found):
        found.insert(0, {"value": "models/hey_aura.onnx", "label": "models/hey_aura.onnx (Default)"})
    return found


def _discover_wiz_broadcasts() -> list[dict]:
    """Suggest global broadcast plus local IPv4 subnet broadcast addresses."""
    options = [{"value": "255.255.255.255", "label": "255.255.255.255 (Global Broadcast - Default)"}]
    seen = {"255.255.255.255"}
    try:
        import ipaddress
        import socket
        for iface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and addr.address and addr.netmask:
                    if addr.address.startswith("127.") or addr.address.startswith("169.254."):
                        continue
                    try:
                        net = ipaddress.IPv4Interface(f"{addr.address}/{addr.netmask}").network
                        bcast = str(net.broadcast_address)
                        if bcast not in seen:
                            seen.add(bcast)
                            options.append({"value": bcast, "label": f"{bcast} ({iface})"})
                    except Exception:
                        pass
    except Exception:
        pass
    return options


def _build_env_schema(available_models: list[str], audio_devices: list[dict], wakeword_models: list[dict], kokoro_voices: list[dict], wiz_broadcasts: list[dict]) -> dict:
    """Return exact validated option metadata for every .env configuration variable."""
    from llm_provider import PROVIDERS
    model_opts = [{"value": m, "label": m} for m in available_models]
    edge_voice_opts = [{"value": v["id"], "label": f"Edge: {v['name']}"} for v in _EDGE_TTS_VOICES]
    kokoro_voice_opts = [{"value": v["id"], "label": f"Kokoro: {v['name']}"} for v in kokoro_voices]

    cloud_schema = {
        "AURA_LLM_PROVIDER": {
            "category": "ai",
            "description": "Active reasoning provider (Ollama local or Cloud API)",
            "type": "select",
            "options": [
                {"value": "ollama", "label": "ollama (Local Ollama)"},
                {"value": "groq", "label": "groq (Groq Cloud)"},
                {"value": "nvidia", "label": "nvidia (NVIDIA NIM)"},
                {"value": "gemini", "label": "gemini (Google Gemini)"},
                {"value": "openai", "label": "openai (OpenAI / ChatGPT)"},
                {"value": "openrouter", "label": "openrouter (OpenRouter)"},
            ],
        },
    }
    for prov_id in ("groq", "nvidia", "gemini", "openai", "openrouter"):
        spec = PROVIDERS[prov_id]
        cloud_schema[spec["api_key_env"]] = {
            "category": "ai",
            "description": f"Custom API key for {spec['label']}",
            "type": "password",
            "options": [],
        }
        cloud_schema[spec["model_env"]] = {
            "category": "ai",
            "description": f"Default {spec['label']} model ID",
            "type": "select_or_custom",
            "options": [{"value": m, "label": m} for m in spec["curated_models"]],
        }

    return {
        **cloud_schema,
        "OLLAMA_MODEL": {
            "category": "ai",
            "description": "Primary reasoning LLM (must be pulled in Ollama)",
            "type": "select_or_custom",
            "options": model_opts or [{"value": "gemma4:e2b", "label": "gemma4:e2b"}],
        },
        "OLLAMA_VISION_MODEL": {
            "category": "ai",
            "description": "Dedicated vision-language model for screenshots & images",
            "type": "select_or_custom",
            "options": model_opts or [{"value": "qwen3-vl:4b", "label": "qwen3-vl:4b"}],
        },
        "OLLAMA_NUM_CTX": {
            "category": "ai",
            "description": "Context window size in tokens (lower reduces VRAM usage)",
            "type": "select_or_custom",
            "options": [
                {"value": "2048", "label": "2,048 tokens (Low VRAM)"},
                {"value": "4096", "label": "4,096 tokens (Compact)"},
                {"value": "8192", "label": "8,192 tokens (Balanced Default)"},
                {"value": "16384", "label": "16,384 tokens (Extended)"},
                {"value": "32768", "label": "32,768 tokens (Large)"},
                {"value": "65536", "label": "65,536 tokens (Very Large)"},
                {"value": "131072", "label": "131,072 tokens (Max 128K)"},
            ],
        },
        "OLLAMA_KEEP_ALIVE": {
            "category": "ai",
            "description": "How long Ollama keeps models loaded in RAM/VRAM",
            "type": "select_or_custom",
            "options": [
                {"value": "0", "label": "0 (Unload immediately)"},
                {"value": "2m", "label": "2m (2 minutes)"},
                {"value": "5m", "label": "5m (5 minutes - Default)"},
                {"value": "10m", "label": "10m (10 minutes)"},
                {"value": "30m", "label": "30m (30 minutes)"},
                {"value": "1h", "label": "1h (1 hour)"},
                {"value": "-1", "label": "-1 (Keep loaded indefinitely)"},
            ],
        },
        "AURA_INTENT_ROUTER": {
            "category": "ai",
            "description": "Pre-classify intent before main agent pass",
            "type": "select",
            "options": [
                {"value": "on", "label": "on (Fast intent pre-routing)"},
                {"value": "off", "label": "off (Direct full toolset)"},
            ],
        },
        "AURA_TTS_BACKEND": {
            "category": "audio",
            "description": "Text-to-Speech synthesis engine",
            "type": "select",
            "options": [
                {"value": "edge", "label": "edge (Microsoft Cloud Neural)"},
                {"value": "kokoro", "label": "kokoro (100% Offline ONNX Neural)"},
            ],
        },
        "AURA_TTS_VOICE": {
            "category": "audio",
            "description": "Voice model ID (Edge Neural or Kokoro local)",
            "type": "select_or_custom",
            "options": edge_voice_opts + kokoro_voice_opts,
        },
        "AURA_TTS_RATE": {
            "category": "audio",
            "description": "Speech rate adjustment",
            "type": "select_or_custom",
            "options": [
                {"value": "-20%", "label": "-20% (Slowest)"},
                {"value": "-15%", "label": "-15%"},
                {"value": "-10%", "label": "-10% (Slower)"},
                {"value": "-5%", "label": "-5%"},
                {"value": "+0%", "label": "+0% (Normal Default)"},
                {"value": "+5%", "label": "+5%"},
                {"value": "+10%", "label": "+10% (Faster)"},
                {"value": "+15%", "label": "+15%"},
                {"value": "+20%", "label": "+20% (Fastest)"},
            ],
        },
        "AURA_STT_BACKEND": {
            "category": "audio",
            "description": "Speech-to-Text engine",
            "type": "select",
            "options": [
                {"value": "local", "label": "local (faster-whisper offline)"},
                {"value": "cloud", "label": "cloud (Google SpeechRecognition)"},
            ],
        },
        "AURA_STT_MODEL": {
            "category": "audio",
            "description": "faster-whisper model checkpoint size",
            "type": "select_or_custom",
            "options": [
                {"value": "tiny.en", "label": "tiny.en (~39M, Fastest English)"},
                {"value": "tiny", "label": "tiny (~39M, Multilingual)"},
                {"value": "base.en", "label": "base.en (~74M, Balanced English)"},
                {"value": "base", "label": "base (~74M, Multilingual)"},
                {"value": "small.en", "label": "small.en (~244M, Accurate English)"},
                {"value": "small", "label": "small (~244M, Multilingual)"},
                {"value": "medium.en", "label": "medium.en (~769M, High Accuracy)"},
                {"value": "medium", "label": "medium (~769M, Multilingual)"},
                {"value": "large-v3", "label": "large-v3 (~1.55B, Maximum Accuracy)"},
                {"value": "turbo", "label": "turbo (~809M, Fast High Accuracy)"},
            ],
        },
        "AURA_STT_DEVICE": {
            "category": "audio",
            "description": "Hardware device for Whisper inference",
            "type": "select",
            "options": [
                {"value": "auto", "label": "auto (CUDA if available, else CPU)"},
                {"value": "cuda", "label": "cuda (NVIDIA GPU)"},
                {"value": "cpu", "label": "cpu (Host CPU)"},
            ],
        },
        "AURA_STT_COMPUTE_TYPE": {
            "category": "audio",
            "description": "CTranslate2 precision / quantization",
            "type": "select",
            "options": [
                {"value": "auto", "label": "auto (float16 on CUDA, int8 on CPU)"},
                {"value": "default", "label": "default (CTranslate2 default)"},
                {"value": "int8", "label": "int8 (Fastest / Lowest RAM on CPU)"},
                {"value": "float16", "label": "float16 (Fast GPU precision)"},
                {"value": "int8_float16", "label": "int8_float16 (Low-VRAM GPU)"},
                {"value": "float32", "label": "float32 (Full precision)"},
            ],
        },
        "AURA_WAKEWORD_MODEL": {
            "category": "audio",
            "description": "ONNX/TFLite wake word model path",
            "type": "select_or_custom",
            "options": wakeword_models,
        },
        "AURA_WAKEWORD_THRESHOLD": {
            "category": "audio",
            "description": "Wake word detection confidence cutoff (0.00 - 1.00)",
            "type": "select_or_custom",
            "options": [
                {"value": f"{v/100:.2f}", "label": f"{v/100:.2f}" + (" (Default)" if v == 60 else " (More sensitive)" if v <= 45 else " (Fewer false wakes)" if v >= 75 else "")}
                for v in range(30, 100, 5)
            ],
        },
        "AURA_WAKEWORD_SPEAKING_THRESHOLD": {
            "category": "audio",
            "description": "Higher threshold while AURA speaks (barge-in guard)",
            "type": "select_or_custom",
            "options": [
                {"value": f"{v/100:.2f}", "label": f"{v/100:.2f}" + (" (Default)" if v == 85 else "")}
                for v in range(50, 100, 5)
            ],
        },
        "AURA_WAKEWORD_COOLDOWN": {
            "category": "audio",
            "description": "Seconds to suppress repeat wake detections",
            "type": "select_or_custom",
            "options": [
                {"value": "0.5", "label": "0.5s"},
                {"value": "1.0", "label": "1.0s"},
                {"value": "1.5", "label": "1.5s"},
                {"value": "2.0", "label": "2.0s (Default)"},
                {"value": "3.0", "label": "3.0s"},
                {"value": "3.5", "label": "3.5s"},
                {"value": "5.0", "label": "5.0s"},
            ],
        },
        "AURA_WAKEWORD_PERSISTENCE": {
            "category": "audio",
            "description": "Consecutive 80ms chunks required above threshold",
            "type": "select_or_custom",
            "options": [
                {"value": "1", "label": "1 chunk (Instant)"},
                {"value": "2", "label": "2 chunks (Fast)"},
                {"value": "3", "label": "3 chunks (Default)"},
                {"value": "4", "label": "4 chunks"},
                {"value": "5", "label": "5 chunks"},
                {"value": "6", "label": "6 chunks (Strict)"},
                {"value": "8", "label": "8 chunks (Very Strict)"},
            ],
        },
        "AURA_WAKEWORD_VAD_THRESHOLD": {
            "category": "audio",
            "description": "Audio RMS energy cutoff to skip silence",
            "type": "select_or_custom",
            "options": [
                {"value": "0.0", "label": "0.0 (Disabled - Always infer)"},
                {"value": "10.0", "label": "10.0 (Quiet room / sensitive mic)"},
                {"value": "15.0", "label": "15.0 (Low noise)"},
                {"value": "20.0", "label": "20.0 (Default)"},
                {"value": "30.0", "label": "30.0 (Moderate background noise)"},
                {"value": "50.0", "label": "50.0 (Noisy room)"},
                {"value": "100.0", "label": "100.0 (Very noisy room)"},
            ],
        },
        "AURA_WAKEWORD_DEVICE": {
            "category": "audio",
            "description": "Microphone input device index or name",
            "type": "select_or_custom",
            "options": audio_devices,
        },
        "AURA_WAKEWORD_ONE_SHOT": {
            "category": "audio",
            "description": "Stream pre-roll utterance right after wake word",
            "type": "select",
            "options": [
                {"value": "true", "label": "true (Stream utterance immediately)"},
                {"value": "false", "label": "false (Wait for pause)"},
            ],
        },
        "AURA_SPEAKER_VERIFICATION": {
            "category": "audio",
            "description": "Verify enrolled speaker voiceprint on wake word",
            "type": "select",
            "options": [
                {"value": "false", "label": "false (Allow any speaker - Default)"},
                {"value": "true", "label": "true (Enforce voiceprint gate)"},
            ],
        },
        "AURA_VISUAL_TASK_TIMEOUT": {
            "category": "env",
            "description": "Time budget in seconds for visual desktop agent",
            "type": "select_or_custom",
            "options": [
                {"value": "30", "label": "30s (Quick tasks)"},
                {"value": "60", "label": "60s"},
                {"value": "90", "label": "90s"},
                {"value": "120", "label": "120s (Default)"},
                {"value": "180", "label": "180s (Complex workflows)"},
                {"value": "240", "label": "240s"},
                {"value": "300", "label": "300s (Max 5 min)"},
            ],
        },
        "AURA_WIZ_BROADCAST": {
            "category": "env",
            "description": "WiZ smart-bulb UDP discovery broadcast address",
            "type": "select_or_custom",
            "options": wiz_broadcasts,
        },
        "AURA_SSE_HEARTBEAT": {
            "category": "env",
            "description": "Server-Sent Events keep-alive ping interval (seconds)",
            "type": "select_or_custom",
            "options": [
                {"value": "5", "label": "5s (Aggressive proxy keep-alive)"},
                {"value": "10", "label": "10s"},
                {"value": "15", "label": "15s (Default)"},
                {"value": "20", "label": "20s"},
                {"value": "30", "label": "30s"},
                {"value": "60", "label": "60s"},
            ],
        },
    }


def _sync_runtime_env(env_map: dict):
    """Apply updated environment values to live in-process modules."""
    if not env_map:
        return
    try:
        import config
    except Exception:
        config = None
    try:
        import agent
    except Exception:
        agent = None
    try:
        import voice
    except Exception:
        voice = None

    if "AURA_TTS_VOICE" in env_map and voice:
        voice.set_tts_voice(env_map["AURA_TTS_VOICE"], None)
    if "AURA_TTS_RATE" in env_map and voice:
        voice.set_tts_voice(None, env_map["AURA_TTS_RATE"])
    if "OLLAMA_MODEL" in env_map:
        if config:
            config.OLLAMA_MODEL = env_map["OLLAMA_MODEL"]
        if agent:
            agent.OLLAMA_MODEL = env_map["OLLAMA_MODEL"]
        _ollama_health_cache["data"] = None
        _ollama_health_cache["ts"] = 0.0
    if "OLLAMA_VISION_MODEL" in env_map and config:
        config.OLLAMA_VISION_MODEL = env_map["OLLAMA_VISION_MODEL"]
    if "OLLAMA_NUM_CTX" in env_map and config:
        try:
            config.OLLAMA_NUM_CTX = int(env_map["OLLAMA_NUM_CTX"])
        except ValueError:
            pass
    if "OLLAMA_KEEP_ALIVE" in env_map:
        if config:
            config.OLLAMA_KEEP_ALIVE = env_map["OLLAMA_KEEP_ALIVE"]
        if agent:
            agent.OLLAMA_KEEP_ALIVE = env_map["OLLAMA_KEEP_ALIVE"]


@app.get("/api/voice/options")
def get_voice_options():
    import voice
    return {
        "status": "success",
        "current_voice": voice.get_tts_voice(),
        "current_rate": voice.get_tts_rate(),
        "voices": _EDGE_TTS_VOICES,
        "kokoro_voices": _discover_kokoro_voices(),
    }

class EnvSettingsRequest(BaseModel):
    settings: dict = {}

@app.get("/api/settings/env")
async def get_env_settings():
    """Retrieve all configuration keys from .env plus discovered models, devices, and exact option schemas."""
    import dotenv
    dotenv_path = os.path.join(_PROJECT_ROOT, ".env")
    example_path = os.path.join(_PROJECT_ROOT, ".env.example")
    if not os.path.exists(dotenv_path) and os.path.exists(example_path):
        import shutil
        shutil.copyfile(example_path, dotenv_path)

    env_vals = {}
    if os.path.exists(example_path):
        for k, v in dotenv.dotenv_values(example_path).items():
            env_vals[k] = "" if v is None else str(v)
    if os.path.exists(dotenv_path):
        for k, v in dotenv.dotenv_values(dotenv_path).items():
            env_vals[k] = "" if v is None else str(v)

    async def _fetch_ollama_models():
        try:
            import ollama
            return await asyncio.wait_for(
                asyncio.to_thread(lambda: _extract_ollama_model_names(ollama.list())),
                timeout=1.5
            )
        except Exception:
            return []

    available_models, audio_devices = await asyncio.gather(
        _fetch_ollama_models(),
        asyncio.to_thread(_discover_audio_input_devices),
    )
    wakeword_models = _discover_wakeword_models()
    kokoro_voices = _discover_kokoro_voices()
    wiz_broadcasts = _discover_wiz_broadcasts()
    schema = _build_env_schema(available_models, audio_devices, wakeword_models, kokoro_voices, wiz_broadcasts)

    return {
        "status": "success",
        "env": env_vals,
        "available_models": available_models,
        "options": {
            "ollama_models": available_models,
            "audio_input_devices": audio_devices,
            "wakeword_models": wakeword_models,
            "tts_voices": {
                "edge": _EDGE_TTS_VOICES,
                "kokoro": kokoro_voices,
            },
            "wiz_broadcasts": wiz_broadcasts,
        },
        "schema": schema,
    }

@app.post("/api/settings/env")
async def update_env_settings(req: EnvSettingsRequest):
    """Update settings directly in the .env file and synchronize live process environment."""
    import dotenv
    import re
    dotenv_path = os.path.join(_PROJECT_ROOT, ".env")
    if not os.path.exists(dotenv_path):
        example_path = os.path.join(_PROJECT_ROOT, ".env.example")
        if os.path.exists(example_path):
            import shutil
            shutil.copyfile(example_path, dotenv_path)

    updated = {}
    for k, v in req.settings.items():
        if v is None:
            continue
        key_str = str(k).strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key_str):
            continue
        val_str = str(v).strip()
        dotenv.set_key(dotenv_path, key_str, val_str, quote_mode="auto")
        os.environ[key_str] = val_str
        updated[key_str] = val_str

    _sync_runtime_env(updated)

    return {
        "status": "success",
        "updated": updated,
        "message": f"Successfully updated {len(updated)} configuration(s) in .env file."
    }

class ProviderTestRequest(BaseModel):
    provider: str
    api_key: Optional[str] = None

@app.post("/api/settings/provider/test")
async def test_cloud_provider(req: ProviderTestRequest):
    """Verify a cloud AI API key and fetch live model IDs from that provider."""
    from llm_provider import fetch_provider_models
    return await asyncio.to_thread(fetch_provider_models, req.provider, req.api_key)

@app.post("/api/settings/env/reset")
async def reset_env_settings():
    """Backup current .env and restore factory defaults from .env.example."""
    import dotenv
    import shutil
    dotenv_path = os.path.join(_PROJECT_ROOT, ".env")
    example_path = os.path.join(_PROJECT_ROOT, ".env.example")
    bak_path = os.path.join(_PROJECT_ROOT, ".env.bak")

    if os.path.exists(dotenv_path):
        try:
            shutil.copyfile(dotenv_path, bak_path)
        except Exception as e:
            logging.warning(f"Failed to create .env backup: {e}")

    if os.path.exists(example_path):
        try:
            shutil.copyfile(example_path, dotenv_path)
        except Exception as e:
            return {"status": "error", "message": f"Failed to restore .env: {e}"}
    else:
        return {"status": "error", "message": ".env.example template not found on server"}

    raw_vals = dict(dotenv.dotenv_values(dotenv_path))
    env_vals = {k: ("" if v is None else str(v)) for k, v in raw_vals.items()}
    for k, v in env_vals.items():
        os.environ[k] = v

    _sync_runtime_env(env_vals)

    return {
        "status": "success",
        "message": "Configuration restored to defaults. Backup saved to .env.bak.",
        "env": env_vals
    }

@app.post("/api/voice/settings")
def update_voice_settings(req: VoiceSettingsRequest):
    import voice
    voice.set_tts_voice(req.voice, req.rate)
    try:
        import dotenv
        dotenv_path = os.path.join(_PROJECT_ROOT, ".env")
        if req.voice:
            dotenv.set_key(dotenv_path, "AURA_TTS_VOICE", req.voice, quote_mode="auto")
            os.environ["AURA_TTS_VOICE"] = req.voice
        if req.rate:
            dotenv.set_key(dotenv_path, "AURA_TTS_RATE", req.rate, quote_mode="auto")
            os.environ["AURA_TTS_RATE"] = req.rate
    except Exception as e:
        logging.warning(f"Failed to persist voice settings to .env: {e}")
    return {
        "status": "success",
        "voice": voice.get_tts_voice(),
        "rate": voice.get_tts_rate()
    }

@app.post("/api/voice/listen")
def voice_listen(background_tasks: BackgroundTasks):
    # listen() blocks on the microphone for seconds, so this must NOT be an async handler.
    # We return ONLY the transcription here and let the frontend stream the answer via
    # /api/chat/stream. Generating the response server-side used to add the full LLM
    # round-trip to this one request, which routinely exceeded the client's timeout —
    # so the reply was persisted to memory but never rendered live.
    text = listen()
    
    if text == "SWITCH_TO_TEXT_MODE":
        return {"status": "error", "message": "Voice input failed — microphone unavailable."}
    if not text:
        # Silence is a normal outcome, not an error
        return {"status": "no_speech", "message": "No speech detected."}
    
    return {
        "status": "success",
        "transcription": text,
    }

@app.post("/api/voice/stop")
async def voice_stop():
    from voice import stop_speaking
    stop_speaking()
    return {"status": "success", "message": "Voice playback stopped."}

class SpeakingStatus(BaseModel):
    is_speaking: bool

@app.post("/api/voice/speaking")
async def set_speaking_status(status: SpeakingStatus):
    import voice
    voice.is_speaking = status.is_speaking
    # HUD playback happens in the browser; this POST is how the backend learns
    # audible speech actually ended (it starts listen()'s anti-echo settle window).
    if not status.is_speaking:
        voice._mark_speech_end()
    return {"status": "success"}


class WakeWordStatus(BaseModel):
    enabled: bool

@app.post("/api/wakeword/toggle")
async def toggle_wakeword(req: WakeWordStatus):
    import voice
    voice.set_wakeword_enabled(req.enabled)
    status = voice.get_wakeword_status()
    # Broadcast so every open HUD flips its Settings chip without polling.
    await bus.publish("wakeword_status", status)
    return {"status": "success", "enabled": req.enabled}

@app.get("/api/wakeword/status")
async def wakeword_status():
    import voice
    return voice.get_wakeword_status()


# ─── Health Endpoints ───
# Lightweight checks for the onboarding overlay. Never throw; always return JSON.

_ollama_health_cache = {"data": None, "ts": 0.0}

@app.get("/api/health")
async def health_check():
    """Trivial liveness probe — returns immediately."""
    return {"ok": True}

@app.get("/api/health/ollama")
async def health_ollama():
    """Check Ollama reachability and default model with a 3s timeout.
    Cached for 30s to avoid hammering Ollama on rapid reloads.
    """
    import time
    import ollama
    now = time.time()
    # Return cached result if fresh (<30s)
    if _ollama_health_cache["data"] and (now - _ollama_health_cache["ts"]) < 30:
        return _ollama_health_cache["data"]

    # Fresh check with 3s timeout
    start = time.perf_counter()
    try:
        # ollama.list() is fast; wrap in asyncio.to_thread with timeout
        async def _list_models():
            return await asyncio.to_thread(ollama.list)

        try:
            result = await asyncio.wait_for(_list_models(), timeout=3.0)
        except asyncio.TimeoutError:
            raise TimeoutError("Ollama list() timed out after 3s")

        latency_ms = int((time.perf_counter() - start) * 1000)
        models = _extract_ollama_model_names(result)
        # Pick the configured model or first available
        from config import OLLAMA_MODEL
        model_name = OLLAMA_MODEL
        if models and model_name not in models:
            model_name = models[0]

        data = {"ok": True, "model": model_name, "latency_ms": latency_ms}
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        data = {"ok": False, "model": None, "latency_ms": latency_ms, "error": str(e)}

    _ollama_health_cache["data"] = data
    _ollama_health_cache["ts"] = now
    return data


@app.post("/api/voice/wake_and_listen")
def wake_and_listen(background_tasks: BackgroundTasks):
    # Greet the user first (this call is synchronous and will block until done)
    speak("I am listening.")
    
    # Listen locally
    text = listen()
    
    if text == "SWITCH_TO_TEXT_MODE":
        return {"status": "error", "message": "Voice input failed — microphone unavailable."}
    if not text:
        # Silence is a normal outcome, not an error
        return {"status": "no_speech", "message": "No speech detected."}
    
    # We got speech — now send it through the agent
    with agent_lock:
        response_text = agent.send_message(text)
    
    # Speak the response (handled by frontend now)
    
    # Check if conversation should continue (if it ends with a question mark)
    continue_conv = response_text.strip().endswith('?')
    
    return {
        "status": "success",
        "transcription": text,
        "response": response_text,
        "continue": continue_conv
    }
@app.get("/api/notifications")
async def get_notifications():
    while True:
        msg = pop_notification()
        if msg is None:
            return {"has_notification": False}
        if msg == "__WAKE_WORD__":
            try:
                ts = _wake_signal_times.get_nowait()
            except _queue.Empty:
                ts = None
            # Drop stale wake signals: they are only actionable for a few
            # seconds after the word was actually heard.
            if ts is None or (time.time() - ts) > WAKE_SIGNAL_MAX_AGE:
                continue
            return {"has_notification": True, "message": msg}
        return {"has_notification": True, "message": msg}

class ScheduleEvent(BaseModel):
    time: str
    event: str

def _schedule_payload():
    import json
    import os
    schedule_file = "schedule.json"
    if not os.path.exists(schedule_file):
        return []
    try:
        with open(schedule_file, 'r') as f:
            return json.load(f)
    except Exception:
        return []

async def collect_schedule_data():
    return _schedule_payload()

@app.get("/api/schedule")
async def get_schedule():
    return await collect_schedule_data()

@app.post("/api/schedule")
async def add_schedule(event: ScheduleEvent):
    from tools.system_tools import manage_schedule
    result = manage_schedule("add", event=event.event, time=event.time)
    if "Successfully added" in result:
        await bus.publish("schedule_update", await collect_schedule_data())
        return {"status": "success", "message": result}
    return {"status": "error", "message": result}

@app.get("/api/memory")
async def get_memory():
    from tools.memory_tools import _load_ltm
    try:
        db = _load_ltm()
        return db.get("semantic", []) + db.get("episodic", []) + db.get("procedural", [])
    except Exception:
        return []

@app.delete("/api/memory/{memory_id}")
async def delete_memory(memory_id: str):
    from tools.memory_tools import _load_ltm, _save_ltm
    try:
        db = _load_ltm()
        deleted = False
        for layer in ["semantic", "episodic", "procedural"]:
            initial_len = len(db[layer])
            db[layer] = [mem for mem in db[layer] if mem.get("id") != memory_id]
            if len(db[layer]) < initial_len:
                deleted = True
        if deleted:
            _save_ltm(db)
            return {"status": "success"}
        return {"status": "error", "message": "ID not found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/proactive")
async def get_proactive():
    return load_proactive_config()

class ProactiveConfigUpdate(BaseModel):
    enabled: bool
    thresholds: dict

@app.post("/api/proactive")
async def update_proactive(req: ProactiveConfigUpdate):
    import json
    config = {
        "enabled": req.enabled,
        "cooldown_iterations": 30,
        "thresholds": req.thresholds
    }
    # Containment-checked project path (see _safe_data_path above).
    Path(PROACTIVE_CONFIG_FILE).write_text(json.dumps(config, indent=4), encoding="utf-8")
    return {"status": "success"}


# ──────────────────────────────────────────────────────────────
# Quick Actions UI Config
# ──────────────────────────────────────────────────────────────

# Built-in defaults used when the JSON file is missing or corrupt.
_DEFAULT_QUICK_ACTIONS = [
    {"id": "screen", "label": "Read Screen", "icon": "eye", "prompt": "read my screen and describe what you see", "danger": False},
    {"id": "lock", "label": "Lock", "icon": "lock", "prompt": "lock the system", "danger": True},
    {"id": "web", "label": "Web", "icon": "globe", "prompt": "search the web for the latest news", "danger": False},
    {"id": "scan", "label": "Scan", "icon": "shield", "prompt": "run a basic threat scan on the system", "danger": False},
]

def load_quick_actions():
    """Load quick actions from JSON file; fall back to defaults on error."""
    import json
    import os
    import logging
    try:
        cfg_path = Path(QUICK_ACTIONS_CONFIG_FILE)
        if not cfg_path.exists():
            return _DEFAULT_QUICK_ACTIONS
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            # Basic sanity: keep only valid-looking entries
            valid = []
            for a in data:
                if (isinstance(a, dict) and a.get("id") and a.get("label") and a.get("prompt")):
                    valid.append({
                        "id": str(a["id"]),
                        "label": str(a["label"]),
                        "icon": str(a.get("icon", "bolt")),
                        "prompt": str(a["prompt"]),
                        "danger": bool(a.get("danger", False)),
                    })
            if valid:
                return valid
    except Exception as e:
        logging.warning(f"Failed to load quick_actions.json ({e}); using defaults")
    return _DEFAULT_QUICK_ACTIONS


class QuickActionItem(BaseModel):
    id: str
    label: str
    icon: str
    prompt: str
    danger: bool = False


class QuickActionsUpdate(BaseModel):
    actions: List[QuickActionItem]


@app.get("/api/config/ui")
async def get_ui_config():
    return {"quick_actions": load_quick_actions()}


@app.post("/api/config/ui")
async def update_ui_config(req: QuickActionsUpdate):
    import json
    import logging
    # Validate
    if not req.actions or len(req.actions) > 12:
        return {"status": "error", "message": "Must have 1-12 actions"}
    cleaned = []
    for a in req.actions:
        label = (a.label or "").strip()
        prompt = (a.prompt or "").strip()
        if not label or not prompt:
            return {"status": "error", "message": "Label and prompt are required"}
        # Strip control chars
        label = "".join(ch for ch in label if ch >= " " or ch in "\t\n")
        prompt = "".join(ch for ch in prompt if ch >= " " or ch in "\t\n")
        cleaned.append({
            "id": str(a.id).strip() or str(len(cleaned)),
            "label": label,
            "icon": str(a.icon).strip() or "bolt",
            "prompt": prompt,
            "danger": bool(a.danger),
        })
    # Atomic write via temp file
    cfg_path = Path(QUICK_ACTIONS_CONFIG_FILE)
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cfg_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cleaned, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(cfg_path)
    logging.info(f"Saved {len(cleaned)} quick actions to {cfg_path}")
    return {"status": "success", "actions": cleaned}


def _network_scan_sync():
    import subprocess
    import platform

    if platform.system().lower() != "windows":
        return {"status": "error", "message": "Network scanner is currently only optimized for Windows systems."}

    creationflags = 0x08000000 if os.name == 'nt' else 0
    result = subprocess.check_output(["arp", "-a"], text=True, timeout=3.0, creationflags=creationflags)
    devices = []
    for line in result.split('\n'):
        parts = line.split()
        if len(parts) >= 2 and "." in parts[0] and "-" in parts[1]:
            ip = parts[0]
            mac = parts[1]
            if ip.startswith("192.") or ip.startswith("10.") or ip.startswith("172."):
                devices.append({"ip": ip, "mac": mac, "type": "node"})

    return {"status": "success", "nodes": devices}

@app.get("/api/network/scan")
async def network_scan():
    try:
        return await asyncio.to_thread(_network_scan_sync)
    except Exception as e:
        return {"status": "error", "message": str(e)}

def _processes_payload():
    procs = []
    for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
        try:
            procs.append({
                "pid": p.info['pid'],
                "name": p.info['name'],
                "cpu": p.info['cpu_percent'] or 0.0,
                "mem": p.info['memory_percent'] or 0.0
            })
        except: pass
    procs.sort(key=lambda x: x['cpu'], reverse=True)
    return {"processes": procs[:20]}

async def collect_processes_data():
    # Iterating every process is the heaviest poll on the bus; run it in a worker thread.
    return await asyncio.to_thread(_processes_payload)

@app.get("/api/processes")
async def get_processes():
    return await collect_processes_data()

class ProcessKillRequest(BaseModel):
    pid: int

# Processes that must never be killable through the API, even by accident.
_PROTECTED_PROCESS_NAMES = {
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe",
    "winlogon.exe", "services.exe", "lsass.exe", "svchost.exe",
    "dwm.exe", "explorer.exe", "python.exe",
}

@app.post("/api/processes/kill")
async def kill_process(req: ProcessKillRequest):
    try:
        import psutil
        p = psutil.Process(req.pid)
        name = (p.name() or "").lower()
        if req.pid in (0, 4) or name in _PROTECTED_PROCESS_NAMES:
            return {"status": "error", "message": f"Refusing to terminate protected process '{name or req.pid}'."}
        if name == "ollama.exe" or "ollama" in name:
            return {"status": "error", "message": "Refusing to kill the Ollama runtime from the HUD. Stop it manually if truly needed."}
        p.kill()
        return {"status": "success"}
    except psutil.NoSuchProcess:
        return {"status": "error", "message": "Process not found."}
    except psutil.AccessDenied:
        return {"status": "error", "message": "Access denied (try running AURA as Administrator)."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def _threats_payload():
    try:
        import win32evtlog
        server = 'localhost'
        logtype = 'Security'
        flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
        hand = win32evtlog.OpenEventLog(server, logtype)

        events = win32evtlog.ReadEventLog(hand, flags, 0)
        failed_logins = 0

        if events:
            for event in events[:100]:
                if event.EventID == 4625:
                    failed_logins += 1

        win32evtlog.CloseEventLog(hand)

        if failed_logins > 0:
            return {"status": "ELEVATED", "count": failed_logins, "message": f"{failed_logins} failed logins."}
        else:
            return {"status": "CLEAR", "count": 0, "message": "No anomalies detected."}
    except Exception as e:
        return {"status": "ERROR", "count": 0, "message": f"Log read failed."}

async def collect_threats_data():
    # win32evtlog reads block; keep them off the event loop.
    return await asyncio.to_thread(_threats_payload)

@app.get("/api/threats")
async def get_threats():
    return await collect_threats_data()


# ----------------------------- SSE EVENT BUS -----------------------------

def _fingerprint(data) -> str:
    return hashlib.sha256(_json.dumps(data, sort_keys=True, default=str).encode("utf-8")).hexdigest()

async def _detect_loop(event_type: str, interval: int, collector, refresh_after: int = None, initial_delay: float = 0.0):
    """Poll a shared collector and publish when the payload changes.

    refresh_after (seconds): even an UNCHANGED payload is republished after this
    much silence, so clients can treat a missing channel as a liveness/staleness
    signal rather than "nothing happened".
    """
    if initial_delay > 0:
        await asyncio.sleep(initial_delay)
    last = None
    last_pub = 0.0
    while True:
        try:
            data = await collector()
            fp = _fingerprint(data)
            expired = refresh_after is not None and (time.time() - last_pub) > refresh_after
            if fp != last or last_pub == 0 or expired:
                # The first sample is published too, so a newly connected HUD
                # receives current state within one interval without polling.
                await bus.publish(event_type, data)
                last = fp
                last_pub = time.time()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass  # A failed sweep must never kill the detector.
        await asyncio.sleep(interval)

async def _media_detector():
    """Publish media state only when track/identity changes (not every second
    with the playhead); HUD interpolates progress locally between events."""
    last = None
    while True:
        try:
            data = await get_now_playing()
            fp = _fingerprint({k: data.get(k) for k in
                               ("available", "playing", "title", "artist",
                                "album", "app", "duration_s")})
            if fp != last:
                await bus.publish("media_update", data)
                last = fp
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(3)

async def _notifications_detector():
    """Publishes empty->non-empty transitions WITHOUT consuming the queue.

    pop_notification() is destructive and GET /api/notifications remains the
    single consumer during the frontend migration; this detector only peeks so
    both transports stay consistent. Re-published every ~10s as a liveness tick.
    """
    last_available = None
    last_pub = 0.0
    while True:
        try:
            import notifications as _notifications
            with _notifications._lock:
                available = len(_notifications.pending_notifications) > 0
            if available != last_available or (time.time() - last_pub) > 10:
                await bus.publish("notifications_update", {"available": available})
                last_available = available
                last_pub = time.time()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass
        await asyncio.sleep(3)

@app.get("/api/events")
async def sse_events():
    import os
    # Comment-ping cadence; configurable so deployments behind aggressive
    # proxy idle timeouts can shorten it.
    try:
        heartbeat = float(os.environ.get("AURA_SSE_HEARTBEAT", "15"))
    except ValueError:
        heartbeat = 15.0
    q = bus.subscribe()

    async def stream():
        try:
            hello = {
                "type": "hello",
                "data": {"server": "AURA API", "clients": bus.client_count},
                "ts": time.time()
            }
            yield format_sse(hello)
            last_output = time.time()
            while True:
                # Guarantee at least one write (event or ping) per heartbeat
                # window so proxies/clients can detect a dead link.
                timeout = heartbeat - (time.time() - last_output)
                if timeout <= 0:
                    yield ": ping\n\n"
                    last_output = time.time()
                    continue
                try:
                    event = await asyncio.wait_for(q.get(), timeout=timeout)
                    yield format_sse(event)
                    last_output = time.time()
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    last_output = time.time()
        finally:
            # Runs on client disconnect or generator close: always unsubscribe.
            bus.unsubscribe(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

# --------------------------------------------------------------------------
_security_cache = {"ts": 0.0, "data": None}
_security_cache_lock = threading.Lock()

def _security_payload(force_refresh: bool = False):
    from concurrent.futures import ThreadPoolExecutor
    from tools.security_tools import get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes
    now = time.time()
    if not force_refresh:
        with _security_cache_lock:
            if _security_cache["data"] is not None and (now - _security_cache["ts"]) < 15.0:
                return _security_cache["data"]
    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            f_def = pool.submit(get_windows_defender_status)
            f_fw = pool.submit(get_firewall_status)
            f_ports = pool.submit(get_listening_ports)
            f_files = pool.submit(get_suspicious_files)
            f_procs = pool.submit(analyze_suspicious_processes)
            f_devs = pool.submit(get_removable_devices)
            defender = f_def.result()
            firewall = f_fw.result()
            ports = f_ports.result()
            files = f_files.result()
            processes = f_procs.result()
            devices = f_devs.result()

        # Calculate simplistic risk level based on keywords
        alerts = []
        if "DISABLED" in defender:
            alerts.append("Windows Defender Real-Time Protection is DISABLED.")
        if "WARN:" in processes:
            alerts.append("Suspicious processes detected.")
        if "Suspicious/Recent Executables Found" in files:
            alerts.append("Recent executables found in drop locations.")

        risk_level = "HIGH" if alerts else "LOW"
        if risk_level == "LOW" and ("DISABLED" in firewall or "No active listening ports" not in ports):
            risk_level = "MEDIUM"

        payload = {
            "status": "success",
            "risk_level": risk_level,
            "alerts": alerts,
            "defender": defender,
            "firewall": firewall,
            "ports": ports,
            "files": files,
            "processes": processes,
            "devices": devices
        }
        with _security_cache_lock:
            _security_cache["ts"] = time.time()
            _security_cache["data"] = payload
        return payload
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def collect_security_data():
    # PowerShell-based checks block for hundreds of ms; run off the event loop.
    return await asyncio.to_thread(_security_payload)

@app.get("/api/security")
async def get_security():
    return await collect_security_data()


@app.get("/api/plans/active")
async def get_active_plan():
    import planner_state
    return {"status": "success", "plan": planner_state.get_active_plan()}

@app.get("/api/plans")
async def get_recent_plans():
    import planner_state
    return {"status": "success", "plans": planner_state.list_plans(10)}

@app.post("/api/plans/{plan_id}/cancel")
async def cancel_plan_endpoint(plan_id: str):
    import planner_state
    result = planner_state.cancel_plan(plan_id)
    if result is None:
        return {"status": "error", "message": "Plan not found."}
    return {"status": "success"}

@app.get("/api/media")
async def get_media():
    """Now-playing snapshot. Always 200; degrades to available:false without winsdk."""
    try:
        return await get_now_playing()
    except Exception as e:
        return {"available": False, "reason": str(e), "playing": False,
                "title": None, "artist": None, "album": None, "album_art": None,
                "app": None, "position_s": None, "duration_s": None}

@app.post("/api/media/control")
async def control_media_endpoint(req: Request):
    """Direct transport control (playpause/next/previous) — no LLM in the loop."""
    try:
        data = await req.json()
        action = data.get("action")
        # control_media spells it 'play_pause'; the HUD sends the compact form.
        if action == "playpause":
            action = "play_pause"
        if action not in ("play_pause", "play", "pause", "next", "previous"):
            return {"status": "error", "message": f"Invalid action '{action}'."}
        from tools.system_tools import control_media
        result = control_media(action)
        ok = result.startswith("Successfully")
        return {"status": "success" if ok else "error", "message": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/fs")
async def get_fs(path: str = ""):
    import os, string
    try:
        if not path:
            drives = []
            for d in string.ascii_uppercase:
                if os.path.exists(f"{d}:\\"):
                    drives.append({"name": f"{d}:\\", "path": f"{d}:\\", "is_dir": True})
            return {"status": "success", "items": drives, "current": ""}
        
        if not os.path.isdir(path):
            return {"status": "error", "message": "Not a directory"}
            
        items = []
        for f in os.listdir(path):
            try:
                full = os.path.join(path, f)
                items.append({
                    "name": f,
                    "path": full,
                    "is_dir": os.path.isdir(full)
                })
            except: pass
            
        items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
        return {"status": "success", "items": items, "current": path}
    except Exception as e:
        return {"status": "error", "message": str(e)}

from datetime import datetime

def load_proactive_config():
    import json
    import os
    config_file = Path(PROACTIVE_CONFIG_FILE)
    default_config = {
        "enabled": True,
        "cooldown_iterations": 30,
        "thresholds": {
            "cpu_percent": 90,
            "ram_percent": 90,
            "gpu_temp_c": 85,
            "cpu_temp_c": 90,
            "disk_percent": 90,
            "battery_percent_low": 20
        }
    }
    if not config_file.exists():
        config_file.write_text(json.dumps(default_config, indent=4), encoding="utf-8")
        return default_config
    try:
        return json.loads(config_file.read_text(encoding="utf-8"))
    except Exception:
        return default_config

def get_top_process():
    import psutil
    try:
        procs = [(p.info['name'], p.info['cpu_percent']) for p in psutil.process_iter(['name', 'cpu_percent']) if p.info['cpu_percent']]
        procs.sort(key=lambda x: x[1], reverse=True)
        return procs[0][0] if procs else "unknown process"
    except:
        return "unknown process"

from notifications import pop_notification, push_notification

def run_schedule():
    """Background thread that runs scheduled tasks and proactive telemetry monitoring."""
    briefing_done_today = False
    
    violations = {
        "cpu": 0, "ram": 0, "gpu_temp": 0, "disk": 0, "battery": 0
    }
    
    cooldowns = {
        "cpu": 0, "ram": 0, "gpu_temp": 0, "disk": 0, "battery": 0, "schedule": {}
    }
    
    VIOLATION_LIMIT = 10 # 5 minutes at 30s intervals
    
    import json
    import os
    from datetime import datetime, timedelta
    
    while True:
        now = datetime.now()
        
        if now.hour == 8 and now.minute == 0 and not briefing_done_today:
            print("[SCHEDULER] Triggering morning briefing...")
            with agent_lock:
                response = agent.send_message("Good morning AURA! Please give me my daily morning briefing including the time and a short motivational quote.")
            push_notification(response)
            briefing_done_today = True
            
        if now.hour == 0 and now.minute == 0:
            briefing_done_today = False
            
        config = load_proactive_config()
        if config.get("enabled", True):
            thresh = config.get("thresholds", {})
            cool_max = config.get("cooldown_iterations", 30)
            
            for k in cooldowns:
                if k != "schedule" and cooldowns[k] > 0:
                    cooldowns[k] -= 1
                    
            try:
                # --- CPU ---
                cpu_usage = psutil.cpu_percent(interval=None)
                if cpu_usage > thresh.get("cpu_percent", 90):
                    violations["cpu"] += 1
                else:
                    violations["cpu"] = 0
                    
                if violations["cpu"] >= VIOLATION_LIMIT and cooldowns["cpu"] <= 0:
                    top_proc = get_top_process()
                    push_notification(f"Sir, CPU usage has sustained above {thresh.get('cpu_percent', 90)}% for 5 minutes. Top consuming process is {top_proc}.")
                    cooldowns["cpu"] = cool_max
                    violations["cpu"] = 0

                # --- RAM ---
                mem_usage = psutil.virtual_memory().percent
                if mem_usage > thresh.get("ram_percent", 90):
                    violations["ram"] += 1
                else:
                    violations["ram"] = 0
                    
                if violations["ram"] >= VIOLATION_LIMIT and cooldowns["ram"] <= 0:
                    push_notification(f"Sir, RAM usage has sustained above {thresh.get('ram_percent', 90)}% for 5 minutes.")
                    cooldowns["ram"] = cool_max
                    violations["ram"] = 0
                    
                # --- DISK ---
                disk_usage = psutil.disk_usage('C:\\').percent
                if disk_usage > thresh.get("disk_percent", 90):
                    violations["disk"] += 1
                else:
                    violations["disk"] = 0
                    
                if violations["disk"] >= VIOLATION_LIMIT and cooldowns["disk"] <= 0:
                    push_notification(f"Sir, your C: drive is almost full, sustained above {thresh.get('disk_percent', 90)}% capacity.")
                    cooldowns["disk"] = cool_max
                    violations["disk"] = 0
                    
                # --- BATTERY ---
                battery = psutil.sensors_battery()
                if battery and not battery.power_plugged and battery.percent < thresh.get("battery_percent_low", 20):
                    violations["battery"] += 1
                else:
                    violations["battery"] = 0
                    
                if violations["battery"] >= 2 and cooldowns["battery"] <= 0:
                    push_notification(f"Sir, your battery is running critically low at {battery.percent}%. Please plug in your device.")
                    cooldowns["battery"] = cool_max
                    violations["battery"] = 0
                    
                # --- TEMPS (GPU) ---
                try:
                    import subprocess
                    gpu_result = subprocess.check_output(
                        ["nvidia-smi", "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
                        text=True, stderr=subprocess.DEVNULL
                    )
                    gpu_temp = round(float(gpu_result.strip()))
                    if gpu_temp > thresh.get("gpu_temp_c", 85):
                        violations["gpu_temp"] += 1
                    else:
                        violations["gpu_temp"] = 0
                        
                    if violations["gpu_temp"] >= VIOLATION_LIMIT and cooldowns["gpu_temp"] <= 0:
                        push_notification(f"Sir, GPU temperature has been above {thresh.get('gpu_temp_c', 85)}°C for 5 minutes. Consider checking your cooling.")
                        cooldowns["gpu_temp"] = cool_max
                        violations["gpu_temp"] = 0
                except:
                    pass
                    
            except Exception as e:
                print(f"[ALERTS] Error checking telemetry: {e}")
                
        # 3. Schedule Monitoring
        try:
            schedule_file = "schedule.json"
            if os.path.exists(schedule_file):
                with open(schedule_file, 'r') as f:
                    schedule = json.load(f)
                
                for item in schedule:
                    evt_time_str = item.get("time", "")
                    evt_name = item.get("event", "")
                    evt_id = f"{evt_time_str}_{evt_name}"
                    
                    try:
                        if ":" in evt_time_str and len(evt_time_str) == 5:
                            evt_dt = datetime.strptime(f"{now.date()} {evt_time_str}", "%Y-%m-%d %H:%M")
                        else:
                            evt_dt = datetime.strptime(evt_time_str, "%Y-%m-%d %H:%M")
                            
                        diff = (evt_dt - now).total_seconds()
                        if 0 <= diff <= 300 and evt_id not in cooldowns["schedule"]:
                            push_notification(f"Reminder: Your scheduled task '{evt_name}' is due shortly at {evt_time_str}.")
                            cooldowns["schedule"][evt_id] = True
                    except:
                        pass
        except:
            pass
            
        # 4. Persistent Goal Evaluation
        try:
            from tools.goal_tools import _load_goals, _save_goals
            from config import OLLAMA_MODEL
            import ollama
            
            goals = _load_goals()
            needs_save = False
            
            for g in goals:
                if not g.get("enabled"):
                    continue
                    
                last_run_str = g.get("last_run")
                if last_run_str:
                    try:
                        last_run_dt = datetime.fromisoformat(last_run_str)
                        if (now - last_run_dt).total_seconds() < 300: # 5 minute evaluation cycle
                            continue
                    except:
                        pass
                
                # Check cooldown for notifications
                can_notify = True
                last_notified_str = g.get("last_notified")
                if last_notified_str:
                    try:
                        last_notified_dt = datetime.fromisoformat(last_notified_str)
                        if (now - last_notified_dt).total_seconds() < g.get("cooldown", 3600):
                            can_notify = False
                    except:
                        pass
                
                if not can_notify:
                    continue # Skip evaluation if we're in a notification cooldown to save compute
                    
                g["last_run"] = now.isoformat()
                needs_save = True
                
                print(f"[SCHEDULER] Evaluating Goal: {g['name']}")
                
                # Build context using allowed tools
                tool_context = "Available data from allowed tools:\n"
                import inspect
                from agent import tool_map
                for t_name in g.get("allowed_tools", []):
                    if t_name in tool_map:
                        try:
                            sig = inspect.signature(tool_map[t_name])
                            required = [
                                p.name for p in sig.parameters.values()
                                if p.default is inspect.Parameter.empty
                                and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
                            ]
                            if required:
                                tool_context += f"- {t_name}: Skipped (requires arguments: {', '.join(required)})\n"
                                continue
                            res = str(tool_map[t_name]())
                            tool_context += f"- {t_name}: {res[:500]}\n"
                        except Exception as e:
                            tool_context += f"- {t_name}: Error {e}\n"
                            
                prompt = f"""Goal: {g['name']}
Description: {g['description']}
Conditions: {g['monitoring_conditions']}
Rules: {g['notification_rules']}

{tool_context}

Based on the tool data, evaluate this goal.
If the goal is violated and requires a notification, output the exact message for the user.
If NO notification is needed, output EXACTLY "ALL_GOOD".
DO NOT perform any destructive actions."""
                
                try:
                    res = ollama.chat(
                        model=OLLAMA_MODEL,
                        messages=[{'role': 'user', 'content': prompt}]
                    )
                    out = res['message']['content'].strip()
                    if out and "ALL_GOOD" not in out:
                        push_notification(out)
                        g["last_notified"] = now.isoformat()
                except Exception as e:
                    print(f"Goal evaluation error: {e}")
                    
            if needs_save:
                _save_goals(goals)
        except Exception as e:
            print(f"Goal system error in schedule: {e}")
            
        time.sleep(30)

# Start background scheduler
scheduler_thread = threading.Thread(target=run_schedule, daemon=True)
scheduler_thread.start()

# Mount static files to serve the frontend
import os
os.makedirs("static", exist_ok=True)

# Landing page at root and /welcome, HUD at /hud
@app.get("/", include_in_schema=False)
async def serve_landing():
    return FileResponse("static/welcome.html")

@app.get("/welcome", include_in_schema=False)
async def serve_welcome():
    return FileResponse("static/welcome.html")

@app.get("/hud", include_in_schema=False)
async def serve_hud():
    return FileResponse("static/hud.html")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Loopback bind only: the API can browse the filesystem, kill processes
    # and control the machine. It must never be reachable from the LAN.
    # reload=False: the reloader re-imports this module in a second process,
    # which would duplicate the agent, wake-word listener and scheduler.
    print("Starting AURA Web Server on http://127.0.0.1:8000")
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=False)
