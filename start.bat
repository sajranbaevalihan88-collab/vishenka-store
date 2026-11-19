@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Vishenka Store - React + Python + PostgreSQL
echo.
echo   ==========================================
echo    Vishenka Store - zapusk
echo   ==========================================
echo.
echo   Ne zakryvayte eto okno!
echo.
python run.py
echo.
pause
