from fastapi import FastAPI, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
import warnings

# Suppress standard warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

import psutil
import random

from agent import create_agent
from voice import speak, listen, generate_tts_file, start_wakeword_listener

app = FastAPI(title="AURA API")

import threading

# Initialize global agent
agent = create_agent()
agent_lock = threading.Lock()

pending_notifications = []

def wake_word_callback():
    pending_notifications.append("__WAKE_WORD__")

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

@app.get("/api/logs")
async def get_logs():
    import os
    log_file = "aura_agent.log"
    if not os.path.exists(log_file):
        return {"status": "error", "message": "Log file not found."}
    try:
        with open(log_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        # Return last 50 lines
        return {"status": "success", "lines": lines[-50:]}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/telemetry")
async def get_telemetry():
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory().percent
    
    battery = psutil.sensors_battery()
    power = battery.percent if battery else 100
    
    # Get real Wi-Fi signal strength for Uplink
    uplink = 0
    try:
        import subprocess
        import re
        result = subprocess.check_output("netsh wlan show interfaces", shell=True, text=True, stderr=subprocess.DEVNULL)
        match = re.search(r"Signal\s*:\s*(\d+)%", result)
        if match:
            uplink = int(match.group(1))
    except Exception:
        pass
    
    # Fallback to a random value if ethernet/no wifi
    if uplink == 0:
        uplink = random.randint(85, 100)
        
    # --- HARDWARE THERMALS ---
    # CPU Temp: Attempt to read real sensors via WMI (Requires Admin)
    cpu_temp = None
    try:
        import wmi
        w = wmi.WMI(namespace="root\\wmi")
        temperature_info = w.MSAcpi_ThermalZoneTemperature()
        if temperature_info:
            cpu_temp = int((temperature_info[0].CurrentTemperature / 10.0) - 273.15)
    except Exception:
        pass
        
    # Fallback to simulated if WMI fails (e.g., standard user permissions)
    if cpu_temp is None:
        cpu_temp = int(45 + (cpu * 0.40))  # Base 45C + up to 40C under full load
        
    # CPU Fan: Win32_Fan is rarely populated on Windows laptops, fallback to load-based simulation
    cpu_fan = int(2000 + (cpu * 35))   # Base 2000 RPM + up to 3500 extra under full load
    
    # GPU: Real data via nvidia-smi
    gpu_temp = 0
    gpu_mem = "0 / 0 MB"
    gpu_fan = "N/A"
    try:
        gpu_result = subprocess.check_output(
            "nvidia-smi --query-gpu=temperature.gpu,memory.used,memory.total,fan.speed --format=csv,noheader,nounits",
            shell=True, text=True, stderr=subprocess.DEVNULL
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
        gpu_temp = 40
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
        "latency": f"{random.randint(8, 28)}ms",
        "nodes": random.randint(35, 65),
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
            "telemetry": agent.ai_telemetry if 'agent' in globals() else {}
        }
    }

@app.post("/api/chat")
async def chat(req: ChatRequest, background_tasks: BackgroundTasks):
    # Send message and get response
    with agent_lock:
        response_text = agent.send_message(req.message, images=req.images, file_texts=req.file_texts)
    
    # We no longer speak locally via background_tasks if use_voice_output is true.
    # The frontend will hit /api/tts to fetch the audio and play it.
        
    return {"status": "success", "response": response_text}

@app.get("/api/permissions/pending")
async def get_pending_permissions():
    from permissions import get_pending_actions, TRUSTED_AUTOMATION_ENABLED
    return {
        "status": "success",
        "pending": get_pending_actions(),
        "trusted_automation": TRUSTED_AUTOMATION_ENABLED
    }

@app.post("/api/permissions/confirm/{action_id}")
async def confirm_permission(action_id: str):
    from permissions import confirm_pending_action
    result = confirm_pending_action(action_id)
    return {"status": "success", "message": result}

@app.post("/api/permissions/reject/{action_id}")
async def reject_permission(action_id: str):
    from permissions import reject_pending_action
    result = reject_pending_action(action_id)
    return {"status": "success", "message": result}

@app.post("/api/permissions/trusted_mode")
async def set_trusted_mode(req: Request):
    data = await req.json()
    enabled = data.get("enabled", False)
    from permissions import toggle_trusted_automation
    toggle_trusted_automation(enabled)
    return {"status": "success", "enabled": enabled}

@app.get("/api/tts")
async def tts(text: str):
    import os
    if not text:
        return {"error": "No text provided"}
    
    # Generate the TTS file
    filepath = generate_tts_file(text)
    
    if os.path.exists(filepath):
        return FileResponse(filepath, media_type="audio/mpeg")
    return {"error": "Failed to generate TTS"}

@app.post("/api/voice/listen")
async def voice_listen(background_tasks: BackgroundTasks):
    # Listen locally
    text = listen()
    
    if not text or text == "SWITCH_TO_TEXT_MODE":
        return {"status": "error", "message": "Voice input failed or no speech detected."}
    
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
    return {"status": "success"}


@app.post("/api/voice/wake_and_listen")
async def wake_and_listen(background_tasks: BackgroundTasks):
    # Greet the user first (this call is synchronous and will block until done)
    speak("I am listening.")
    
    # Listen locally
    text = listen()
    
    if not text or text == "SWITCH_TO_TEXT_MODE":
        return {"status": "error", "message": "Voice input failed or no speech detected."}
    
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
    global pending_notifications
    if pending_notifications:
        # Pop the oldest notification
        msg = pending_notifications.pop(0)
        return {"has_notification": True, "message": msg}
    return {"has_notification": False}

class ScheduleEvent(BaseModel):
    time: str
    event: str

@app.get("/api/schedule")
async def get_schedule():
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

@app.post("/api/schedule")
async def add_schedule(event: ScheduleEvent):
    from tools.system_tools import manage_schedule
    result = manage_schedule("add", event=event.event, time=event.time)
    if "Successfully added" in result:
        return {"status": "success", "message": result}
    return {"status": "error", "message": result}

@app.get("/api/memory")
async def get_memory():
    import json
    import os
    ltm_file = "long_term_memory.json"
    if not os.path.exists(ltm_file):
        return []
    try:
        with open(ltm_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

@app.delete("/api/memory/{memory_id}")
async def delete_memory(memory_id: str):
    import json
    import os
    ltm_file = "long_term_memory.json"
    if not os.path.exists(ltm_file):
        return {"status": "error", "message": "Memory file not found"}
    try:
        with open(ltm_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        initial_len = len(data)
        data = [mem for mem in data if mem.get("id") != memory_id]
        
        if len(data) < initial_len:
            with open(ltm_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
            return {"status": "success"}
        return {"status": "error", "message": "ID not found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/proactive")
async def get_proactive():
    from api import load_proactive_config
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
    with open("proactive_config.json", 'w') as f:
        json.dump(config, f, indent=4)
    return {"status": "success"}


@app.get("/api/network/scan")
async def network_scan():
    try:
        import subprocess
        import platform
        
        if platform.system().lower() != "windows":
            return {"status": "error", "message": "Network scanner is currently only optimized for Windows systems."}
            
        result = subprocess.check_output("arp -a", shell=True, text=True)
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

@app.get("/api/processes")
async def get_processes():
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

class ProcessKillRequest(BaseModel):
    pid: int

@app.post("/api/processes/kill")
async def kill_process(req: ProcessKillRequest):
    try:
        import psutil
        p = psutil.Process(req.pid)
        p.kill()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/threats")
async def get_threats():
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
@app.get("/api/security")
async def get_security():
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

import time
from datetime import datetime

def load_proactive_config():
    import json
    import os
    config_file = "proactive_config.json"
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
    if not os.path.exists(config_file):
        with open(config_file, 'w') as f:
            json.dump(default_config, f, indent=4)
        return default_config
    try:
        with open(config_file, 'r') as f:
            return json.load(f)
    except:
        return default_config

def get_top_process():
    import psutil
    try:
        procs = [(p.info['name'], p.info['cpu_percent']) for p in psutil.process_iter(['name', 'cpu_percent']) if p.info['cpu_percent']]
        procs.sort(key=lambda x: x[1], reverse=True)
        return procs[0][0] if procs else "unknown process"
    except:
        return "unknown process"

def run_schedule():
    """Background thread that runs scheduled tasks and proactive telemetry monitoring."""
    global pending_notifications
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
            pending_notifications.append(response)
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
                    pending_notifications.append(f"Sir, CPU usage has sustained above {thresh.get('cpu_percent', 90)}% for 5 minutes. Top consuming process is {top_proc}.")
                    cooldowns["cpu"] = cool_max
                    violations["cpu"] = 0

                # --- RAM ---
                mem_usage = psutil.virtual_memory().percent
                if mem_usage > thresh.get("ram_percent", 90):
                    violations["ram"] += 1
                else:
                    violations["ram"] = 0
                    
                if violations["ram"] >= VIOLATION_LIMIT and cooldowns["ram"] <= 0:
                    pending_notifications.append(f"Sir, RAM usage has sustained above {thresh.get('ram_percent', 90)}% for 5 minutes.")
                    cooldowns["ram"] = cool_max
                    violations["ram"] = 0
                    
                # --- DISK ---
                disk_usage = psutil.disk_usage('C:\\').percent
                if disk_usage > thresh.get("disk_percent", 90):
                    violations["disk"] += 1
                else:
                    violations["disk"] = 0
                    
                if violations["disk"] >= VIOLATION_LIMIT and cooldowns["disk"] <= 0:
                    pending_notifications.append(f"Sir, your C: drive is almost full, sustained above {thresh.get('disk_percent', 90)}% capacity.")
                    cooldowns["disk"] = cool_max
                    violations["disk"] = 0
                    
                # --- BATTERY ---
                battery = psutil.sensors_battery()
                if battery and not battery.power_plugged and battery.percent < thresh.get("battery_percent_low", 20):
                    violations["battery"] += 1
                else:
                    violations["battery"] = 0
                    
                if violations["battery"] >= 2 and cooldowns["battery"] <= 0:
                    pending_notifications.append(f"Sir, your battery is running critically low at {battery.percent}%. Please plug in your device.")
                    cooldowns["battery"] = cool_max
                    violations["battery"] = 0
                    
                # --- TEMPS (GPU) ---
                try:
                    import subprocess
                    gpu_result = subprocess.check_output(
                        "nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits",
                        shell=True, text=True, stderr=subprocess.DEVNULL
                    )
                    gpu_temp = int(gpu_result.strip())
                    if gpu_temp > thresh.get("gpu_temp_c", 85):
                        violations["gpu_temp"] += 1
                    else:
                        violations["gpu_temp"] = 0
                        
                    if violations["gpu_temp"] >= VIOLATION_LIMIT and cooldowns["gpu_temp"] <= 0:
                        pending_notifications.append(f"Sir, GPU temperature has been above {thresh.get('gpu_temp_c', 85)}°C for 5 minutes. Consider checking your cooling.")
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
                            pending_notifications.append(f"Reminder: Your scheduled task '{evt_name}' is due shortly at {evt_time_str}.")
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
                from agent import tool_map
                for t_name in g.get("allowed_tools", []):
                    if t_name in tool_map:
                        try:
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
                        pending_notifications.append(out)
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
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("Starting AURA Web Server on http://localhost:8000")
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
