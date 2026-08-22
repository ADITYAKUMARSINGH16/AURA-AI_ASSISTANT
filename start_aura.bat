@echo off
:: Request Admin Privileges automatically
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :admin
) else (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~dpnx0' -Verb RunAs"
    exit /b
)
:admin
cd /d "%~dp0"

echo ==============================================
echo ==============================================
echo             STARTING AURA ASSISTANT
echo ==============================================
echo.
echo Launching System Tray Daemon...
echo You can find the AURA icon in your Windows taskbar.
echo.
python tray.py
pause
