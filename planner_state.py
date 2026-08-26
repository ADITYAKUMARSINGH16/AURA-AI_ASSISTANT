"""Persistent plan state for the agentic planner.

Thread-safe JSON store at plans.json, mirroring the locking style of
tools/memory_tools.py. Every mutation publishes a "plan_update" event on the
SSE bus (backend/event_bus.py) when an event loop is running; publishing is
best-effort and silently skipped elsewhere (e.g. scheduler threads).
"""
import datetime
import json
import threading
import uuid
from pathlib import Path

# Anchor the store beside this module; resolve() pins the real path and the
# confinement check rejects anything escaping the project directory.
_BASE_DIR = Path(__file__).resolve().parent
PLANS_PATH = (_BASE_DIR / "plans.json").resolve()
try:
    PLANS_PATH.relative_to(_BASE_DIR)
except ValueError:
    raise RuntimeError("plans.json path escaped the project directory")

MAX_PLANS = 20
_STEP_STATUSES = ("pending", "in_progress", "done", "skipped")

_LOCK = threading.RLock()


def _now() -> str:
    return datetime.datetime.now().isoformat()


def _load() -> dict:
    if not PLANS_PATH.exists():
        return {"plans": []}
    try:
        with PLANS_PATH.open('r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("plans"), list):
            return data
    except Exception:
        pass
    return {"plans": []}


def _save(db: dict):
    with PLANS_PATH.open('w', encoding='utf-8') as f:
        json.dump(db, f, indent=4)


def _prune(db: dict):
    """Keep at most MAX_PLANS; prune oldest finished plans first, then oldest overall."""
    plans = db["plans"]
    if len(plans) <= MAX_PLANS:
        return
    finished = sorted(
        (p for p in plans if p.get("status") in ("completed", "cancelled")),
        key=lambda p: p.get("updated_at", ""))
    for old in finished:
        if len(plans) <= MAX_PLANS:
            break
        plans.remove(old)
    while len(plans) > MAX_PLANS:
        plans.pop(0)


def _copy(plan) -> dict:
    return json.loads(json.dumps(plan)) if plan else None


def _publish(action: str, plan: dict):
    payload = {
        "action": action,
        "plan_id": plan["id"] if plan else None,
        "status": plan.get("status") if plan else None,
        "goal": plan.get("goal") if plan else None,
        "current_step": plan.get("current_step") if plan else None,
        "total_steps": len(plan.get("steps", [])) if plan else 0,
    }
    try:
        # Preferred: already inside the server's event loop.
        import asyncio
        from backend.event_bus import bus
        loop = asyncio.get_running_loop()
        loop.create_task(bus.publish("plan_update", payload))
    except Exception:
        # Tool execution happens in worker threads with no loop; bridge to the
        # bound main loop instead. Publishing must never break planner tools.
        try:
            from backend.event_bus import publish_now
            publish_now("plan_update", payload)
        except Exception:
            pass


def _find(db: dict, plan_id: str):
    return next((p for p in db["plans"] if p.get("id") == plan_id), None)


def create_plan(goal: str, steps: list) -> dict:
    texts = [str(s).strip() for s in (steps or []) if str(s).strip()]
    if not texts:
        raise ValueError("A plan needs at least one non-empty step.")
    with _LOCK:
        db = _load()
        now = _now()
        plan = {
            "id": uuid.uuid4().hex[:12],
            "goal": (goal or "Untitled task").strip(),
            "steps": [{"index": i, "text": t, "status": "pending", "note": ""}
                      for i, t in enumerate(texts, start=1)],
            "current_step": 1,
            "created_at": now,
            "updated_at": now,
            "status": "active"
        }
        db["plans"].append(plan)
        _prune(db)
        _save(db)
        snapshot = _copy(plan)
    _publish("created", snapshot)
    return snapshot


def get_plan(plan_id: str):
    with _LOCK:
        return _copy(_find(_load(), plan_id))


def update_step(plan_id: str, index: int, status: str, note: str = ""):
    """Set one step's status (and optionally attach a progress note)."""
    if status not in _STEP_STATUSES:
        status = "in_progress"
    with _LOCK:
        db = _load()
        plan = _find(db, plan_id)
        if not plan or plan.get("status") != "active":
            return None
        if not isinstance(index, int) or not (1 <= index <= len(plan["steps"])):
            return None
        step = plan["steps"][index - 1]
        step["status"] = status
        if note:
            step["note"] = str(note)[:300]
        plan["updated_at"] = _now()
        _save(db)
        snapshot = _copy(plan)
    _publish("step_updated", snapshot)
    return snapshot


def advance(plan_id: str):
    """Mark the current step done and move to the next one.

    Advancing past the final step implicitly completes the plan.
    """
    with _LOCK:
        db = _load()
        plan = _find(db, plan_id)
        if not plan or plan.get("status") != "active":
            return None
        cur = plan.get("current_step", 1)
        if 1 <= cur <= len(plan["steps"]):
            plan["steps"][cur - 1]["status"] = "done"
        action = "advanced"
        nxt = cur + 1
        if nxt > len(plan["steps"]):
            plan["status"] = "completed"
            action = "completed"
        else:
            plan["current_step"] = nxt
        plan["updated_at"] = _now()
        _save(db)
        snapshot = _copy(plan)
    _publish(action, snapshot)
    return snapshot


def complete_plan(plan_id: str):
    with _LOCK:
        db = _load()
        plan = _find(db, plan_id)
        if not plan:
            return None
        plan["status"] = "completed"
        for step in plan["steps"]:
            if step["status"] != "skipped":
                step["status"] = "done"
        plan["updated_at"] = _now()
        _save(db)
        snapshot = _copy(plan)
    _publish("completed", snapshot)
    return snapshot


def cancel_plan(plan_id: str):
    with _LOCK:
        db = _load()
        plan = _find(db, plan_id)
        if not plan:
            return None
        plan["status"] = "cancelled"
        plan["updated_at"] = _now()
        _save(db)
        snapshot = _copy(plan)
    _publish("cancelled", snapshot)
    return snapshot


def get_active_plan():
    with _LOCK:
        plans = _load()["plans"]
        for plan in reversed(plans):
            if plan.get("status") == "active":
                return _copy(plan)
    return None


def list_plans(limit: int = 10):
    with _LOCK:
        plans = _load()["plans"]
        return _copy(list(reversed(plans[-max(1, min(limit, MAX_PLANS)):])))
