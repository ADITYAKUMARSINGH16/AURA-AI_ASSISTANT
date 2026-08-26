# AURA 2.0 — Autonomous Utility & Response Agent

![AURA Banner](static/logo_small.png)

**AURA 2.0** is a locally-hosted, fully autonomous multi-modal AI assistant paired with a **Cinematic Sci-Fi Landing Page** and a full-screen **Tactical HUD Command Console**. Powered by the [Ollama](https://ollama.com/) framework running the **Gemma 4 E2B** model for cognition and **Qwen3-VL 4B** for vision, AURA 2.0 provides advanced agentic planning, computer vision, local security scanning, long-term memory, continuous voice interactions, and system telemetry. LLM reasoning and vision run 100% locally; voice STT/TTS use cloud services (see *Voice Pipeline Privacy*).

---

## ⚡ Highlights

- **Local LLM Inference:** Cognition and vision run entirely on your machine via Ollama. Voice features are the exception — see *Voice Pipeline Privacy* below.
- **Cinematic Landing Page:** 
  - 3D mouse parallax tilt with smooth lerp momentum lag and 5-layer depth orbs.
  - Glowing Three.js orbital particle trails synchronized to rotational physics.
  - CSS-only animated mini-demos on feature card hover (Waveforms, OCR boxes, Mesh discovery, Telemetry arc gauges with CSS counters, Port sentinel, Agentic checklist).
  - Top scroll progress indicator and staggered section reveals.
  - Live hero telemetry bar polling system CPU, uptime, and AI status.
  - Interactive terminal auto-typing demonstration.
- **Tactical HUD Command Console:**
  - 4 Dynamic Color Themes: **Cyan (Default)**, **Crimson (Alert)**, **Emerald (Matrix)**, and **Violet (Psionic)** with persistent memory.
  - Real-time sci-fi dashboard featuring live diagnostics, hardware thermals, waveform audio visualizer, and command console.
  - Quick panel search spotlight (`Ctrl + K`) and customizable grid presets.
- **Dynamic Intent Routing:** Pre-processes user inputs using LLM classification to categorize requests, subset available tools dynamically, and route to specific skills for faster, lower-latency execution.
- **Advanced Agentic Planner:** Multi-step autonomous task decomposition, dependency sequencing, tool chaining, and progress verification.
- **Vision & GUI Desktop Automation:** Deep integration of VLM (`Qwen3-VL 4B`) and OCR (`Tesseract`) allowing AURA to read the screen and control Windows via keyboard and mouse actions (`pyautogui`).
- **Continuous Voice Interaction:** Advanced barge-in interruption, dynamic RMS silence detection, and continuous conversational looping using Edge-TTS and OpenWakeWord ("Hey Aura").
- **Persistent Long-Term Memory:** Semantic memory database (`ltm_db.json`) allowing AURA to remember user preferences, environment facts, and cross-session knowledge.
- **Local Security Center:** Proactive scanning suite for listening ports, rogue processes, firewall integrity, and downloaded file threats.
- **Proactive Telemetry Daemon:** Runs continuously in the background, pushing alerts for critical CPU/RAM/Disk loads and triggering morning briefings.
- **System Tray Integration:** Runs silently in the background via Windows system tray (`pystray`) for instant access.

---

## 🚀 Interactive Interfaces

| Interface | URL / Path | Description |
|---|---|---|
| **Cinematic Landing Page** | `http://127.0.0.1:8000/` | Interactive showcase featuring 3D parallax, Three.js particle orbits, feature card hover mini-demos, live terminal, and sound effects. |
| **Tactical Command HUD** | `http://127.0.0.1:8000/hud.html` | The primary operational dashboard with 4 selectable color themes, live telemetry, audio visualizers, and agent chat. |
| **System Tray Daemon** | `tray.py` / `start_aura.bat` | Background taskbar daemon with right-click launch options and proactive scheduler monitoring. |

---

## 🛠️ AURA 2.0 Unified Architecture

```text
                           [ AURA Core: Gemma 4 E2B ]
                                       │
                ┌──────────────┬───────┼───────┬──────────────┐
                ▼              ▼       ▼       ▼              ▼
           [ Vision ]      [ Memory ] [ Planner ] [ System ] [ Voice ]
                │              │       │       │              │
           Screenshot      Long-Term Multi-Step Windows    STT / Edge-TTS
           OCR & VLM       Archive   Execution OS Control   Wake-Word Loop
                │              │       │       │              │
                └──────────────┴───────┼───────┴──────────────┘
                                       ▼
                              [ Intent Router ]
                                       │
                      ┌────────────────┼────────────────┐
                      ▼                ▼                ▼
                 [ Web Intel ]   [ Smart Home ]   [ Security ]
```

### Core Subsystems:
1. **Vision:** Captures active display frames and processes them via Tesseract OCR and `qwen3-vl:4b` to safely execute GUI interactions.
2. **Memory:** Dual-layer architecture (`memory.json` for conversational context and `ltm_db.json` for semantic long-term knowledge).
3. **Planner:** Autonomous execution engine that breaks complex user requests into structured steps with real-time verification and HUD notifications.
4. **System:** Deep integration via `psutil`, `wmi`, and `winreg` for hardware telemetry, and desktop manipulation via `pyautogui`.
5. **Voice:** Edge-TTS combined with PyAudio/Sounddevice and OpenWakeWord, supporting real-time speech barge-in and audio visualizer output.
6. **Security Center:** Scans for active listening ports, suspicious processes, Windows Defender status, and network devices.
7. **Intent Router:** Intelligent pre-processing classifier in `agent.py` that selects minimal tool subsets and routes dangerous tasks for safety confirmation.

---

## 📦 Prerequisites

- **Python 3.10+**
- **Windows OS** (required for WMI telemetry, Registry access, and certain security tools)
- **Ollama** installed and running ([Download Ollama](https://ollama.com/download))
- **Gemma 4** model pulled locally:
  ```bash
  ollama pull gemma4:e2b
  ```
- **Qwen3-VL 4B** model for the vision pipeline:
  ```bash
  ollama pull qwen3-vl:4b
  ```
- **Microphone & Speakers** for full voice capabilities
- **Tesseract OCR** for screen vision support ([Download Tesseract](https://github.com/UB-Mannheim/tesseract/wiki))

---

## 🔧 Installation & Setup

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/your-repo/aura.git
   cd aura
   ```

2. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Install Hardware & Audio Extras (Recommended):**
   ```bash
   pip install wmi pypiwin32 edge-tts pygame pystray pyautogui pygetwindow
   ```

4. **Configure Environment:**
   Create or verify `.env` in the root directory:
   ```env
   OLLAMA_MODEL=gemma4:e2b
   OLLAMA_VISION_MODEL=qwen3-vl:4b
   ```

---

## 🎮 Running AURA

### 1. Automated Launch (Recommended)
Double click `start_aura.bat`. This automatically requests Administrator privileges (required for hardware sensors, event logs, and firewall inspections) and starts the `tray.py` daemon with the web server.

### 2. Manual Web Server Launch
Start the FastAPI / Uvicorn server directly:
```bash
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```
- Navigate to `http://127.0.0.1:8000/` for the **Cinematic Landing Page**.
- Navigate to `http://127.0.0.1:8000/hud.html` for the **Tactical Command HUD**.

### 3. Classic Terminal Mode
To run AURA exclusively in the CLI for text/voice interactions without the web server:
```bash
python main.py
```

---

## 📂 Project Structure

```
├── api.py                    # FastAPI server (APIs, HUD, Landing Page, and Scheduler)
├── agent.py                  # Core agent reasoning, Intent Router & tool dispatcher
├── main.py                   # CLI terminal interface
├── tray.py                   # Windows System Tray daemon for background execution
├── vision.py                 # Multi-modal vision pipeline (OCR + Qwen3-VL)
├── voice.py                  # STT listening, Wake-word detection, & Edge-TTS
├── memory.py                 # Conversation memory manager
├── config.py                 # Configuration & environment loader
├── permissions.py            # Security & tool execution permission rules
├── ltm_db.json               # Long-term knowledge base
├── memory.json               # Short-term session context
├── proactive_config.json     # Background telemetry thresholds
├── requirements.txt          # Python dependencies
├── static/
│   ├── index.html            # Cinematic landing page
│   ├── landing.css           # Landing page stylesheet & mini-demo animations
│   ├── landing.js            # Landing page Three.js, parallax, & terminal modules
│   ├── hud.html              # Tactical HUD interface
│   ├── style.css             # Tactical HUD stylesheet & color themes
│   ├── script.js             # Tactical HUD interactions & WebSocket/API client
│   └── ...                   # Audio assets & logos
└── tools/
    ├── __init__.py               # Unified tool registration
    ├── system_tools.py           # OS, hardware telemetry & power control
    ├── windows_tools.py          # Windows OS diagnostics & registry queries
    ├── computer_control_tools.py # GUI automation (mouse/keyboard via pyautogui)
    ├── security_tools.py         # Threat scanning, firewall & listening ports
    ├── planner_tools.py          # Multi-step goal planner & progress reporting
    ├── memory_tools.py           # Long-term knowledge queries
    ├── smart_home_tools.py       # Smart home mesh control
    └── ...                       # Additional tool modules
```

---

## 🔐 Tool Permission Levels

Every tool call passes through `permissions.py` before execution:

| Level | Behavior | Examples |
|---|---|---|
| SAFE / LOW | Runs immediately | system info, web search, read file, security status scanners (`get_listening_ports`, `get_suspicious_files`, `get_removable_devices`, `analyze_suspicious_processes`) |
| MEDIUM | Needs approval unless **Trusted Mode** is ON in the HUD | open/close apps, media, smart home, screen capture (`read_screen`), `run_threat_scan` |
| HIGH / CRITICAL | Always needs approval via the HUD **SECURITY CLEARANCE** panel or a conversational "yes" | GUI automation (`execute_visual_task`), memory deletion (`forget_memory`), shutdown/restart |

Pending actions appear in the HUD panel with AUTHORIZE / REJECT buttons; approving makes AURA re-run the tool automatically.

## 🎙️ Voice Pipeline Privacy

- **Wake word ("Hey Aura"):** fully offline (local OpenWakeWord model). Test it standalone with `python test_wakeword.py --duration 30`.
- **Speech-to-text:** uses Google's free recognizer (`speech_recognition`), which sends the recorded clip to Google's servers. No internet = no STT.
- **Text-to-speech:** Edge-TTS synthesizes via Microsoft's service. Offline it falls back to Windows pyttsx3.

## ⚠️ Known Limitations

- The wake-word model can false-trigger on long sustained tones (~1 kHz); keep `AURA_WAKEWORD_THRESHOLD` at 0.6+ if this affects you.
- On 4 GB VRAM GPUs, `gemma4:e2b` partially offloads to CPU: expect ~10–30 s per response and a slower intent-router pass. Lower `OLLAMA_NUM_CTX`, or disable the router with `AURA_INTENT_ROUTER=off`, to reduce latency.
- Running both the main model and vision model back-to-back causes model load/unload churn in Ollama on small VRAM budgets.

---

## ⌨️ Interactive Features & Easter Eggs

- **HUD Color Themes:** Click the 4 theme dots under `SIGNAL / UPLINK` on the HUD to switch between Cyan, Crimson, Emerald, and Violet.
- **Spotlight Panel Search:** Press `Ctrl + K` in the HUD to quickly jump to any diagnostic panel.
- **Feature Card Mini-Demos:** Hover over any of the 6 feature cards on the landing page to view interactive animated mockups.
- **Interactive Landing Terminal:** Type `help`, `status`, `scan`, `whoami`, `ping`, `threat`, `time`, or `about` directly in the browser terminal.
- **Web Audio Sound Effects:** Click the speaker icon in the navigation bar to toggle cybernetic interaction audio.
- **Konami Code:** Press `↑ ↑ ↓ ↓ ← → ← → B A` on the landing page for a secret visual overload!

---

## 🛡️ License

Created for personal and educational use. LLM/vision run locally; see *Voice Pipeline Privacy* for what leaves the machine.
