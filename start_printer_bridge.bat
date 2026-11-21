@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Vishenka Xprinter Bridge (TSPL)
echo.
echo   Vishenka Xprinter Bridge zapushen: http://127.0.0.1:18181
echo   Teper pryamaya pechat na Xprinter rabotaet dazhe s sayta na Render!
echo.
python printer_bridge.py
pause
