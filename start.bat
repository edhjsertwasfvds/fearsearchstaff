@echo off
chcp 65001 >nul
echo.
echo === Fear Project Viewer — запуск localhost ===
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не найден!
    echo.
    echo Установите Node.js: https://nodejs.org/
    echo Выберите LTS версию и перезапустите терминал после установки.
    echo.
    pause
    exit /b 1
)

echo Node: 
node --version
echo npm: 
npm --version
echo.

if not exist "node_modules" (
    echo Установка зависимостей...
    call npm install
    if %errorlevel% neq 0 (
        echo Ошибка npm install
        pause
        exit /b 1
    )
    echo.
)

echo Запуск сервера на http://localhost:3000
echo.
call npm start
