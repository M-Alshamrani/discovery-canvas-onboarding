@echo off
REM Dell Discovery Canvas — Windows local runner
REM Double-click this file to launch the app in your browser.

setlocal

REM Check that Python is installed and on PATH
python --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Python 3.10 or later is not installed on this machine.
  echo.
  echo  Install it from:  https://www.python.org/downloads/
  echo  IMPORTANT: during install, tick the box "Add python.exe to PATH".
  echo.
  echo  Once installed, run this file again.
  echo.
  pause
  exit /b 1
)

REM Change to the folder this script lives in, regardless of where launched from
cd /d "%~dp0"

echo.
echo  ============================================================
echo    Dell Discovery Canvas
echo    Local server starting on http://localhost:8000
echo    Your browser will open in a moment.
echo.
echo    To stop: close this window OR press Ctrl+C then Y.
echo  ============================================================
echo.

REM Open the default browser after a 2-second delay so the server is up
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8000"

REM Run Python's built-in static file server on port 8000
python -m http.server 8000

echo.
echo  Server stopped.
pause
endlocal
