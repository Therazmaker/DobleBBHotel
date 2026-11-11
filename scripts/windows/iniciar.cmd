@echo off
rem Arranca el Respaldo PMS y lo vuelve a levantar si se cae. Lo lanza la tarea programada
rem "Respaldo PMS" al encender el servidor. Registro en logs\servidor.log
setlocal
cd /d "%~dp0..\.."
if not exist logs mkdir logs
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
:bucle
if exist logs\servidor.log for %%F in (logs\servidor.log) do if %%~zF GTR 10485760 move /y logs\servidor.log logs\servidor.anterior.log >nul
echo [%date% %time%] Arrancando Respaldo PMS>> logs\servidor.log
"%NODE%" --no-warnings --env-file-if-exists=.env server\index.js >> logs\servidor.log 2>&1
echo [%date% %time%] El servidor se detuvo (codigo %errorlevel%). Reinicio en 10 segundos.>> logs\servidor.log
rem ping en vez de timeout: timeout falla cuando no hay consola (tarea como SYSTEM)
ping -n 11 127.0.0.1 >nul
goto bucle
