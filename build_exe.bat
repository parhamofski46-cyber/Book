@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ==========================================================
echo   Building ArbitrageLab.exe for Windows
echo ==========================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [X] Python was not found.
  echo     Install it from https://www.python.org/downloads/
  echo     IMPORTANT: tick "Add Python to PATH" during installation.
  pause
  exit /b 1
)

python -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"
if errorlevel 1 (
  echo [X] Python 3.9 or newer is required. Found:
  python --version
  pause
  exit /b 1
)

echo [1/5] Preparing the build environment...
if not exist ".venv" python -m venv .venv
if errorlevel 1 ( echo [X] Could not create the virtual environment. & pause & exit /b 1 )
set PY=.venv\Scripts\python.exe

echo [2/5] Installing dependencies...
"%PY%" -m pip install --upgrade pip --quiet
"%PY%" -m pip install -r requirements.txt --quiet
if errorlevel 1 ( echo [X] Dependency installation failed. Check your connection. & pause & exit /b 1 )
"%PY%" -m pip install "pyinstaller>=6.3" --quiet
if errorlevel 1 ( echo [X] PyInstaller installation failed. & pause & exit /b 1 )

echo [3/5] Running the test suite...
set PYTHONPATH=%~dp0src
"%PY%" -m unittest discover -s tests
if errorlevel 1 (
  echo.
  echo [X] Tests failed. The build is stopped on purpose:
  echo     an executable built from failing code would report wrong numbers.
  pause
  exit /b 1
)

echo [4/5] Building the executable ^(this takes a few minutes^)...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
"%PY%" -m PyInstaller nobitex_arb.spec --noconfirm --clean
if errorlevel 1 ( echo [X] The build failed. See the output above. & pause & exit /b 1 )

if not exist "dist\ArbitrageLab.exe" (
  echo [X] The build finished but dist\ArbitrageLab.exe is missing.
  pause
  exit /b 1
)

echo [5/5] Staging the runtime files...
copy /y "config.example.json" "dist\config.example.json" >nul
copy /y "README.md" "dist\README.md" >nul

for %%F in ("dist\ArbitrageLab.exe") do set SIZE=%%~zF
set /a MB=!SIZE!/1048576

echo.
echo ==========================================================
echo   Done.  dist\ArbitrageLab.exe  ^(!MB! MB^)
echo ==========================================================
echo.
echo   Double-click it to launch. On first run it creates
echo   config.json and a data folder alongside the .exe.
echo.
echo   Windows SmartScreen will warn that the publisher is
echo   unknown, because the file is not code-signed. Choose
echo   "More info" then "Run anyway".
echo.
pause
