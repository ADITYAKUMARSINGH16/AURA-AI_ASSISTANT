import json
import os
import uuid

GOALS_FILE = "goals.json"

def _load_goals():
    if not os.path.exists(GOALS_FILE):
        return []
    try:
        with open(GOALS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_goals(goals):
    try:
        with open(GOALS_FILE, 'w', encoding='utf-8') as f:
            json.dump(goals, f, indent=4)
    except Exception as e:
        print(f"Error saving goals: {e}")

def create_goal(name: str, description: str, monitoring_conditions: str, allowed_tools: list, notification_rules: str, cooldown: int = 3600) -> str:
    """Creates a persistent background goal for AURA to monitor. allowed_tools should be a list of tool names as strings."""
    goals = _load_goals()
    goal_id = str(uuid.uuid4())
    
    new_goal = {
        "id": goal_id,
        "name": name,
        "description": description,
        "monitoring_conditions": monitoring_conditions,
        "allowed_tools": allowed_tools,
        "notification_rules": notification_rules,
        "cooldown": cooldown,
        "enabled": True,
        "last_run": None,
        "last_notified": None
    }
    
    goals.append(new_goal)
    _save_goals(goals)
    return f"Successfully created and activated goal '{name}' (ID: {goal_id})."

def list_goals() -> str:
    """Lists all active and inactive background goals."""
    goals = _load_goals()
    if not goals:
        return "No goals have been created yet."
        
    res = "Current Goals:\n"
    for g in goals:
        status = "ENABLED" if g.get("enabled") else "DISABLED"
        res += f"- [{status}] {g['name']} (ID: {g['id']})\n"
        res += f"  Desc: {g['description']}\n"
    return res

def toggle_goal(goal_id: str, enabled: bool) -> str:
    """Enables or disables a goal by its ID."""
    goals = _load_goals()
    for g in goals:
        if g['id'] == goal_id or g['name'].lower() == goal_id.lower():
            g['enabled'] = enabled
            _save_goals(goals)
            state = "enabled" if enabled else "disabled"
            return f"Goal '{g['name']}' has been {state}."
    return f"Goal with ID or name '{goal_id}' not found."
