import subprocess
import time

def open_application(app_name: str) -> str:
    """
    Attempts to open a specified application by name on Windows.
    For example: 'notepad', 'calc'.
    Verifies that a matching process actually appears before claiming success.
    """
    try:
        import psutil

        def _running():
            target = app_name.lower().replace('.exe', '')
            for proc in psutil.process_iter(['name']):
                try:
                    pname = (proc.info['name'] or "").lower()
                    if pname and target in pname:
                        return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            return False

        was_running = _running()

        # Popen is non-blocking so it doesn't freeze the assistant
        subprocess.Popen(["start", app_name], shell=True)

        # Verify a process with a matching name actually appeared (max ~6s).
        # Some apps spawn via a launcher with an unrelated process name, so if
        # the app was not already running and nothing new shows up we say so.
        for _ in range(12):
            time.sleep(0.5)
            if _running():
                return f"Verified: {app_name} is now running."
        if was_running:
            return f"{app_name} was already running; launch command sent."
        return (f"Sent the open command for {app_name}, but no process with a "
                f"matching name appeared within 6 seconds. It may have failed, "
                f"or run under a different process name.")
    except Exception as e:
        return f"Failed to open {app_name}. Error: {str(e)}"

def close_application(app_name: str) -> str:
    """
    Attempts to forcefully close a specified application by name.
    Provide the process name (e.g., 'notepad.exe' or just 'notepad').
    """
    try:
        import psutil
        
        # Ensure we check with and without .exe
        target_name = app_name.lower()
        if not target_name.endswith('.exe'):
            target_name += '.exe'
            
        closed_count = 0
        for proc in psutil.process_iter(['name']):
            try:
                if proc.info['name'] and proc.info['name'].lower() == target_name:
                    proc.kill()
                    closed_count += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
                
        if closed_count > 0:
            return f"Successfully closed {closed_count} instance(s) of {app_name}."
        else:
            return f"Could not find any running application named {app_name}."
    except Exception as e:
        return f"Failed to close {app_name}. Error: {str(e)}"
