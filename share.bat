@echo off
rem TP_2-3 viewer - share while this PC is on
rem 1) starts local server (vercel dev, port 3000) in a new window
rem 2) creates a public https link with Cloudflare quick tunnel
rem Close this window to stop sharing.
cd /d "%~dp0"

echo [1/3] Starting local server in a new window...
start "TP_2-3 server" cmd /k "vercel dev --yes --listen 3000"

echo [2/3] Waiting for http://localhost:3000 ...
:wait
curl -s -o nul http://localhost:3000
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait
)
echo Local server is ready.

echo [3/3] Creating public link...
where cloudflared >nul 2>nul
if errorlevel 1 if not exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" if not exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
  echo Installing cloudflared - first time only ...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
)
set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not exist "%CF%" if not "%CF%"=="cloudflared" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"

echo.
echo ============================================================
echo  SHARE LINK = the https://....trycloudflare.com address below
echo  Keep this window and the server window open while sharing.
echo ============================================================
echo.
"%CF%" tunnel --url http://localhost:3000
pause
