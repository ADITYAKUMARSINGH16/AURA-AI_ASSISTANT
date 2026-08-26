from enum import Enum
import uuid
import datetime

class RiskLevel(Enum):
    SAFE = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

# In-memory store for pending actions
# Format: { action_id: {"tool_name": str, "arguments": dict, "risk": str, "status": "PENDING"|"APPROVED"|"REJECTED", "timestamp": str} }
PENDING_ACTIONS = {}
TRUSTED_AUTOMATION_ENABLED = False

TOOL_RISK_MAP = {
    # SAFE: Execute automatically.
    "get_system_time": RiskLevel.SAFE,
    "get_system_info": RiskLevel.SAFE,
    "get_cpu_info": RiskLevel.SAFE,
    "get_gpu_info": RiskLevel.SAFE,
    "get_ram_usage": RiskLevel.SAFE,
    "get_disk_usage": RiskLevel.SAFE,
    "get_battery_health": RiskLevel.SAFE,
    "get_network_info": RiskLevel.SAFE,
    "get_windows_services": RiskLevel.SAFE,
    "get_installed_applications": RiskLevel.SAFE,
    "get_windows_event_logs": RiskLevel.SAFE,
    "get_system_uptime": RiskLevel.SAFE,
    "list_directory": RiskLevel.SAFE,
    "get_active_window": RiskLevel.SAFE,
    "read_clipboard": RiskLevel.SAFE,
    "discover_smart_devices": RiskLevel.SAFE,
    "get_smart_device_status": RiskLevel.SAFE,
    "search_memory": RiskLevel.SAFE,
    "recall_fact": RiskLevel.SAFE,
    "search_spotify": RiskLevel.SAFE,
    "list_goals": RiskLevel.SAFE,
    "run_aura_diagnostics": RiskLevel.SAFE,

    # LOW: Execute automatically when clearly requested.
    "web_search": RiskLevel.LOW,
    "read_file": RiskLevel.LOW,
    "get_windows_defender_status": RiskLevel.LOW,
    "get_firewall_status": RiskLevel.LOW,
    "get_listening_ports": RiskLevel.LOW,
    "get_suspicious_files": RiskLevel.LOW,
    "get_removable_devices": RiskLevel.LOW,
    "get_active_processes": RiskLevel.LOW,
    "get_startup_programs": RiskLevel.LOW,
    "manage_schedule": RiskLevel.LOW,
    "report_progress": RiskLevel.LOW,
    "create_temporary_plan": RiskLevel.LOW,
    "remember_fact": RiskLevel.LOW,
    # Heuristics only read psutil process data (names/CPU/RAM); nothing is killed or modified.
    "analyze_suspicious_processes": RiskLevel.LOW,

    # MEDIUM: Ask for confirmation unless trusted automation is enabled.
    # Screen capture sends the entire desktop to the vision model — privacy-sensitive,
    # so require approval outside Trusted Mode even though nothing is mutated.
    "read_screen": RiskLevel.MEDIUM,
    # Read-only psutil CPU/RAM anomaly sweep; no state mutation, but user-visible activity.
    "run_threat_scan": RiskLevel.MEDIUM,
    "open_application": RiskLevel.MEDIUM,
    "close_application": RiskLevel.MEDIUM,
    "control_media": RiskLevel.MEDIUM,
    "play_spotify_music": RiskLevel.MEDIUM,
    "control_smart_device": RiskLevel.MEDIUM,
    "set_smart_scene": RiskLevel.MEDIUM,
    "create_goal": RiskLevel.MEDIUM,
    "toggle_goal": RiskLevel.MEDIUM,
    "sync_archive": RiskLevel.MEDIUM,
    "scan_home_network": RiskLevel.MEDIUM,

    # HIGH: Always require explicit confirmation.
    "execute_visual_task": RiskLevel.HIGH,
    "forget_fact": RiskLevel.HIGH,
    "forget_memory": RiskLevel.HIGH,

    # CRITICAL: Always require explicit confirmation.
    "control_system_power": RiskLevel.CRITICAL
}

# Confirmation workflow tools must never be blocked themselves,
# otherwise the agent can never approve its own pending actions (deadlock).
for _meta_tool in ("confirm_pending_action", "reject_pending_action"):
    TOOL_RISK_MAP[_meta_tool] = RiskLevel.SAFE

def get_risk_level(tool_name: str) -> RiskLevel:
    """Returns the risk level of a tool. Defaults to CRITICAL for unknown tools for safety."""
    return TOOL_RISK_MAP.get(tool_name, RiskLevel.CRITICAL)

def evaluate_permission(tool_name: str, arguments: dict) -> str:
    """
    Evaluates if a tool can execute immediately.
    Returns "APPROVED" if it can run.
    Returns action_id (str) if it is placed in the pending queue.
    """
    risk = get_risk_level(tool_name)
    
    if risk == RiskLevel.SAFE or risk == RiskLevel.LOW:
        return "APPROVED"
        
    if risk == RiskLevel.MEDIUM and TRUSTED_AUTOMATION_ENABLED:
        return "APPROVED"
        
    # Check if this exact tool/args combo was already approved and waiting to be consumed
    for aid, data in list(PENDING_ACTIONS.items()):
        if data["tool_name"] == tool_name and data["arguments"] == arguments and data["status"] == "APPROVED":
            # Consume the approval
            del PENDING_ACTIONS[aid]
            return "APPROVED"
            
    action_id = str(uuid.uuid4())
    PENDING_ACTIONS[action_id] = {
        "id": action_id,
        "tool_name": tool_name,
        "arguments": arguments,
        "risk": risk.name,
        "status": "PENDING",
        "timestamp": datetime.datetime.now().isoformat()
    }
    return action_id

def confirm_pending_action(action_id: str) -> str:
    """Confirms a pending action so it can be executed. Use 'all' to confirm all pending actions."""
    if action_id.lower() == "all":
        count = 0
        for aid, data in PENDING_ACTIONS.items():
            if data["status"] == "PENDING":
                data["status"] = "APPROVED"
                count += 1
        return f"Approved {count} pending actions."
        
    if action_id in PENDING_ACTIONS and PENDING_ACTIONS[action_id]["status"] == "PENDING":
        PENDING_ACTIONS[action_id]["status"] = "APPROVED"
        return f"Action {action_id} approved. Please call the tool again to execute it."
    return "Action not found or not pending."
    
def reject_pending_action(action_id: str) -> str:
    """Rejects a pending action. Use 'all' to reject all. Rejected actions are removed from the queue."""
    if action_id.lower() == "all":
        count = len([d for d in PENDING_ACTIONS.values() if d["status"] == "PENDING"])
        PENDING_ACTIONS.clear()
        return f"Rejected {count} pending actions."
        
    if action_id in PENDING_ACTIONS and PENDING_ACTIONS[action_id]["status"] == "PENDING":
        del PENDING_ACTIONS[action_id]
        return f"Action {action_id} rejected."
    return "Action not found or not pending."

def get_pending_actions():
    return {k: v for k, v in PENDING_ACTIONS.items() if v["status"] == "PENDING"}

def toggle_trusted_automation(enabled: bool):
    global TRUSTED_AUTOMATION_ENABLED
    TRUSTED_AUTOMATION_ENABLED = enabled
