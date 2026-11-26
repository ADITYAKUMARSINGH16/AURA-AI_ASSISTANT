@echo off
title AURA Offline STT (faster-whisper) Setup
cd /d "%~dp0"
echo ========================================================
echo Downloading and verifying faster-whisper Offline STT...
echo ========================================================
.venv\Scripts\python.exe tools\download_faster_whisper.py
echo.
pause
