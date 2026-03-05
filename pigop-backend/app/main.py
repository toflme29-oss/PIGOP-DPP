from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import create_tables
from app.core.exceptions import PigopException

# Directorio de uploads locales
UPLOADS_ROOT = Path(__file__).parent.parent / "uploads"
UPLOADS_ROOT.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"🚀 {settings.APP_NAME} v{settings.APP_VERSION} iniciando...")
    # Crea/verifica todas las tablas (create_all es idempotente)
    await create_tables()
    print("✅ Tablas verificadas.")
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
