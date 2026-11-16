@echo off
setlocal
cd /d "%~dp0"
title PokeParade - Launcher
set "PORT=3187"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 or newer from https://nodejs.org
  echo Then run this file again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Update Node.js from https://nodejs.org
  pause
  exit /b 1
)
if not exist "dist\server.mjs" (
  echo Installing build tools. Internet is required for the first launch...
  call npm ci --include=dev --no-fund --no-audit
  if errorlevel 1 goto failed
  call npm run build
  if errorlevel 1 goto failed
)
if not exist "node_modules\ws\package.json" (
  echo Installing runtime dependencies. Internet is required for the first launch...
  call npm ci --omit=dev --no-fund --no-audit
  if errorlevel 1 goto failed
)
echo Starting PokeParade...
echo Keep the server window open while streaming. Press Ctrl+C in that window to stop.
start "PokeParade - Server" /D "%~dp0" cmd /k node dist/server.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3187"
exit /b 0
:failed
echo.
echo Launch failed. Check your internet connection and the messages above.
pause
exit /b 1
