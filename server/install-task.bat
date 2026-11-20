@echo off
setlocal
rem TP_2-3 smart factory log sender - company server setup (Windows)
rem   install-task.bat          register task: run-once.bat every 10 minutes (as SYSTEM, runs without login)
rem   install-task.bat check    one dry run (no sending), shows what would be sent
rem   install-task.bat test     one test send (DO6999, excluded from statistics) to check the keys
rem   install-task.bat remove   delete the task
rem Run as administrator (right-click > Run as administrator).
set "TASK=TP23 SF Log Runner"
set "OLD_TASK=TP23 Smart Factory Log"
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22 or later, then run this again.
  pause & exit /b 1
)
if not exist ".env" (
  echo .env not found. Copy env.example to .env and fill in PG_PASSWORD and SF_LOG_KEY_A..D.
  pause & exit /b 1
)
if not exist "..\node_modules\pg" (
  echo Installing packages...
  pushd ..
  call npm install
  popd
)

if /i "%~1"=="remove" (
  schtasks /Delete /TN "%TASK%" /F
  pause & exit /b
)
if /i "%~1"=="check" (
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env sf-log-runner.mjs --dry
  pause & exit /b
)
if /i "%~1"=="test" (
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env sf-log-runner.mjs --test
  pause & exit /b
)

rem The older task called the Vercel API from this PC. Remove it so logs are not sent twice.
schtasks /Query /TN "%OLD_TASK%" >nul 2>nul
if not errorlevel 1 (
  echo Removing older task "%OLD_TASK%" to avoid duplicate sending...
  schtasks /Delete /TN "%OLD_TASK%" /F
)

schtasks /Create /TN "%TASK%" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /TR "\"%~dp0run-once.bat\"" /F
if errorlevel 1 (
  echo Failed to register the task. Run this file as administrator.
) else (
  echo Registered "%TASK%" - runs every 10 minutes, also without login and after reboot.
  echo Log file: %~dp0logs\sf-log.log
)
pause
