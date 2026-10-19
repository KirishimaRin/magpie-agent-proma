@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 或更新版本，然后重新运行。
  pause
  exit /b 1
)
node "%~dp0magpie-proma.cjs" --apply
if errorlevel 1 (
  echo 同步未完成，请按上面的提示处理后重试。
)
pause
