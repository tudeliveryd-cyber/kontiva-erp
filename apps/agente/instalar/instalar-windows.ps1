# KONTIVA ERP · instalación del agente local del PDV en Windows.
# Requisito: Node.js 22 o superior (https://nodejs.org). Ejecutar en PowerShell desde la carpeta del agente:
#   powershell -ExecutionPolicy Bypass -File instalar\instalar-windows.ps1
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Write-Error 'Instale Node.js 22 o superior desde https://nodejs.org y vuelva a ejecutar.' }
$destino = Join-Path $env:LOCALAPPDATA 'KontivaAgente'
New-Item -ItemType Directory -Force -Path $destino | Out-Null
Copy-Item -Recurse -Force (Join-Path $PSScriptRoot '..\dist\*') $destino
# Inicio automático con Windows, sin ventana.
$vbs = Join-Path $destino 'iniciar.vbs'
Set-Content -Encoding ASCII -Path $vbs -Value "CreateObject(""WScript.Shell"").Run ""node """"$destino\main.js"""""", 0, False"
$inicio = [Environment]::GetFolderPath('Startup')
Copy-Item -Force $vbs (Join-Path $inicio 'KONTIVA agente.vbs')
# Primera ejecución visible: crea la configuración y muestra la clave para el PDV.
Write-Host 'Agente instalado. La configuración está en %APPDATA%\kontiva-agente\config.json'
& node (Join-Path $destino 'main.js')
