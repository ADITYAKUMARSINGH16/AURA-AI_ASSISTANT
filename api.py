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
        asyncio.create_task(_detect_loop("telemetry", 3, collect_telemetry_data, refresh_after=10)),
        asyncio.create_task(_detect_loop("threats_update", 10, collect_threats_data, refresh_after=30)),
        asyncio.create_task(_detect_loop("permissions_update", 3, collect_permissions_data, refresh_after=10)),
        asyncio.create_task(_notifications_detector()),
        asyncio.create_task(_detect_loop("logs_append", 10, collect_logs_data, refresh_after=30)),
        asyncio.create_task(_detect_loop("schedule_update", 30, collect_schedule_data, refresh_after=90)),
        asyncio.create_task(_detect_loop("processes_update", 5, collect_processes_data, refresh_after=15)),
        asyncio.create_task(_detect_loop("security_update", 30, collect_security_data, refresh_after=90)),
        asyncio.create_task(_media_detector()),
    ]
    yield
    for task in detectors:
        task.cancel()


app = FastAPI(title="AURA API", lifespan=lifespan)

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

def _telemetry_payload():
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory().percent
    
    battery = psutil.sensors_battery()
    power = battery.percent if battery else 100
    
    # Get real Wi-Fi signal strength for Uplink
    uplink = 0
    try:
        import subprocess
        import re
        result = subprocess.check_output(["netsh", "wlan", "show", "interfaces"], text=True, stderr=subprocess.DEVNULL)
        match = re.search(r"Signal\s*:\s*(\d+)%", result)
        if match:
            uplink = int(match.group(1))
    except Exception:
        pass
        
    # --- HARDWARE THERMALS ---
    # CPU Temp: Attempt to read real sensors via WMI (Requires Admin).
    # No simulation: report null when real sensors are unavailable.
    cpu_temp = None
    try:
        import wmi
        w = wmi.WMI(namespace="root\\wmi")
        temperature_info = w.MSAcpi_ThermalZoneTemperature()
        if temperature_info:
            cpu_temp = int((temperature_info[0].CurrentTemperature / 10.0) - 273.15)
    except Exception:
        pass
        
    # Win32_Fan is rarely populated on Windows; report null rather than a simulated RPM
    cpu_fan = None
    
    # GPU: Real data via nvidia-smi
    gpu_temp = 0
    gpu_mem = "0 / 0 MB"
    gpu_fan = "N/A"
    try:
        gpu_result = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=temperature.gpu,memory.used,memory.total,fan.speed", "--format=csv,noheader,nounits"],
            text=True, stderr=subprocess.DEVNULL
        )
        parts = [p.strip() for p in gpu_result.split(',')]
        if len(parts) >= 4:
            gpu_temp = int(parts[0])
            gpu_mem = f"{parts[1]} / {parts[2]} MB"
            gpu_fan = parts[3]
            if gpu_fan.lower() != "[not supported]" and gpu_fan.lower() != "[n/a]" and gpu_fan.lower() != "n/a":
                gpu_fan = f"{gpu_fan} %"
            else:
                gpu_fan = "AUTO"
    except Exception:
        gpu_temp = None
        gpu_mem = "N/A"
        gpu_fan = "N/A"
    
    try:
        from config import OLLAMA_MODEL
    except ImportError:
        OLLAMA_MODEL = "UNKNOWN"
        
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
        "ai": {
            "model": OLLAMA_MODEL.upper().split(':')[0],
            "vram": vram_gb,
            "telemetry": agent.ai_telemetry
        }
    }

async def collect_telemetry_data():
    # netsh/WMI/nvidia-smi block for tens of ms; keep them off the event loop
    # so the SSE bus and other requests stay responsive.
    return await asyncio.to_thread(_telemetry_payload)

@app.get("/api/telemetry")
async def get_telemetry():
    return await collect_telemetry_data()

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

@app.get("/api/tts")
def tts(text: str):
    import os
    if not text:
        return Response(status_code=204)
    if len(text) > 2000:
        # Bound synthesis time and temp-file size; spoken replies don't need
        # unbounded input from a query parameter.
        text = text[:2000]
    
    try:
        # Generate the TTS file (blocking, so this endpoint runs in a threadpool)
        filepath = generate_tts_file(text)
        if filepath and os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            media_type = "audio/mpeg" if filepath.lower().endswith(".mp3") else "audio/wav"
            return FileResponse(filepath, media_type=media_type)
    except Exception as e:
        logging.error(f"TTS endpoint error: {e}")

    return Response(status_code=204)

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
        models = result.get("models", []) if isinstance(result, dict) else []
        # Pick the configured model or first available
        from config import OLLAMA_MODEL
        model_name = OLLAMA_MODEL
        if models and not any(m.get("name") == model_name for m in models):
            model_name = models[0].get("name", model_name)

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


@app.get("/api/network/scan")
async def network_scan():
    try:
        import subprocess
        import platform
        
        if platform.system().lower() != "windows":
            return {"status": "error", "message": "Network scanner is currently only optimized for Windows systems."}
            
        result = subprocess.check_output(["arp", "-a"], text=True)
        lines = result.split('\n')
        devices = []
        for line in lines:
            parts = line.split()
            if len(parts) >= 2 and "." in parts[0] and "-" in parts[1]:
                ip = parts[0]
                mac = parts[1]
                if ip.startswith("192.") or ip.startswith("10.") or ip.startswith("172."):
                    devices.append({"ip": ip, "mac": mac, "type": "node"})
                    
        return {"status": "success", "nodes": devices}
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

async def _detect_loop(event_type: str, interval: int, collector, refresh_after: int = None):
    """Poll a shared collector and publish when the payload changes.

    refresh_after (seconds): even an UNCHANGED payload is republished after this
    much silence, so clients can treat a missing channel as a liveness/staleness
    signal rather than "nothing happened".
    """
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
def _security_payload():
    from tools.security_tools import get_windows_defender_status, get_firewall_status, get_listening_ports, get_suspicious_files, get_removable_devices, analyze_suspicious_processes
    try:
        defender = get_windows_defender_status()
        firewall = get_firewall_status()
        ports = get_listening_ports()
        files = get_suspicious_files()
        processes = analyze_suspicious_processes()
        devices = get_removable_devices()

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

        return {
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
                    gpu_temp = int(gpu_result.strip())
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
