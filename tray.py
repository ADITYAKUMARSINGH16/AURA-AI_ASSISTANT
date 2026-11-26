import pystray
from PIL import Image, ImageDraw
import subprocess
import os
import socket
import sys
import threading
import time
import urllib.request
import urllib.error
import webbrowser
from datetime import datetime

HOST = "127.0.0.1"
PORT = 8000
BASE_URL = f"http://{HOST}:{PORT}"

def create_image():
    # Generate an icon if logo_small.png is missing
    image = Image.new('RGB', (64, 64), color=(0, 0, 0))
    dc = ImageDraw.Draw(image)
    dc.rectangle((16, 16, 48, 48), fill=(0, 240, 255))
    dc.rectangle((24, 24, 40, 40), fill=(0, 0, 0))
    return image

def _is_port_in_use(host=HOST, port=PORT):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0

if _is_port_in_use():
    print(f"[WARN] Port {PORT} on {HOST} is already in use by an existing process.", flush=True)
    print("       Quit any older AURA tray/uvicorn instance if changes do not appear.", flush=True)

# Start the backend server with output captured to a file — DEVNULL made
# silent startup failures (port conflicts, model load errors) undiagnosable.
_backend_log = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "aura_backend_console.log"), "ab", buffering=0)
_backend_log.write(f"\n=== AURA backend launched {datetime.now():%Y-%m-%d %H:%M:%S} ===\n".encode())
backend_process = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "api:app", "--host", HOST, "--port", str(PORT)],
    stdout=_backend_log,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
)

def _probe_url(url, timeout=1.5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False

def wait_and_report_startup(proc, base_url=BASE_URL, timeout_sec=45.0):
    print(f"Checking AURA backend & frontend on {base_url} ...", flush=True)
    deadline = time.monotonic() + timeout_sec
    backend_ok = False
    landing_ok = False
    hud_ok = False

    while time.monotonic() < deadline:
        if proc.poll() is not None:
            break
        backend_ok = _probe_url(f"{base_url}/api/health")
        if backend_ok:
            landing_ok = _probe_url(f"{base_url}/")
            hud_ok = _probe_url(f"{base_url}/hud")
            if landing_ok and hud_ok:
                break
        time.sleep(0.5)

    print("", flush=True)
    if backend_ok and landing_ok and hud_ok:
        print("----------------------------------------------", flush=True)
        print(f"[OK] Backend API  : STARTED -> {base_url}/api/health", flush=True)
        print(f"[OK] Frontend UI  : STARTED -> {base_url}/", flush=True)
        print(f"[OK] Tactical HUD : STARTED -> {base_url}/hud", flush=True)
        print("----------------------------------------------", flush=True)
    else:
        exit_code = proc.poll()
        status_note = f"exited with code {exit_code}" if exit_code is not None else f"timed out after {int(timeout_sec)}s"
        print("----------------------------------------------", flush=True)
        print(f"[FAIL] Backend API  : {'STARTED' if backend_ok else 'NOT STARTED'} ({base_url}/api/health)", flush=True)
        print(f"[FAIL] Frontend UI  : {'STARTED' if landing_ok else 'NOT STARTED'} ({base_url}/)", flush=True)
        print(f"[FAIL] Tactical HUD : {'STARTED' if hud_ok else 'NOT STARTED'} ({base_url}/hud)", flush=True)
        print(f"Reason: server {status_note}. Check aura_backend_console.log", flush=True)
        print("----------------------------------------------", flush=True)

def on_open_hud(icon, item):
    webbrowser.open("http://127.0.0.1:8000/hud")

def on_open_landing(icon, item):
    webbrowser.open("http://127.0.0.1:8000/")

def on_quit(icon, item):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(backend_process.pid)], capture_output=True)
    else:
        backend_process.terminate()
    icon.stop()

# Load logo or generate one
try:
    icon_img = Image.open(os.path.join("static", "logo_small.png"))
except:
    icon_img = create_image()

icon = pystray.Icon("AURA", icon_img, "AURA Assistant", menu=pystray.Menu(
    pystray.MenuItem("Open HUD", on_open_hud, default=True),
    pystray.MenuItem("Open Landing Page", on_open_landing),
    pystray.MenuItem("Quit", on_quit)
))

if __name__ == "__main__":
    print("AURA Daemon running in system tray...", flush=True)
    threading.Thread(
        target=wait_and_report_startup,
        args=(backend_process,),
        daemon=True,
    ).start()
    icon.run()
