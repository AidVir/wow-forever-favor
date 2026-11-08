@echo off
rem Double-click to preview the site locally at http://localhost:5178 (no caching, live prices).
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%LOCALAPPDATA%\portable-tools\node-v24.11.0-win-x64\node.exe"
start "" http://localhost:5178/
"%NODE%" scripts\serve.mjs 5178 %*
pause
