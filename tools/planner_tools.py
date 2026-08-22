import datetime

def report_progress(message: str) -> str:
    """
    Reports the current progress or step to the user via the HUD.
    Use this tool before executing a long-running step or to show what you are doing.
    :param message: The short progress message to show (e.g., "Step 1: Checking GPU temperature...")
    """
    try:
        import api
        notification = {
            "title": "AURA PLANNER",
            "message": message,
            "type": "info",
            "timestamp": datetime.datetime.now().isoformat()
        }
        api.pending_notifications.append(notification)
        return "[PLANNER] Progress reported to user."
    except Exception as e:
        return f"[PLANNER ERROR] Could not report progress: {e}"

def create_temporary_plan(steps: list) -> str:
    """
    Registers a multi-step plan for a complex task.
    :param steps: A list of strings describing each step of the plan.
    """
    try:
        import api
        plan_str = " | ".join([f"{i+1}. {s}" for i, s in enumerate(steps)])
        notification = {
            "title": "AURA PLANNER: New Task",
            "message": f"Executing Plan: {plan_str}",
            "type": "info",
            "timestamp": datetime.datetime.now().isoformat()
        }
        api.pending_notifications.append(notification)
        return f"[PLANNER] Plan registered with {len(steps)} steps. Begin executing step 1."
    except Exception as e:
        return f"[PLANNER ERROR] Could not register plan: {e}"
