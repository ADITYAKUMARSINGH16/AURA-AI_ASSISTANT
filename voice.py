import speech_recognition as sr
import sounddevice as sd
import scipy.io.wavfile as wav
import tempfile
import os
import re
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

EDGE_TTS_VOICE = "en-US-GuyNeural"

_TEMP_DIR = tempfile.gettempdir()
_TTS_PATH = os.path.join(_TEMP_DIR, "aura_tts_output.mp3")

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


def speak(text: str):
    """Speaks the given text using the best available TTS engine."""
    print(f"\nAURA: {text.strip()}")
    
    # Clean up markdown formatting so the voice doesn't pronounce "asterisk"
    clean_text = re.sub(r'\*\*(.*?)\*\*', r'\1', text) # Remove bold
    clean_text = re.sub(r'\*(.*?)\*', r'\1', clean_text) # Remove italics
    clean_text = clean_text.replace('*', '') # Remove bullet points or stray asterisks
    clean_text = re.sub(r'#+\s*', '', clean_text) # Remove headers

    if _use_edge_tts:
        _speak_edge_tts(clean_text)
    elif _pyttsx3_engine:
        _speak_pyttsx3(clean_text)


def generate_tts_file(text: str) -> str:
    """Generates a TTS audio file and returns its path without playing it."""
    clean_text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    clean_text = re.sub(r'\*(.*?)\*', r'\1', clean_text)
    clean_text = clean_text.replace('*', '')
    clean_text = re.sub(r'#+\s*', '', clean_text)
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
        communicate = edge_tts.Communicate(text, EDGE_TTS_VOICE)
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
    try:
        import pygame
        pygame.mixer.init()
        pygame.mixer.music.load(filepath)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            pygame.time.wait(100)
        pygame.mixer.quit()
    except ImportError:
        # Fallback: Windows media player (silent window)
        os.system(f'start /min /wait "" "{filepath}"')


def _speak_pyttsx3(text: str):
    """Offline TTS via pyttsx3 (fallback)."""
    try:
        _pyttsx3_engine.say(text)
        _pyttsx3_engine.runAndWait()
    except Exception:
        pass


def listen(max_duration=15, fs=16000) -> str:
    """Listens to the microphone using sounddevice with dynamic silence detection."""
    try:
        import numpy as np
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

        temp_path = os.path.join(_TEMP_DIR, "aura_temp_audio.wav")
        wav.write(temp_path, fs, recording)

        recognizer = sr.Recognizer()
        with sr.AudioFile(temp_path) as source:
            audio = recognizer.record(source)
            text = recognizer.recognize_google(audio)
            print(f"You: {text}")
            return text

    except sr.UnknownValueError:
        print("[Could not understand audio. Try speaking clearly.]")
        return ""
    except sr.RequestError as e:
        print(f"[Could not request results; {e}]")
        return ""
    except Exception as e:
        print(f"\n[Microphone Error]: {e}")
        return "SWITCH_TO_TEXT_MODE"

# ──────────── Wake Word Background Listener ────────────
def start_wakeword_listener(callback):
    import threading
    def listener_thread():
        try:
            import sounddevice as sd
            import numpy as np
            from openwakeword.model import Model
            
            RATE = 16000
            CHUNK = 1280
            
            owwModel = Model(wakeword_models=['hey_jarvis'], inference_framework='onnx')
            
            print('[WAKE WORD] Listening for "Hey Jarvis"...')
            
            def audio_callback(indata, frames, time, status):
                if status:
                    print(status)
                
                # indata is shape (frames, channels), float32 or int16
                # openwakeword expects 1D int16 array
                audio_data = (indata[:, 0]).astype(np.int16)
                prediction = owwModel.predict(audio_data)
                
                for mdl, score in prediction.items():
                    if score > 0.5:
                        print(f'[WAKE WORD] Detected {mdl} with score {score}')
                        callback()
                        owwModel.reset()
            
            # Start non-blocking stream
            with sd.InputStream(samplerate=RATE, channels=1, blocksize=CHUNK, dtype='int16', callback=audio_callback):
                while True:
                    import time
                    time.sleep(1)
                    
        except ImportError:
            print('[WAKE WORD] openwakeword not installed. Wake word disabled.')
        except Exception as e:
            print(f'[WAKE WORD] Error: {e}')

    t = threading.Thread(target=listener_thread, daemon=True)
    t.start()
