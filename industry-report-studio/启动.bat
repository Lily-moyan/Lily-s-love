@echo off
chcp 65001 >nul
cd /d "%~dp0"
set npm_config_cache=G:\dsh\.npm-cache
title 行业分析工作台 - http://localhost:5178
echo.
echo   工作台      http://localhost:5178/app
echo   资讯页      http://localhost:5178/app  (顶部「资讯」标签)
echo   管理后台    http://localhost:5178/admin
echo   提示词说明  http://localhost:5178/prompts
echo   模型通道：DeepSeek（配置见 .env）
echo   关闭本窗口即停止服务。
echo.
start "" http://localhost:5178/app
node server/index.js
pause
