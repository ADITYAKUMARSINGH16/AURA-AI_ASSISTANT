"""Temp demo driver: registers/advances plans inside the server process so the
HUD plan card can be verified against real SSE events. Deleted after use."""
import threading
import time

import uvicorn

import api

config = uvicorn.Config(api.app, host="127.0.0.1", port=8044, log_level="warning")
server = uvicorn.Server(config)
server_thread = threading.Thread(target=server.run, daemon=True)
server_thread.start()
for _ in range(60):
    if server.started:
        break
    time.sleep(0.25)

from tools.planner_tools import create_temporary_plan, report_progress


def run():
    time.sleep(8)
    print("DEMO: creating 4-step plan for visual checks", flush=True)
    create_temporary_plan(
        ["scan system", "list processes", "analyze results", "write summary"],
        goal="System review")


threading.Thread(target=run, daemon=True).start()

# Keep the process alive serving requests; Ctrl+C / kill ends it.
try:
    server_thread.join()
except KeyboardInterrupt:
    server.should_exit = True
