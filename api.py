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

class ChatRequest(BaseModel):
    message: str
    use_voice_output: bool = True

@app.get("/api/history")
async def get_history():
    # Filter out system and tool messages for the frontend
    history = [msg for msg in agent.messages if msg.get("role") in ("user", "assistant")]
    return history  # Return as a plain JSON array

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
        "gpu_fan": gpu_fan
    }

@app.post("/api/chat")
async def chat(req: ChatRequest, background_tasks: BackgroundTasks):
    # Send message and get response
    with agent_lock:
        response_text = agent.send_message(req.message)
    
    # We no longer speak locally via background_tasks if use_voice_output is true.
    # The frontend will hit /api/tts to fetch the audio and play it.
        
    return {"response": response_text}

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
    
    return {
        "status": "success",
        "transcription": text,
        "response": response_text
    }

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
    
    return {
        "status": "success",
        "transcription": text,
        "response": response_text
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
        return {}
    try:
        with open(ltm_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

@app.delete("/api/memory/{key}")
async def delete_memory(key: str):
    import json
    import os
    ltm_file = "long_term_memory.json"
    if not os.path.exists(ltm_file):
        return {"status": "error", "message": "Memory file not found"}
    try:
        with open(ltm_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if key in data:
            del data[key]
            with open(ltm_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
            return {"status": "success"}
        return {"status": "error", "message": "Key not found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

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

def run_schedule():
    """Background thread that runs scheduled tasks like the morning briefing."""
    global pending_notifications
    briefing_done_today = False
    cpu_alert_cooldown = 0
    mem_alert_cooldown = 0
    
    while True:
        now = datetime.now()
        # Trigger daily briefing at 8:00 AM
        if now.hour == 8 and now.minute == 0 and not briefing_done_today:
            print("[SCHEDULER] Triggering morning briefing...")
            with agent_lock:
                response = agent.send_message("Good morning AURA! Please give me my daily morning briefing including the time and a short motivational quote.")
            pending_notifications.append(response)
            briefing_done_today = True
            
        # Reset the flag at midnight (00:00)
        # Note: If trigger was also 00:00, this would immediately reset it and cause an infinite loop.
        # Since trigger is 08:00, this is safe.
        if now.hour == 0 and now.minute == 0:
            briefing_done_today = False
            
        # PROACTIVE SYSTEM ALERTS
        try:
            cpu_usage = psutil.cpu_percent(interval=None)
            mem_usage = psutil.virtual_memory().percent
            
            if cpu_usage > 90 and cpu_alert_cooldown <= 0:
                print(f"[ALERTS] High CPU detected: {cpu_usage}%")
                pending_notifications.append(f"Sir, CPU usage is critically high at {cpu_usage} percent.")
                cpu_alert_cooldown = 10  # Wait 10 iterations (5 mins) before alerting again
                
            if mem_usage > 90 and mem_alert_cooldown <= 0:
                print(f"[ALERTS] High RAM detected: {mem_usage}%")
                pending_notifications.append(f"Sir, Memory usage is critically high at {mem_usage} percent.")
                mem_alert_cooldown = 10
                
            if cpu_alert_cooldown > 0:
                cpu_alert_cooldown -= 1
            if mem_alert_cooldown > 0:
                mem_alert_cooldown -= 1
        except Exception as e:
            print(f"[ALERTS] Error checking telemetry: {e}")
            
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
