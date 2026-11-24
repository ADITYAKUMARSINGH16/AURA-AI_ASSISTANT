import os
import psutil
import platform

try:
    import wmi
    WMI_AVAILABLE = True
except Exception:
    wmi = None
    WMI_AVAILABLE = False

import winreg
import datetime
import subprocess

def get_cpu_info() -> str:
    """Gets detailed CPU information including model, cores, and current utilization."""
    try:
        if not WMI_AVAILABLE:
            return "CPU info unavailable: the 'wmi' package is not installed."
        w = wmi.WMI()
        cpu_info = w.Win32_Processor()[0]
        usage = psutil.cpu_percent(interval=0.5)
        freq = psutil.cpu_freq()
        
        info = f"CPU Model: {cpu_info.Name.strip()}\n"
        info += f"Physical Cores: {psutil.cpu_count(logical=False)} | Logical Processors: {psutil.cpu_count(logical=True)}\n"
        if freq:
            info += f"Current Frequency: {freq.current:.2f} MHz (Max: {freq.max:.2f} MHz)\n"
        info += f"Current Overall Usage: {usage}%\n"
        return info
    except Exception as e:
        return f"Error retrieving CPU info: {str(e)}"

def get_gpu_info() -> str:
    """Gets GPU model, utilization, and temperature."""
    try:
        if not WMI_AVAILABLE:
            return "GPU info unavailable: the 'wmi' package is not installed."
        w = wmi.WMI()
        gpu_info = ""
        for gpu in w.Win32_VideoController():
            gpu_info += f"GPU Model: {gpu.Name}\n"
            gpu_info += f"Driver Version: {gpu.DriverVersion}\n"
        
        # Try to get nvidia-smi data if it's an NVIDIA card
        try:
            smi = subprocess.check_output(["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total", "--format=csv,noheader"], text=True)
            if smi:
                parts = smi.strip().split(', ')
                if len(parts) >= 4:
                    gpu_info += f"Utilization: {parts[0]}\n"
                    gpu_info += f"Temperature: {parts[1]} C\n"
                    gpu_info += f"VRAM Used: {parts[2]} / {parts[3]}\n"
        except subprocess.CalledProcessError:
            pass # Not an NVIDIA GPU or nvidia-smi not in PATH
            
        return gpu_info.strip()
    except Exception as e:
        return f"Error retrieving GPU info: {str(e)}"

def get_ram_usage() -> str:
    """Gets detailed RAM usage information."""
    try:
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()
        
        info = f"Total RAM: {mem.total / (1024**3):.2f} GB\n"
        info += f"Used RAM: {mem.used / (1024**3):.2f} GB ({mem.percent}%)\n"
        info += f"Available RAM: {mem.available / (1024**3):.2f} GB\n"
        info += f"Swap Total: {swap.total / (1024**3):.2f} GB | Swap Used: {swap.used / (1024**3):.2f} GB ({swap.percent}%)\n"
        return info
    except Exception as e:
        return f"Error retrieving RAM usage: {str(e)}"

def get_disk_usage() -> str:
    """Gets disk space utilization across all mounted drives."""
    try:
        info = ""
        for part in psutil.disk_partitions():
            if 'cdrom' in part.opts or part.fstype == '':
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                info += f"Drive {part.device} ({part.fstype}):\n"
                info += f"  Total: {usage.total / (1024**3):.2f} GB\n"
                info += f"  Used: {usage.used / (1024**3):.2f} GB ({usage.percent}%)\n"
                info += f"  Free: {usage.free / (1024**3):.2f} GB\n"
            except PermissionError:
                continue
        return info.strip()
    except Exception as e:
        return f"Error retrieving Disk usage: {str(e)}"

def get_battery_health() -> str:
    """Gets battery percentage and power plugged-in status."""
    try:
        battery = psutil.sensors_battery()
        if not battery:
            return "No battery detected (likely a desktop PC)."
        
        plugged = "Plugged In" if battery.power_plugged else "Discharging"
        time_left = ""
        if not battery.power_plugged and battery.secsleft != psutil.POWER_TIME_UNKNOWN:
            time_left = f" | Estimated Time Left: {datetime.timedelta(seconds=battery.secsleft)}"
            
        return f"Battery Level: {battery.percent}% | Status: {plugged}{time_left}"
    except Exception as e:
        return f"Error retrieving Battery health: {str(e)}"

def get_network_info() -> str:
    """Gets current network interfaces and their IP addresses."""
    try:
        info = ""
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        
        for interface, ips in addrs.items():
            if interface in stats and stats[interface].isup:
                ipv4 = next((ip.address for ip in ips if ip.family == 2), None)
                if ipv4 and not ipv4.startswith("127."):
                    info += f"Interface: {interface} | IP: {ipv4}\n"
                    
        if not info:
            return "No active external network interfaces found."
        return info.strip()
    except Exception as e:
        return f"Error retrieving Network info: {str(e)}"

def get_active_processes(limit: int = 10) -> str:
    """Gets a list of the top active processes sorted by CPU and Memory utilization."""
    try:
        processes = []
        for p in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent']):
            try:
                processes.append(p.info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
                
        # Sort by CPU usage first
        processes = sorted(processes, key=lambda x: (x.get('cpu_percent') or 0, x.get('memory_percent') or 0), reverse=True)
        
        info = f"Top {limit} Active Processes (by CPU/RAM):\n"
        info += f"{'PID':<8} | {'Name':<25} | {'CPU%':<6} | {'RAM%'}\n"
        info += "-" * 55 + "\n"
        
        for p in processes[:limit]:
            cpu = p.get('cpu_percent') or 0
            mem = p.get('memory_percent') or 0
            name = str(p.get('name'))[:24]
            info += f"{p.get('pid'):<8} | {name:<25} | {cpu:<6.1f} | {mem:.1f}%\n"
            
        return info
    except Exception as e:
        return f"Error retrieving Active Processes: {str(e)}"

def get_startup_programs() -> str:
    """Gets a list of programs configured to launch on Windows startup."""
    try:
        programs = []
        keys = [
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run")
        ]
        
        for hkey, path in keys:
            try:
                key = winreg.OpenKey(hkey, path)
                for i in range(1024):
                    try:
                        name, value, _ = winreg.EnumValue(key, i)
                        programs.append(f"{name}: {value}")
                    except OSError:
                        break
                winreg.CloseKey(key)
            except OSError:
                continue
                
        if not programs:
            return "No startup programs found in standard Run registry keys."
            
        return "Startup Programs:\n" + "\n".join(programs)
    except Exception as e:
        return f"Error retrieving Startup Programs: {str(e)}"

def get_windows_services(status: str = "running") -> str:
    """Gets a list of Windows services. By default only returns running services (max 20 to save context length)."""
    try:
        services = []
        for s in psutil.win_service_iter():
            try:
                if s.status() == status:
                    services.append(f"{s.name()} ({s.display_name()})")
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
                
        count = len(services)
        info = f"Found {count} {status} services. Listing top 20:\n"
        info += "\n".join(services[:20])
        return info
    except Exception as e:
        return f"Error retrieving Windows Services: {str(e)}"

def get_installed_applications() -> str:
    """Gets a list of installed applications from the Windows Registry (max 30 to save context length)."""
    try:
        apps = []
        keys = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall")
        ]
        
        for hkey, path in keys:
            try:
                key = winreg.OpenKey(hkey, path)
                for i in range(1024):
                    try:
                        subkey_name = winreg.EnumKey(key, i)
                        subkey = winreg.OpenKey(key, subkey_name)
                        try:
                            display_name, _ = winreg.QueryValueEx(subkey, "DisplayName")
                            if display_name and display_name not in apps:
                                apps.append(display_name)
                        except OSError:
                            pass
                        winreg.CloseKey(subkey)
                    except OSError:
                        break
                winreg.CloseKey(key)
            except OSError:
                continue
                
        apps.sort()
        count = len(apps)
        info = f"Found {count} installed applications. Listing top 30 (alphabetical):\n"
        info += "\n".join(apps[:30])
        return info
    except Exception as e:
        return f"Error retrieving Installed Applications: {str(e)}"

def get_windows_event_logs(log_type: str = "System", limit: int = 10) -> str:
    """Queries the Windows Event Log for recent Errors or Warnings."""
    try:
        import win32evtlog
        server = 'localhost'
        hand = win32evtlog.OpenEventLog(server, log_type)
        flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
        
        events_found = []
        while True:
            events = win32evtlog.ReadEventLog(hand, flags, 0)
            if not events:
                break
            for event in events:
                # 1=Error, 2=Warning
                if event.EventType in (1, 2):
                    evt_type = "ERROR" if event.EventType == 1 else "WARNING"
                    time_gen = event.TimeGenerated.Format()
                    source = event.SourceName
                    events_found.append(f"[{time_gen}] {evt_type} | Source: {source}")
                    if len(events_found) >= limit:
                        break
            if len(events_found) >= limit:
                break
                
        if not events_found:
            return f"No recent errors or warnings found in {log_type} log."
            
        return f"Recent Windows Event Logs ({log_type} - Errors/Warnings):\n" + "\n".join(events_found)
    except ImportError:
        return "Error: pywin32 module is not installed. Cannot read event logs."
    except Exception as e:
        return f"Error reading Windows Event Logs: {str(e)}"

def get_system_uptime() -> str:
    """Gets the system boot time and total uptime."""
    try:
        boot_time = datetime.datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.datetime.now() - boot_time
        
        # Remove microseconds
        uptime = uptime - datetime.timedelta(microseconds=uptime.microseconds)
        
        info = f"System Boot Time: {boot_time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        info += f"Total Uptime: {uptime}"
        return info
    except Exception as e:
        return f"Error retrieving System Uptime: {str(e)}"
