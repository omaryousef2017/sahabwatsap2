@echo off
chcp 65001 >nul
setlocal
where git >nul 2>nul || (echo Git is not installed. Download: https://git-scm.com/download/win & pause & exit /b 1)

rem --- safety: .env must be ignored ---
findstr /x /c:".env" .gitignore >nul || (echo STOP: .env is not listed in .gitignore & pause & exit /b 1)

set /p REPO=https://github.com/omaryousef2017/sahabwatsap (e.g. https://github.com/USER/sahab-wa-engine.git): 
if "%REPO%"=="" (echo No URL entered. & pause & exit /b 1)

if not exist .git git init -b main
git add .

rem --- safety: .env must not be staged ---
git ls-files | findstr /x /c:".env" >nul && (echo STOP: .env is tracked by git. Run: git rm --cached .env & pause & exit /b 1)

git commit -m "Deploy: sahab-wa-engine"
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin %REPO%
git push -u origin main

echo.
echo Done. Next: Render ^> New ^> Blueprint ^> select this repo.
pause
