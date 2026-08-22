import pystray
from PIL import Image, ImageDraw
import subprocess
import os
import sys
import webbrowser

def create_image():
    # Generate an icon if logo.jpg is missing
    image = Image.new('RGB', (64, 64), color=(0, 0, 0))
    dc = ImageDraw.Draw(image)
    dc.rectangle((16, 16, 48, 48), fill=(0, 240, 255))
    dc.rectangle((24, 24, 40, 40), fill=(0, 0, 0))
    return image

# Start the backend server invisibly
backend_process = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "api:app", "--host", "127.0.0.1", "--port", "8000"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
)

def on_open_hud(icon, item):
    webbrowser.open("http://127.0.0.1:8000/hud.html")

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
    icon_img = Image.open(os.path.join("static", "logo.jpg"))
except:
    icon_img = create_image()

icon = pystray.Icon("AURA", icon_img, "AURA Assistant", menu=pystray.Menu(
    pystray.MenuItem("Open HUD", on_open_hud, default=True),
    pystray.MenuItem("Open Landing Page", on_open_landing),
    pystray.MenuItem("Quit", on_quit)
))

if __name__ == "__main__":
    print("AURA Daemon running in system tray...")
    icon.run()
