@echo off
rem overlays-server: git clone ile kurulumda cift tikla calistir.
title overlays-server (pencereyi kapatma)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden 22.18 veya ustunu kur. & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || (echo Node.js 22.18 veya ustu gerekli. Kurulu surum: & node --version & pause & exit /b 1)
if not exist node_modules (echo Bagimliliklar kuruluyor... & call npm install --omit=dev --no-audit --no-fund || (pause & exit /b 1))
node src\cli.ts %*
pause
