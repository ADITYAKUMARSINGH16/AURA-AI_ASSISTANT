# AURA-AI Assistant: Comprehensive Project Overview for AI Agents

## 1. Project Identity & Purpose
**AURA (Autonomous Utility & Response Agent)** is a locally-hosted, multimodal autonomous AI assistant engineered for Windows. Powered by the **Gemma 4** family (`gemma4:e2b`) for natural language and reasoning, and **Qwen3-VL** (`qwen3-vl:4b`) for visual comprehension via **Ollama**, AURA provides an extensive suite of local agentic actions, system telemetry, continuous voice interactions, and security surveillance without external cloud reliance.

### Primary Capabilities:
- **100% Local Inference:** Ollama LLM and VLM processing ensures absolute privacy.
- **Continuous Voice Interaction:** Wake-word detection ("Hey Aura" via `openwakeword`), dynamic RMS speech detection, and real-time neural TTS (`edge-tts` with offline `pyttsx3` fallback), supporting conversational interruption / barge-in.
- **Multi-Modal Vision & GUI Automation:** Screen capture pipeline with Tesseract OCR and VLM analysis coupled with `pyautogui` for autonomous desktop control.
- **Hardware Telemetry & Security Diagnostics:** Real-time monitoring of CPU, RAM, GPU, thermals, processes, network ports, and firewall integrity via `psutil`, `wmi`, and PowerShell.
- **Agentic Multi-Step Planner:** Autonomous goal decomposition, dependency sequencing, and progress verification.
- **Dual-Layer Memory:** Ephemeral session memory (`memory.json`) and persistent semantic long-term storage (`ltm_db.json` / `long_term_memory.json`).
- **Rich Interfaces:** Cinematic WebGL/Three.js landing page (`index.html`), Tactical 4-theme HUD (`hud.html`), and background Windows System Tray daemon (`tray.py`).

---

## 2. Architecture & Tech Stack

### Core Modules (`/`)
- **`api.py` (FastAPI + Uvicorn):** The central HTTP and WebSocket server. Serves static files, manages REST endpoints (`/api/chat`, `/api/tts`, `/api/telemetry`, `/api/network/scan`, `/api/processes`, `/api/security`, `/api/fs`), coordinates the proactive background scheduler (`run_schedule`), and maintains the global `agent` instance.
- **`agent.py`:** Core cognitive orchestrator.
  - **Intent Router (`analyze_intent`):** Pre-classifies user prompt to select a minimal tool subset, filter dangerous commands, and determine if an agentic plan is required.
  - **Ollama Client:** Sends system prompt, context, memories, and tools to Ollama.
  - **Tool Dispatcher:** Executes Python tool functions in sequence, handling intermediate feedback and screenshots.
- **`vision.py`:** Screen vision engine. Captures displays, crops active regions, runs Tesseract OCR for text extraction, and sends images to `qwen3-vl:4b` for spatial reasoning, returning structured JSON schemas.
- **`voice.py`:** Comprehensive audio pipeline.
  - **TTS:** Async neural synthesis via `edge-tts` saved to temp `.mp3` and played via `pygame.mixer`, with offline fallback to `pyttsx3`.
  - **STT:** `sounddevice` stream analyzing chunk RMS power for adaptive silence cutoff.
  - **Wake-Word:** Background `openwakeword` thread monitoring for "Hey Aura"; immediately terminates active speech playback for natural barge-in.
- **`memory.py`:** Manages short-term conversation context in `memory.json` and long-term memory queries.
- **`permissions.py`:** Security gateway enforcing execution policies (safe vs. dangerous operations) with user confirmation gates.
- **`tray.py`:** Windows System Tray integration (`pystray`) enabling silent background operation with right-click launch options.
- **`main.py`:** Standalone CLI interface for terminal-only interaction.

### Frontend (`/static/`)
- **Landing Page (`index.html`, `landing.css`, `landing.js`):**
  - WebGL background shader & Three.js 3D globe.
  - Three.js glowing particle trails around the hero orbital logo.
  - 3D mouse parallax tilt with smooth lerp lag factor and 5-depth ambient orbs.
  - Top scroll progress bar & staggered `IntersectionObserver` section reveals.
  - 6 feature card animated hover mini-demos (Voice waveforms, OCR bounding boxes, Device mesh discovery, Telemetry arc gauges with CSS counters, Port sentinel audit, and Agentic checklist).
  - Interactive terminal auto-typing demonstration.
  - Web Audio API SFX synthesizer and Konami code easter egg.
- **Tactical Command HUD (`hud.html`, `style.css`, `script.js`):**
  - Full-screen cybernetic operator console with responsive grid layout.
  - **4 Dynamic Color Themes:** Cyan (Default), Crimson (Alert), Emerald (Matrix), and Violet (Psionic) with persistent `localStorage` state.
  - Real-time diagnostic gauges, process manager, network scanner, file browser, and audio waveform visualizer.
  - Spotlight search overlay (`Ctrl + K`) to instantly jump to any HUD panel.

---

## 3. Toolset Matrix (`tools/`)

| Tool Module | Key Functions | Description |
|---|---|---|
| **`system_tools.py`** | `get_system_time`, `get_system_info`, `control_media`, `read_screen`, `manage_schedule` | Basic OS status, media playback keys, screen capture, and timer schedules. |
| **`windows_tools.py`** | `get_cpu_info`, `get_gpu_info`, `get_ram_usage`, `get_active_processes`, `get_startup_programs`, `get_windows_services`, `get_system_uptime`, `get_disk_usage`, `get_battery_health`, `get_network_info`, `get_installed_applications`, `get_windows_event_logs` | Deep Windows diagnostics via WMI, PowerShell, and Win32 APIs. |
| **`security_tools.py`** | `get_windows_defender_status`, `get_firewall_status`, `get_listening_ports`, `get_suspicious_files`, `analyze_suspicious_processes`, `get_removable_devices` | Local threat surveillance, port inspection, and firewall policy checks. |
| **`computer_control_tools.py`** | `click_text`, `click_coordinates`, `type_text`, `press_key`, `scroll`, `get_active_window` | GUI automation through `pyautogui` and OCR-assisted element targeting. |
| **`planner_tools.py`** | `create_temporary_plan`, `report_progress` | Multi-step agentic planner for autonomous multi-tool execution. |
| **`memory_tools.py`** | `remember_fact`, `recall_fact`, `search_memory`, `forget_fact` | Long-term memory query and update interface (`ltm_db.json`). |
| **`smart_home_tools.py`** | `discover_smart_devices`, `control_smart_device`, `set_smart_scene` | Local IoT discovery and smart appliance state management. |
| **`app_tools.py` & `file_tools.py`** | `open_application`, `close_application`, `list_directory`, `read_file` | File system navigation and application lifecycle control. |

---

## 4. Key Execution Workflows

### 1. User Message Processing (`agent.py:send_message`)
1. **Input Ingestion:** User prompt and optional image attachment received.
2. **Vision Pre-processing:** If an image is provided, `vision.py` analyzes it with OCR and `qwen3-vl:4b`, embedding structured findings into the prompt context.
3. **Intent Routing:** `analyze_intent()` uses the LLM to classify the query type, determine required tools, and detect dangerous actions.
4. **Memory Injection:** Semantic memories from `ltm_db.json` are fetched and injected.
5. **Tool Execution Loop:** The agent invokes Ollama with the dynamically subsetted tool definitions. If a tool call is returned, AURA executes it, appends the output to the conversation context, and re-invokes the model until a final answer is synthesized.
6. **Output Delivery:** Response text is returned to the UI while TTS audio is synthesized and streamed.

### 2. Proactive Telemetry Daemon (`api.py:run_schedule`)
- Continuously polls hardware utilization against thresholds defined in `proactive_config.json`.
- Evaluates CPU (>90%), RAM (>90%), and low battery conditions over a sustained window before queuing notifications to the HUD.
- Executes daily automated morning briefings at 08:00 AM.

---

## 5. Important Guidelines for AI Agents Modifying This Project
- **Windows Integration:** The project relies heavily on Windows APIs (`wmi`, `winreg`, `win32evtlog`, PowerShell). Ensure fallbacks exist when testing in non-elevated environments.
- **CSS Variable Cascade & Themes:** The HUD supports 4 themes via `:root` classes (`.theme-crimson`, `.theme-emerald`, `.theme-violet`). Set variables via both `document.documentElement.style.setProperty` and class toggles to ensure consistent theme propagation.
- **Tool Registration:** When adding new tools in `tools/`, register them in `tools/__init__.py` and include their schemas in `agent.py:AVAILABLE_TOOLS`.
- **Model Compatibility:** Default models are `gemma4:e2b` (reasoning) and `qwen3-vl:4b` (vision). Keep prompts compatible with Ollama OpenAI-compatible tool-calling schemas.
