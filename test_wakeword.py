"""
Standalone "Hey Aura" wake-word test.

Tests ONLY: Microphone -> Wake-word model -> detection.
Starts no FastAPI, no Ollama, no HUD, no tray - nothing else.

It never falls back to a built-in openwakeword model: if a real
hey_aura .onnx/.tflite file is not found it exits with an error instead
of pretending to test "Hey Aura".

Usage:
    python test_wakeword.py
    python test_wakeword.py --threshold 0.6
    python test_wakeword.py --device "Realtek"     # match by name substring
    python test_wakeword.py --device 1             # or by index
    python test_wakeword.py --duration 30          # auto-stop after N seconds
"""

import argparse
import os
import sys
import time

RATE = 16000          # openWakeWord models require 16 kHz mono int16
CHUNK = 1280          # 80 ms frames, as recommended by openWakeWord


def find_model_path(cli_value):
    """Locate a hey_aura model without ever falling back to another wake word."""
    candidates = []
    if cli_value:
        candidates.append(cli_value)
    env_path = os.environ.get("AURA_WAKEWORD_MODEL")
    if env_path:
        candidates.append(env_path)
    base = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(base, "models", "hey_aura.onnx"))
    candidates.append(os.path.join(base, "models", "hey_aura.tflite"))
    candidates.append(os.path.join("models", "hey_aura.onnx"))
    candidates.append(os.path.join("models", "hey_aura.tflite"))
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def pick_input_device(cli_value):
    """Resolve --device (index or name substring) to a sounddevice input index."""
    import sounddevice as sd

    default = sd.query_devices(kind="input")
    print("=" * 64)
    print("AUDIO DEVICES (input capable):")
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            marker = "  <-- SYSTEM DEFAULT" if i == default["index"] else ""
            print(f"  [{i}] {d['name']}  ({d['hostapi']}, "
                  f"{d['max_input_channels']}ch, {d['default_samplerate']:.0f}Hz){marker}")
    print("=" * 64)

    if cli_value is None:
        idx = default["index"]
        name = default["name"]
    else:
        try:
            idx = int(cli_value)
        except ValueError:
            needle = cli_value.lower()
            matches = [i for i, d in enumerate(sd.query_devices())
                       if d["max_input_channels"] > 0 and needle in d["name"].lower()]
            if not matches:
                print(f"[WAKE] ERROR: No input device matching '{cli_value}'.")
                sys.exit(2)
            if len(matches) > 1:
                print(f"[WAKE] ERROR: Device name '{cli_value}' is ambiguous: {matches}")
                sys.exit(2)
            idx = matches[0]
        info = sd.query_devices(idx)
        name = info["name"]

    print(f"[WAKE] Microphone: [{idx}] {name}")
    return idx


def main():
    parser = argparse.ArgumentParser(description="Standalone Hey Aura wake-word test")
    parser.add_argument("--model", default=None,
                        help="Path to hey_aura .onnx/.tflite (default: ./models/hey_aura.onnx)")
    parser.add_argument("--threshold", type=float, default=0.5,
                        help="Detection threshold, 0.0-1.0 (default: 0.5)")
    parser.add_argument("--device", default=None,
                        help="Input device index or unique name substring (default: system default)")
    parser.add_argument("--cooldown", type=float, default=2.0,
                        help="Seconds to suppress repeat detections (default: 2.0)")
    parser.add_argument("--duration", type=float, default=None,
                        help="Auto-stop after N seconds (omit to run until Ctrl+C)")
    args = parser.parse_args()

    # ── 1. Locate the exact model ────────────────────────────────
    model_path = find_model_path(args.model)
    if not model_path:
        print("[WAKE] ERROR: No 'hey_aura' model found.")
        print("Looked for:")
        print("  - --model argument path")
        print("  - AURA_WAKEWORD_MODEL environment variable")
        print("  - ./models/hey_aura.onnx")
        print("  - ./models/hey_aura.tflite")
        print()
        print("'hey_aura' is NOT a built-in OpenWakeWord model. You must train one.")
        print("See wakeword_training/ for the training pipeline.")
        sys.exit(1)

    # ── 2. Load model ────────────────────────────────────────────
    framework = "onnx" if model_path.lower().endswith(".onnx") else "tflite"
    try:
        from openwakeword.model import Model
        model = Model(wakeword_models=[model_path], inference_framework=framework)
    except Exception as e:
        print(f"[WAKE] ERROR: Failed to load wake-word model: {type(e).__name__}: {e}")
        sys.exit(1)

    model_name = list(model.models.keys())[0]
    print(f"[WAKE] Model: {model_path} (loads as '{model_name}', framework={framework})")
    print(f"[WAKE] Sample rate: {RATE} Hz mono int16 ({CHUNK}-sample frames)")

    # ── 3. Microphone ────────────────────────────────────────────
    import numpy as np
    import sounddevice as sd
    device_idx = pick_input_device(args.device)
    print(f"[WAKE] Threshold: {args.threshold}")

    print("=" * 64)
    print("[WAKE] Listening... say 'Hey Aura'. Ctrl+C to stop.")
    print("=" * 64)

    last_print = 0.0
    last_detect = 0.0
    start_time = time.time()
    stream = None
    while True:
        if args.duration is not None and (time.time() - start_time) >= args.duration:
            print(f"[WAKE] Stopped after {args.duration:.0f}s (duration limit).")
            break
        try:
            if stream is None:
                stream = sd.InputStream(samplerate=RATE, channels=1,
                                        blocksize=CHUNK, dtype="int16",
                                        device=device_idx)
                stream.start()
                last_print = 0.0  # force an immediate score print after reopen

            data, overflowed = stream.read(CHUNK)
            if overflowed:
                print("[WAKE] WARN: Audio buffer overflowed (system too slow).")

            prediction = model.predict(data[:, 0])
            score = max(prediction.values()) if prediction else 0.0
            now = time.time()

            if now - last_print >= 0.5:
                bar = "#" * int(score * 40)
                print(f"[WAKE] Score: {score:.4f} {bar}")
                last_print = now

            if score >= args.threshold and (now - last_detect) >= args.cooldown:
                print("*" * 64)
                print(f"[WAKE] HEY AURA DETECTED (score={score:.4f}, threshold={args.threshold})")
                print("*" * 64)
                last_detect = now

        except KeyboardInterrupt:
            print("\n[WAKE] Stopped by user.")
            break
        except Exception as e:
            # Report failures instead of dying silently; try to recover the stream
            print(f"[WAKE] ERROR: Audio loop: {type(e).__name__}: {e} - reopening stream in 2s...")
            try:
                if stream is not None:
                    stream.close()
            except Exception:
                pass
            stream = None
            time.sleep(2)

    if stream is not None:
        try:
            stream.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
