@echo off
REM Build Google Maps Lead Scraper - Setup Script
REM This script sets up the project for first-time use

echo.
echo ========================================
echo Google Maps Lead Scraper - Setup
echo ========================================
echo.

REM Check for Node.js
echo [1/5] Checking Node.js installation...
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found. Please install Node.js from https://nodejs.org/
    exit /b 1
)
echo OK: Node.js found

REM Check for Python
echo [2/5] Checking Python installation...
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python not found. Please install Python from https://www.python.org/
    exit /b 1
)
echo OK: Python found

REM Install Node dependencies
echo [3/5] Installing Node.js dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed
    exit /b 1
)
echo OK: Dependencies installed

REM Install Python dependencies
echo [4/5] Installing Python dependencies...
call pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pip install failed
    exit /b 1
)
echo OK: Python packages installed

REM Setup Playwright
echo [5/5] Setting up Playwright browsers...
call python -m playwright install chromium
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Playwright setup failed
    exit /b 1
)
echo OK: Playwright configured

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Copy .env.example to .env.local
echo   2. Edit .env.local with your API credentials
echo   3. Run: npm start
echo.
echo For detailed setup instructions, see SECURITY.md
echo.
pause
