@echo off
setlocal
echo Restarting DeepSeek Harness to load the updated dsh-mobile-bridge client...
taskkill /IM "DeepSeek Harness.exe" /T /F >nul 2>&1
timeout /t 3 /nobreak >nul
start "" "%DSH_HOME%\DeepSeek Harness.exe"
endlocal
