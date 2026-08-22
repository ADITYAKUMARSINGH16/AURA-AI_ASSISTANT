import psutil
import subprocess
import os
import datetime

def get_windows_defender_status() -> str:
    """Checks Windows Defender real-time protection and antivirus status."""
    try:
        cmd = 'powershell -Command "Get-MpComputerStatus | Select-Object -Property RealTimeProtectionEnabled, AntivirusSignatureAge"'
        result = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        if "True" in result:
            return "Windows Defender: Real-Time Protection is ENABLED."
        elif "False" in result:
            return "Windows Defender: Real-Time Protection is DISABLED (Warning)."
        return f"Windows Defender Status:\n{result.strip()}"
    except Exception as e:
        return f"Could not determine Windows Defender status: {str(e)}"

def get_firewall_status() -> str:
    """Checks the status of Windows Firewall profiles (Domain, Private, Public)."""
    try:
        cmd = 'powershell -Command "Get-NetFirewallProfile | Select-Object Name, Enabled"'
        result = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        if not result.strip():
            return "Could not retrieve firewall status."
        return f"Windows Firewall Status:\n{result.strip()}"
    except Exception as e:
        return f"Could not determine Firewall status: {str(e)}"

def get_listening_ports() -> str:
    """Lists processes actively listening on network ports (limit 15)."""
    try:
        connections = psutil.net_connections(kind='inet')
        listening = []
        for conn in connections:
            if conn.status == 'LISTEN':
                port = conn.laddr.port
                pid = conn.pid
                name = "Unknown"
                if pid:
                    try:
                        p = psutil.Process(pid)
                        name = p.name()
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                if name != "Unknown":
                    listening.append(f"Port {port} -> {name} (PID: {pid})")
                    
        # Remove duplicates
        listening = list(set(listening))
        
        if not listening:
            return "No active listening ports found."
        
        return "Listening Ports (Top 15):\n" + "\n".join(listening[:15])
    except psutil.AccessDenied:
        return "Access denied when retrieving listening ports. Administrator privileges required."
    except Exception as e:
        return f"Error retrieving listening ports: {str(e)}"

def get_suspicious_files() -> str:
    """Scans common drop locations (Temp, Downloads) for recently created executables within the last 24 hours."""
    try:
        import os
        from pathlib import Path
        import time
        
        user_profile = os.environ.get('USERPROFILE', '')
        if not user_profile:
            return "Could not determine user profile path."
            
        scan_dirs = [
            os.path.join(user_profile, 'Downloads'),
            os.path.join(user_profile, 'AppData', 'Local', 'Temp')
        ]
        
        suspicious = []
        now = time.time()
        one_day_ago = now - (24 * 3600)
        
        for d in scan_dirs:
            if os.path.exists(d):
                try:
                    for entry in os.scandir(d):
                        if entry.is_file() and entry.name.lower().endswith(('.exe', '.bat', '.ps1', '.vbs', '.scr')):
                            stat = entry.stat()
                            if stat.st_ctime > one_day_ago or stat.st_mtime > one_day_ago:
                                suspicious.append(f"{entry.name} in {d} (Modified recently)")
                except Exception:
                    pass
                    
        if not suspicious:
            return "No recent suspicious executables found in standard drop locations."
            
        return "Suspicious/Recent Executables Found (Limit 15):\n" + "\n".join(suspicious[:15])
    except Exception as e:
        return f"Error scanning for suspicious files: {str(e)}"

def get_removable_devices() -> str:
    """Detects plugged-in USB or removable drives."""
    try:
        import wmi
        w = wmi.WMI()
        drives = []
        for disk in w.Win32_LogicalDisk(DriveType=2):
            drives.append(f"Drive {disk.DeviceID} [{disk.VolumeName or 'Unknown'}] - Removable Media")
            
        if not drives:
            return "No removable drives detected."
        return "Removable Devices:\n" + "\n".join(drives)
    except Exception as e:
        return f"Error detecting removable devices: {str(e)}"

def analyze_suspicious_processes() -> str:
    """Heuristically flags processes running from temp directories or consuming massive resources."""
    try:
        suspicious = []
        user_temp = os.environ.get('TEMP', '').lower()
        
        for p in psutil.process_iter(['pid', 'name', 'exe', 'cpu_percent']):
            try:
                info = p.info
                exe = (info.get('exe') or "").lower()
                name = info.get('name') or "Unknown"
                cpu = info.get('cpu_percent') or 0
                
                # Flag if running from Temp
                if user_temp and user_temp in exe and exe.endswith('.exe'):
                    suspicious.append(f"WARN: {name} (PID: {info['pid']}) is executing from Temp directory.")
                
                # Flag if extremely high CPU for anomalous binary (very basic heuristic)
                if cpu > 80.0 and "system" not in name.lower() and "chrome" not in name.lower():
                    suspicious.append(f"WARN: {name} (PID: {info['pid']}) is consuming {cpu}% CPU.")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
                
        if not suspicious:
            return "No suspicious processes flagged by heuristics."
            
        return "Suspicious Processes Analysis:\n" + "\n".join(suspicious)
    except Exception as e:
        return f"Error analyzing processes: {str(e)}"
