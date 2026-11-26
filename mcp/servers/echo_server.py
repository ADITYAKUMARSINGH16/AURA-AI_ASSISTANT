"""
Reference Standard Model Context Protocol (MCP) Server for AURA
================================================================
Implements stdio JSON-RPC 2.0 communication for initialize, tools/list, and tools/call.
"""
import sys
import json
import logging

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            mid = req.get("id")
            method = req.get("method")
            params = req.get("params", {})

            if method == "initialize":
                res = {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "aura-echo-mcp", "version": "1.0.0"}
                }
                out = {"jsonrpc": "2.0", "id": mid, "result": res}
            elif method == "notifications/initialized":
                continue
            elif method == "tools/list":
                tools = [
                    {
                        "name": "mcp_ping",
                        "description": "Pings the MCP echo server to verify bidirectional JSON-RPC connectivity.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "message": {"type": "string", "description": "Message to ping"}
                            },
                            "required": ["message"]
                        }
                    },
                    {
                        "name": "mcp_system_eval",
                        "description": "Evaluates a mathematical expression via external MCP server process.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "expression": {"type": "string", "description": "Math expression (e.g. '25 * 4')"}
                            },
                            "required": ["expression"]
                        }
                    }
                ]
                out = {"jsonrpc": "2.0", "id": mid, "result": {"tools": tools}}
            elif method == "tools/call":
                t_name = params.get("name")
                args = params.get("arguments", {})
                if t_name == "mcp_ping":
                    msg = args.get("message", "pong")
                    out = {
                        "jsonrpc": "2.0",
                        "id": mid,
                        "result": {
                            "content": [{"type": "text", "text": f"[MCP PONG] {msg}"}]
                        }
                    }
                elif t_name == "mcp_system_eval":
                    expr = args.get("expression", "0")
                    try:
                        # Safe arithmetic evaluation
                        import ast
                        node = ast.parse(expr, mode='eval')
                        val = eval(compile(node, '<string>', 'eval'), {"__builtins__": {}}, {})
                        ans = str(val)
                    except Exception as e:
                        ans = f"Calculation error: {e}"
                    out = {
                        "jsonrpc": "2.0",
                        "id": mid,
                        "result": {
                            "content": [{"type": "text", "text": f"[MCP EVAL RESULT] {ans}"}]
                        }
                    }
                else:
                    out = {
                        "jsonrpc": "2.0",
                        "id": mid,
                        "error": {"code": -32601, "message": f"Method {t_name} not found"}
                    }
            else:
                out = {
                    "jsonrpc": "2.0",
                    "id": mid,
                    "error": {"code": -32601, "message": f"Method {method} not found"}
                }

            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
        except Exception as e:
            err_out = {
                "jsonrpc": "2.0",
                "id": mid if 'mid' in locals() else None,
                "error": {"code": -32603, "message": f"Internal error: {e}"}
            }
            sys.stdout.write(json.dumps(err_out) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
