@echo off
chcp 65001 >nul
REM Instala o cronometro na inicializacao do Windows (cria um atalho na pasta Startup).
REM Rode DEPOIS de preencher a APP_KEY e o valor/hora no cronometro.ahk.

set "SRC=%~dp0cronometro.ahk"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\Dash Lala Cronometro.lnk"

if not exist "%SRC%" (
  echo Nao encontrei o cronometro.ahk nesta pasta.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%SRC%'; $s.WorkingDirectory='%~dp0'; $s.Save()"

start "" "%SRC%"

echo.
echo Pronto! O cronometro foi iniciado e vai subir sozinho toda vez que o Windows ligar.
echo Atalhos: Ctrl+Alt+I iniciar  ^|  Ctrl+Alt+P parar/voltar  ^|  Ctrl+Alt+R registrar  ^|  Ctrl+Alt+V ver
echo.
pause
