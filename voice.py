import speech_recognition as sr
import sounddevice as sd
import scipy.io.wavfile as wav
import numpy as np
import tempfile
import os
import subprocess
import re
import time
import uuid
import asyncio
import logging
import collections
from dotenv import load_dotenv

# Ensure .env is loaded for standalone or module usage
load_dotenv()

# ──────────── TTS Configuration ────────────
# We try edge-tts first (high-quality neural voice).
# If not installed, we fall back to pyttsx3 with tuned settings.
#
# To upgrade to neural voice, run:  pip install edge-tts pygame
#
# Voice options for edge-tts (ultra-realistic human neural models):
#   en-US-AvaNeural       - Female, ultra-realistic conversational (Default)
#   en-US-AndrewNeural    - Male, warm natural conversational
#   en-US-EmmaNeural      - Female, expressive natural
#   en-US-JennyNeural     - Female, friendly American
#   en-GB-SoniaNeural     - Female, sophisticated British (Jarvis/Friday)
#   en-GB-RyanNeural      - Male, intellectual British
#   en-US-GuyNeural       - Male, natural American
#   en-US-AriaNeural      - Female, classic tactical assistant

EDGE_TTS_VOICE = os.environ.get("AURA_TTS_VOICE", "en-US-AvaNeural")
EDGE_TTS_RATE = os.environ.get("AURA_TTS_RATE", "+0%")

def set_tts_voice(voice_name: Optional[str] = None, rate: Optional[str] = None):
    global EDGE_TTS_VOICE, EDGE_TTS_RATE
    if voice_name:
        EDGE_TTS_VOICE = voice_name
    if rate:
        EDGE_TTS_RATE = rate

def get_tts_voice() -> str:
    return EDGE_TTS_VOICE

def get_tts_rate() -> str:
    return EDGE_TTS_RATE

_TEMP_DIR = tempfile.gettempdir()
_TTS_PATH = os.path.join(_TEMP_DIR, "aura_tts_output.mp3")

# Global state to prevent self-triggering and allow barge-in
is_speaking = False
_is_listening_active = False

# Rolling ring buffer for one-shot command continuity and live telemetry
_preroll_audio_ring = collections.deque(maxlen=20)
_last_wakeword_preroll = None
_last_wakeword_preroll_ts = 0.0
_last_inference_latency_ms = 0.0

# Echo-guard state: what AURA last said aloud and when she finished saying it.
# Used so the microphone never mistakes her own TTS for a user request.
_last_spoken_text = ""
_last_speak_end = 0.0


def _mark_speech_end():
    global _last_speak_end
    _last_speak_end = time.time()


def _wait_for_speaker_clearance(timeout=25.0, settle=0.8):
    """Blocks while AURA's TTS is playing (or just finished) so the mic
    doesn't capture her own voice as a user request."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_speaking and (time.time() - _last_speak_end) >= settle:
            return True
        time.sleep(0.1)
    return False


def _normalize_words(s):
    return set(w for w in re.sub(r"[^a-z0-9\s]", "", s.lower()).split() if w)


def _is_echo_of_self(text, min_overlap=0.7):
    """True if the transcription closely matches what AURA just said (mic echo)."""
    if not text or not _last_spoken_text:
        return False
    heard = _normalize_words(text)
    said = _normalize_words(_last_spoken_text)
    if not heard:
        return False
    return len(heard & said) / len(heard) >= min_overlap


def stop_speaking():
    """Immediately halts TTS playback if active."""
    global is_speaking
    is_speaking = False
    try:
        import pygame
        if pygame.mixer.get_init():
            pygame.mixer.music.stop()
    except Exception:
        pass
    finally:
        _mark_speech_end()


# ──────────── Audio Normalization & Acoustic Analysis ────────────

def normalize_audio(audio_data: np.ndarray, target_peak: float = 26000.0) -> np.ndarray:
    """Normalizes int16 audio array to target peak amplitude to boost low-volume speech."""
    if len(audio_data) == 0:
        return audio_data
    max_val = float(np.max(np.abs(audio_data)))
    if 0 < max_val < target_peak:
        gain = target_peak / max_val
        gain = min(gain, 4.0)  # Safe gain ceiling to prevent amplifying noise floor excessively
        normalized = np.clip(audio_data.astype(np.float32) * gain, -32768, 32767).astype(np.int16)
        return normalized
    return audio_data


def compute_acoustic_features(audio_samples: np.ndarray, sample_rate: int = 16000) -> dict:
    """Extracts lightweight acoustic features: F0 (pitch), spectral centroid, and spectral tilt."""
    if audio_samples.ndim > 1:
        samples = audio_samples.flatten()
    else:
        samples = audio_samples
    if len(samples) < 256:
        return {"f0_hz": 0.0, "spectral_centroid": 0.0, "energy_rms": 0.0}
    
    samples_f = samples.astype(np.float32)
    rms = float(np.sqrt(np.mean(samples_f ** 2)))
    if rms < 1e-4:
        return {"f0_hz": 0.0, "spectral_centroid": 0.0, "energy_rms": 0.0}

    # 1. Pitch estimation (F0) via autocorrelation within human vocal pitch [70 Hz, 400 Hz]
    min_lag = int(sample_rate / 400)
    max_lag = int(sample_rate / 70)
    
    center_len = min(2048, len(samples_f))
    start_idx = (len(samples_f) - center_len) // 2
    segment = samples_f[start_idx : start_idx + center_len]
    segment = segment - np.mean(segment)
    
    f0 = 0.0
    if len(segment) >= max_lag:
        autocorr = np.correlate(segment, segment, mode='full')
        autocorr = autocorr[len(autocorr)//2 :]
        search_range = autocorr[min_lag : min_lag + (max_lag - min_lag)]
        if len(search_range) > 0 and np.max(search_range) > 0.3 * autocorr[0]:
            peak_lag = min_lag + int(np.argmax(search_range))
            f0 = float(sample_rate / peak_lag)
            
    # 2. Spectral Centroid via FFT
    fft_vals = np.abs(np.fft.rfft(segment))
    freqs = np.fft.rfftfreq(len(segment), 1.0 / sample_rate)
    sum_fft = np.sum(fft_vals)
    centroid = float(np.sum(freqs * fft_vals) / sum_fft) if sum_fft > 0 else 0.0

    return {
        "f0_hz": round(f0, 1),
        "spectral_centroid": round(centroid, 1),
        "energy_rms": round(rms, 1)
    }


def verify_speaker_voiceprint(features: dict, reference_profile: dict = None, tolerance: float = 0.35) -> bool:
    """Verifies if extracted acoustic features match the enrolled reference profile.
    If no reference profile exists or speaker verification is disabled, returns True (pass-through)."""
    if not reference_profile:
        return True
    ref_f0 = reference_profile.get("f0_hz", 0.0)
    ref_centroid = reference_profile.get("spectral_centroid", 0.0)
    
    if ref_f0 > 50 and features.get("f0_hz", 0.0) > 50:
        f0_diff = abs(features["f0_hz"] - ref_f0) / ref_f0
        if f0_diff > tolerance:
            return False
            
    if ref_centroid > 200 and features.get("spectral_centroid", 0.0) > 200:
        centroid_diff = abs(features["spectral_centroid"] - ref_centroid) / ref_centroid
        if centroid_diff > (tolerance * 1.5):
            return False
            
    return True


def _load_speaker_profile() -> dict:
    """Loads enrolled speaker voiceprint if available, or returns empty dict."""
    try:
        import json
        profile_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "speaker_voiceprint.json")
        if os.path.exists(profile_path):
            with open(profile_path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def benchmark_onnx_inference(model_path: str = None, iterations: int = 50) -> dict:
    """Profiles ONNX inference latency for an 80ms chunk (1280 samples at 16kHz)."""
    if not model_path:
        model_path = _get_wakeword_model_path()
    if not model_path or not os.path.exists(model_path):
        return {"error": "model_not_found"}
        
    try:
        from openwakeword.model import Model
        framework = "onnx" if model_path.lower().endswith(".onnx") else "tflite"
        test_model = Model(wakeword_models=[model_path], inference_framework=framework)
        
        dummy_chunk = np.zeros(1280, dtype=np.int16)
        for _ in range(5):
            test_model.predict(dummy_chunk)
            
        latencies = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            test_model.predict(dummy_chunk)
            latencies.append((time.perf_counter() - t0) * 1000.0)
            
        return {
            "iterations": iterations,
            "avg_ms": round(float(np.mean(latencies)), 2),
            "min_ms": round(float(np.min(latencies)), 2),
            "max_ms": round(float(np.max(latencies)), 2),
            "p95_ms": round(float(np.percentile(latencies, 95)), 2),
        }
    except Exception as e:
        return {"error": str(e)}


# ──────────── Detect available TTS engine ────────────
_use_edge_tts = False
_pyttsx3_engine = None

try:
    import edge_tts
    _use_edge_tts = True
    print("[TTS] Using Edge TTS (Neural Voice)")
except ImportError:
    try:
        import pyttsx3
        _pyttsx3_engine = pyttsx3.init()
        # Tune pyttsx3 to sound less robotic
        _pyttsx3_engine.setProperty('rate', 160)      # Slightly slower
        _pyttsx3_engine.setProperty('volume', 0.95)
        # Try to pick a better voice if available
        voices = _pyttsx3_engine.getProperty('voices')
        for v in voices:
            # Prefer a female voice (usually sounds less robotic)
            if 'zira' in v.name.lower() or 'hazel' in v.name.lower():
                _pyttsx3_engine.setProperty('voice', v.id)
                break
        print(f"[TTS] Using pyttsx3 (offline). Install edge-tts for better voice: pip install edge-tts")
    except Exception as e:
        print(f"[TTS] WARNING: No TTS engine available: {e}")

# ──────────── Local Neural Voice Engine (Kokoro-82M) ────────────
_kokoro_instance = None
_kokoro_model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "kokoro")
_kokoro_model_path = os.path.join(_kokoro_model_dir, "kokoro-v0_19.onnx")
_kokoro_voices_path = os.path.join(_kokoro_model_dir, "voices.json")
_kokoro_voices_npz_path = os.path.join(_kokoro_model_dir, "voices.npz")
_kokoro_voices_bin_path = os.path.join(_kokoro_model_dir, "voices-v1.0.bin")


def _ensure_kokoro_voices_file() -> Optional[str]:
    """Return a np.load-compatible Kokoro voices archive (.bin or .npz), converting voices.json if needed."""
    if os.path.exists(_kokoro_voices_bin_path) and os.path.getsize(_kokoro_voices_bin_path) > 0:
        return _kokoro_voices_bin_path
    if os.path.exists(_kokoro_voices_npz_path) and os.path.getsize(_kokoro_voices_npz_path) > 0:
        return _kokoro_voices_npz_path
    if not os.path.exists(_kokoro_voices_path):
        return None
    try:
        import json
        with open(_kokoro_voices_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict) or not raw:
            return None
        arrays = {k: np.asarray(v, dtype=np.float32) for k, v in raw.items()}
        tmp_path = _kokoro_voices_npz_path + ".tmp.npz"
        np.savez(tmp_path, **arrays)
        os.replace(tmp_path, _kokoro_voices_npz_path)
        return _kokoro_voices_npz_path
    except Exception as e:
        logging.warning(f"[TTS] Failed to convert Kokoro voices.json to voices.npz: {e}")
        return None


def _init_kokoro():
    global _kokoro_instance
    if _kokoro_instance is not None:
        return _kokoro_instance
    if os.path.exists(_kokoro_model_path):
        voices_file = _ensure_kokoro_voices_file()
        if not voices_file:
            return None
        try:
            import kokoro_onnx
            _kokoro_instance = kokoro_onnx.Kokoro(_kokoro_model_path, voices_file)
            print("[TTS] Kokoro-ONNX offline neural engine loaded.")
            return _kokoro_instance
        except Exception as e:
            logging.warning(f"[TTS] Failed to initialize Kokoro-ONNX: {e}")
    return None


def _tts_rate_to_speed(rate_str: Optional[str]) -> float:
    """Convert Edge-style rate string (e.g. '+15%', '-10%') into Kokoro speed multiplier."""
    if not rate_str:
        return 1.0
    try:
        pct = float(str(rate_str).strip().replace("%", "").replace("+", ""))
        return max(0.5, min(2.0, round(1.0 + (pct / 100.0), 2)))
    except ValueError:
        return 1.0


def _resolve_edge_voice(requested_voice: Optional[str]) -> str:
    """Ensure Edge-TTS receives a valid Edge Neural voice ID (containing locale hyphens), never a Kokoro ID."""
    cand = (requested_voice or "").strip()
    if cand and "-" in cand:
        return cand
    env_or_default = (EDGE_TTS_VOICE or "").strip()
    if env_or_default and "-" in env_or_default:
        return env_or_default
    return "en-US-JennyNeural"


def _resolve_kokoro_voice(kokoro, requested_voice: str) -> str:
    """Resolve a Kokoro voice ID, falling back to 'af' (or first voice) if an Edge-TTS name is set."""
    voices = getattr(kokoro, "voices", None)
    keys = list(voices.keys()) if hasattr(voices, "keys") else (list(voices.files) if hasattr(voices, "files") else [])
    if requested_voice and requested_voice in keys:
        return requested_voice
    if "af" in keys:
        return "af"
    if keys:
        return keys[0]
    return "af"


def _speak_kokoro(text: str, voice_name: str = "af", rate: Optional[str] = None) -> bool:
    """Speaks using Kokoro-82M offline neural voice."""
    kokoro = _init_kokoro()
    if not kokoro:
        return False
    try:
        import soundfile as sf
        resolved_voice = _resolve_kokoro_voice(kokoro, voice_name)
        speed = _tts_rate_to_speed(rate or EDGE_TTS_RATE)
        samples, sample_rate = kokoro.create(text, voice=resolved_voice, speed=speed, lang="en-us")
        wav_path = _TTS_PATH.replace(".mp3", ".wav")
        sf.write(wav_path, samples, sample_rate)
        _play_mp3(wav_path)
        return True
    except Exception as e:
        logging.warning(f"[TTS] Kokoro synthesis error ({e}).")
        return False


def _cleanup_stale_tts_files(max_age_seconds: int = 3600):
    """Deletes aura_tts_* files older than max_age_seconds from the temp
    directory. Without this, every spoken reply leaves a permanent file behind."""
    try:
        now = time.time()
        for name in os.listdir(_TEMP_DIR):
            if name.startswith("aura_tts_") and (name.endswith(".mp3") or name.endswith(".wav")):
                path = os.path.join(_TEMP_DIR, name)
                try:
                    if now - os.path.getmtime(path) > max_age_seconds:
                        os.remove(path)
                except OSError:
                    pass
    except Exception:
        pass


def _synth_sapi_file(text: str, filepath: str) -> bool:
    """Synthesizes text to a WAV file using native Windows SAPI (offline, zero-network)."""
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            filestream = win32com.client.Dispatch("SAPI.SpFileStream")
            filestream.Open(filepath, 3, False)
            speaker.AudioOutputStream = filestream
            speaker.Speak(text)
            filestream.Close()
            return os.path.exists(filepath) and os.path.getsize(filepath) > 0
        finally:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass
    except Exception as e:
        logging.warning(f"[TTS] SAPI file synthesis failed: {e}")
        return False


def _speak_sapi(text: str):
    """Speaks directly through Windows SAPI (offline fallback)."""
    global is_speaking
    is_speaking = True
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        try:
            speaker = win32com.client.Dispatch("SAPI.SpVoice")
            speaker.Speak(text)
        finally:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass
    except Exception as e:
        logging.warning(f"[TTS] SAPI direct speech failed: {e}")
    finally:
        is_speaking = False
        _mark_speech_end()


def clean_text_for_speech(text: str) -> str:
    """Prepares raw LLM markdown text for natural, conversational human speech.

    Strips code blocks, markdown tables, raw URLs, excessive symbols,
    and expands numbers/units into naturally spoken words.
    """
    if not text:
        return ""

    # 0. Strip reasoning / cognitive thinking traces
    text = re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)

    # 1. Strip triple-backtick code blocks
    text = re.sub(r'```[\s\S]*?```', ' [code omitted] ', text)

    # 2. Strip inline code backticks: `file.py` -> file.py
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # 3. Replace long URLs with clean domain or "the link"
    def _url_sub(match):
        u = match.group(0)
        try:
            from urllib.parse import urlparse
            netloc = urlparse(u).netloc
            return f"link to {netloc}" if netloc else "the link"
        except Exception:
            return "the link"
    text = re.sub(r'https?://\S+', _url_sub, text)

    # 4. Remove markdown images and links: [Title](url) -> Title
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)

    # 5. Remove headers, bold, italics, strikethrough, blockquotes
    text = re.sub(r'#+\s*', '', text)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'__(.*?)__', r'\1', text)
    text = re.sub(r'_(.*?)_', r'\1', text)
    text = re.sub(r'~~(.*?)~~', r'\1', text)
    text = re.sub(r'^\s*>\s*', '', text, flags=re.MULTILINE)

    # 6. Remove bullet points and list numbering
    text = re.sub(r'^\s*[\*\-\+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)

    # 7. Convert common technical symbols to natural conversational words
    text = re.sub(r'\bapprox\.?\b', 'approximately', text, flags=re.IGNORECASE)
    text = re.sub(r'\be\.g\.?\b', 'for example', text, flags=re.IGNORECASE)
    text = re.sub(r'\bi\.e\.?\b', 'that is', text, flags=re.IGNORECASE)
    text = re.sub(r'\bw/\b', 'with', text, flags=re.IGNORECASE)
    text = re.sub(r'\bw/o\b', 'without', text, flags=re.IGNORECASE)
    text = re.sub(r'\bvs\.?\b', 'versus', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*ms\b', r'\1 milliseconds', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*kHz\b', r'\1 kilohertz', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*MHz\b', r'\1 megahertz', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*GB\b', r'\1 gigabytes', text, flags=re.IGNORECASE)
    text = re.sub(r'(\d+)\s*MB\b', r'\1 megabytes', text, flags=re.IGNORECASE)
    text = text.replace('$', ' dollars ').replace('&', ' and ').replace('%', ' percent ')
    text = re.sub(r'->|=>', ' to ', text)

    # 8. Collapse whitespace and newlines into smooth sentence pauses
    text = re.sub(r'\n+', '. ', text)
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'\.\s*\.', '.', text)
    return text.strip()


def speak(text: str):
    """Speaks the given text using the best available TTS engine."""
    global _last_spoken_text
    print(f"\nAURA: {text.strip()}")

    clean_text = clean_text_for_speech(text)
    _last_spoken_text = clean_text

    tts_backend = os.environ.get("AURA_TTS_BACKEND", "edge").lower()

    # 1. If user prefers Kokoro offline neural voice and model is present
    if tts_backend == "kokoro" and os.path.exists(_kokoro_model_path):
        kokoro_voice = os.environ.get("AURA_TTS_VOICE", "af")
        if _speak_kokoro(clean_text, voice_name=kokoro_voice):
            return

    # 2. Try Edge TTS (Neural high-fidelity cloud voice)
    if _use_edge_tts:
        _speak_edge_tts(clean_text)
    elif _speak_kokoro(clean_text):
        return
    elif _pyttsx3_engine:
        _speak_pyttsx3(clean_text)
    else:
        _speak_sapi(clean_text)


def generate_tts_file(text: str, voice: Optional[str] = None, rate: Optional[str] = None, backend: Optional[str] = None) -> str:
    """Generates a TTS audio file and returns its path without playing it.
    Attempts neural Edge TTS first, with automatic fallback to native Windows SAPI.
    """
    global _last_spoken_text
    clean_text = clean_text_for_speech(text)
    _last_spoken_text = clean_text

    _cleanup_stale_tts_files()

    active_voice = _resolve_edge_voice(voice or EDGE_TTS_VOICE)
    active_rate = rate or EDGE_TTS_RATE

    tts_backend = (backend or os.environ.get("AURA_TTS_BACKEND", "edge")).lower()
    if tts_backend == "kokoro" and os.path.exists(_kokoro_model_path):
        kokoro = _init_kokoro()
        if kokoro:
            try:
                import soundfile as sf
                filepath = os.path.join(_TEMP_DIR, f"aura_tts_{uuid.uuid4().hex}.wav")
                kokoro_voice = _resolve_kokoro_voice(kokoro, voice or os.environ.get("AURA_TTS_VOICE", "af"))
                speed = _tts_rate_to_speed(active_rate)
                samples, sample_rate = kokoro.create(clean_text, voice=kokoro_voice, speed=speed, lang="en-us")
                sf.write(filepath, samples, sample_rate)
                if os.path.exists(filepath):
                    return filepath
            except Exception as e:
                logging.warning(f"[TTS] Kokoro file generation failed: {e}")

    # 1. Try Edge TTS (Neural high-quality voice)
    if _use_edge_tts:
        filepath = os.path.join(_TEMP_DIR, f"aura_tts_{uuid.uuid4().hex}.mp3")
        try:
            import edge_tts
            import concurrent.futures
            
            async def _synth():
                # Uses rate=EDGE_TTS_RATE by default unless overridden
                communicate = edge_tts.Communicate(clean_text, active_voice, rate=active_rate)
                await communicate.save(filepath)
            
            # Always run in a fresh thread to avoid event loop conflicts
            def _worker():
                asyncio.run(_synth())
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pool.submit(_worker).result(timeout=15)
                
            if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
                return filepath
        except Exception as e:
            logging.warning(f"[TTS] Edge TTS synthesis failed ({e}). Falling back to native Windows offline voice.")

    # 2. Native Windows SAPI fallback (offline, immediate, zero-network)
    sapi_path = os.path.join(_TEMP_DIR, f"aura_tts_{uuid.uuid4().hex}.wav")
    if _synth_sapi_file(clean_text, sapi_path):
        return sapi_path

    # 3. pyttsx3 fallback
    if _pyttsx3_engine:
        try:
            fallback_path = os.path.join(_TEMP_DIR, f"aura_tts_{uuid.uuid4().hex}.wav")
            _pyttsx3_engine.save_to_file(clean_text, fallback_path)
            _pyttsx3_engine.runAndWait()
            if os.path.exists(fallback_path):
                return fallback_path
        except Exception:
            pass

    return ""


def _speak_edge_tts(text: str, voice: Optional[str] = None, rate: Optional[str] = None):
    """High-quality neural voice via Edge TTS with automatic SAPI fallback."""
    try:
        import asyncio
        import edge_tts

        active_voice = _resolve_edge_voice(voice or EDGE_TTS_VOICE)
        active_rate = rate or EDGE_TTS_RATE

        async def _synth():
            communicate = edge_tts.Communicate(text, active_voice, rate=active_rate)
            await communicate.save(_TTS_PATH)

        # Handle asyncio event loop safely
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pool.submit(_run_in_new_loop, _synth()).result(timeout=15)
        else:
            asyncio.run(_synth())

        if os.path.exists(_TTS_PATH) and os.path.getsize(_TTS_PATH) > 0:
            _play_mp3(_TTS_PATH)
            return
    except Exception as e:
        logging.warning(f"[TTS] Edge TTS playback failed ({e}). Falling back to native voice.")

    # Direct fallback to native Windows SAPI
    _speak_sapi(text)


def _run_in_new_loop(coro):
    """Run a coroutine in a fresh event loop (for thread contexts)."""
    import asyncio
    new_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(new_loop)
    try:
        new_loop.run_until_complete(coro)
    finally:
        new_loop.close()


def _play_mp3(filepath: str):
    """Play an mp3 file."""
    global is_speaking
    is_speaking = True
    try:
        import pygame
        pygame.mixer.init()
        pygame.mixer.music.load(filepath)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy() and is_speaking:
            pygame.time.wait(100)
        pygame.mixer.music.stop()
        pygame.mixer.quit()
    except ImportError:
        # Fallback: Windows media player (silent window)
        subprocess.run(["cmd", "/c", "start", "/min", "/wait", "", filepath], check=False)
    finally:
        is_speaking = False
        _mark_speech_end()


def _speak_pyttsx3(text: str):
    """Offline TTS via pyttsx3 (fallback)."""
    global is_speaking
    is_speaking = True
    try:
        _pyttsx3_engine.say(text)
        _pyttsx3_engine.runAndWait()
    except Exception:
        pass
    finally:
        is_speaking = False
        _mark_speech_end()


# ──────────── Speech-to-Text (STT) Engine ────────────
_whisper_instance = None
_whisper_loaded_config = None


def _init_whisper():
    """Initializes and caches the faster-whisper model on demand."""
    global _whisper_instance, _whisper_loaded_config
    model_name = os.environ.get("AURA_STT_MODEL", "tiny.en")
    device_cfg = os.environ.get("AURA_STT_DEVICE", "auto").lower()
    compute_cfg = os.environ.get("AURA_STT_COMPUTE_TYPE", "auto").lower()

    cfg_key = f"{model_name}:{device_cfg}:{compute_cfg}"
    if _whisper_instance is not None and _whisper_loaded_config == cfg_key:
        return _whisper_instance

    try:
        import faster_whisper
        import ctranslate2

        device = device_cfg
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"

        compute_type = compute_cfg
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

        print(f"[STT] Loading faster-whisper ({model_name} on {device}:{compute_type})...")
        try:
            _whisper_instance = faster_whisper.WhisperModel(model_name, device=device, compute_type=compute_type)
            # Verify CUDA runtime dependencies (e.g. cublas64_12.dll) with a lightweight probe
            if device == "cuda":
                dummy_probe = np.zeros(1600, dtype=np.float32)
                _ = list(_whisper_instance.transcribe(dummy_probe, beam_size=1)[0])
        except Exception as cuda_err:
            if device == "cuda":
                logging.info(f"[STT] CUDA runtime unavailable ({cuda_err}). Seamlessly falling back to CPU int8.")
                device = "cpu"
                compute_type = "int8"
                _whisper_instance = faster_whisper.WhisperModel(model_name, device=device, compute_type=compute_type)
            else:
                raise cuda_err

        _whisper_loaded_config = cfg_key
        print(f"[STT] faster-whisper ready ({model_name} on {device}:{compute_type}). 100% offline speech recognition active.")
        return _whisper_instance
    except Exception as e:
        logging.warning(f"[STT] Failed to initialize faster-whisper ({e}). Fallback to cloud STT.")
        return None


def transcribe_audio(audio_data: np.ndarray, sample_rate: int = 16000) -> str:
    """Transcribes an audio waveform into text.
    Prefers 100% offline faster-whisper, with automatic fallback to cloud SpeechRecognition.
    """
    if audio_data is None or len(audio_data) == 0:
        return ""

    stt_backend = os.environ.get("AURA_STT_BACKEND", "local").lower()

    # 1. Local Offline Neural Speech Recognition (faster-whisper)
    if stt_backend != "cloud":
        whisper = _init_whisper()
        if whisper:
            try:
                # Ensure float32 normalized [-1.0, 1.0] as required by whisper
                if audio_data.dtype == np.int16:
                    audio_float = audio_data.astype(np.float32) / 32768.0
                else:
                    audio_float = audio_data.astype(np.float32)

                if audio_float.ndim > 1:
                    audio_float = audio_float.flatten()

                segments, info = whisper.transcribe(
                    audio_float,
                    beam_size=3,
                    language="en",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=400),
                )
                text = " ".join([seg.text for seg in segments]).strip()
                if text:
                    return text
                return ""
            except Exception as e:
                logging.warning(f"[STT] faster-whisper transcription error ({e}). Trying cloud fallback.")

    # 2. Cloud Fallback (Google SpeechRecognition)
    temp_path = os.path.join(_TEMP_DIR, f"aura_stt_{uuid.uuid4().hex}.wav")
    try:
        if audio_data.dtype != np.int16:
            audio_int = np.clip(audio_data * 32768.0, -32768, 32767).astype(np.int16)
        else:
            audio_int = audio_data
        wav.write(temp_path, sample_rate, audio_int)

        recognizer = sr.Recognizer()
        with sr.AudioFile(temp_path) as source:
            audio = recognizer.record(source)
            text = recognizer.recognize_google(audio)
            return text
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as e:
        logging.warning(f"[STT] Google SpeechRecognition request error: {e}")
        return ""
    except Exception as e:
        logging.warning(f"[STT] SpeechRecognition audio read error: {e}")
        return ""
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass


def listen(max_duration=15, fs=16000) -> str:
    """Listens to the microphone using sounddevice with dynamic silence detection."""
    global _is_listening_active
    _is_listening_active = True
    try:
        import numpy as np

        # Never record while AURA is speaking (or right after she stopped),
        # otherwise her own TTS gets transcribed as a user request.
        _wait_for_speaker_clearance()

        print("\n[Listening...]")
        
        chunk_duration = 0.5  # seconds
        chunk_samples = int(chunk_duration * fs)
        
        recorded_chunks = []
        silence_chunks = 0
        speech_started = False

        # One-shot command streaming: seed pre-roll audio if triggered right after wake-word
        global _last_wakeword_preroll, _last_wakeword_preroll_ts
        one_shot_enabled = os.environ.get("AURA_WAKEWORD_ONE_SHOT", "true").lower() in ("true", "1", "yes")
        if one_shot_enabled and _last_wakeword_preroll and (time.time() - _last_wakeword_preroll_ts) < 3.5:
            for pr_chunk in _last_wakeword_preroll:
                pr_2d = np.asarray(pr_chunk, dtype=np.int16).reshape(-1, 1)
                recorded_chunks.append(pr_2d)
            preroll_max_rms = max((float(np.sqrt(np.mean(c.astype(np.float32)**2))) for c in recorded_chunks), default=0.0)
            if preroll_max_rms > 120.0:
                speech_started = True
                print(f"[VOICE] One-shot audio seeded ({len(_last_wakeword_preroll)} chunks, max rms: {preroll_max_rms:.1f})")
                logging.info(f"[VOICE] One-shot audio seeded ({len(_last_wakeword_preroll)} chunks, max rms: {preroll_max_rms:.1f})")
            _last_wakeword_preroll = None
        
        device = _resolve_input_device(os.environ.get("AURA_WAKEWORD_DEVICE"))
        stream = sd.InputStream(samplerate=fs, channels=1, dtype='int16', device=device)
        with stream:
            # 1. Quick calibration chunk (0.5 seconds)
            calib_chunk, _ = stream.read(int(fs * 0.5))
            recorded_chunks.append(calib_chunk)
            
            # Start with the calibration chunk's RMS
            initial_rms = np.sqrt(np.mean(calib_chunk.astype(np.float32)**2))
            
            # noise_floor tracks the quietest background noise we've seen.
            # We initialize it to the calibration chunk, but if they are already speaking,
            # this will be high initially and drop later when they pause.
            noise_floor = initial_rms
            
            # Base threshold dynamically tracks the noise floor (sensitive to normal room speech)
            threshold = max(noise_floor * 2.0 + 25, 60)
            
            # If it's already loud, assume speech started immediately
            if initial_rms > 300:
                speech_started = True
                print(f"[VOICE] Speech detected immediately (rms: {initial_rms:.1f})")
                logging.info(f"[VOICE] Speech detected immediately (rms: {initial_rms:.1f})")
            
            # 2. Main recording loop
            max_iterations = int(max_duration / chunk_duration)
            silence_timeout_chunks = int(5.0 / chunk_duration)  # 5 seconds of silence before timeout
            for iter_idx in range(max_iterations):
                chunk, overflowed = stream.read(chunk_samples)
                recorded_chunks.append(chunk)
                
                rms = np.sqrt(np.mean(chunk.astype(np.float32)**2))
                
                # Adapt noise floor downwards if we find a quieter moment
                if rms < noise_floor:
                    noise_floor = rms
                    threshold = max(noise_floor * 2.0 + 25, 60)
                
                if not speech_started:
                    # Detect if speech has started
                    if rms > threshold:
                        speech_started = True
                        logging.info(f"[VOICE] Speech started (rms: {rms:.1f} > thr: {threshold:.1f})")
                    elif iter_idx >= silence_timeout_chunks:
                        # User hasn't spoken for 5 seconds, exit early
                        break
                else:
                    # If speech started, check for silence
                    if rms < threshold:
                        silence_chunks += 1
                    else:
                        silence_chunks = 0
                    
                    # Stop after 2 seconds of silence (4 chunks)
                    if silence_chunks >= 4:
                        break

        # Check if any chunk had audible sound above ambient noise floor
        chunk_max_rms = max((np.sqrt(np.mean(c.astype(np.float32)**2)) for c in recorded_chunks), default=0.0)
        if not speech_started and chunk_max_rms < max(noise_floor * 1.5, 30):
            print(f"[VOICE] No speech detected (max rms: {chunk_max_rms:.1f}, noise floor: {noise_floor:.1f}).")
            logging.info(f"[VOICE] No speech detected (max rms: {chunk_max_rms:.1f}, noise floor: {noise_floor:.1f})")
            return ""

        # Concatenate all recorded chunks and normalize volume
        recording = np.concatenate(recorded_chunks, axis=0)
        recording = normalize_audio(recording)

        text = transcribe_audio(recording, fs)
        if text:
            print(f"You: {text}")
            # Echo guard: discard transcriptions of AURA's own voice
            if _is_echo_of_self(text):
                print("[VOICE] Discarded input: it was an echo of AURA's own speech.")
                return ""
            return text
        else:
            print("[Could not understand audio. Try speaking clearly.]")
            return ""

    except Exception as e:
        print(f"\n[Microphone Error]: {e}")
        return "SWITCH_TO_TEXT_MODE"
    finally:
        _is_listening_active = False

def _get_wakeword_model_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    env_model = os.environ.get("AURA_WAKEWORD_MODEL")
    candidates = [
        env_model,
        os.path.join(base_dir, env_model) if env_model else None,
        os.path.join(base_dir, "models", "hey_aura.onnx"),
        os.path.join(base_dir, "models", "hey_aura.tflite"),
        os.path.join(base_dir, "hey_aura.onnx"),
        os.path.join(base_dir, "hey_aura.tflite"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return os.path.abspath(p)
    return None


def _env_float(name, default):
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


def _resolve_input_device(spec):
    """Resolve a device index or name substring to a sounddevice input index."""
    import sounddevice as sd
    if spec is None or str(spec).strip() == "":
        return None
    try:
        return int(spec)
    except ValueError:
        pass
    needle = str(spec).lower()
    matches = [i for i, d in enumerate(sd.query_devices())
               if d["max_input_channels"] > 0 and needle in d["name"].lower()]
    if len(matches) == 1:
        return matches[0]
    print(f"[WAKE WORD] Device spec '{spec}' matched {matches or 'nothing'}; using default mic.")
    return None


# ──────────── Wake Word Background Listener ────────────
wakeword_enabled = True

# Detection-layer status, surfaced through /api/wakeword/status. The audio
# callback runs on the sounddevice thread, so these are plain floats/ints
# (atomic enough for status reporting; no locking needed).
wakeword_listening = False          # mic stream open + model ready
wakeword_model_loaded = False
wakeword_model_error = None         # last fatal setup error, if any
wakeword_last_detection_ts = 0.0    # epoch ts of last accepted "Hey Aura"
wakeword_false_positives = 0        # near-misses today (reset daily)
_fp_day = ""                        # date string the FP counter is valid for


def get_wakeword_status():
    global _last_inference_latency_ms
    return {
        "enabled": wakeword_enabled,
        "listening": wakeword_listening,
        "threshold": _env_float("AURA_WAKEWORD_THRESHOLD", 0.88),
        "persistence": int(os.environ.get("AURA_WAKEWORD_PERSISTENCE", "6")),
        "vad_threshold": _env_float("AURA_WAKEWORD_VAD_THRESHOLD", 15.0),
        "one_shot_enabled": os.environ.get("AURA_WAKEWORD_ONE_SHOT", "true").lower() in ("true", "1", "yes"),
        "speaker_verification_enabled": os.environ.get("AURA_SPEAKER_VERIFICATION", "false").lower() in ("true", "1", "yes"),
        "last_detection_ts": wakeword_last_detection_ts,
        "model_loaded": wakeword_model_loaded,
        "error": wakeword_model_error,
        "false_positives_today": wakeword_false_positives,
        "last_inference_ms": round(_last_inference_latency_ms, 2),
        "stt_backend": os.environ.get("AURA_STT_BACKEND", "local"),
        "stt_model": os.environ.get("AURA_STT_MODEL", "tiny.en"),
    }


def set_wakeword_enabled(enabled: bool):
    """Master switch for the backend 'Hey Aura' listener."""
    global wakeword_enabled
    wakeword_enabled = bool(enabled)
    print(f"[WAKE WORD] Backend listener {'ENABLED' if wakeword_enabled else 'DISABLED'}")


def start_wakeword_listener(callback):
    import threading

    threshold = _env_float("AURA_WAKEWORD_THRESHOLD", 0.88)
    speaking_threshold = _env_float("AURA_WAKEWORD_SPEAKING_THRESHOLD", 0.93)
    cooldown = _env_float("AURA_WAKEWORD_COOLDOWN", 3.5)
    persistence = int(os.environ.get("AURA_WAKEWORD_PERSISTENCE", "6"))
    device = _resolve_input_device(os.environ.get("AURA_WAKEWORD_DEVICE"))

    def listener_thread():
        import time
        global wakeword_model_loaded, wakeword_model_error, wakeword_listening
        try:
            # Retry the whole setup (model path + load) so a transient failure
            # - e.g. mic driver not ready at boot - doesn't kill wake word forever.
            max_setup_attempts = 5
            owwModel = None
            model_path = None
            for attempt in range(1, max_setup_attempts + 1):
                try:
                    model_path = _get_wakeword_model_path()
                    if not model_path:
                        wakeword_model_error = 'model not found in models/ directory'
                        print(f'[WAKE WORD] Attempt {attempt}/{max_setup_attempts}: "hey_aura" model not found in models/ directory.')
                        time.sleep(5)
                        continue

                    import sounddevice as sd
                    import numpy as np
                    from openwakeword.model import Model

                    RATE = 16000
                    CHUNK = 1280

                    framework = "onnx" if model_path.lower().endswith(".onnx") else "tflite"
                    owwModel = Model(wakeword_models=[model_path], inference_framework=framework)
                    wakeword_model_loaded = True
                    wakeword_model_error = None
                    break
                except ImportError:
                    wakeword_model_error = 'openwakeword/onnxruntime not installed'
                    print('[WAKE WORD] openwakeword/onnxruntime not installed. Wake word disabled.')
                    return
                except Exception as e:
                    wakeword_model_error = f'{type(e).__name__}: {e}'
                    print(f'[WAKE WORD] Setup attempt {attempt}/{max_setup_attempts} failed: {type(e).__name__}: {e}. Retrying in 5s...')
                    time.sleep(5)

            if owwModel is None or model_path is None:
                print('[WAKE WORD] Fatal error, listener stopped.')
                return

            dev_desc = "default"
            if device is not None:
                dev_desc = sd.query_devices(device)["name"]
            print(f'[WAKE WORD] Loaded "{model_path}". Listening for "Hey Aura" on mic: {dev_desc} '
                  f'(threshold={threshold}, speaking_threshold={speaking_threshold}, '
                  f'persistence={persistence}, cooldown={cooldown}s)')

            last_detect = 0.0
            consec_high = 0
            _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "wakeword_training", "wakeword_detections.log")
            _last_nearmiss_log = 0.0

            def _log_detection(score, thr, speaking, near_miss=False):
                nonlocal _last_nearmiss_log
                try:
                    if near_miss:
                        # Near-misses fire on ordinary background audio; without a
                        # rate limit this appends to disk many times per second.
                        now = time.time()
                        if now - _last_nearmiss_log < 1.0:
                            return
                        _last_nearmiss_log = now
                    tag = "NEAR-MISS" if near_miss else "DETECT"
                    with open(_log_path, "a", encoding="utf-8") as lf:
                        lf.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} {tag} '
                                 f"score={score:.3f} thr={thr:.2f} speaking={speaking}\n")
                except Exception:
                    pass

            def audio_callback(indata, frames, time_info, status):
                nonlocal last_detect, consec_high
                global wakeword_last_detection_ts, wakeword_false_positives, _fp_day
                global _last_inference_latency_ms, _last_wakeword_preroll, _last_wakeword_preroll_ts
                if not wakeword_enabled or _is_listening_active:
                    return
                if status:
                    print(f"[WAKE WORD] Audio status: {status}")

                # openwakeword expects 1D int16 array
                audio_data = (indata[:, 0]).astype(np.int16)

                # Maintain circular pre-roll buffer for one-shot command continuity
                _preroll_audio_ring.append(audio_data.copy())

                # Energy-adaptive VAD pre-filter: skip ONNX inference during ambient room silence
                vad_threshold = _env_float("AURA_WAKEWORD_VAD_THRESHOLD", 15.0)
                audio_rms = float(np.sqrt(np.mean(audio_data.astype(np.float32) ** 2)))
                if audio_rms < vad_threshold:
                    consec_high = 0
                    return

                t_start = time.perf_counter()
                prediction = owwModel.predict(audio_data)
                _last_inference_latency_ms = (time.perf_counter() - t_start) * 1000.0

                for mdl, score in prediction.items():
                    # Read thresholds dynamically so Settings UI changes take effect immediately.
                    cur_threshold = _env_float("AURA_WAKEWORD_THRESHOLD", threshold)
                    cur_speaking_threshold = _env_float("AURA_WAKEWORD_SPEAKING_THRESHOLD", speaking_threshold)
                    cur_cooldown = _env_float("AURA_WAKEWORD_COOLDOWN", cooldown)
                    try:
                        cur_persistence = max(1, int(os.environ.get("AURA_WAKEWORD_PERSISTENCE", persistence)))
                    except ValueError:
                        cur_persistence = persistence

                    # Higher threshold while AURA is speaking to prevent self-triggering,
                    # but a loud/close "Hey Aura" can still interrupt (barge-in).
                    thr = cur_speaking_threshold if is_speaking else cur_threshold
                    now = time.time()
                    
                    # Strict consecutive persistence: full phrase must sustain high scores
                    # without dropping below threshold. Any drop resets immediately.
                    if score >= thr:
                        consec_high += 1
                    else:
                        consec_high = 0

                    # Detection requires sustained consecutive frames meeting the threshold
                    is_detected = (score >= thr and consec_high >= cur_persistence)

                    if is_detected and (now - last_detect) >= cur_cooldown:
                        # Refractory period: ignore detections in the first second
                        # after AURA finishes speaking - that's just her own echo.
                        if not is_speaking and (now - _last_speak_end) < 1.0:
                            owwModel.reset()
                            return

                        # Speaker verification gate (if enabled)
                        spk_ver_enabled = os.environ.get("AURA_SPEAKER_VERIFICATION", "false").lower() in ("true", "1", "yes")
                        if spk_ver_enabled:
                            recent_audio = np.concatenate(list(_preroll_audio_ring)[-5:], axis=0) if len(_preroll_audio_ring) >= 5 else audio_data
                            feats = compute_acoustic_features(recent_audio)
                            ref_profile = _load_speaker_profile()
                            if not verify_speaker_voiceprint(feats, ref_profile):
                                logging.info(f"[WAKE WORD] Wake candidate rejected by speaker voiceprint gate (f0={feats['f0_hz']}Hz)")
                                consec_high = 0
                                return

                        last_detect = now
                        consec_high = 0
                        wakeword_last_detection_ts = now

                        # Store pre-roll snapshot for one-shot command streaming
                        _last_wakeword_preroll = list(_preroll_audio_ring)
                        _last_wakeword_preroll_ts = now

                        msg = f'[WAKE WORD] Detected {mdl} with score {score:.3f} (threshold {thr})'
                        print(msg)
                        logging.info(msg)
                        _log_detection(score, thr, is_speaking)
                        if is_speaking:
                            print('[WAKE WORD] Barge-in detected! Stopping TTS...')
                            stop_speaking()
                        callback()
                        owwModel.reset()
                    elif score > thr * 0.85:
                        # near-miss logging: helps diagnose false wakes
                        today = time.strftime("%Y-%m-%d")
                        if today != _fp_day:
                            _fp_day = today
                            wakeword_false_positives = 0
                        wakeword_false_positives += 1
                        _log_detection(score, thr, is_speaking, near_miss=True)

            # Self-healing stream loop: reopen the mic on errors instead of dying
            while True:
                try:
                    with sd.InputStream(samplerate=RATE, channels=1, blocksize=CHUNK,
                                        dtype='int16', device=device, callback=audio_callback):
                        wakeword_listening = True
                        print('[WAKE WORD] Mic stream open — listening.')
                        while True:
                            time.sleep(1)
                except Exception as e:
                    wakeword_listening = False
                    print(f'[WAKE WORD] Stream error: {type(e).__name__}: {e}. Reopening mic in 3s...')
                    time.sleep(3)

        except ImportError:
            print('[WAKE WORD] openwakeword not installed. Wake word disabled.')
        except Exception as e:
            print(f'[WAKE WORD] Fatal error, listener stopped: {type(e).__name__}: {e}')

    t = threading.Thread(target=listener_thread, daemon=True)
    t.start()
