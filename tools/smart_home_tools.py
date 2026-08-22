import asyncio
import concurrent.futures
from typing import Dict, Any, List

try:
    from pywizlight import wizlight, PilotBuilder, discovery
except ImportError:
    wizlight = None

# In-memory registry of discovered devices
DISCOVERED_DEVICES = {
    # Mocks for Smart Plugs (since no specific library was chosen, we simulate these)
    "monitor_plug": {"type": "plug", "state": "off", "mock": True, "ip": "mock_ip_1"},
    "heater_plug": {"type": "plug", "state": "off", "mock": True, "ip": "mock_ip_2"},
    "tv_plug": {"type": "plug", "state": "off", "mock": True, "ip": "mock_ip_3"},
}

def _run_async(coro):
    """Safely run an async coroutine from any context."""
    def _worker():
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        try:
            return pool.submit(_worker).result(timeout=10)
        except concurrent.futures.TimeoutError:
            return "[SMART HOME] Error: Device connection timed out. The device is likely offline or unreachable."
        except Exception as e:
            return f"[SMART HOME] Error: {str(e)}"

def discover_smart_devices() -> str:
    """Discovers all available smart lights and smart plugs on the local network."""
    async def _discover():
        if not wizlight:
            return "[SMART HOME] Error: pywizlight not installed. Cannot discover lights."
            
        try:
            bulbs = await discovery.discover_lights(broadcast_space="192.168.29.255")
        except Exception:
            # Fallback to standard broadcast
            try:
                bulbs = await discovery.discover_lights(broadcast_space="255.255.255.255")
            except Exception:
                bulbs = []
                
        # Also add a hardcoded fallback if discovery fails completely on some routers
        fallback_ip = "192.168.29.140"
        found_ips = [b.ip for b in bulbs]
        if fallback_ip not in found_ips:
            try:
                bulb = wizlight(fallback_ip)
                bulbs.append(bulb)
            except:
                pass
                
        count = 0
        for i, bulb in enumerate(bulbs):
            name = f"light_{i+1}"
            DISCOVERED_DEVICES[name] = {"type": "light", "ip": bulb.ip, "mock": False}
            count += 1
            
        plug_count = len([d for d in DISCOVERED_DEVICES.values() if d['type'] == 'plug'])
        
        return f"[SMART HOME] Discovery complete. Found {count} lights and {plug_count} smart plugs on the network."

    return _run_async(_discover())

def get_smart_device_status(device_name: str) -> str:
    """Gets the current status of a specific smart device."""
    if device_name not in DISCOVERED_DEVICES:
        return f"[SMART HOME] Error: Device '{device_name}' not found. Please run discover_smart_devices first."
        
    device = DISCOVERED_DEVICES[device_name]
    
    if device['mock']:
        return f"[SMART HOME] {device_name.upper()} is currently {device['state'].upper()}."
        
    async def _status():
        bulb = wizlight(device['ip'])
        try:
            state = await bulb.updateState()
            if not state:
                return f"[SMART HOME] Error: {device_name} is unreachable."
            is_on = state.get_state()
            brightness = state.get_brightness()
            return f"[SMART HOME] {device_name.upper()}: {'ON' if is_on else 'OFF'} | Brightness: {brightness}"
        except Exception as e:
            return f"[SMART HOME] Error reaching {device_name}: {str(e)}"
            
    return _run_async(_status())

def control_smart_device(device_name: str, state: str, brightness: int = None, color: str = None) -> str:
    """
    Controls a single smart device (light or plug).
    :param device_name: Name of the device (e.g. 'light_1', 'monitor_plug')
    :param state: 'on' or 'off'
    :param brightness: 0-255 (for lights only)
    :param color: string color name like 'red', 'blue', 'warm white' (for lights only)
    """
    if device_name not in DISCOVERED_DEVICES and device_name != "all":
        return f"[SMART HOME] Error: Device '{device_name}' not found."
        
    devices_to_control = [device_name] if device_name != "all" else list(DISCOVERED_DEVICES.keys())
    results = []
    
    async def _control():
        for d_name in devices_to_control:
            device = DISCOVERED_DEVICES[d_name]
            
            if device['mock']:
                device['state'] = state.lower()
                results.append(f"{d_name}: Turned {state.upper()}")
                continue
                
            if device['type'] == 'light':
                bulb = wizlight(device['ip'])
                try:
                    if state.lower() == "off":
                        await bulb.turn_off()
                        results.append(f"{d_name}: Turned OFF")
                    else:
                        r, g, b = 255, 255, 255
                        if color:
                            c = color.lower()
                            if 'red' in c: r, g, b = 255, 0, 0
                            elif 'blue' in c: r, g, b = 0, 0, 255
                            elif 'green' in c: r, g, b = 0, 255, 0
                            elif 'purple' in c: r, g, b = 128, 0, 128
                            elif 'orange' in c: r, g, b = 255, 165, 0
                            elif 'pink' in c: r, g, b = 255, 192, 203
                            elif 'yellow' in c: r, g, b = 255, 255, 0
                            elif 'warm' in c or 'white' in c: r, g, b = 255, 200, 150
                            elif 'cyan' in c: r, g, b = 0, 255, 255
                            elif 'magenta' in c: r, g, b = 255, 0, 255
                            
                        builder = PilotBuilder(rgb=(r, g, b), brightness=brightness)
                        await bulb.turn_on(builder)
                        col_str = f" [{color.upper()}]" if color else ""
                        bri_str = f" [Bri: {brightness}]" if brightness else ""
                        results.append(f"{d_name}: Turned ON{col_str}{bri_str}")
                except Exception as e:
                    results.append(f"{d_name}: ERROR - Unreachable ({str(e)})")
                    
        return "[SMART HOME] " + " | ".join(results)
        
    return _run_async(_control())

def set_smart_scene(scene_name: str) -> str:
    """
    Activates predefined smart home scenes (e.g. 'movie mode', 'gaming mode', 'sleep mode', 'study mode', 'away mode').
    Coordinates multiple devices at once.
    """
    scene = scene_name.lower().strip()
    
    # Ensure devices are populated
    if not any(d['type'] == 'light' for d in DISCOVERED_DEVICES.values()):
        discover_smart_devices()
        
    lights = [name for name, d in DISCOVERED_DEVICES.items() if d['type'] == 'light']
    plugs = [name for name, d in DISCOVERED_DEVICES.items() if d['type'] == 'plug']
    
    if not lights and not plugs:
        return "[SMART HOME] Error: No devices discovered to set the scene."
        
    results = []
    
    if "movie" in scene:
        # Dim lights, blue/purple hue, turn off heater
        for l in lights:
            results.append(control_smart_device(l, "on", brightness=50, color="purple"))
        if "tv_plug" in plugs:
            results.append(control_smart_device("tv_plug", "on"))
        if "heater_plug" in plugs:
            results.append(control_smart_device("heater_plug", "off"))
            
    elif "gaming" in scene:
        # Vibrant cyan/magenta, monitor on
        for i, l in enumerate(lights):
            color = "cyan" if i % 2 == 0 else "magenta"
            results.append(control_smart_device(l, "on", brightness=255, color=color))
        if "monitor_plug" in plugs:
            results.append(control_smart_device("monitor_plug", "on"))
            
    elif "sleep" in scene:
        # All lights off, all non-essential plugs off
        for l in lights:
            results.append(control_smart_device(l, "off"))
        for p in plugs:
            results.append(control_smart_device(p, "off"))
            
    elif "study" in scene:
        # Bright warm white, entertainment plugs off
        for l in lights:
            results.append(control_smart_device(l, "on", brightness=255, color="warm white"))
        if "tv_plug" in plugs:
            results.append(control_smart_device("tv_plug", "off"))
            
    elif "away" in scene:
        # Everything off
        for l in lights:
            results.append(control_smart_device(l, "off"))
        for p in plugs:
            results.append(control_smart_device(p, "off"))
            
    else:
        return f"[SMART HOME] Error: Unknown scene '{scene_name}'. Available scenes: Movie, Gaming, Sleep, Study, Away."
        
    # Summarize results to avoid huge context usage
    success_count = sum(1 for r in results if "ERROR" not in r)
    error_count = len(results) - success_count
    
    summary = f"[SMART HOME] Scene '{scene.upper()}' activated. {success_count} devices updated."
    if error_count > 0:
        summary += f" ({error_count} devices failed or timed out)."
        
    return summary
