@echo off
setlocal
cd /d "%~dp0"
set PYTHONPATH=%~dp0src
if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
echo ============================================
echo   PAPER TRADING - simulated money only
echo   No order is ever sent to any exchange.
echo   Leave this window open. Ctrl+C to stop.
echo ============================================
echo.
call ".venv\Scripts\python.exe" -m nobitex_arb collect %*
echo.
echo Stopped. Run report.bat to see the results.
pause
