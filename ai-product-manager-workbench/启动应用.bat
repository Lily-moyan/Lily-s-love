@echo off
chcp 65001 >nul
echo ========================================
echo    AI 产品经理工作台
echo ========================================
echo.
echo 请选择操作：
echo.
echo [1] 打开主应用（推荐）
echo [2] 清除数据并重新配置
echo [3] 打开调试工具
echo [4] 退出
echo.
set /p choice=请输入选项（1-4）：

if "%choice%"=="1" goto open
if "%choice%"=="2" goto clear
if "%choice%"=="3" goto debug
if "%choice%"=="4" goto exit
goto invalid

:open
echo.
echo 正在打开 AI 产品经理工作台...
start "" "%~dp0index.html"
timeout /t 2 >nul
goto end

:clear
echo.
echo 正在打开清除和配置页面...
start "" "%~dp0清除数据并重新配置.html"
timeout /t 2 >nul
goto end

:debug
echo.
echo 正在打开调试工具...
start "" "%~dp0调试工具.html"
timeout /t 2 >nul
goto end

:invalid
echo.
echo 无效选项，请重新运行
timeout /t 2 >nul
goto end

:exit
echo.
echo 再见！
timeout /t 2 >nul
exit

:end
echo.
echo 按任意键关闭窗口...
pause >nul