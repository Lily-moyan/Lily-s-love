# -*- coding: utf-8 -*-
"""生成一个双击即可推送的 .bat（用 GBK 编码写，cmd 才能真正显示中文）"""
import io, os

BAT_GBK = r'''@echo off
title 推送智能客服项目到 GitHub
color 0A

echo ============================================================
echo   正在把「AI 智能客服系统」推送到 GitHub
echo ============================================================
echo.
echo   仓库地址：https://github.com/Lily-moyan/coze-customer-service
echo.
echo   稍后可能会弹出登录窗口，请登录你的 GitHub 账号并授权。
echo   授权后推送会自动完成，不需要你再做别的。
echo.
echo ------------------------------------------------------------
echo.

cd /d "G:\coze-customer-service"

git push -u origin main --force

echo.
echo ------------------------------------------------------------
if %ERRORLEVEL% EQU 0 (
    echo.
    echo   [成功] 推送完成！
    echo.
    echo   现在去浏览器打开（或刷新）：
    echo   https://github.com/Lily-moyan/coze-customer-service
    echo.
    echo   应该能看到 14 个条目（含 src 文件夹和 3 个点开头的文件）。
) else (
    echo.
    echo   [失败] 退出码 %ERRORLEVEL%
    echo.
    echo   常见原因：
    echo     1. 登录窗口没弹出来或你取消了 -^> 重跑一次本文件
    echo     2. 网络抖动                   -^> 重跑一次本文件
    echo     3. 仍然失败                   -^> 把本窗口截图发给 AI 助手
)
echo.
echo ============================================================
echo.
pause
'''

# 目标：工作区内先生成，再复制到 G 盘根目录
ws_path = r'G:\dsh\一键推送GitHub.bat'
io.open(ws_path, 'w', encoding='gbk', errors='replace', newline='\r\n').write(BAT_GBK)
print('已生成(GBK): %s  (%d B)' % (ws_path, os.path.getsize(ws_path)))
