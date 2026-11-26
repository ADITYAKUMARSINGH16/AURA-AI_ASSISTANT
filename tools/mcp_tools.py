"""
AURA Model Context Protocol (MCP) Management Tools
==================================================
Allows AURA to inspect connected MCP servers, reload tool specifications,
and directly invoke MCP tools.
"""

import json
from typing import Dict, Any, Optional
from mcp.client import get_mcp_manager


def list_mcp_servers() -> Dict[str, Any]:
    """Lists all configured and active Model Context Protocol (MCP) servers and their tools.

    Returns the server name, connection status, server metadata, and list of available
    tools with parameter schemas.
    """
    mgr = get_mcp_manager()
    servers = mgr.list_servers_info()
    return {
        "status": "success",
        "active_servers_count": len([s for s in servers if s.get("connected")]),
        "servers": servers
    }


def reload_mcp_servers() -> Dict[str, Any]:
    """Reloads the MCP configuration and reconnects to all enabled MCP servers.

    Use this when new MCP servers have been added to config/mcp_servers.json.
    """
    mgr = get_mcp_manager()
    mgr.load_and_connect()
    servers = mgr.list_servers_info()
    tool_count = sum(len(s.get("tools", [])) for s in servers)
    return {
        "status": "success",
        "message": f"Reloaded MCP servers: {len(servers)} server(s) active, {tool_count} tool(s) discovered.",
        "servers": [s["name"] for s in servers]
    }


def call_mcp_tool(server_name: str, tool_name: str, arguments: Optional[Dict[str, Any]] = None) -> str:
    """Invokes a specific tool on a connected Model Context Protocol (MCP) server.

    Args:
        server_name: The name of the target MCP server (e.g. 'local_helper').
        tool_name: The tool name on that server (e.g. 'mcp_ping', 'mcp_system_eval').
        arguments: Dictionary of arguments matching the tool's input schema.

    Returns:
        The text result or error returned by the MCP server.
    """
    mgr = get_mcp_manager()
    args = arguments or {}
    res = mgr.call_tool(server_name, tool_name, args)
    if "error" in res:
        return f"Error from MCP server '{server_name}': {res['error']}"
    content = res.get("content", [])
    if isinstance(content, list):
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and "text" in c]
        return "\n".join(texts) if texts else json.dumps(res)
    return str(res)
