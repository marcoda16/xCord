@echo off
setlocal enabledelayedexpansion
title Instalador de xcord

echo ============================================
echo   Instalador de xcord (plugin de Vencord)
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [!] No se encontro Git instalado.
    echo     Se va a abrir la pagina de descarga. Instalalo y despues
    echo     vuelve a hacer doble clic en este archivo.
    start https://git-scm.com/download/win
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [!] No se encontro Node.js instalado.
    echo     Se va a abrir la pagina de descarga. Instala la version LTS
    echo     y despues vuelve a hacer doble clic en este archivo.
    start https://nodejs.org
    pause
    exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [*] Instalando pnpm...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [X] No se pudo instalar pnpm.
        pause
        exit /b 1
    )
)

set INSTALL_DIR=%USERPROFILE%\Vencord

if exist "%INSTALL_DIR%\.git" (
    echo [*] Vencord ya esta clonado, actualizando...
    cd /d "%INSTALL_DIR%"
    call git pull
) else (
    echo [*] Clonando Vencord en %INSTALL_DIR%...
    call git clone https://github.com/Vendicated/Vencord "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [X] Fallo al clonar Vencord.
        pause
        exit /b 1
    )
    cd /d "%INSTALL_DIR%"
)

echo [*] Instalando dependencias de Vencord...
call pnpm install
if errorlevel 1 (
    echo [X] Fallo pnpm install.
    pause
    exit /b 1
)

if exist "src\userplugins\xcord\.git" (
    echo [*] xcord ya esta clonado, actualizando...
    pushd "src\userplugins\xcord"
    call git pull
    popd
) else (
    echo [*] Clonando xcord...
    call git clone https://github.com/marcoda16/xCord.git "src\userplugins\xcord"
    if errorlevel 1 (
        echo [X] Fallo al clonar xcord.
        pause
        exit /b 1
    )
)

echo [*] Compilando...
call pnpm build
if errorlevel 1 (
    echo [X] Fallo la compilacion.
    pause
    exit /b 1
)

echo.
echo [*] Ahora se va a inyectar en Discord.
echo     Cuando te lo pida, elige con las flechas tu instalacion de
echo     Discord (Stable/PTB/Canary) y presiona Enter.
echo.
pause
call pnpm inject

echo.
echo ============================================
echo   Listo. Abre Discord (reiniciandolo si ya
echo   estaba abierto) y activa "xcord" en
echo   Ajustes -^> Vencord -^> Plugins
echo ============================================
pause
