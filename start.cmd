@echo off
rem overlays-server: git clone ile kurulumda cift tikla calistir.
rem Acilista "git pull" ile kendini gunceller. Kapatmak icin: set OVERLAYS_SERVER_NO_UPDATE=1
title overlays-server (pencereyi kapatma)
cd /d "%~dp0"
rem Gunluk log dosyalari bu klasorun altinda: logs (sorun bildirirken ekle).
if not defined OVERLAYS_SERVER_LOG_DIR set "OVERLAYS_SERVER_LOG_DIR=%~dp0logs"
set "NEED_INSTALL="
if defined OVERLAYS_SERVER_AFTER_UPDATE goto :after_update

where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden 22.18 veya ustunu kur. & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || (echo Node.js 22.18 veya ustu gerekli. Kurulu surum: & node --version & pause & exit /b 1)

rem ---- guncelleme (git pull) ----
if defined OVERLAYS_SERVER_NO_UPDATE goto :install
if not exist .git goto :install
where git >nul 2>nul || (echo Git bulunamadi, guncelleme atlandi. & goto :install)
set "OVERLAYS_SERVER_OLD_HEAD="
for /f %%h in ('git rev-parse HEAD 2^>nul') do set "OVERLAYS_SERVER_OLD_HEAD=%%h"
echo Guncellemeler kontrol ediliyor (git pull)...
set "GIT_TERMINAL_PROMPT=0"
rem git bu dosyayi degistirebilir ve cmd calisan dosyayi satir satir okur: pull ile yeniden baslatma ayni satirda.
git pull --ff-only || echo Guncelleme alinamadi ^(internet yok ya da yerel degisiklik var^), mevcut surumle devam ediliyor. & set "OVERLAYS_SERVER_AFTER_UPDATE=1" & "%~f0" %*

:after_update
set "OVERLAYS_SERVER_AFTER_UPDATE="
if not defined OVERLAYS_SERVER_OLD_HEAD goto :install
set "NEW_HEAD="
for /f %%h in ('git rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%h"
if "%OVERLAYS_SERVER_OLD_HEAD%"=="%NEW_HEAD%" (echo Guncel. & goto :install)
echo Guncellendi: %OVERLAYS_SERVER_OLD_HEAD:~0,7% -^> %NEW_HEAD:~0,7%
git diff --quiet %OVERLAYS_SERVER_OLD_HEAD% %NEW_HEAD% -- package.json pnpm-lock.yaml || set "NEED_INSTALL=1"

:install
set "OVERLAYS_SERVER_OLD_HEAD="
if not exist node_modules set "NEED_INSTALL=1"
if not defined NEED_INSTALL goto :run
echo Bagimliliklar kuruluyor...
call npm install --omit=dev --no-audit --no-fund || (pause & exit /b 1)
set "NEED_INSTALL="

:run
node src\cli.ts %*
pause
