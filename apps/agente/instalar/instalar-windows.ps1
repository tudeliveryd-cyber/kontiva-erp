# KONTIVA ERP · instalación del agente local del PDV en Windows.
# Con kontiva-agente.exe (no necesita Node.js). Ejecutar en PowerShell desde la carpeta descargada:
#   powershell -ExecutionPolicy Bypass -File instalar-windows.ps1
$ErrorActionPreference = 'Stop'
$aqui = $PSScriptRoot
$exe = @((Join-Path $aqui 'kontiva-agente.exe'), (Join-Path $aqui '..\ejecutable\kontiva-agente.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { Write-Error 'No se encontró kontiva-agente.exe junto a este instalador.' }
$destino = Join-Path $env:LOCALAPPDATA 'KontivaAgente'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
Get-Process kontiva-agente -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item -Force $exe (Join-Path $destino 'kontiva-agente.exe')
# Inicio automático con Windows, sin ventana.
$vbs = Join-Path $destino 'iniciar.vbs'
Set-Content -Encoding ASCII -Path $vbs -Value "CreateObject(""WScript.Shell"").Run """"""$destino\kontiva-agente.exe"""""", 0, False"
Copy-Item -Force $vbs (Join-Path ([Environment]::GetFolderPath('Startup')) 'KONTIVA agente.vbs')
Write-Host 'Agente instalado. Inicia solo con Windows.'
Write-Host 'Configuración: %APPDATA%\kontiva-agente\config.json (edite la impresora y reinicie la computadora o el agente).'
Write-Host 'Primera ejecución: anote la clave que aparece abajo y cárguela en el PDV (botón Impresora). Cierre esta ventana para terminar.'
& (Join-Path $destino 'kontiva-agente.exe')
