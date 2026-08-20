import asyncio
import concurrent.futures
from pywizlight import wizlight, PilotBuilder, discovery

# Known WiZ bulb IPs on the local network (discovered via UDP scan).
# Add more IPs here if you have multiple bulbs.
KNOWN_BULB_IPS = ["192.168.29.140"]

def _run_async(coro):
    """Safely run an async coroutine from any context (sync, async, threaded)."""
    def _worker():
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor() as pool:
        return pool.submit(_worker).result(timeout=15)


def control_smart_lights(room: str, state: str = "on", color: str = None) -> str:
    """
    Controls the smart lights in a specific room using Philips WiZ Connected protocol.
    :param room: The room to control (e.g., 'bedroom', 'living room', 'all').
    :param state: 'on', 'off', or 'toggle'.
    :param color: Optional color to set the lights to (e.g., 'red', 'blue', 'warm white').
    """
    async def _run_wiz():
        results = []
        for ip in KNOWN_BULB_IPS:
            bulb = wizlight(ip)
            try:
                if state.lower() == "off":
                    await bulb.turn_off()
                    results.append(f"Turned OFF bulb at {ip}")
                else:
                    # Convert common color strings to RGB
                    r, g, b = 255, 255, 255  # Default to white
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
                    await bulb.turn_on(PilotBuilder(rgb=(r, g, b)))
                    color_msg = f" with color {color.upper()}" if color else ""
                    results.append(f"Turned ON bulb at {ip}{color_msg}")
            except Exception as e:
                results.append(f"Error with bulb {ip}: {str(e)}")
        
        if not results:
            return "[SMART HOME] No bulbs configured. Add IPs to KNOWN_BULB_IPS in smart_home_tools.py."
        return "[SMART HOME] " + "; ".join(results)

    try:
        return _run_async(_run_wiz())
    except Exception as e:
        return f"[SMART HOME] WiZ Error: {str(e)}"


def control_smart_plug(device: str, state: str = "on") -> str:
    """
    Controls a smart plug/outlet.
    :param device: The name of the device (e.g., 'fan', 'heater', 'monitor').
    :param state: 'on', 'off', or 'toggle'.
    """
    # MOCK IMPLEMENTATION
    # In the future, integrate Tuya / Kasa API here.
    message = f"[SMART HOME] Turning {state.upper()} the {device.upper()} plug"
    print(message)
    return message
