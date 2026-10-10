@echo off
chcp 65001 >nul
cd /d "%~dp0"
set npm_config_cache=G:\dsh\.npm-cache
title ip-studio (文案工坊) - http://localhost:5177
echo.
echo   文案工坊工作台  http://localhost:5177/app
echo   产品说明页      http://localhost:5177
echo   管理后台        http://localhost:5177/admin
echo   提示词说明书    http://localhost:5177/prompts
echo   模型通道：DeepSeek（配置见 .env）
echo   关闭本窗口即停止服务。
echo.
start "" http://localhost:5177/app
node server/index.js
pause
