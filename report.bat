@echo off
setlocal
cd /d "%~dp0"
set PYTHONPATH=%~dp0src
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
call ".venv\Scripts\python.exe" -m nobitex_arb report %*
echo.
echo Opening the HTML report...
for /f "delims=" %%f in ('dir /b /o-d "reports\*.html" 2^>nul') do (
  start "" "reports\%%f"
  goto :done
)
:done
pause
