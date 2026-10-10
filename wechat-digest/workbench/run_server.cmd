@echo off
rem Silent launcher for logon autostart: supervised, auto-restart on exit.
cd /d "%~dp0.."
where pythonw >nul 2>nul
if errorlevel 1 (set "PYEXE=python") else (set "PYEXE=pythonw")
start "" "%PYEXE%" "tools\workbench_supervisor.py"
exit /b 0
