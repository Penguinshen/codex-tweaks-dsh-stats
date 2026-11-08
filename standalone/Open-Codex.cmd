@echo off
setlocal
set "PSModulePath="
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-demo.ps1" -Port 49251 %*
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
