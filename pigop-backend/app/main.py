from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import create_tables, init_db_data
from app.core.exceptions import PigopException

# Directorio de uploads locales
UPLOADS_ROOT = Path(__file__).parent.parent / "uploads"
UPLOADS_ROOT.mkdir(exist_ok=True)


async def _reparar_inconsistencias_firma():
    """Corrige documentos con firmado_digitalmente=True pero estado inconsistente.

    Se ejecuta en startup de forma idempotente: si no hay inconsistencias no
    hace nada. Reportes previos mostraron datos de seed/migraciones con
    estado='respondido' mientras firmado_digitalmente=1 — eso es imposible
    por flujo (una vez firmado, el estado debe ser 'firmado' para recibidos
    o 'vigente' para emitidos).
    """
    from sqlalchemy import text
    from app.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        res = await db.execute(text(
            "UPDATE documentos_oficiales SET estado='firmado' "
            "WHERE firmado_digitalmente=1 AND flujo='recibido' "
            "AND estado NOT IN ('firmado','archivado')"
        ))
        n_rec = res.rowcount or 0
        res = await db.execute(text(
            "UPDATE documentos_oficiales SET estado='vigente' "
            "WHERE firmado_digitalmente=1 AND flujo='emitido' "
            "AND estado NOT IN ('vigente','archivado')"
        ))
        n_emi = res.rowcount or 0
        if n_rec or n_emi:
            await db.commit()
            print(f"🔧 Integridad: corregidos {n_rec} recibidos y {n_emi} emitidos con estado inconsistente.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} iniciando...")
    # Crea/verifica todas las tablas (create_all es idempotente)
    await create_tables()
    # Inicializar datos semilla (Admin y Cliente DPP) si no existen
    await init_db_data()
    print("✅ Tablas verificadas y datos base listos.")
    # Reparación de integridad: estado ↔ firmado_digitalmente
    try:
        await _reparar_inconsistencias_firma()
    except Exception as e:  # no bloquear arranque si la reparación falla
        print(f"⚠️  Reparación de integridad omitida: {e}")
    yield
    print("👋 Apagando servidor...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "API Backend para PIGOP — Plataforma Integral de Gestión y Optimización Presupuestaria. "
        "Gobierno del Estado de Michoacán, Dirección de Programación y Presupuesto."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expone X-Total-Count al navegador — sin esto, CORS oculta el header y el
    # contador de la paginación llega en 0 desde el frontend.
    expose_headers=["X-Total-Count", "Content-Disposition"],
)

# ── Servir archivos locales (desarrollo) ──────────────────────────────────────
app.mount("/files", StaticFiles(directory=str(UPLOADS_ROOT), html=False), name="files")


# ── Manejadores de errores ────────────────────────────────────────────────────
@app.exception_handler(PigopException)
async def pigop_exception_handler(request: Request, exc: PigopException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api/v1")


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["Sistema"], summary="Health check")
async def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@app.get("/", tags=["Sistema"], summary="Bienvenida")
async def root():
    return {
        "message": f"Bienvenido a {settings.APP_NAME}",
        "docs": "/docs",
        "version": settings.APP_VERSION,
    }
