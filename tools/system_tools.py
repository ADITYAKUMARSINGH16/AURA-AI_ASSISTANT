import datetime
import psutil

def get_system_time() -> str:
    """Returns the current system time in a readable format."""
    now = datetime.datetime.now()
    return now.strftime("%Y-%m-%d %H:%M:%S")

def get_system_info() -> str:
    """Returns basic system information including CPU usage and memory."""
    cpu_usage = psutil.cpu_percent(interval=0.1)
    memory = psutil.virtual_memory()
    mem_total = memory.total / (1024 ** 3)
    mem_used = memory.used / (1024 ** 3)
    
    return f"CPU Usage: {cpu_usage}%. Memory: {mem_used:.2f}GB / {mem_total:.2f}GB ({memory.percent}% used)."

def read_clipboard() -> str:
    """Reads the current text from the system clipboard."""
    try:
        import pyperclip
        text = pyperclip.paste()
        if not text:
            return "Clipboard is empty."
        return text
    except ImportError:
        return "Error: pyperclip module is not installed."
    except Exception as e:
        return f"Error reading clipboard: {str(e)}"

def control_media(action: str) -> str:
    """Controls system media. Valid actions: 'volume_up', 'volume_down', 'mute', 'play_pause', 'next', 'previous'."""
    try:
        import pyautogui
        action = action.lower()
        if action == 'volume_up':
            pyautogui.press('volumeup')
        elif action == 'volume_down':
            pyautogui.press('volumedown')
        elif action == 'mute':
            pyautogui.press('volumemute')
        elif action in ['play_pause', 'play', 'pause']:
            pyautogui.press('playpause')
        elif action == 'next':
            pyautogui.press('nexttrack')
        elif action == 'previous':
            pyautogui.press('prevtrack')
        else:
            return f"Invalid action '{action}'. Use volume_up, volume_down, mute, play_pause, next, or previous."
        return f"Successfully executed media action: {action}"
    except ImportError:
        return "Error: pyautogui module is not installed."
    except Exception as e:
        return f"Error controlling media: {str(e)}"

def control_system_power(action: str) -> str:
    """Controls system power. Valid actions: 'lock', 'sleep', 'shutdown', 'restart'."""
    try:
        import os
        import platform
        
        action = action.lower()
        system = platform.system()
        
        if system == "Windows":
            if action == 'lock':
                os.system("rundll32.exe user32.dll,LockWorkStation")
            elif action == 'sleep':
                os.system("rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
            elif action == 'shutdown':
                os.system("shutdown /s /t 1")
            elif action == 'restart':
                os.system("shutdown /r /t 1")
            else:
                return f"Invalid action '{action}'."
            return f"Executed power action: {action}"
        else:
            return "Power control is currently only supported on Windows."
    except Exception as e:
        return f"Error executing power control: {str(e)}"

def read_screen(prompt: str = "Describe what is on this screen in detail, including any text, UI elements, or applications you see.") -> str:
    """Takes a screenshot of the current screen and analyzes it using a local vision model. You can specify a prompt to ask specific questions about the screen."""
    try:
        from PIL import ImageGrab
        import os
        import io
        import base64
        import ollama
        from config import OLLAMA_MODEL
        
        # Grab screenshot
        screenshot = ImageGrab.grab()
        
        # Save original screenshot for HUD
        capture_dir = os.path.join("static", "captures")
        if not os.path.exists(capture_dir):
            os.makedirs(capture_dir)
        screenshot.save(os.path.join(capture_dir, "last_screen.png"))
        
        # Optimize image for the vision model (convert to RGB, resize, JPEG)
        img_opt = screenshot.convert("RGB")
        img_opt.thumbnail((1280, 1280))
        
        img_byte_arr = io.BytesIO()
        img_opt.save(img_byte_arr, format='JPEG', quality=85)
        img_bytes = img_byte_arr.getvalue()
        
        # Base64 encode the image
        b64_str = base64.b64encode(img_bytes).decode('utf-8')
        
        # Analyze with internal vision pipeline
        from vision import analyze_vision_payload
        return analyze_vision_payload(b64_str, user_prompt=prompt)
        
    except ImportError as e:
        return f"Missing dependency for screen reading: {str(e)}. Make sure Pillow and ollama are installed."
    except Exception as e:
        return f"Error reading screen with vision model: {str(e)}"

def run_threat_scan() -> str:
    """Runs a basic security threat scan on the system by checking top resource consuming processes."""
    try:
        import psutil
        threats = []
        # Check for processes using excessive CPU or Memory (mocking a threat heuristics scan)
        for proc in psutil.process_iter(['name', 'cpu_percent', 'memory_percent']):
            try:
                info = proc.info
                if info['cpu_percent'] and info['cpu_percent'] > 50.0:
                    threats.append(f"High CPU Usage Anomaly: {info['name']} ({info['cpu_percent']}%)")
                if info['memory_percent'] and info['memory_percent'] > 50.0:
                    threats.append(f"High Memory Usage Anomaly: {info['name']} ({info['memory_percent']:.1f}%)")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        
        if not threats:
            return "Threat Scan Complete. System is secure. 0 Anomalies detected."
        else:
            return "Threat Scan Complete. Anomalies found:\n" + "\n".join(threats)
    except Exception as e:
        return f"Error running threat scan: {str(e)}"

def manage_schedule(action: str, event: str = None, time: str = None) -> str:
    """Manages a local schedule/calendar. action can be 'read', 'add', or 'clear'."""
    import json
    import os
    schedule_file = "schedule.json"
    
    try:
        if not os.path.exists(schedule_file):
            with open(schedule_file, 'w') as f:
                json.dump([], f)
                
        with open(schedule_file, 'r') as f:
            schedule = json.load(f)
            
        action = action.lower()
        if action == "add":
            if not event or not time:
                return "Error: Must provide both 'event' and 'time' to add to schedule."
            schedule.append({"time": time, "event": event})
            with open(schedule_file, 'w') as f:
                json.dump(schedule, f, indent=4)
            return f"Successfully added '{event}' at {time} to your schedule."
            
        elif action == "clear":
            with open(schedule_file, 'w') as f:
                json.dump([], f)
            return "Schedule has been completely cleared."
            
        elif action == "read" or action == "list":
            if not schedule:
                return "Your schedule is currently empty."
            res = "Your upcoming schedule:\n"
            for item in schedule:
                res += f"- [{item['time']}] {item['event']}\n"
            return res
            
        else:
            return f"Invalid schedule action: '{action}'. Use 'add', 'read', or 'clear'."
    except Exception as e:
        return f"Error managing schedule: {str(e)}"

def scan_home_network() -> str:
    """Scans the local network (Home Grid) for active devices using the ARP cache."""
    try:
        import subprocess
        import platform
        
        if platform.system().lower() != "windows":
            return "Network scanner is currently only optimized for Windows systems."
            
        # Run ARP -a to get local network devices
        result = subprocess.check_output("arp -a", shell=True, text=True)
        
        # Parse output for clean response
        lines = result.split('\n')
        devices = []
        for line in lines:
            parts = line.split()
            if len(parts) >= 2 and "." in parts[0] and "-" in parts[1]:
                ip = parts[0]
                mac = parts[1]
                if ip.startswith("192.") or ip.startswith("10.") or ip.startswith("172."):
                    devices.append(f"Node [IP: {ip}] [MAC: {mac}]")
        
        if not devices:
            return "Home Grid Scan complete. No active nodes found."
            
        # Limit to 10 for brevity in voice readout
        summary = f"Home Grid Scan complete. Found {len(devices)} active nodes.\n"
        summary += "\n".join(devices[:10])
        if len(devices) > 10:
            summary += f"\n...and {len(devices) - 10} more."
            
        return summary
    except Exception as e:
        return f"Error scanning home network: {str(e)}"

def sync_archive() -> str:
    """Creates a secure backup snapshot of the system's active memory and configuration."""
    try:
        import os
        import shutil
        from datetime import datetime
        
        backup_dir = "backups"
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_folder = os.path.join(backup_dir, f"archive_{timestamp}")
        os.makedirs(backup_folder)
        
        # Sync critical files
        files_to_sync = ["memory.json", "schedule.json", ".env"]
        synced = 0
        for f in files_to_sync:
            if os.path.exists(f):
                shutil.copy2(f, backup_folder)
                synced += 1
                
        return f"Archive Sync complete. Securely backed up {synced} core files to {backup_folder}."
    except Exception as e:
        return f"Error syncing archive: {str(e)}"
