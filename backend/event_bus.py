"""Asyncio broadcast hub for Server-Sent Events.

The HUD historically polled ~9 REST endpoints on independent timers. This bus
lets api.py push the same payloads once per change instead. Stdlib asyncio
only — no external pub/sub dependency.
"""
import asyncio
import json
import time

# Upper bound on concurrent SSE clients; the oldest subscriber is dropped when
# exceeded so a runaway tab count can never exhaust server resources.
MAX_CLIENTS = 20

# Per-client buffer of undelivered events. When full, the oldest queued event
# is evicted in favour of the newest — a slow tab should see fresh state, not
# a growing backlog.
_MAX_QUEUE = 200


class EventBus:
    def __init__(self):
        # dict used as an insertion-ordered set so "oldest client" is well defined.
        self._subscribers = {}

    def subscribe(self) -> asyncio.Queue:
        if len(self._subscribers) >= MAX_CLIENTS:
            oldest = next(iter(self._subscribers))
            self.unsubscribe(oldest)
        q = asyncio.Queue(maxsize=_MAX_QUEUE)
        self._subscribers[q] = True
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subscribers.pop(q, None)

    @property
    def client_count(self) -> int:
        return len(self._subscribers)

    async def publish(self, event_type: str, data: dict):
        """Broadcast {"type", "data", "ts"} to every subscriber.

        put_nowait keeps this safe to call from anywhere on the event loop;
        overflow drops the oldest event per slow client rather than blocking
        the publishing detector coroutine.
        """
        event = {"type": event_type, "data": data, "ts": time.time()}
        dead = []
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    dead.append(q)
        for q in dead:
            self.unsubscribe(q)


bus = EventBus()

# Main-loop reference so threads without an event loop (tool execution runs in
# worker threads) can still publish. Bound during app startup.
_main_loop = None


def bind_loop(loop):
    """Capture the server's main event loop for cross-thread publishing."""
    global _main_loop
    _main_loop = loop


def publish_now(event_type: str, data: dict):
    """Thread-safe fire-and-forget publish usable from any thread."""
    global _main_loop
    try:
        if _main_loop is not None and _main_loop.is_running():
            asyncio.run_coroutine_threadsafe(bus.publish(event_type, data), _main_loop)
            return True
        asyncio.run(bus.publish(event_type, data))
        return True
    except Exception:
        return False


def format_sse(event: dict) -> str:
    """Serialize an event dict into the text/event-stream wire format."""
    return f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"
