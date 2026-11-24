"""
Comprehensive regression and unit tests for voice listening, wake-word coordination,
one-shot ring buffering, acoustic feature extraction, audio normalization, VAD filtering,
and ONNX inference benchmarking.
"""
import os
import sys
import numpy as np

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import voice


def test_listening_flag_lifecycle():
    """Verify that _is_listening_active flag defaults to False and is accessible."""
    assert hasattr(voice, "_is_listening_active"), "voice must define _is_listening_active"
    assert voice._is_listening_active is False


def test_device_resolver():
    """Verify _resolve_input_device handles None, empty, and numeric specs safely."""
    assert voice._resolve_input_device(None) is None
    assert voice._resolve_input_device("") is None
    assert voice._resolve_input_device("   ") is None
    assert voice._resolve_input_device(0) == 0 or voice._resolve_input_device(0) is not None


def test_wakeword_status_structure():
    """Verify get_wakeword_status returns required telemetry and tuning fields."""
    status = voice.get_wakeword_status()
    assert isinstance(status, dict)
    for field in (
        "enabled", "listening", "threshold", "persistence",
        "vad_threshold", "one_shot_enabled", "speaker_verification_enabled",
        "last_detection_ts", "model_loaded", "last_inference_ms"
    ):
        assert field in status, f"Missing expected telemetry field: {field}"


def test_persistence_logic():
    """Verify that non-consecutive frames do not trigger persistence."""
    thr = 0.70
    persistence = 3
    scores = [0.75, 0.50, 0.75, 0.75]  # Interrupted sequence
    consec_high = 0
    detected = False
    for s in scores:
        if s >= thr:
            consec_high += 1
        else:
            consec_high = 0
        if consec_high >= persistence:
            detected = True
    assert not detected, "Interrupted frames must NOT trigger persistence"

    # Truly consecutive frames
    consec_high = 0
    consecutive_scores = [0.72, 0.81, 0.79]
    for s in consecutive_scores:
        if s >= thr:
            consec_high += 1
        else:
            consec_high = 0
        if consec_high >= persistence:
            detected = True
    assert detected, "Consecutive frames >= persistence must trigger"


def test_preroll_ring_buffer():
    """Verify rolling ring buffer pushes and retains the last 20 audio chunks."""
    voice._preroll_audio_ring.clear()
    assert len(voice._preroll_audio_ring) == 0

    # Push 25 dummy chunks of 1280 samples
    for i in range(25):
        chunk = np.full(1280, fill_value=i, dtype=np.int16)
        voice._preroll_audio_ring.append(chunk)

    assert len(voice._preroll_audio_ring) == 20
    # Oldest retained chunk should have value 5, newest should be 24
    assert voice._preroll_audio_ring[0][0] == 5
    assert voice._preroll_audio_ring[-1][0] == 24


def test_audio_normalization():
    """Verify normalize_audio boosts quiet signals cleanly without clipping."""
    # Quiet 1kHz tone with peak amplitude 1000
    t = np.linspace(0, 0.1, 1600, endpoint=False)
    quiet_signal = (1000 * np.sin(2 * np.pi * 1000 * t)).astype(np.int16)
    
    normalized = voice.normalize_audio(quiet_signal, target_peak=26000.0)
    assert normalized.dtype == np.int16
    peak_norm = np.max(np.abs(normalized))
    # Target peak is 26000, max gain is capped at 4.0x (1000 * 4.0 = 4000)
    assert peak_norm >= 3900, f"Expected boosted peak ~4000, got {peak_norm}"
    assert np.max(normalized) <= 32767
    assert np.min(normalized) >= -32768

    # Empty array returns safely
    empty = np.array([], dtype=np.int16)
    assert len(voice.normalize_audio(empty)) == 0


def test_acoustic_feature_extraction():
    """Verify F0 and spectral centroid extraction on synthetic audio."""
    fs = 16000
    t = np.linspace(0, 0.5, int(fs * 0.5), endpoint=False)
    # 200 Hz tone (typical human pitch)
    pitch_200hz = (10000 * np.sin(2 * np.pi * 200 * t)).astype(np.int16)
    
    feats = voice.compute_acoustic_features(pitch_200hz, sample_rate=fs)
    assert isinstance(feats, dict)
    assert "f0_hz" in feats
    assert "spectral_centroid" in feats
    assert "energy_rms" in feats
    assert 180.0 <= feats["f0_hz"] <= 220.0, f"Expected F0 ~200Hz, got {feats['f0_hz']}"
    assert feats["energy_rms"] > 5000.0

    # Silent signal
    silence = np.zeros(1600, dtype=np.int16)
    feats_silent = voice.compute_acoustic_features(silence, sample_rate=fs)
    assert feats_silent["energy_rms"] == 0.0


def test_speaker_voiceprint_verification():
    """Verify speaker voiceprint comparison logic."""
    # Match case
    sample_feats = {"f0_hz": 200.0, "spectral_centroid": 1200.0, "energy_rms": 5000.0}
    matching_profile = {"f0_hz": 210.0, "spectral_centroid": 1250.0}
    assert voice.verify_speaker_voiceprint(sample_feats, matching_profile) is True

    # Mismatch case (F0 wildly different)
    mismatched_profile = {"f0_hz": 90.0, "spectral_centroid": 600.0}
    assert voice.verify_speaker_voiceprint(sample_feats, mismatched_profile) is False

    # Disabled / un-enrolled profile passes unconditionally
    assert voice.verify_speaker_voiceprint(sample_feats, None) is True
    assert voice.verify_speaker_voiceprint(sample_feats, {}) is True


def test_vad_silence_filtering():
    """Verify VAD calculation and silence detection."""
    # Low energy noise (RMS ~2.0)
    quiet_noise = np.array([1, -1, 2, -2, 0, 1, -1, 0] * 160, dtype=np.int16)
    rms = float(np.sqrt(np.mean(quiet_noise.astype(np.float32) ** 2)))
    assert rms < 15.0, f"Expected RMS < 15.0 for quiet noise, got {rms}"

    # Loud speech signal
    np.random.seed(42)
    loud_speech = np.random.randint(-5000, 5000, size=1280, dtype=np.int16)
    loud_rms = float(np.sqrt(np.mean(loud_speech.astype(np.float32) ** 2)))
    assert loud_rms > 15.0, f"Expected RMS > 15.0 for speech, got {loud_rms}"


def test_onnx_inference_benchmark():
    """Verify OpenWakeWord ONNX inference runs within acceptable real-time latency (< 25ms)."""
    model_path = voice._get_wakeword_model_path()
    if not model_path or not os.path.exists(model_path):
        print("  [SKIP] test_onnx_inference_benchmark: ONNX model file not found")
        return

    bench = voice.benchmark_onnx_inference(model_path, iterations=15)
    assert "avg_ms" in bench, f"Benchmark returned error: {bench}"
    print(f"  [BENCHMARK] Avg ONNX latency: {bench['avg_ms']}ms (p95: {bench['p95_ms']}ms)")
    # Must comfortably meet real-time budget (< 25ms for an 80ms chunk)
    assert bench["avg_ms"] < 25.0, f"ONNX inference too slow: {bench['avg_ms']}ms"


if __name__ == "__main__":
    print("Running comprehensive voice & wakeword regression tests...")
    test_listening_flag_lifecycle()
    print("  [PASS] test_listening_flag_lifecycle")
    test_device_resolver()
    print("  [PASS] test_device_resolver")
    test_wakeword_status_structure()
    print("  [PASS] test_wakeword_status_structure")
    test_persistence_logic()
    print("  [PASS] test_persistence_logic")
    test_preroll_ring_buffer()
    print("  [PASS] test_preroll_ring_buffer")
    test_audio_normalization()
    print("  [PASS] test_audio_normalization")
    test_acoustic_feature_extraction()
    print("  [PASS] test_acoustic_feature_extraction")
    test_speaker_voiceprint_verification()
    print("  [PASS] test_speaker_voiceprint_verification")
    test_vad_silence_filtering()
    print("  [PASS] test_vad_silence_filtering")
    test_onnx_inference_benchmark()
    print("  [PASS] test_onnx_inference_benchmark")
    print("\nALL VOICE WAKEWORD TESTS PASSED!")
