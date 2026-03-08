@echo off
REM Quick Start Test Script - Tests all major components
REM Windows Batch version

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo Google Maps Lead Scraper - Quick Start
echo ==========================================
echo.

REM Check environment
echo [1/5] Verifying environment...
call npm run verify
if %ERRORLEVEL% NEQ 0 goto error
echo.

REM Create sample data directory and file
echo [2/5] Creating sample test data...
if not exist "data" mkdir data
(
echo business_name,address,city,state,phone,website,rating,review_count
echo "Smoke Therapy","123 Main St","Houston","TX","713-555-8899","https://smoketherapy.com","4.8","156"
echo "Rock N Roll Smoke","456 Rocker Ave","Houston","TX","832-555-1234","https://rocknroll.com","4.5","98"
echo "Vape City","789 Vapor Ln","Houston","TX","713-555-5678","https://vapecity.com","4.2","67"
) > data\test_leads.csv
echo [OK] Sample test data created: data/test_leads.csv
echo.

REM Test Python scraper
echo [3/5] Testing Python scraper...
echo   Command: python scraper.py --help
python scraper.py --help >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto error
echo   [OK] Scraper ready
echo.

REM Test Node scripts
echo [4/5] Testing Node.js scripts...
echo   Checking: server.js
node -c server.js >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto error
echo   [OK] Server syntax valid
echo   Checking: run_pipeline.js
node -c run_pipeline.js >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto error
echo   [OK] Pipeline syntax valid
echo   Checking: auditor.js
node -c auditor.js >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto error
echo   [OK] Auditor syntax valid
echo.

REM Summary
echo [5/5] Summary
echo ==========================================
echo [OK] All tests passed!
echo.
echo Next steps:
echo   1. Edit .env.local with your API keys
echo   2. Run: npm start
echo   3. Visit: http://localhost:3000
echo.
echo To test scraper:
echo   python scraper.py --city "Houston" --type "smoke shop" --max-results 10
echo.
echo To run full pipeline:
echo   npm run pipeline
echo ==========================================
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Test failed!
echo Please run "npm run verify" for more details.
echo.
pause
exit /b 1
