#Requires -RunAsAdministrator
# Reinicia el Respaldo PMS (por ejemplo, después de editar .env).
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

Detener-Servidor
Start-ScheduledTask -TaskName $Tarea
if (Esperar-Servidor (Leer-Puerto)) { Write-Host "Reiniciado." -ForegroundColor Green }
else { Write-Host "El servidor no respondió. Revisa $Raiz\logs\servidor.log" -ForegroundColor Red; exit 1 }
