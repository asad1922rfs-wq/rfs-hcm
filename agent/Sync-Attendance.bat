@echo off
title RFS HCM - Sync Attendance
echo Syncing attendance from the machine to RFS HCM...
echo.
"C:\ZKBioTime\Python311\python.exe" "%~dp0sync-now.py"
echo.
pause
