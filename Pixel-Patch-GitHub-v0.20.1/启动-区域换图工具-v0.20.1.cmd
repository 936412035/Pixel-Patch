@echo off
setlocal
set "PATCH_APP_DIR=%~dp0"
set "PATCH_APP_PORT=17837"
set "PATCH_APP_PATH=%PATCH_APP_DIR%index.html"
set "PATCH_PROXY_URL=http://127.0.0.1:%PATCH_APP_PORT%/"
set "PATCH_APP_URL=file:///%PATCH_APP_PATH:\=/%?proxyPort=%PATCH_APP_PORT%"
powershell.exe -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 '%PATCH_PROXY_URL%health'; if ($r.Content -match 'pixel-patch') { exit 0 } } catch {}; exit 1" >nul 2>nul
if errorlevel 1 start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%PATCH_APP_DIR%server.ps1" -Port %PATCH_APP_PORT%
where msedge.exe >nul 2>nul
if %errorlevel%==0 (
  start "" msedge.exe --app="%PATCH_APP_URL%" --start-maximized
  exit /b 0
)
start "" "%PATCH_APP_URL%"
