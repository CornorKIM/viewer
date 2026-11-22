@echo off
setlocal
rem TP1 (Gyeonggi TP type 1) smart factory log sender - company server setup (Windows)
rem   install-task-tp1.bat          register task: run-once-tp1.bat every 10 minutes (as SYSTEM)
rem   install-task-tp1.bat check    one dry run (no sending)
rem   install-task-tp1.bat test     one test send (DO6999, excluded from statistics)
rem   install-task-tp1.bat remove   delete the task
rem Separate from the TP23 task. Run as administrator to register.
set "TASK=TP1 SF Log Runner"
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 22 or later, then run this again.
  pause & exit /b 1
)
if not exist ".env.tp1" (
  echo .env.tp1 not found. Copy env.tp1.example to .env.tp1 and fill in the values.
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
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env.tp1 tp1-sf-log-runner.mjs --dry
  pause & exit /b
)
if /i "%~1"=="test" (
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env.tp1 tp1-sf-log-runner.mjs --test
  pause & exit /b
)

schtasks /Create /TN "%TASK%" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /TR "\"%~dp0run-once-tp1.bat\"" /F
if errorlevel 1 (
  echo Failed to register the task. Run this file as administrator.
) else (
  echo Registered "%TASK%" - runs every 10 minutes, also without login and after reboot.
  echo Log file: %~dp0logs\tp1-sf-log.log
)
pause
