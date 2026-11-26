"""
Comprehensive test suite for Phase 2: OS Intelligence & Control.
Tests Windows UI Automation (UIA) tools and sandboxed Python Code Interpreter.
"""
import os
import sys
import json
import time

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import tools
from tools.uia_tools import list_open_windows, get_window_controls, click_ui_element, set_ui_element_text
from tools.interpreter_tools import execute_python_code
from agent import tool_map, TOOL_CATEGORIES, available_tools


def test_tool_registration():
    """Verify all Phase 2 tools are registered and documented."""
    phase2_tools = [
        "list_open_windows",
        "get_window_controls",
        "click_ui_element",
        "set_ui_element_text",
        "execute_python_code",
    ]
    for name in phase2_tools:
        assert name in tool_map, f"Tool {name} not found in agent.tool_map"
        tool_fn = tool_map[name]
        assert callable(tool_fn), f"Tool {name} is not callable"
        assert tool_fn.__doc__, f"Tool {name} has no docstring"

    assert "CODE" in TOOL_CATEGORIES, "CODE category missing from TOOL_CATEGORIES"
    assert execute_python_code in TOOL_CATEGORIES["CODE"], "execute_python_code missing from TOOL_CATEGORIES['CODE']"
    assert execute_python_code in TOOL_CATEGORIES["SYSTEM"], "execute_python_code missing from TOOL_CATEGORIES['SYSTEM']"
    for uia_tool in [list_open_windows, get_window_controls, click_ui_element, set_ui_element_text]:
        assert uia_tool in TOOL_CATEGORIES["COMPUTER_CONTROL"], f"{uia_tool.__name__} missing from COMPUTER_CONTROL"


def test_uia_window_listing():
    """Verify list_open_windows returns desktop window information."""
    res = list_open_windows()
    assert isinstance(res, list), f"Expected list, got {type(res)}"
    print(f"    Discovered {len(res)} open windows via desktop enumeration.")
    if len(res) > 0:
        first = res[0]
        assert "title" in first
        assert "hwnd" in first


def test_uia_window_controls_nonexistent():
    """Verify get_window_controls returns structured error for non-existent window."""
    res = get_window_controls("__NON_EXISTENT_WINDOW_TITLE_12345__")
    assert isinstance(res, dict), f"Expected dict, got {type(res)}"
    assert res.get("status") == "not_found"
    assert "message" in res
    assert "open_windows" in res


def test_uia_actions_validation():
    """Verify click_ui_element and set_ui_element_text handle missing windows cleanly."""
    res_click = click_ui_element("__NON_EXISTENT_WINDOW__", "OK")
    assert "error" in res_click.lower() or "not found" in res_click.lower()

    res_set = set_ui_element_text("__NON_EXISTENT_WINDOW__", "Edit", "Hello")
    assert "error" in res_set.lower() or "not found" in res_set.lower()


def test_interpreter_basic_computation():
    """Verify Python code interpreter executes mathematical code and captures stdout."""
    code = """
total = sum(i ** 2 for i in range(1, 11))
print(f"SUM_OF_SQUARES: {total}")
"""
    res = execute_python_code(code)
    assert isinstance(res, dict), f"Expected dict, got {type(res)}"
    assert res.get("success") is True, f"Execution failed: {res}"
    assert "SUM_OF_SQUARES: 385" in res.get("stdout", ""), f"Unexpected stdout: {res}"
    assert res.get("exit_code") == 0


def test_interpreter_syntax_error():
    """Verify Python code interpreter captures syntax errors cleanly."""
    code = "def broken(:\n    pass"
    res = execute_python_code(code)
    assert res.get("success") is False
    assert "SyntaxError" in res.get("stderr", "")


def test_interpreter_runtime_exception():
    """Verify Python code interpreter captures runtime exceptions without crashing."""
    code = "x = 100 / 0"
    res = execute_python_code(code)
    assert res.get("success") is False
    assert "ZeroDivisionError" in res.get("stderr", "")


def test_interpreter_timeout():
    """Verify Python code interpreter respects execution timeout."""
    code = "import time\ntime.sleep(5)"
    res = execute_python_code(code, timeout_seconds=1)
    assert res.get("success") is False
    assert "Execution timed out" in res.get("stderr", "")


def test_interpreter_matplotlib_chart_generation():
    """Verify Matplotlib figures are automatically intercepted, saved, and returned."""
    code = """
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 50)
y = np.sin(x)

plt.figure(figsize=(6, 4))
plt.plot(x, y, label='Sine Wave', color='cyan')
plt.title('AURA Test Plot')
plt.xlabel('X Axis')
plt.ylabel('Y Axis')
plt.grid(True)
plt.legend()
print("Plot generated successfully.")
"""
    res = execute_python_code(code)
    assert res.get("success") is True, f"Execution failed: {res}"
    assert "Plot generated successfully." in res.get("stdout", "")
    assert len(res.get("charts", [])) > 0, f"No charts returned in result: {res}"

    chart_url = res["charts"][0]
    assert chart_url.startswith("/charts/"), f"Unexpected chart URL: {chart_url}"
    assert chart_url.endswith(".png"), f"Expected PNG chart: {chart_url}"

    # Extract filename
    chart_filename = os.path.basename(chart_url)
    chart_path = os.path.join(_PROJECT_ROOT, "static", "charts", chart_filename)
    assert os.path.exists(chart_path), f"Chart file does not exist at {chart_path}"
    assert os.path.getsize(chart_path) > 1000, f"Chart file is unexpectedly small: {os.path.getsize(chart_path)} bytes"
    print(f"    Matplotlib chart successfully saved to {chart_path} ({os.path.getsize(chart_path)} bytes)")


if __name__ == "__main__":
    print("Running Phase 2 OS Intelligence & Control tests...")
    test_tool_registration()
    print("  [PASS] test_tool_registration")
    test_uia_window_listing()
    print("  [PASS] test_uia_window_listing")
    test_uia_window_controls_nonexistent()
    print("  [PASS] test_uia_window_controls_nonexistent")
    test_uia_actions_validation()
    print("  [PASS] test_uia_actions_validation")
    test_interpreter_basic_computation()
    print("  [PASS] test_interpreter_basic_computation")
    test_interpreter_syntax_error()
    print("  [PASS] test_interpreter_syntax_error")
    test_interpreter_runtime_exception()
    print("  [PASS] test_interpreter_runtime_exception")
    test_interpreter_timeout()
    print("  [PASS] test_interpreter_timeout")
    test_interpreter_matplotlib_chart_generation()
    print("  [PASS] test_interpreter_matplotlib_chart_generation")
    print("\nALL PHASE 2 TESTS PASSED!")
