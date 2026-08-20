import subprocess

def open_application(app_name: str) -> str:
    """
    Attempts to open a specified application by name on Windows.
    For example: 'notepad', 'calc'.
    """
    try:
        # Popen is non-blocking so it doesn't freeze the assistant
        subprocess.Popen(["start", app_name], shell=True)
        return f"Successfully sent command to open {app_name}."
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
