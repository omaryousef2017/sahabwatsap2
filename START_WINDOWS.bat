@echo off
chcp 65001 >nul
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm install
node scripts/check-env.js || (notepad .env & exit /b 1)
npm start
