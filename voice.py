import speech_recognition as sr
import sounddevice as sd
import scipy.io.wavfile as wav
import tempfile
import os
import subprocess
import re
import time
import uuid
import asyncio

# ──────────── TTS Configuration ────────────
# We try edge-tts first (high-quality neural voice).
# If not installed, we fall back to pyttsx3 with tuned settings.
#
# To upgrade to neural voice, run:  pip install edge-tts pygame
#
# Voice options for edge-tts:
#   en-US-GuyNeural       - Male, natural American
#   en-US-AriaNeural      - Female, natural American
#   en-GB-RyanNeural      - Male, British
#   en-IN-PrabhatNeural   - Male, Indian English

EDGE_TTS_VOICE = "en-US-AriaNeural"
EDGE_TTS_RATE = "+0%"

_TEMP_DIR = tempfile.gettempdir()
_TTS_PATH = os.path.join(_TEMP_DIR, "aura_tts_output.mp3")

# Global state to prevent self-triggering and allow barge-in
is_speaking = False

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


def _cleanup_stale_tts_files(max_age_seconds: int = 3600):
    """Deletes aura_tts_*.mp3 files older than max_age_seconds from the temp
    directory. Without this, every spoken reply leaves a permanent mp3 behind."""
    try:
        now = time.time()
        for name in os.listdir(_TEMP_DIR):
            if name.startswith("aura_tts_") and name.endswith(".mp3"):
                path = os.path.join(_TEMP_DIR, name)
                try:
                    if now - os.path.getmtime(path) > max_age_seconds:
                        os.remove(path)
                except OSError:
                    pass
    except Exception:
        pass


def speak(text: str):
    """Speaks the given text using the best available TTS engine."""
    global _last_spoken_text
    print(f"\nAURA: {text.strip()}")

    # Clean up markdown formatting so the voice doesn't pronounce "asterisk"
    clean_text = re.sub(r'\*\*(.*?)\*\*', r'\1', text) # Remove bold
    clean_text = re.sub(r'\*(.*?)\*', r'\1', clean_text) # Remove italics
    clean_text = clean_text.replace('*', '') # Remove bullet points or stray asterisks
    clean_text = re.sub(r'#+\s*', '', clean_text) # Remove headers
    _last_spoken_text = clean_text

    if _use_edge_tts:
        _speak_edge_tts(clean_text)
    elif _pyttsx3_engine:
        _speak_pyttsx3(clean_text)


def generate_tts_file(text: str) -> str:
    """Generates a TTS audio file and returns its path without playing it."""
    global _last_spoken_text
    clean_text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    clean_text = re.sub(r'\*(.*?)\*', r'\1', clean_text)
    clean_text = clean_text.replace('*', '')
    clean_text = re.sub(r'#+\s*', '', clean_text)
    _last_spoken_text = clean_text

    _cleanup_stale_tts_files()
    filepath = os.path.join(_TEMP_DIR, f"aura_tts_{uuid.uuid4().hex}.mp3")
    
    if _use_edge_tts:
        import edge_tts
        import concurrent.futures
        
        async def _synth():
            communicate = edge_tts.Communicate(clean_text, EDGE_TTS_VOICE)
            await communicate.save(filepath)
        
        # Always run in a fresh thread to avoid event loop conflicts
        def _worker():
            asyncio.run(_synth())
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(_worker).result(timeout=30)
            
        return filepath
    else:
        # pyttsx3 fallback (save to file)
        if _pyttsx3_engine:
            _pyttsx3_engine.save_to_file(clean_text, filepath)
            _pyttsx3_engine.runAndWait()
            return filepath
    return ""


def _speak_edge_tts(text: str):
    """High-quality neural voice via Edge TTS."""
    import asyncio
    import edge_tts

    async def _synth():
        communicate = edge_tts.Communicate(text, EDGE_TTS_VOICE, rate=EDGE_TTS_RATE)
        await communicate.save(_TTS_PATH)

    # Handle asyncio event loop safely
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(_run_in_new_loop, _synth()).result()
    else:
        asyncio.run(_synth())

    _play_mp3(_TTS_PATH)


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


def listen(max_duration=15, fs=16000) -> str:
    """Listens to the microphone using sounddevice with dynamic silence detection."""
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
        
        stream = sd.InputStream(samplerate=fs, channels=1, dtype='int16')
        with stream:
            # 1. Quick calibration chunk (0.5 seconds)
            calib_chunk, _ = stream.read(int(fs * 0.5))
            recorded_chunks.append(calib_chunk)
            ambient_rms = np.sqrt(np.mean(calib_chunk.astype(np.float32)**2))
            
            # Base threshold on ambient noise, but keep a minimum of 300
            threshold = max(ambient_rms * 1.5 + 150, 300)
            
            # 2. Main recording loop
            max_iterations = int(max_duration / chunk_duration)
            for _ in range(max_iterations):
                chunk, overflowed = stream.read(chunk_samples)
                recorded_chunks.append(chunk)
                
                rms = np.sqrt(np.mean(chunk.astype(np.float32)**2))
                
                if not speech_started:
                    # Detect if speech has started
                    if rms > threshold:
                        speech_started = True
                else:
                    # If speech started, check for silence
                    if rms < threshold:
                        silence_chunks += 1
                    else:
                        silence_chunks = 0
                    
                    # Stop after 2 seconds of silence (4 chunks)
                    if silence_chunks >= 4:
                        break

        # Concatenate all recorded chunks
        recording = np.concatenate(recorded_chunks, axis=0)

        # Unique temp file: two overlapping listen() calls (e.g. HUD open in
        # two tabs) must not overwrite each other's capture.
        temp_path = os.path.join(_TEMP_DIR, f"aura_temp_audio_{uuid.uuid4().hex}.wav")
        try:
            wav.write(temp_path, fs, recording)

            recognizer = sr.Recognizer()
            with sr.AudioFile(temp_path) as source:
                audio = recognizer.record(source)
                text = recognizer.recognize_google(audio)
                print(f"You: {text}")

                # Echo guard: discard transcriptions of AURA's own voice
                if _is_echo_of_self(text):
                    print("[VOICE] Discarded input: it was an echo of AURA's own speech.")
                    return ""
                return text
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass

    except sr.UnknownValueError:
        print("[Could not understand audio. Try speaking clearly.]")
        return ""
    except sr.RequestError as e:
        print(f"[Could not request results; {e}]")
        return ""
    except Exception as e:
        print(f"\n[Microphone Error]: {e}")
        return "SWITCH_TO_TEXT_MODE"

def _get_wakeword_model_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.environ.get("AURA_WAKEWORD_MODEL"),
        os.path.join(base_dir, "models", "hey_aura.onnx"),
        os.path.join(base_dir, "models", "hey_aura.tflite"),
        os.path.join(base_dir, "hey_aura.onnx"),
        os.path.join(base_dir, "hey_aura.tflite"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
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
    return {
        "enabled": wakeword_enabled,
        "listening": wakeword_listening,
        "threshold": _env_float("AURA_WAKEWORD_THRESHOLD", 0.6),
        "last_detection_ts": wakeword_last_detection_ts,
        "model_loaded": wakeword_model_loaded,
        "error": wakeword_model_error,
        "false_positives_today": wakeword_false_positives,
    }


def set_wakeword_enabled(enabled: bool):
    """Master switch for the backend 'Hey Aura' listener."""
    global wakeword_enabled
    wakeword_enabled = bool(enabled)
    print(f"[WAKE WORD] Backend listener {'ENABLED' if wakeword_enabled else 'DISABLED'}")


def start_wakeword_listener(callback):
    import threading

    threshold = _env_float("AURA_WAKEWORD_THRESHOLD", 0.6)
    speaking_threshold = _env_float("AURA_WAKEWORD_SPEAKING_THRESHOLD", 0.8)
    cooldown = _env_float("AURA_WAKEWORD_COOLDOWN", 2.0)
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
                  f'(threshold={threshold}, speaking_threshold={speaking_threshold}, cooldown={cooldown}s)')

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
                if not wakeword_enabled:
                    return
                if status:
                    print(f"[WAKE WORD] Audio status: {status}")

                # openwakeword expects 1D int16 array
                audio_data = (indata[:, 0]).astype(np.int16)
                prediction = owwModel.predict(audio_data)

                for mdl, score in prediction.items():
                    # Higher threshold while AURA is speaking to prevent self-triggering,
                    # but a loud/close "Hey Aura" can still interrupt (barge-in).
                    thr = speaking_threshold if is_speaking else threshold
                    now = time.time()
                    # Persistence: the full phrase sustains high scores across
                    # several consecutive chunks; isolated spikes do not.
                    if score > thr:
                        consec_high += 1
                    elif score < thr * 0.8:
                        consec_high = 0
                    if score > thr and consec_high >= 4 and (now - last_detect) >= cooldown:
                        # Refractory period: ignore detections in the first second
                        # after AURA finishes speaking - that's just her own echo.
                        if not is_speaking and (now - _last_speak_end) < 1.0:
                            owwModel.reset()
                            return
                        last_detect = now
                        consec_high = 0
                        wakeword_last_detection_ts = now
                        print(f'[WAKE WORD] Detected {mdl} with score {score:.3f} (threshold {thr})')
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
