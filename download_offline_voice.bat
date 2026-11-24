@echo off
title AURA Offline Voice Installer
cd /d "%~dp0"
echo ========================================================
echo Downloading Kokoro-82M Offline Neural Voice for AURA...
echo ========================================================
.venv\Scripts\python.exe tools\download_kokoro_voice.py
echo.
pause
