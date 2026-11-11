#Requires -RunAsAdministrator
# Instala el Respaldo PMS en este servidor Windows:
#   1. comprueba Node.js, 2. instala dependencias y compila, 3. crea .env (si no existe),
#   4. registra la tarea "Respaldo PMS" que arranca con Windows y se reinicia si falla,
#   5. abre el puerto en el firewall y 6. arranca el servidor.
# Uso (PowerShell como administrador, desde la carpeta del proyecto):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\instalar.ps1
$ErrorActionPreference = "Stop"
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Raiz
$Tarea = "Respaldo PMS"

function Detener-Servidor {
  Stop-ScheduledTask -TaskName $Tarea -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*server\index.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Ejecutar([string]$Programa, [string[]]$Argumentos) {
  & $Programa @Argumentos
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Programa $($Argumentos -join ' ')" }
}

function Compilar {
  Write-Host "Instalando dependencias y compilando la web..." -ForegroundColor Cyan
  Ejecutar "npm.cmd" @("ci", "--no-audit", "--no-fund")
  Ejecutar "npm.cmd" @("run", "build")
}

function Esperar-Servidor([int]$Puerto) {
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
      Invoke-WebRequest "http://localhost:$Puerto/api/me" -UseBasicParsing -TimeoutSec 3 | Out-Null
      return $true
    } catch {
      if ($_.Exception.Response) { return $true } # responde (aunque sea 401): está vivo
    }
  }
  return $false
}

function Leer-Puerto {
  $p = Select-String -Path (Join-Path $Raiz ".env") -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { return [int]$p.Matches[0].Groups[1].Value }
  return 3000
}

# 1. Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "No encuentro Node.js. Instala la versión LTS (22.12 o superior) desde https://nodejs.org, cierra y vuelve a abrir PowerShell, y ejecuta otra vez este script."
}
$ver = (& node -v).TrimStart("v").Split(".")
if ([int]$ver[0] -lt 22 -or ([int]$ver[0] -eq 22 -and [int]$ver[1] -lt 12)) {
  throw "Node.js $(& node -v) es antiguo: hace falta 22.12 o superior."
}
Write-Host "Node.js $(& node -v) OK" -ForegroundColor Green

# 2. Dependencias y web
Detener-Servidor
Compilar

# 3. Configuración (.env)
$envFile = Join-Path $Raiz ".env"
if (Test-Path $envFile) {
  Write-Host "Ya existe .env: se mantiene tal cual." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "Configuración (se guarda en .env, solo en este servidor)" -ForegroundColor Cyan
  $email = Read-Host "Usuario (correo) de NewHotel para la sincronización"
  $sec = Read-Host "Contraseña de ese usuario" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $hotel = Read-Host "ID del hotel en NewHotel (Enter = el de la cuenta)"
  $puerto = Read-Host "Puerto de la web (Enter = 3000)"
  if (-not $puerto) { $puerto = "3000" }
  Write-Host "Qué equipos pueden abrir la app: IPs o redes separadas por comas, p. ej. 192.168.1.0/24"
  $redes = Read-Host "(Enter = la misma red que este servidor)"
  $bk = Read-Host "Carpeta para la copia de seguridad diaria (Enter = $Raiz\data\backups)"

  function Entrecomillar([string]$v) {
    if ($v -notmatch "'") { return "'$v'" }
    if ($v -notmatch '"') { return '"' + $v + '"' }
    if ($v -notmatch '`') { return '`' + $v + '`' }
    throw "La contraseña tiene a la vez comillas simples, dobles e invertidas: edita .env a mano."
  }
  $lineas = @(
    "# Respaldo PMS. Contiene la contraseña de NewHotel: no lo copies ni lo compartas.",
    "NEWHOTEL_EMAIL=$email",
    "NEWHOTEL_PASSWORD=$(Entrecomillar $pass)",
    "NEWHOTEL_HOTEL_ID=$hotel",
    "PORT=$puerto",
    "HOTEL_TZ=America/Lima",
    "# Sin login: entra cualquiera desde ALLOWED_NETWORKS (vacío = la red de este servidor)",
    "AUTH_MODE=open",
    "ALLOWED_NETWORKS=$redes"
  )
  if ($bk) { $lineas += "BACKUP_DIR=$bk" }
  # UTF-8 sin BOM (Node no entiende el BOM en .env)
  [IO.File]::WriteAllLines($envFile, $lineas, (New-Object Text.UTF8Encoding $false))
  $pass = $null
  # Solo Administradores y SYSTEM pueden leerlo
  Ejecutar "icacls.exe" @($envFile, "/inheritance:r", "/grant:r", "*S-1-5-32-544:F", "*S-1-5-18:F")
  Write-Host ".env creado y protegido." -ForegroundColor Green
}
$Puerto = Leer-Puerto

# 4. Tarea programada: arranca con Windows, como SYSTEM, sin límite de tiempo
$cmd = Join-Path $Raiz "scripts\windows\iniciar.cmd"
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"" -WorkingDirectory $Raiz
$disparador = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Tarea -Action $accion -Trigger $disparador -Principal $principal `
  -Settings $ajustes -Description "Respaldo PMS: copia de NewHotel para contingencias" -Force | Out-Null
Write-Host "Tarea programada '$Tarea' registrada." -ForegroundColor Green

# 5. Firewall (la propia app filtra además por ALLOWED_NETWORKS)
Get-NetFirewallRule -DisplayName $Tarea -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $Tarea -Direction Inbound -Protocol TCP -LocalPort $Puerto -Action Allow -Profile Any | Out-Null
Write-Host "Firewall: puerto $Puerto abierto." -ForegroundColor Green

# 6. Arrancar
Start-ScheduledTask -TaskName $Tarea
if (Esperar-Servidor $Puerto) {
  $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }).IPAddress
  Write-Host ""
  Write-Host "Listo. Desde los PCs de recepción abre:" -ForegroundColor Green
  foreach ($ip in $ips) { Write-Host "   http://${ip}:$Puerto" }
  Write-Host "La primera sincronización con NewHotel tarda unos minutos. Registro: $Raiz\logs\servidor.log"
} else {
  Write-Host "El servidor no respondió. Revisa $Raiz\logs\servidor.log" -ForegroundColor Red
  exit 1
}
