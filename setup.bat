@echo off
setlocal
rem TP_2-3 viewer - one-click setup for a new PC
rem  - Run it anywhere: clones github.com/CornorKIM/viewer into .\viewer, installs, links Vercel,
rem    pulls env vars, then starts the local server and opens the browser.
rem  - Run it inside an existing viewer folder: updates it (git pull) instead of cloning.
rem  - "setup.bat norun" : set up only, do not start the server.

set "REPO_URL=https://github.com/CornorKIM/viewer.git"
set "VERCEL_PROJECT=viewer"
set "PORT=3000"

echo [1/7] Checking Git and Node.js...
where git >nul 2>nul
if errorlevel 1 goto :install_git
where node >nul 2>nul
if errorlevel 1 goto :install_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)"
if errorlevel 1 goto :install_node

echo [2/7] Getting source code...
set "APP_DIR=%~dp0viewer"
if exist "%~dp0.git" if exist "%~dp0package.json" set "APP_DIR=%~dp0."
if exist "%APP_DIR%\.git" goto :update_repo
echo Cloning %REPO_URL%
git clone "%REPO_URL%" "%APP_DIR%"
if errorlevel 1 goto :fail
goto :repo_ready
:update_repo
echo Updating existing copy...
git -C "%APP_DIR%" pull --ff-only
if errorlevel 1 echo WARNING: git pull failed. Continuing with the local copy.
:repo_ready
cd /d "%APP_DIR%"
if errorlevel 1 goto :fail

echo [3/7] Installing packages - npm install...
call npm install
if errorlevel 1 goto :fail

echo [4/7] Checking Vercel CLI...
set "VERCEL=vercel"
where vercel >nul 2>nul
if not errorlevel 1 goto :vercel_ready
echo Installing Vercel CLI - first time only...
call npm install -g vercel
if errorlevel 1 goto :fail
where vercel >nul 2>nul
if errorlevel 1 set "VERCEL=npx --yes vercel"
:vercel_ready

echo [5/7] Checking Vercel login...
call %VERCEL% whoami >nul 2>nul
if not errorlevel 1 goto :logged_in
echo Login needed. Open the https://vercel.com/oauth/device link shown below in a browser and approve.
echo If several codes appear, use the last one.
call %VERCEL% login
if errorlevel 1 goto :fail
:logged_in

echo [6/7] Linking Vercel project "%VERCEL_PROJECT%"...
if exist ".vercel\project.json" goto :linked
call %VERCEL% link --yes --project %VERCEL_PROJECT%
if not exist ".vercel\project.json" call %VERCEL% link
if not exist ".vercel\project.json" goto :fail
:linked

echo [7/7] Downloading environment variables into .env.local...
call %VERCEL% env pull .env.local --yes
if errorlevel 1 goto :fail
findstr /b "PG_PASSWORD=" .env.local >nul || echo WARNING: PG_PASSWORD is missing in .env.local. Machine data will fail.
findstr /b "INFLUX_TOKEN=" .env.local >nul || echo WARNING: INFLUX_TOKEN is missing in .env.local. Sensor data will fail.

if /i "%~1"=="norun" goto :done

echo.
echo Starting local server in a new window...
start "TP_2-3 server" cmd /k "%VERCEL% dev --yes --listen %PORT%"
echo Waiting for http://localhost:%PORT% ...
set /a TRIES=0
:wait
curl -s -o nul http://localhost:%PORT%
if not errorlevel 1 goto :ready
set /a TRIES+=1
if %TRIES% geq 90 goto :slow
timeout /t 2 /nobreak >nul
goto :wait
:ready
start "" http://localhost:%PORT%
goto :done
:slow
echo Server did not answer within 3 minutes. Check the server window for errors.

:done
echo.
echo ============================================================
echo  Setup complete: %CD%
echo  Next time, in this folder:
echo    vercel dev --yes --listen %PORT%   - run locally
echo    share.bat                          - share a public link
echo ============================================================
pause
exit /b 0

:install_git
echo Git was not found. Installing with winget...
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
echo Close this window and run setup.bat again.
pause
exit /b 1

:install_node
echo Node.js 20.19 or newer is required. Installing Node.js LTS with winget...
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
echo Close this window and run setup.bat again.
pause
exit /b 1

:fail
echo.
echo Setup stopped because the step above failed. Check the messages above.
pause
exit /b 1
