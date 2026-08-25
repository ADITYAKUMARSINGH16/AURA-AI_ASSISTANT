"""Shared notification queue used by both the API layer and agent tools.

Lives in its own module so tools like planner_tools can push HUD
notifications without importing api.py (which would drag the whole
FastAPI stack - agent, wake-word listener, scheduler - into any process
that merely wanted to report progress).
"""
import threading

pending_notifications = []
_lock = threading.Lock()


def push_notification(message):
    """Thread-safe append of a notification dict or string."""
    with _lock:
        pending_notifications.append(message)


def pop_notification():
    """Returns the oldest notification or None if the queue is empty."""
    with _lock:
        if pending_notifications:
            return pending_notifications.pop(0)
        return None


def has_notifications():
    with _lock:
        return len(pending_notifications) > 0
