import logging
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update

from app.api.dependencies import get_current_active_user, get_current_admin
from app.core.database import get_db
from app.models.feedback import FeedbackReporte
from app.models.user import Usuario

logger = logging.getLogger(__name__)

router = APIRouter()

FEEDBACK_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "uploads", "feedback"
)
os.makedirs(FEEDBACK_DIR, exist_ok=True)

TIPO_LABELS = {"bug": "Error / Problema", "mejora": "Mejora / Sugerencia", "consulta": "Consulta / Duda"}
ESTADO_LABELS = {"pendiente": "Pendiente", "en_revision": "En revisión", "resuelto": "Resuelto"}


# ── Enviar reporte de feedback ─────────────────────────────────────────────────

@router.post("/", summary="Enviar reporte de feedback o bitácora")
async def crear_feedback(
    modulo: str = Form(...),
    tipo: str = Form(...),
    descripcion: str = Form(...),
    captura: UploadFile = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    captura_nombre = None
    captura_path_rel = None
    captura_mime = None

    if captura and captura.filename:
        content = await captura.read()
        ext = os.path.splitext(captura.filename)[1].lower() or ".png"
        fname = f"{uuid.uuid4()}{ext}"
        fpath = os.path.join(FEEDBACK_DIR, fname)
        with open(fpath, "wb") as f:
            f.write(content)
        captura_nombre = captura.filename
        captura_path_rel = fpath
        captura_mime = captura.content_type or "image/png"

    reporte = FeedbackReporte(
        cliente_id=str(current_user.cliente_id) if current_user.cliente_id else None,
        usuario_id=str(current_user.id),
        usuario_nombre=current_user.nombre_completo or current_user.email,
        area_codigo=current_user.area_codigo,
        modulo=modulo,
        tipo=tipo,
        descripcion=descripcion,
        captura_nombre=captura_nombre,
        captura_path=captura_path_rel,
        captura_mime=captura_mime,
        estado="pendiente",
    )
    db.add(reporte)
    await db.commit()
    await db.refresh(reporte)

    logger.info(f"[Feedback] Nuevo reporte #{reporte.id[:8]} de {reporte.usuario_nombre} — {tipo} en {modulo}")
    return {"id": reporte.id, "message": "Reporte enviado correctamente. ¡Gracias por tu feedback!"}


# ── Listar reportes (admin) ────────────────────────────────────────────────────

@router.get("/", summary="Listar reportes de feedback (admin)")
async def listar_feedback(
    estado: str = Query(None),
    tipo: str = Query(None),
    modulo: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    stmt = select(FeedbackReporte).order_by(FeedbackReporte.creado_en.desc())

    # Si no es admin, solo ve sus propios reportes
    if current_user.rol not in ("superadmin", "admin_cliente"):
        stmt = stmt.where(FeedbackReporte.usuario_id == str(current_user.id))
    elif current_user.cliente_id:
        stmt = stmt.where(FeedbackReporte.cliente_id == str(current_user.cliente_id))

    if estado:
        stmt = stmt.where(FeedbackReporte.estado == estado)
    if tipo:
        stmt = stmt.where(FeedbackReporte.tipo == tipo)
    if modulo:
        stmt = stmt.where(FeedbackReporte.modulo == modulo)

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(total_stmt)).scalar() or 0

    stmt = stmt.offset(skip).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "usuario_nombre": r.usuario_nombre,
            "area_codigo": r.area_codigo,
            "modulo": r.modulo,
            "tipo": r.tipo,
            "tipo_label": TIPO_LABELS.get(r.tipo, r.tipo),
            "descripcion": r.descripcion,
            "estado": r.estado,
            "estado_label": ESTADO_LABELS.get(r.estado, r.estado),
            "notas_admin": r.notas_admin,
            "tiene_captura": bool(r.captura_nombre),
            "captura_nombre": r.captura_nombre,
            "creado_en": r.creado_en.isoformat() if r.creado_en else None,
        })

    return {"items": items, "total": total}


# ── Ver captura de un reporte ──────────────────────────────────────────────────

@router.get("/{feedback_id}/captura", summary="Obtener captura del reporte")
async def obtener_captura(
    feedback_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    from fastapi import HTTPException
    result = await db.execute(select(FeedbackReporte).where(FeedbackReporte.id == feedback_id))
    reporte = result.scalar_one_or_none()
    if not reporte:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")

    # Solo el propio usuario o un admin puede ver la captura
    if current_user.rol not in ("superadmin", "admin_cliente") and str(reporte.usuario_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Sin acceso")

    if not reporte.captura_path or not os.path.exists(reporte.captura_path):
        raise HTTPException(status_code=404, detail="Captura no disponible")

    return FileResponse(
        reporte.captura_path,
        media_type=reporte.captura_mime or "image/png",
        filename=reporte.captura_nombre or "captura.png",
    )


# ── Actualizar estado (admin) ─────────────────────────────────────────────────

@router.patch("/{feedback_id}", summary="Actualizar estado del reporte (admin)")
async def actualizar_feedback(
    feedback_id: str,
    estado: str = Form(None),
    notas_admin: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    from fastapi import HTTPException
    result = await db.execute(select(FeedbackReporte).where(FeedbackReporte.id == feedback_id))
    reporte = result.scalar_one_or_none()
    if not reporte:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")

    if estado:
        reporte.estado = estado
    if notas_admin is not None:
        reporte.notas_admin = notas_admin

    await db.commit()
    return {"id": reporte.id, "estado": reporte.estado, "message": "Actualizado correctamente"}
