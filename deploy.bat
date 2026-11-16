@echo off
rem TP_2-3 viewer - deploy to Vercel
rem Public link that works even when this PC is off.
cd /d "%~dp0"

echo [1/2] Production environment variables on Vercel:
call vercel env ls production
echo.
echo PG_PASSWORD and INFLUX_TOKEN must be in the list above.
echo If one is missing, close this window and run (in this folder):
echo    vercel env add PG_PASSWORD production
echo    vercel env add INFLUX_TOKEN production
echo.
pause

echo [2/2] Deploying...
call vercel --prod --yes
echo.
echo ============================================================
echo  PUBLIC LINK = the https address on the "Production:" or
echo  "Aliased:" line above. It works even when this PC is off.
echo ============================================================
pause
