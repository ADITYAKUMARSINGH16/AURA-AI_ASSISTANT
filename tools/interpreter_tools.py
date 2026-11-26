"""
AURA Sandboxed Python Code Interpreter Tool
===========================================
Allows AURA to write and execute in-process or isolated Python code for data
analysis, mathematical calculations, chart generation, and data transformations.
"""

import os
import sys
import subprocess
import tempfile
import time
import uuid
import logging
from typing import Dict, Any

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CHARTS_DIR = os.path.join(_BASE_DIR, "static", "charts")


def _ensure_charts_dir():
    try:
        os.makedirs(_CHARTS_DIR, exist_ok=True)
    except Exception:
        pass


def execute_python_code(code: str, timeout_seconds: int = 20) -> Dict[str, Any]:
    """Executes arbitrary Python code in an isolated subprocess with stdout/stderr capture and chart plotting.

    Use this tool when the user asks you to:
    - Compute complex mathematical or scientific equations
    - Analyze datasets (CSV, JSON, lists) or transform data
    - Generate graphs, plots, or statistical visualizations (matplotlib/numpy)
    - Run algorithmic simulations or batch data calculations

    Args:
        code: Complete, executable Python script string.
        timeout_seconds: Maximum allowed runtime in seconds before terminating (default: 20).

    Returns:
        Dict with 'success', 'stdout', 'stderr', 'charts', 'execution_time_ms', and 'exit_code'.
    """
    _ensure_charts_dir()
    chart_id = f"chart_{uuid.uuid4().hex[:10]}"
    chart_output_path = os.path.join(_CHARTS_DIR, f"{chart_id}.png").replace("\\", "/")

    # Prepend headless matplotlib configuration and auto-save hook
    preamble = f"""
import sys, os
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    _AURA_CHART_PATH = {repr(chart_output_path)}
    def _aura_save_hook(*args, **kwargs):
        if plt.get_fignums():
            plt.savefig(_AURA_CHART_PATH, bbox_inches='tight', dpi=120)
    plt.show = _aura_save_hook
except Exception:
    pass
"""

    postamble = f"""
try:
    import matplotlib.pyplot as plt
    if plt.get_fignums():
        plt.savefig(_AURA_CHART_PATH, bbox_inches='tight', dpi=120)
        plt.close('all')
except Exception:
    pass
"""

    full_script = preamble + "\n# --- User Code ---\n" + code + "\n" + postamble

    python_executable = sys.executable
    venv_python = os.path.join(_BASE_DIR, ".venv", "Scripts", "python.exe")
    if os.path.exists(venv_python):
        python_executable = venv_python

    temp_script_path = os.path.join(tempfile.gettempdir(), f"aura_script_{uuid.uuid4().hex}.py")
    t_start = time.perf_counter()

    try:
        with open(temp_script_path, "w", encoding="utf-8") as f:
            f.write(full_script)

        proc = subprocess.run(
            [python_executable, temp_script_path],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=_BASE_DIR,
            encoding="utf-8",
            errors="replace"
        )
        t_elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 1)

        charts_produced = []
        if os.path.exists(chart_output_path) and os.path.getsize(chart_output_path) > 0:
            charts_produced.append(f"/charts/{chart_id}.png")

        return {
            "success": proc.returncode == 0,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip(),
            "exit_code": proc.returncode,
            "charts": charts_produced,
            "execution_time_ms": t_elapsed_ms,
        }

    except subprocess.TimeoutExpired:
        t_elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 1)
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout_seconds} seconds.",
            "exit_code": -1,
            "charts": [],
            "execution_time_ms": t_elapsed_ms,
        }
    except Exception as e:
        t_elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 1)
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Interpreter error: {e}",
            "exit_code": -1,
            "charts": [],
            "execution_time_ms": t_elapsed_ms,
        }
    finally:
        try:
            if os.path.exists(temp_script_path):
                os.remove(temp_script_path)
        except OSError:
            pass
