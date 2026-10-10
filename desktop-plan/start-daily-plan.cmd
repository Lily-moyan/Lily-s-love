@echo off
rem Daily work plan desktop widget - console launcher (for debugging).
rem Double-click start-daily-plan.vbs for the normal, no-flash launch.
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0DailyPlan.ps1"
