"""
AURA Model Context Protocol (MCP) Standard Client
=================================================
Manages stdio JSON-RPC 2.0 connections to external MCP servers, handles dynamic
tool discovery (tools/list), and bridges MCP tools into the AURA agent's tool registry.
"""

import os
import sys
import json
import subprocess
import threading
import time
import logging
from typing import Dict, Any, List, Optional, Callable

from config import project_path

_MCP_CONFIG_PATH = project_path("config", "mcp_servers.json")


class MCPServerConnection:
    """Manages an active stdio connection to an external MCP server."""

    def __init__(self, name: str, config: Dict[str, Any]):
        self.name = name
        self.config = config
        self.proc: Optional[subprocess.Popen] = None
        self._msg_id = 0
        self._lock = threading.Lock()
        self.tools: List[Dict[str, Any]] = []
        self.is_connected = False
        self.server_info: Dict[str, Any] = {}

    def connect(self) -> bool:
        cmd_name = self.config.get("command", "")
        args = self.config.get("args", [])
        env = os.environ.copy()
        if "env" in self.config:
            env.update(self.config["env"])

        # Resolve python executable to current venv if requested
        if cmd_name in ("python", "python3", "python.exe"):
            venv_python = project_path(".venv", "Scripts", "python.exe")
            cmd_name = venv_python if os.path.exists(venv_python) else sys.executable

        full_cmd = [cmd_name] + [project_path(a) if os.path.exists(project_path(a)) else a for a in args]

        try:
            self.proc = subprocess.Popen(
                full_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=project_path(),
                env=env
            )
            self.is_connected = True

            # Handshake: initialize
            init_res = self._send_request("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "clientInfo": {"name": "AURA-MCP-Client", "version": "1.0.0"}
            })
            if not init_res or "error" in init_res:
                logging.warning(f"[MCP] Init failed for {self.name}: {init_res}")
                self.disconnect()
                return False

            self.server_info = init_res.get("result", {}).get("serverInfo", {})

            # Notification: initialized
            self._send_notification("notifications/initialized", {})

            # Discover tools
            tools_res = self._send_request("tools/list", {})
            if tools_res and "result" in tools_res:
                self.tools = tools_res["result"].get("tools", [])
                logging.info(f"[MCP] Discovered {len(self.tools)} tool(s) from server '{self.name}'.")

            return True

        except Exception as e:
            logging.error(f"[MCP] Failed to connect to server '{self.name}': {e}")
            self.is_connected = False
            return False

    def _send_request(self, method: str, params: Dict[str, Any], timeout: float = 10.0) -> Optional[Dict[str, Any]]:
        with self._lock:
            if not self.proc or self.proc.poll() is not None:
                return None

            self._msg_id += 1
            mid = self._msg_id
            payload = {
                "jsonrpc": "2.0",
                "id": mid,
                "method": method,
                "params": params
            }

            try:
                line = json.dumps(payload) + "\n"
                self.proc.stdin.write(line)
                self.proc.stdin.flush()

                # Read response line
                resp_line = self.proc.stdout.readline()
                if not resp_line:
                    return None
                return json.loads(resp_line.strip())
            except Exception as e:
                logging.error(f"[MCP] Error during request {method} to {self.name}: {e}")
                return None

    def _send_notification(self, method: str, params: Dict[str, Any]):
        with self._lock:
            if not self.proc or self.proc.poll() is not None:
                return
            try:
                payload = {
                    "jsonrpc": "2.0",
                    "method": method,
                    "params": params
                }
                self.proc.stdin.write(json.dumps(payload) + "\n")
                self.proc.stdin.flush()
            except Exception as e:
                logging.debug(f"[MCP] Notification note for {self.name}: {e}")

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Calls a tool on the MCP server and returns the structured result."""
        res = self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        }, timeout=25.0)

        if not res:
            return {"error": f"MCP server '{self.name}' did not respond."}
        if "error" in res:
            return {"error": res["error"].get("message", "Unknown MCP error")}
        return res.get("result", {})

    def disconnect(self):
        with self._lock:
            if self.proc:
                try:
                    self.proc.terminate()
                    self.proc.wait(timeout=2)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                self.proc = None
            self.is_connected = False


class MCPManager:
    """Manages all configured MCP server connections and bridges dynamic tools to AURA."""

    def __init__(self):
        self.connections: Dict[str, MCPServerConnection] = {}
        self._dynamic_tools: Dict[str, Callable] = {}
        self.load_and_connect()

    def load_and_connect(self):
        self.disconnect_all()
        if not os.path.exists(_MCP_CONFIG_PATH):
            logging.info("[MCP] No mcp_servers.json found. Skipping MCP setup.")
            return

        try:
            with open(_MCP_CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)

            servers = cfg.get("mcpServers", {})
            for name, scfg in servers.items():
                if scfg.get("enabled", True):
                    conn = MCPServerConnection(name, scfg)
                    if conn.connect():
                        self.connections[name] = conn

            self._rebuild_dynamic_tools()
        except Exception as e:
            logging.error(f"[MCP] Error loading MCP configuration: {e}")

    def _rebuild_dynamic_tools(self):
        """Constructs wrapper callable functions for each discovered tool."""
        self._dynamic_tools.clear()
        for s_name, conn in self.connections.items():
            for t_spec in conn.tools:
                raw_name = t_spec.get("name", "")
                t_desc = t_spec.get("description", f"MCP Tool from {s_name}")
                # Create scoped wrapper
                def make_wrapper(srv_name: str, target_tool: str, doc: str):
                    def mcp_tool_wrapper(**kwargs) -> str:
                        res = self.call_tool(srv_name, target_tool, kwargs)
                        if "error" in res:
                            return f"MCP Error: {res['error']}"
                        content = res.get("content", [])
                        if isinstance(content, list):
                            texts = [c.get("text", "") for c in content if isinstance(c, dict) and "text" in c]
                            return "\n".join(texts) if texts else str(res)
                        return str(res)

                    mcp_tool_wrapper.__name__ = f"mcp_{target_tool}" if not target_tool.startswith("mcp_") else target_tool
                    mcp_tool_wrapper.__doc__ = f"[MCP: {srv_name}] {doc}"
                    return mcp_tool_wrapper

                wrapper_fn = make_wrapper(s_name, raw_name, t_desc)
                self._dynamic_tools[wrapper_fn.__name__] = wrapper_fn

    def get_dynamic_tools(self) -> List[Callable]:
        """Returns list of all active dynamic tool callables."""
        return list(self._dynamic_tools.values())

    def call_tool(self, server_name: str, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.connections.get(server_name)
        if not conn:
            return {"error": f"Server '{server_name}' is not connected or active."}
        return conn.call_tool(tool_name, arguments)

    def list_servers_info(self) -> List[Dict[str, Any]]:
        info = []
        for name, conn in self.connections.items():
            info.append({
                "name": name,
                "connected": conn.is_connected,
                "server_info": conn.server_info,
                "tools": conn.tools
            })
        return info

    def disconnect_all(self):
        for conn in self.connections.values():
            conn.disconnect()
        self.connections.clear()
        self._dynamic_tools.clear()


_manager_instance: Optional[MCPManager] = None
_manager_lock = threading.Lock()


def get_mcp_manager() -> MCPManager:
    global _manager_instance
    with _manager_lock:
        if _manager_instance is None:
            _manager_instance = MCPManager()
        return _manager_instance
