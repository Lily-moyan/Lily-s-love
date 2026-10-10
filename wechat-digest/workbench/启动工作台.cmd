@echo off
title WeChat Digest Workbench
cd /d "%~dp0.."

echo ================================================
echo   WeChat Digest Workbench
echo   Data auto-refreshes every hour.
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python not found in PATH
  pause
  exit /b 1
)
where pythonw >nul 2>nul
if errorlevel 1 (set "PYEXE=python") else (set "PYEXE=pythonw")

rem Remove the previous URL so we never open a stale port.
del "out\workbench.url" >nul 2>nul

echo   Starting supervisor (auto-restart; log: out\workbench.log) ...
start "" "%PYEXE%" "tools\workbench_supervisor.py"
ping -n 8 127.0.0.1 >nul

set "WBURL="
if exist "out\workbench.url" set /p WBURL=<"out\workbench.url"
if not defined WBURL set "WBURL=http://127.0.0.1:18765/"

start "" "%WBURL%"
echo.
echo ================================================
echo   Started. URL: %WBURL%
echo   You may close this window; the service keeps running.
echo   To stop it: end pythonw.exe in Task Manager.
echo ================================================
pause
