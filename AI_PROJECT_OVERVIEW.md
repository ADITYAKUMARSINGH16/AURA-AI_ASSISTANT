# AURA-AI Assistant: Project Overview for AI Agents

## 1. Project Identity & Purpose
**AURA (Autonomous Utility & Response Agent)** is a highly capable, locally-hosted AI assistant optimized for Windows. It integrates a **Gemma 4** model (via Ollama) with a Python-based backend (FastAPI) and provides multiple interfaces, including a **CLI**, a **Cinematic Web Interface**, a **Tactical HUD**, and a **System Tray Daemon**. AURA is designed to be fully private, executing inference and tools entirely on the local machine.

**Primary Capabilities:**
- **Local Inference:** Fully relies on `ollama` for LLM and Vision tasks.
- **Voice Capabilities:** Features Wake-Word detection ("Hey Aura" via `openwakeword`), Speech-To-Text (via `sounddevice` and `speech_recognition`), and Neural Text-To-Speech (via `edge-tts` with a `pyttsx3` fallback), fully supporting conversational interruption/barge-in.
- **Hardware Telemetry & Security Control:** Real-time monitoring of CPU, RAM, GPU, thermals, open ports, and network via `psutil`, `wmi`, and `nvidia-smi`.
- **Agentic Actions & GUI Control:** Can manipulate files, control media, manage system power, control smart home devices, and fully control the desktop GUI (mouse/keyboard) using `pyautogui`.
- **Vision (OCR & VLM Analysis):** Captures the current screen and processes it via Tesseract OCR and the `qwen3-vl:4b` Vision Language Model for deep semantic understanding.

---

## 2. Architecture & Tech Stack

### Backend & Core Logic
- **`api.py` (FastAPI):** The primary server. Serves static files, handles API requests (`/api/chat`, `/api/tts`, `/api/telemetry`, `/api/network/scan`, `/api/processes`, `/api/security`, `/api/fs`), runs the proactive background thread (`run_schedule`), and maintains the global `agent` instance.
- **`agent.py`:** The core AI brain. Manages the system prompt, maintains context, communicates with the Ollama API, and dynamically maps and triggers local Python functions (tools) based on LLM responses.
- **`tray.py`:** The system tray daemon (`pystray`). Allows AURA to run invisibly in the background and provides a right-click menu to launch the web interfaces or shut down the server.
- **`main.py`:** A standalone CLI interface for text/voice interactions without the web server.
- **`vision.py`:** Handles image validation, OCR extraction, and `qwen3-vl` analysis, returning strictly formatted JSON context to prevent hallucinations.
- **`voice.py`:** Handles the audio pipeline. 
  - TTS: Prefers `edge-tts` (neural), falls back to `pyttsx3` (offline). Runs asynchronously.
  - STT: Uses `sounddevice` with RMS-based dynamic silence detection.
  - Wake Word: Uses `openwakeword` in a background thread to detect "Hey Aura" and triggers barge-in if the agent is speaking.
- **`memory.py`:** Manages short-term conversation context, saving it to `memory.json`.

### Configuration Files
- **`proactive_config.json`:** Defines thresholds for background telemetry checks (CPU > 90%, RAM > 90%, low battery).
- **`.env`:** Used to define `OLLAMA_MODEL`.
- **`start_aura.bat`:** Launches the system, automatically elevating to Administrator permissions (crucial for hardware/security tools) and starting `tray.py`.

### Frontend (Static Files in `/static/`)
- **`index.html` & `landing.js/css`:** A cinematic 3D/WebGL landing page showcasing AURA's features.
- **`hud.html` & `script.js/style.css`:** A tactical dashboard fetching real-time telemetry from `/api/telemetry`, providing a command console, and interfacing with the agent via `/api/chat`.

---

## 3. Toolset Matrix (`tools/`)

The agent has access to a comprehensive suite of tools mapped in `agent.py`:

| Tool Category | File | Key Functions |
|---|---|---|
| **System & Telemetry** | `system_tools.py` | `get_system_time`, `get_system_info`, `control_media`, `read_screen`, `manage_schedule` |
| **Windows Diagnostics** | `windows_tools.py` | `get_cpu_info`, `get_gpu_info`, `get_ram_usage`, `get_active_processes`, `get_startup_programs`, `get_windows_services`, `get_system_uptime`, `get_disk_usage`, `get_battery_health`, `get_network_info`, `get_installed_applications`, `get_windows_event_logs` |
| **Security Center** | `security_tools.py` | `get_windows_defender_status`, `get_firewall_status`, `get_listening_ports`, `get_suspicious_files`, `analyze_suspicious_processes`, `get_removable_devices` |
| **Computer Control (GUI)** | `computer_control_tools.py` | `click_text`, `click_coordinates`, `type_text`, `press_key`, `scroll`, `get_active_window` |
| **App & File Management** | `app_tools.py`, `file_tools.py` | `open_application`, `close_application`, `list_directory`, `read_file` |
| **Planner & Execution** | `planner_tools.py` | `create_temporary_plan`, `report_progress` |
| **Memory Management** | `memory_tools.py` | `remember_fact`, `recall_fact`, `search_memory`, `forget_fact` |
| **Smart Home & Media** | `smart_home_tools.py`, `spotify_tools.py` | `discover_smart_devices`, `control_smart_device`, `set_smart_scene`, `search_spotify`, `play_spotify_music` |

---

## 4. Key Workflows

### Standard Agent Interaction (`agent.send_message`)
1. User provides input. Any provided images are routed through `vision.py` first, and the resulting JSON analysis is injected as context.
2. Relevant memories are searched via `memory_tools.py` and appended to the prompt.
3. Sent to Ollama via `ollama.chat(tools=available_tools)`.
4. If the LLM responds with a tool call, the tool is executed sequentially. For example, UI actions like `click_text` automatically take a new screenshot (`read_screen`) to feed the result back to the model.
5. Once all tools finish, a final text response is generated and sent to the frontend.

### Background Scheduler (`api.py:run_schedule`)
- Runs continuously checking system state based on `proactive_config.json`.
- Automatically triggers a "Morning Briefing" at 08:00 AM.
- Proactively pushes alerts to `pending_notifications` if CPU, RAM, or Disk exceeds configured thresholds (e.g., 90%) after a 5-minute sustained window.

### Voice Pipeline (`voice.py`)
- **Listening:** `listen()` uses `sounddevice` to read audio chunks, calculating RMS to detect speech thresholds and silence (stopping after 4 silent chunks).
- **Wake Word:** A separate thread uses `openwakeword`. If triggered while AURA is speaking (`is_speaking=True`), it calls `stop_speaking()` to instantly interrupt playback.

---

## 5. Potential Improvements & Notes for Future AIs
- **OS Dependency:** Telemetry and security heavily rely on Windows-specific commands (`wmi`, `win32evtlog`, `netsh`, PowerShell). Porting to Linux/macOS would require modifying `windows_tools.py` and `security_tools.py`.
- **Model Requirements:** Designed for `gemma4:e2b` (logic) and `qwen3-vl:4b` (vision). Both models are strictly configurable via the `.env` file.
- **Permissions:** Full functionality requires running as Administrator (handled automatically by `start_aura.bat`), otherwise tools querying the registry, event logs, or WMI thermal sensors will return fallback/mocked data.
- **Smart Plugs:** `control_smart_plug` is a mock implementation and needs to be linked to a real protocol (e.g., Tuya/Kasa) in the future.
