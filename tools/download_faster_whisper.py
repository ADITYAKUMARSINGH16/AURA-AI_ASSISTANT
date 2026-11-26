"""
AURA Offline Speech-to-Text (STT) Downloader & Benchmark (faster-whisper)
========================================================================
Pre-downloads, verifies, and benchmarks the faster-whisper neural model
for 100% offline, low-latency, private speech recognition on Windows.
"""

import os
import sys
import time
import numpy as np
from dotenv import load_dotenv

# Ensure root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

load_dotenv(os.path.join(BASE_DIR, ".env"))


def main():
    print("=" * 64)
    print("   AURA OFFLINE SPEECH RECOGNITION (faster-whisper) SETUP")
    print("=" * 64)

    try:
        import faster_whisper
        import ctranslate2
    except ImportError as e:
        print(f"[ERROR] Required packages not found ({e}). Run: pip install -r requirements.txt")
        sys.exit(1)

    model_name = os.environ.get("AURA_STT_MODEL", "tiny.en")
    device_cfg = os.environ.get("AURA_STT_DEVICE", "auto").lower()
    compute_cfg = os.environ.get("AURA_STT_COMPUTE_TYPE", "auto").lower()

    cuda_available = ctranslate2.get_cuda_device_count() > 0
    device = device_cfg
    if device == "auto":
        device = "cuda" if cuda_available else "cpu"

    compute_type = compute_cfg
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    print(f"Target Model:   {model_name}")
    print(f"Device:         {device.upper()} (CUDA Available: {cuda_available})")
    print(f"Compute Type:   {compute_type}")
    print("-" * 64)
    print(f"Downloading/loading model '{model_name}'...")

    t0 = time.perf_counter()
    try:
        model = faster_whisper.WhisperModel(model_name, device=device, compute_type=compute_type)
        if device == "cuda":
            dummy_probe = np.zeros(1600, dtype=np.float32)
            _ = list(model.transcribe(dummy_probe, beam_size=1)[0])
    except Exception as e:
        print(f"[INFO] CUDA runtime unavailable ({e}). Falling back to CPU int8...")
        device = "cpu"
        compute_type = "int8"
        model = faster_whisper.WhisperModel(model_name, device=device, compute_type=compute_type)

    load_time = (time.perf_counter() - t0) * 1000.0
    print(f"  [OK] Model ready on {device.upper()}:{compute_type} in {load_time:.1f}ms")

    # Benchmark with 2 seconds of synthetic audio
    print("\nRunning warm inference benchmark (2.0s audio chunk)...")
    dummy_audio = np.zeros(32000, dtype=np.float32)
    latencies = []
    for i in range(5):
        t_start = time.perf_counter()
        segments, info = model.transcribe(dummy_audio, beam_size=1)
        _ = list(segments)
        lat = (time.perf_counter() - t_start) * 1000.0
        latencies.append(lat)
        print(f"  Run #{i+1}: {lat:.1f}ms (RTF: {lat / 2000.0:.3f})")

    avg_lat = np.mean(latencies)
    print("-" * 64)
    print(f"Avg Transcription Latency: {avg_lat:.1f}ms")
    print(f"Real-Time Factor (RTF):    {avg_lat / 2000.0:.3f} (< 1.0 means faster than real-time)")
    print("\nSUCCESS: AURA offline speech recognition is fully configured and ready!")
    print("=" * 64)


if __name__ == "__main__":
    main()
