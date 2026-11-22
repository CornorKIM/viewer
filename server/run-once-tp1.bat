@echo off
rem Runs the TP1 (type 1) smart factory log sender once (called every 10 minutes by Task Scheduler).
cd /d "%~dp0"
if not exist logs mkdir logs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env.tp1 tp1-sf-log-runner.mjs %* >> logs\tp1-sf-log.log 2>&1
