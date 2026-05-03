# ============================================================
#  start-dev.ps1 — Inicia el frontend local de PIGOP-DPP
#  Uso: .\start-dev.ps1
# ============================================================

$FRONTEND_DIR = Join-Path $PSScriptRoot "pigop-frontend"
$URL = "http://localhost:5173"

Write-Host ""
Write-Host "  PIGOP - Iniciando entorno de desarrollo..." -ForegroundColor Cyan
Write-Host ""

# Matar procesos anteriores de Vite en puertos 5173-5176
Write-Host "  Limpiando servidores anteriores..." -ForegroundColor Gray
5173..5176 | ForEach-Object {
    $port = $_
    $pid_ = (netstat -ano 2>$null | Select-String ":$port " | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Select-Object -First 1)
    if ($pid_ -and $pid_ -match '^\d+$') {
        Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 500

# Arrancar frontend en segundo plano
Write-Host "  Iniciando frontend (npm run dev)..." -ForegroundColor Yellow
$job = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev 2>&1
} -ArgumentList $FRONTEND_DIR

# Esperar a que el servidor esté listo
Write-Host "  Esperando servidor" -NoNewline -ForegroundColor Gray
$intentos = 0
$listo = $false
while ($intentos -lt 20 -and -not $listo) {
    Start-Sleep -Milliseconds 800
    Write-Host "." -NoNewline -ForegroundColor Gray
    try {
        $r = Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        $listo = $true
    } catch {
        # Probar puertos alternativos
        foreach ($p in 5174, 5175, 5176) {
            try {
                $r2 = Invoke-WebRequest -Uri "http://localhost:$p" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
                $URL = "http://localhost:$p"
                $listo = $true
                break
            } catch {}
        }
    }
    $intentos++
}

Write-Host ""

if ($listo) {
    Write-Host ""
    Write-Host "  Frontend listo en: $URL" -ForegroundColor Green
    Write-Host ""
    # Abrir navegador automáticamente
    Start-Process $URL
    Write-Host "  Navegador abierto. Presiona Ctrl+C para detener." -ForegroundColor Cyan
    Write-Host ""

    # Mantener vivo y mostrar output del servidor
    try {
        while ($true) {
            $output = Receive-Job -Job $job
            if ($output) { Write-Host $output -ForegroundColor DarkGray }
            Start-Sleep -Milliseconds 500
        }
    } finally {
        Stop-Job -Job $job
        Remove-Job -Job $job
    }
} else {
    Write-Host "  No se pudo iniciar el servidor. Revisa los errores:" -ForegroundColor Red
    Receive-Job -Job $job | Write-Host
    Stop-Job -Job $job
    Remove-Job -Job $job
}
