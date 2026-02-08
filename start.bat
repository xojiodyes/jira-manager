@echo off
REM Start Jira Manager with real Jira connection
REM Before running, copy config.example.json to config.json and fill in your credentials:
REM   copy config.example.json config.json
REM   notepad config.json

cd /d "%~dp0"

if not exist config.json (
    echo config.json not found!
    echo Copy config.example.json to config.json and fill in your credentials:
    echo     copy config.example.json config.json
    pause
    exit /b 1
)

set MODE=real
node server.js
pause
