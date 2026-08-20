@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   Setting up the arbitrage paper-trading lab
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [X] Python was not found.
  echo     Install it from https://www.python.org/downloads/
  echo     IMPORTANT: tick "Add Python to PATH" during installation.
  echo.
  pause
  exit /b 1
)

python -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"
if errorlevel 1 (
  echo [X] Python 3.9 or newer is required.
  python --version
  pause
  exit /b 1
)

echo [1/3] Creating the virtual environment...
if not exist ".venv" python -m venv .venv
if errorlevel 1 (
  echo [X] Could not create the virtual environment.
  pause
  exit /b 1
)

echo [2/3] Installing dependencies...
call ".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
call ".venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet
if errorlevel 1 (
  echo [X] Dependency installation failed. Check your internet connection.
  pause
  exit /b 1
)

echo [3/3] Running the test suite...
call ".venv\Scripts\python.exe" -m unittest discover -s tests
if errorlevel 1 (
  echo [X] Tests failed. Do not trust any numbers until this passes.
  pause
  exit /b 1
)

echo.
echo Setup complete. Next step: run doctor.bat
echo.
pause
