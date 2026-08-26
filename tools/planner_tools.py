import datetime
import re

import planner_state


def _push_planner_notification(message: str):
    from notifications import push_notification
    notification = {
        "title": "AURA PLANNER",
        "message": message,
        "type": "info",
        "timestamp": datetime.datetime.now().isoformat()
    }
    push_notification(notification)


def create_temporary_plan(steps: list, goal: str = "") -> str:
    """
    Registers a multi-step plan for a complex task and starts tracking it.
    :param steps: A list of strings describing each step of the plan.
    :param goal: Optional short name of the overall task.
    """
    try:
        if not isinstance(steps, list) or not steps:
            return "[PLANNER ERROR] Provide a non-empty list of step strings."
        plan = planner_state.create_plan(goal, steps)
        total = len(plan["steps"])
        plan_str = " | ".join(f"{s['index']}. {s['text']}" for s in plan["steps"])
        _push_planner_notification(f"New Plan: {plan['goal']} — {plan_str}")
        first = plan["steps"][0]["text"]
        return (f"[PLANNER] Plan {plan['id']} registered with {total} steps. "
                f"Begin executing step 1: {first}")
    except Exception as e:
        return f"[PLANNER ERROR] Could not register plan: {e}"


def report_progress(message: str, step: int = None) -> str:
    """
    Reports progress on the active plan and records step transitions.
    Use after finishing each step, e.g. report_progress("Step 1 complete: files backed up").
    Messages like "Step N complete/done" advance the plan; any other message is
    attached as a note to the current step.
    :param message: The short progress message to show the user.
    :param step: Optional explicit step number this message refers to.
    """
    try:
        _push_planner_notification(str(message))

        plan = planner_state.get_active_plan()
        if not plan:
            # No plan tracked — pure HUD progress note, same as the old behaviour.
            return "[PLANNER] Progress reported to user."

        plan_id = plan["id"]
        current = plan.get("current_step", 1)
        total = len(plan["steps"])
        text = str(message).strip().lower()

        # Heuristics: "step N ... complete/done", bare "complete"/"done", or an
        # explicit step argument mean the model finished that step.
        m = re.search(r"step\s*(\d+)", text)
        num = int(m.group(1)) if m else (step if isinstance(step, int) else None)
        says_done = bool(re.search(r"\b(complete|completed|done|finished)\b", text))
        bare_done = text in ("complete", "completed", "done", "finished")

        advanced_to = None
        if num is not None and says_done:
            target = min(max(num, 1), total)
        elif bare_done or (num is None and says_done):
            target = current
        else:
            target = None

        if target is not None:
            while plan.get("current_step", 1) <= min(target, total):
                updated = planner_state.advance(plan_id)
                if not updated:
                    break
                plan = updated
                advanced_to = target
            if plan.get("status") == "completed":
                return (f"[PLANNER] Step {total}/{total} complete. "
                        f"Plan '{plan['goal']}' COMPLETED.")
            nxt = plan.get("current_step")
            return (f"[PLANNER] Step {advanced_to or target}/{total} complete. "
                    f"Next: {plan['steps'][nxt - 1]['text']}")

        # Not a transition — attach as a note to the current step.
        planner_state.update_step(plan_id, current, "in_progress", note=str(message))
        return (f"[PLANNER] Note recorded on step {current}/{total} "
                f"('{plan['steps'][current - 1]['text']}').")
    except Exception as e:
        return f"[PLANNER ERROR] Could not report progress: {e}"
