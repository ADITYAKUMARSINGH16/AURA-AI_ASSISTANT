# AURA — Autonomous Utility & Response Agent

![AURA Banner](static/logo.jpg)

**AURA** is a locally-hosted, voice-enabled AI assistant paired with a **Cinematic Sci-Fi Landing Page** and a full-screen **Tactical HUD Command Console**. Powered by the [Ollama](https://ollama.com/) framework running the **Gemma 4** model, AURA provides autonomous agency, system control, vision (OCR), and telemetry without sending your data to the cloud.

---

## ⚡ Highlights

- **100% Local Inference:** Zero cloud reliance — total data privacy.
- **Cinematic Landing Page:** WebGL nebula shaders, 3D wireframe globe, boot sequence simulation, Web Audio SFX, interactive terminal, and feature comparison.
- **Tactical HUD Interface:** Real-time sci-fi dashboard featuring an arc-reactor core, live diagnostics, hardware thermals, waveform audio visualizer, and command console.
- **Multi-Modal Voice Core:** Neural Text-to-Speech (Edge-TTS) with seamless Speech-to-Text (STT) and Wake Word ("Hey Aura").
- **Real-Time Hardware Telemetry:** CPU load & thermals, GPU load, VRAM, fan speeds (via WMI and `nvidia-smi`), Wi-Fi uplink, and memory metrics.
- **Agentic Tool Execution:** Autonomous capabilities including screen reading (OCR), media playback, smart home & network scanning, file manipulation, and system management.

---

## 🚀 Interactive Interfaces

| Interface | URL | Description |
|-----------|-----|-------------|
| **Cinematic Landing Page** | `http://127.0.0.1:8000/` | Interactive showcase with 3D globe, WebGL shaders, sound effects, system specs, live terminal, and preview carousel. |
| **Tactical Command HUD** | `http://127.0.0.1:8000/hud.html` | The primary operational dashboard with live voice recognition, system telemetry, and agent chat. |

---

## 🛠️ Features & Agent Capabilities

### 1. Vision & Screen Analysis (OCR)
- Captures and inspects active screen content in real time using Tesseract OCR.
- Allows AURA to "see" your work, error logs, documents, and browsers to answer contextual queries.

### 2. Voice & Wake Word
- **Wake Word Detection:** Hands-free voice activation.
- **Neural Speech Synthesis:** High-fidelity Edge-TTS voice generation with fallback to pyttsx3.
- **Microphone Recognition:** Speech-to-Text processing with real-time feedback.

### 3. Hardware Monitoring & Diagnostics
- **CPU:** Load percentage, real-time core temperature (°C via WMI), and fan RPM.
- **GPU:** Dedicated GPU temperature, VRAM allocation (`used / total MB`), and fan speed via `nvidia-smi`.
- **System:** Memory consumption, battery/power cell status, and Wi-Fi signal strength.

### 4. System & Application Control
- Launch or terminate applications and processes.
- Lock PC, trigger sleep, or safely schedule shutdowns.
- Media controls (Volume up/down/mute, play/pause track, Spotify integration).

### 5. Memory & Context Archives
- Persistent sliding-window conversation history stored in `memory.json`.
- Long-term memory store (`long_term_memory.json`) for facts, operator preferences, and notes.

---

## 📦 Prerequisites

- **Python 3.10+**
- **Ollama** installed and running ([Download Ollama](https://ollama.com/download))
- **Gemma 4** model pulled locally:
  ```bash
  ollama pull gemma4:e2b
  ```
- **Microphone & Speakers** for full voice capabilities
- *(Optional)* **Tesseract OCR** for screen vision support ([Download Tesseract](https://github.com/UB-Mannheim/tesseract/wiki))

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
   pip install wmi pypiwin32 edge-tts pygame
   ```

4. **Configure Environment:**
   Create or verify `.env` in the root directory:
   ```env
   OLLAMA_MODEL=gemma4:e2b
   ```

---

## 🎮 Running AURA

### 1. Web Application & HUD (Recommended)

Start the FastAPI / Uvicorn server:
```bash
python -m uvicorn api:app --host 127.0.0.1 --port 8000 --reload
```

- Navigate to `http://127.0.0.1:8000/` for the **Cinematic Landing Page**.
- Navigate to `http://127.0.0.1:8000/hud.html` for the **Tactical Command HUD**.

### 2. Classic Terminal Mode

To run AURA exclusively in the CLI:
```bash
python main.py
```
Select either **Text** or **Voice** mode when prompted.

### 3. Streamlit Web Interface

To run the lightweight chat interface via Streamlit:
```bash
streamlit run app.py
```

---

## 📂 Project Architecture

```
├── api.py                    # FastAPI server (serves APIs, HUD, and Landing Page)
├── app.py                    # Streamlit web interface
├── agent.py                  # Core agent reasoning, Ollama client & tool dispatcher
├── main.py                   # CLI terminal interface
├── memory.py                 # Short-term and long-term conversation memory manager
├── voice.py                  # STT listening & Edge-TTS audio generation
├── config.py                 # Configuration & environment loader
├── requirements.txt          # Python dependencies
├── memory.json               # Local short-term conversation context
├── long_term_memory.json     # Local long-term knowledge archive
├── static/
│   ├── index.html            # Cinematic landing page
│   ├── hud.html              # Tactical HUD interface
│   ├── landing.css           # Landing page stylesheet & animations
│   ├── landing.js            # Landing page 3D globe, WebGL shaders & SFX
│   ├── style.css             # Tactical HUD stylesheet
│   ├── script.js             # Tactical HUD logic & API polling
│   ├── logo.jpg              # AURA emblem asset
│   └── hud_screenshot.png    # Interface preview asset
└── tools/
    ├── __init__.py           # Unified tool registration
    ├── system_tools.py       # OS, hardware telemetry & thermal monitoring
    ├── app_tools.py          # Application execution & management
    ├── web_tools.py          # DuckDuckGo search & web scraping
    ├── file_tools.py         # Local filesystem explorer
    ├── memory_tools.py       # Long-term memory query & save tools
    ├── smart_home_tools.py   # Smart home device integration (lights, plugs)
    └── spotify_tools.py      # Media & Spotify integration
```

---

## ⌨️ Landing Page Easter Eggs & Controls

- **Interactive Terminal:** Type `help`, `status`, `scan`, `whoami`, `ping`, `threat`, or `time` directly in the browser terminal.
- **Audio Toggle:** Click the speaker icon in the navigation bar to enable sci-fi Web Audio hover & action sound effects.
- **Konami Code:** Type `↑ ↑ ↓ ↓ ← → ← → B A` on the landing page for a secret visual overload!

---

## 🛡️ License

Created for personal and educational use. All subsystems local.
