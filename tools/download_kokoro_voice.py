"""
AURA Offline Neural Voice Downloader (Kokoro-82M)
=================================================
Downloads the Kokoro-82M ONNX model and voice weights for 100% offline,
human-quality neural speech synthesis.
"""

import os
import sys
import urllib.request
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET_DIR = os.path.join(BASE_DIR, "models", "kokoro")

FILES = [
    {
        "name": "voices.json",
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.json",
        "size_mb": 30,
    },
    {
        "name": "kokoro-v0_19.onnx",
        "url": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx",
        "size_mb": 325,
    },
]

def download_file(url: str, dest: str, label: str):
    print(f"Downloading {label}...")
    start_time = time.time()

    def _progress(count, block_size, total_size):
        if total_size > 0:
            pct = int(count * block_size * 100 / total_size)
            mb = (count * block_size) / (1024 * 1024)
            tot_mb = total_size / (1024 * 1024)
            sys.stdout.write(f"\r  [{pct:3d}%] {mb:6.1f} MB / {tot_mb:6.1f} MB")
            sys.stdout.flush()

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as response, open(dest, "wb") as out_file:
        total_size = int(response.headers.get("content-length", 0))
        block_size = 1024 * 64
        count = 0
        while True:
            chunk = response.read(block_size)
            if not chunk:
                break
            out_file.write(chunk)
            count += 1
            _progress(count, block_size, total_size)

    elapsed = time.time() - start_time
    print(f"\n  Done in {elapsed:.1f}s ({os.path.getsize(dest) / (1024 * 1024):.1f} MB)")

def main():
    print("=" * 65)
    print("      AURA OFFLINE NEURAL VOICE INSTALLER (Kokoro-82M)       ")
    print("=" * 65)
    os.makedirs(TARGET_DIR, exist_ok=True)
    print(f"Target Directory: {TARGET_DIR}\n")

    for item in FILES:
        dest_path = os.path.join(TARGET_DIR, item["name"])
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1024 * 1024:
            print(f"  [ALREADY PRESENT] {item['name']} ({os.path.getsize(dest_path) / (1024 * 1024):.1f} MB)")
        else:
            download_file(item["url"], dest_path, f"{item['name']} (~{item['size_mb']} MB)")

    print("\n" + "=" * 65)
    print("  Kokoro-82M offline voice files are ready!")
    print("  To enable offline voice, set in your .env file:")
    print("    AURA_TTS_BACKEND=kokoro")
    print("    AURA_TTS_VOICE=af_heart")
    print("=" * 65)

if __name__ == "__main__":
    main()
