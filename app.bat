@echo off
setlocal
cd /d "%~dp0"
set PYTHONPATH=%~dp0src
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" -m nobitex_arb ui
