# ============================================================
#  deploy.ps1  —  Despliegue completo PIGOP-DPP (Windows)
#  Uso:  .\deploy\deploy.ps1
#        .\deploy\deploy.ps1 -Mensaje "fix: corrección X"
#        .\deploy\deploy.ps1 -SoloFrontend
#        .\deploy\deploy.ps1 -SoloBackendVPS
# ============================================================
param(
    [string]$Mensaje      = "",          # Mensaje de commit (opcional, pregunta si vacío)
    [switch]$SoloFrontend = $false,      # Solo build + push (auto-deploy Hostinger vía GitHub)
    [switch]$SoloBackendVPS = $false,    # Solo deploy al VPS
    [switch]$SkipVPS      = $false,      # Saltar el paso del VPS aunque esté configurado
    [switch]$SinBuild     = $false       # Saltar npm run build
)

# ── Configuración ─────────────────────────────────────────────────────────────
$VPS_HOST    = "srv1532208.hstgr.cloud"
$VPS_USER    = "root"
$VPS_SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"   # cambia si tu llave tiene otro nombre
$VPS_PATH    = "/var/www/pigop"                      # ruta del repo en el VPS
$VPS_SERVICE = "pigop"                               # nombre del servicio systemd

$REPO_ROOT   = Split-Path $PSScriptRoot -Parent
$FRONTEND    = Join-Path $REPO_ROOT "pigop-frontend"
$BRANCH      = "main"

$FRONTEND_URL = "https://seashell-woodcock-771978.hostingersite.com"
$BACKEND_URL  = "https://pigop-dpp-production.up.railway.app/docs"
# ─────────────────────────────────────────────────────────────────────────────

function Write-Step($n, $txt) { Write-Host "`n[$n] $txt" -ForegroundColor Cyan }
function Write-OK($txt)       { Write-Host "  OK $txt" -ForegroundColor Green }
function Write-Warn($txt)     { Write-Host "  AVISO  $txt" -ForegroundColor Yellow }
function Write-Fail($txt)     { Write-Host "  ERROR $txt" -ForegroundColor Red; exit 1 }

Write-Host "`n  PIGOP-DPP — Script de despliegue" -ForegroundColor Magenta
Write-Host "    Repo: $REPO_ROOT" -ForegroundColor Gray

# ══════════════════════════════════════════════════════════════════════════════
#  PASO 1 — Build del frontend (Vite)
# ══════════════════════════════════════════════════════════════════════════════
if (-not $SoloBackendVPS -and -not $SinBuild) {
    Write-Step "1/4" "Build del frontend (npm run build)"
    Set-Location $FRONTEND
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "El build del frontend falló." }
    Write-OK "Build completado → carpeta dist/"
} else {
    Write-Warn "Build del frontend omitido."
}

# ══════════════════════════════════════════════════════════════════════════════
#  PASO 2 — Git commit + push → dispara auto-deploy en Hostinger y Railway
# ══════════════════════════════════════════════════════════════════════════════
if (-not $SoloBackendVPS) {
    Write-Step "2/4" "Git: commit y push a GitHub ($BRANCH)"
    Set-Location $REPO_ROOT

    # Verificar si hay cambios
    $status = git status --porcelain
    if (-not $status) {
        Write-Warn "No hay cambios pendientes. Continuando con el push de todas formas."
    } else {
        if (-not $Mensaje) {
            $Mensaje = Read-Host "  Mensaje de commit (Enter = 'deploy: actualizacion')"
            if (-not $Mensaje) { $Mensaje = "deploy: actualizacion" }
        }
        git add -A
        git commit -m $Mensaje
        if ($LASTEXITCODE -ne 0) { Write-Fail "El commit falló." }
    }

    git push origin $BRANCH
    if ($LASTEXITCODE -ne 0) { Write-Fail "El push a GitHub falló." }
    Write-OK "Push exitoso → GitHub"
    Write-Host "    -> Hostinger detectará el push y desplegará el frontend automáticamente." -ForegroundColor Gray
    Write-Host "    -> Railway detectará el push y desplegará el backend automáticamente." -ForegroundColor Gray
}

# ══════════════════════════════════════════════════════════════════════════════
#  PASO 3 — Deploy manual al VPS Hostinger (backend alternativo)
# ══════════════════════════════════════════════════════════════════════════════
$vpsDisponible = (Test-Path $VPS_SSH_KEY) -and (-not $SkipVPS)

if ($SoloFrontend) {
    Write-Warn "Paso VPS omitido (flag -SoloFrontend)."
} elseif (-not $vpsDisponible) {
    Write-Step "3/4" "VPS Hostinger (backend)"
    Write-Warn "Llave SSH no encontrada en: $VPS_SSH_KEY"
    Write-Host "  Para habilitar el deploy automatico al VPS:" -ForegroundColor Gray
    Write-Host "    1. Genera la llave: ssh-keygen -t ed25519 -C 'pigop-deploy'" -ForegroundColor Gray
    Write-Host "    2. Copia la llave publica: Get-Content `$env:USERPROFILE\.ssh\id_ed25519.pub | clip" -ForegroundColor Gray
    Write-Host "    3. Conéctate al VPS: ssh $VPS_USER@$VPS_HOST" -ForegroundColor Gray
    Write-Host "    4. Agrega la llave: nano ~/.ssh/authorized_keys  (pega y guarda)" -ForegroundColor Gray
} else {
    Write-Step "3/4" "Deploy al VPS Hostinger ($VPS_HOST)"
    $cmd = @"
set -e
cd /var/www/pigop
git stash 2>/dev/null || true
git pull --ff-only origin main
cd pigop-backend
if [ -d venv ]; then
  venv/bin/pip install -q --no-cache-dir -r requirements.txt
fi
sudo systemctl restart $VPS_SERVICE
echo "Servicio reiniciado"
sudo systemctl is-active $VPS_SERVICE
"@
    ssh -i $VPS_SSH_KEY -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" $cmd
    if ($LASTEXITCODE -ne 0) { Write-Warn "El deploy al VPS tuvo errores. Revisa la salida." }
    else { Write-OK "VPS actualizado y servicio reiniciado." }
}

# ══════════════════════════════════════════════════════════════════════════════
#  PASO 4 — Resumen final
# ══════════════════════════════════════════════════════════════════════════════
Write-Step "4/4" "Resumen"
Write-Host ""
Write-Host "  Componente              Estado" -ForegroundColor White
Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "  GitHub                  Push completado" -ForegroundColor Green
Write-Host "  Frontend (Hostinger)    Auto-deploy en curso (~1-2 min)" -ForegroundColor Yellow
Write-Host "  Backend (Railway)       Auto-deploy en curso (~2-3 min)" -ForegroundColor Yellow
if ($vpsDisponible -and -not $SoloFrontend) {
    Write-Host "  VPS Hostinger (backend) Actualizado" -ForegroundColor Green
} elseif (-not $SoloFrontend) {
    Write-Host "  VPS Hostinger (backend) No configurado (ver instrucciones arriba)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "  URLs de produccion:" -ForegroundColor White
Write-Host "  Frontend: $FRONTEND_URL" -ForegroundColor Cyan
Write-Host "  Backend:  $BACKEND_URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Deploy iniciado correctamente." -ForegroundColor Magenta
