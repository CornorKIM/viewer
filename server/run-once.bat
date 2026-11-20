@echo off
rem Runs the smart factory log sender once (called every 10 minutes by Task Scheduler).
cd /d "%~dp0"
if not exist logs mkdir logs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env sf-log-runner.mjs %* >> logs\sf-log.log 2>&1
