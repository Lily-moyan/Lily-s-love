' Daily work plan desktop widget - silent launcher (no console flash).
Option Explicit

Dim shell, fso, base, cmd
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd  = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ _
       & base & "\DailyPlan.ps1"""

shell.Run cmd, 0, False
