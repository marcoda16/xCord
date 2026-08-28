@echo off
setlocal enabledelayedexpansion
title Instalador de xcord

echo ============================================
echo   Instalador de xcord (plugin de Vencord)
echo ============================================
echo.

where winget >nul 2>nul
if errorlevel 1 (set HAS_WINGET=0) else (set HAS_WINGET=1)

call :ensure_git
if errorlevel 1 exit /b 1

call :ensure_node
if errorlevel 1 exit /b 1

where pnpm >nul 2>nul
if errorlevel 1 (
    echo [*] Instalando pnpm...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [X] No se pudo instalar pnpm.
        pause
        exit /b 1
    )
    call :refreshpath
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
exit /b 0

:: ---------------------------------------------------------------------
:: Vuelve a leer el PATH real (registro) y lo pone en esta misma ventana.
:: Necesario porque una instalacion con winget no la ve la consola ya
:: abierta hasta que alguien la reinicia -- esto evita tener que hacerlo.
:: ---------------------------------------------------------------------
:refreshpath
for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:ensure_git
where git >nul 2>nul
if not errorlevel 1 exit /b 0

if "%HAS_WINGET%"=="0" (
    echo [!] No se encontro Git, y este Windows no tiene winget para instalarlo solo.
    echo     Se va a abrir la pagina de descarga. Instalalo a mano y despues
    echo     vuelve a hacer doble clic en este archivo.
    start https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [!] No se encontro Git. Instalando con winget...
winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo [X] No se pudo instalar Git automaticamente.
    echo     Se va a abrir la pagina de descarga. Instalalo a mano y vuelve
    echo     a correr este script.
    start https://git-scm.com/download/win
    pause
    exit /b 1
)
call :refreshpath
where git >nul 2>nul
if errorlevel 1 (
    echo [!] Git se instalo, pero esta ventana todavia no lo detecta.
    echo     Cierra esta ventana y vuelve a hacer doble clic en el script.
    pause
    exit /b 1
)
echo [*] Git instalado correctamente.
exit /b 0

:ensure_node
where node >nul 2>nul
if not errorlevel 1 exit /b 0

if "%HAS_WINGET%"=="0" (
    echo [!] No se encontro Node.js, y este Windows no tiene winget para instalarlo solo.
    echo     Se va a abrir la pagina de descarga. Instala la version LTS a mano
    echo     y despues vuelve a hacer doble clic en este archivo.
    start https://nodejs.org
    pause
    exit /b 1
)

echo [!] No se encontro Node.js. Instalando con winget...
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo [X] No se pudo instalar Node.js automaticamente.
    echo     Se va a abrir la pagina de descarga. Instala la version LTS a
    echo     mano y vuelve a correr este script.
    start https://nodejs.org
    pause
    exit /b 1
)
call :refreshpath
where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js se instalo, pero esta ventana todavia no lo detecta.
    echo     Cierra esta ventana y vuelve a hacer doble clic en el script.
    pause
    exit /b 1
)
echo [*] Node.js instalado correctamente.
exit /b 0
