@echo off
rem TP_2-3 smart factory log - register a Windows scheduled task that calls /api/sf-log every 10 minutes.
rem Run once on a PC that stays on (for example a company mini PC).
rem   sf-log-schedule.bat         register (or replace) the task
rem   sf-log-schedule.bat remove  delete the task
set "TASK=TP23 Smart Factory Log"
set "URL=https://viewer-five-beta.vercel.app/api/sf-log"

if /i "%~1"=="remove" (
  schtasks /Delete /TN "%TASK%" /F
  pause
  exit /b
)

schtasks /Create /TN "%TASK%" /SC MINUTE /MO 10 /TR "curl -s -o NUL --max-time 60 %URL%" /F
if errorlevel 1 (
  echo Failed to register the task.
) else (
  echo Registered "%TASK%" - calls %URL% every 10 minutes.
  echo Check it in Task Scheduler. Remove with: sf-log-schedule.bat remove
)
pause
