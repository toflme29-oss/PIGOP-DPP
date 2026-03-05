"""
Endpoints del módulo de Revisión por Lotes (Bandeja de Trabajo).

Roles:
  - Supervisor/Admin: crear lotes, asignar revisores, ver resumen
  - Revisor/Analista: ver su bandeja, trabajar en la revisión item por item

NOTA TÉCNICA: Se usa selectinload() EXPLÍCITO en todas las queries que necesitan
relaciones anidadas (Lote→items→depp→validaciones) para evitar el error
MissingGreenlet de SQLAlchemy async con Python 3.14+.
"""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user, get_current_admin
from app.core.database import get_db
from app.core.exceptions import BusinessError, NotFoundError
from app.models.depp import DEPP
from app.models.validacion import ValidacionDEPP
from app.models.lote import Lote, LoteDepp
from app.models.user import Usuario

router = APIRouter()


# ── Schemas inline ─────────────────────────────────────────────────────────────

class LoteCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    tamaño: int = 10                      # 5 | 10 | 15
    ejercicio: int = 2026
    mes: Optional[int] = None
    tipo_tramite: Optional[str] = None   # filtro automático de DEPPs
    upp_filtro: Optional[str] = None
    revisor_id: Optional[str] = None
    depp_ids: Optional[List[str]] = None  # Si se proveen, se usan directamente


class ItemRevisionBody(BaseModel):
    estado: str                           # aprobado | rechazado | omitido
    observaciones: Optional[str] = None
    tiempo_seg: Optional[int] = None


class AsignarRevisorBody(BaseModel):
    revisor_id: str


# ── Helper: cargar Lote con todas sus relaciones (evita MissingGreenlet) ───────

def _opts_lote_completo():
    """
    Opciones de SQLAlchemy para cargar un Lote con todas las relaciones
    anidadas que necesita _lote_to_dict (items → depp → validaciones).
    Usar selectinload explícito en lugar de lazy="selectin" del modelo
    para garantizar compatibilidad con SQLAlchemy async + Python 3.14+.
    """
    return selectinload(Lote.items).options(
        selectinload(LoteDepp.depp).options(
            selectinload(DEPP.validaciones)
        )
    )


async def _cargar_lote(db: AsyncSession, lote_id: str) -> Optional[Lote]:
    """Carga un lote con todas las relaciones necesarias para _lote_to_dict."""
    result = await db.execute(
        select(Lote)
        .options(_opts_lote_completo())
        .where(Lote.id == lote_id)
    )
    return result.scalar_one_or_none()


# ── Serialización ──────────────────────────────────────────────────────────────

def _lote_to_dict(lote: Lote, include_items: bool = True) -> dict:
    items_data = []
    if include_items and lote.items:
        for item in lote.items:
            depp = item.depp
            items_data.append({
                "id": item.id,
                "orden": item.orden,
                "estado": item.estado,
                "observaciones": item.observaciones,
                "tiempo_seg": item.tiempo_seg,
                "revisado_en": item.revisado_en.isoformat() if item.revisado_en else None,
                "depp": {
                    "id": depp.id,
                    "folio": depp.folio,
                    "upp": depp.upp,
                    "ejercicio": depp.ejercicio,
                    "mes": depp.mes,
                    "monto_total": float(depp.monto_total or 0),
                    "beneficiario": depp.beneficiario,
                    "clasificador_tipo": depp.clasificador_tipo,
                    "capitulo": depp.capitulo,
                    "estado": depp.estado,
                    "validado_automaticamente": depp.validado_automaticamente,
                    "puede_aprobar": depp.puede_aprobar,
                    "validaciones_resumen": [
                        {
                            "tipo": v.tipo_validacion,
                            "resultado": v.resultado,
                            "gravedad": v.gravedad,
                            "mensaje": v.mensaje,
                        }
                        for v in (depp.validaciones or [])
                        if v.tipo_validacion not in ("normativa_ia_resumen",)
                    ][:8],
                } if depp else None,
            })

    total = len(lote.items or [])
    revisados = sum(1 for i in (lote.items or []) if i.estado in ("aprobado", "rechazado", "omitido"))
    aprobados = sum(1 for i in (lote.items or []) if i.estado == "aprobado")
    rechazados = sum(1 for i in (lote.items or []) if i.estado == "rechazado")

    return {
        "id": lote.id,
        "nombre": lote.nombre,
        "descripcion": lote.descripcion,
        "tamaño": lote.tamaño,
        "ejercicio": lote.ejercicio,
        "mes": lote.mes,
        "tipo_tramite": lote.tipo_tramite,
        "upp_filtro": lote.upp_filtro,
        "estado": lote.estado,
        "revisor_id": lote.revisor_id,
        "creado_por_id": lote.creado_por_id,
        "creado_en": lote.creado_en.isoformat() if lote.creado_en else None,
        "asignado_en": lote.asignado_en.isoformat() if lote.asignado_en else None,
        "iniciado_en": lote.iniciado_en.isoformat() if lote.iniciado_en else None,
        "completado_en": lote.completado_en.isoformat() if lote.completado_en else None,
        "metricas": {
            "total": total,
            "revisados": revisados,
            "aprobados": aprobados,
            "rechazados": rechazados,
            "omitidos": sum(1 for i in (lote.items or []) if i.estado == "omitido"),
            "pendientes": total - revisados,
            "progreso_pct": round(revisados / total * 100) if total else 0,
            "tiempo_total_seg": lote.tiempo_total_seg,
        },
        "items": items_data if include_items else [],
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _seleccionar_depps_automatico(
    db: AsyncSession,
    cliente_id: Optional[str],   # None = superadmin sin cliente → busca en todos
    ejercicio: int,
    tamaño: int,
    mes: Optional[int],
    tipo_tramite: Optional[str],
    upp_filtro: Optional[str],
    excluir_en_lote: bool = True,
) -> List[str]:
    """
    Selecciona automáticamente IDs de DEPPs para un lote.
    Excluye DEPPs que ya están en otro lote activo.
    """
    conditions = [
        DEPP.ejercicio == ejercicio,
        DEPP.estado.in_(["en_tramite", "en_revision"]),
    ]
    if cliente_id:
        conditions.append(DEPP.cliente_id == cliente_id)
    if mes:
        conditions.append(DEPP.mes == mes)
    if upp_filtro:
        conditions.append(DEPP.upp == upp_filtro)
    if tipo_tramite:
        conditions.append(DEPP.clasificador_tipo.ilike(f"%{tipo_tramite}%"))

    q = (
        select(DEPP.id)
        .where(and_(*conditions))
        .order_by(DEPP.creado_en.asc())
        .limit(tamaño * 3)
    )

    result = await db.execute(q)
    candidates = [row[0] for row in result.fetchall()]

    if not candidates:
        return []

    if excluir_en_lote:
        q_en_lote = (
            select(LoteDepp.depp_id)
            .join(Lote)
            .where(Lote.estado.in_(["pendiente", "en_revision"]))
        )
        res_en_lote = await db.execute(q_en_lote)
        ya_en_lote = {row[0] for row in res_en_lote.fetchall()}
        candidates = [d for d in candidates if d not in ya_en_lote]

    return candidates[:tamaño]


# ── CRUD de Lotes ──────────────────────────────────────────────────────────────

@router.post("/", summary="Crear nuevo lote de revisión")
async def crear_lote(
    data: LoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Crea un lote de N DEPPs para revisión en bloque.
    Si se proveen depp_ids, se usan esos DEPPs directamente.
    Si no, el sistema selecciona automáticamente DEPPs en_tramite/en_revision.
    """
    if data.tamaño not in (5, 10, 15):
        raise BusinessError("El tamaño del lote debe ser 5, 10 ó 15.")

    # cliente_id efectivo: usar el del usuario; None si superadmin sin cliente
    cliente_id: Optional[str] = (
        str(current_user.cliente_id) if current_user.cliente_id else None
    )

    # Seleccionar DEPPs
    if data.depp_ids:
        depp_ids = data.depp_ids[:data.tamaño]
    else:
        depp_ids = await _seleccionar_depps_automatico(
            db=db,
            cliente_id=cliente_id,   # None → busca en todos (superadmin)
            ejercicio=data.ejercicio,
            tamaño=data.tamaño,
            mes=data.mes,
            tipo_tramite=data.tipo_tramite,
            upp_filtro=data.upp_filtro,
        )

    if not depp_ids:
        raise BusinessError(
            "No hay DEPPs disponibles para formar un lote con los filtros indicados. "
            "Verifica que existan DEPPs en estado 'En Trámite' o 'En Revisión' sin asignar."
        )

    # Si el superadmin no tiene cliente_id propio, tomarlo del primer DEPP (columna, sin ORM load)
    if not cliente_id:
        row = await db.execute(select(DEPP.cliente_id).where(DEPP.id == depp_ids[0]))
        cliente_id = row.scalar_one_or_none() or "00000000-0000-0000-0000-000000000000"

    now = datetime.now(timezone.utc)
    lote = Lote(
        id=str(uuid.uuid4()),
        cliente_id=cliente_id,
        nombre=data.nombre,
        descripcion=data.descripcion,
        tamaño=len(depp_ids),
        ejercicio=data.ejercicio,
        mes=data.mes,
        tipo_tramite=data.tipo_tramite,
        upp_filtro=data.upp_filtro,
        revisor_id=data.revisor_id,
        creado_por_id=str(current_user.id),
        estado="pendiente",
        asignado_en=now if data.revisor_id else None,
    )
    db.add(lote)
    await db.flush()

    for orden, depp_id in enumerate(depp_ids, start=1):
        item = LoteDepp(
            id=str(uuid.uuid4()),
            lote_id=lote.id,
            depp_id=depp_id,
            orden=orden,
            estado="pendiente",
        )
        db.add(item)

    await db.commit()

    # Recargar con relaciones explícitas (evita MissingGreenlet)
    lote_cargado = await _cargar_lote(db, lote.id)
    return _lote_to_dict(lote_cargado)


@router.get("/", summary="Listar todos los lotes")
async def listar_lotes(
    estado: Optional[str] = Query(None),
    ejercicio: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Lista los lotes visibles para el usuario (todos si supervisor, solo propios si revisor)."""
    q = select(Lote).order_by(Lote.creado_en.desc())

    if current_user.rol not in ("superadmin", "admin_cliente"):
        q = q.where(Lote.revisor_id == str(current_user.id))

    if estado:
        q = q.where(Lote.estado == estado)
    if ejercicio:
        q = q.where(Lote.ejercicio == ejercicio)

    result = await db.execute(q)
    lotes = result.scalars().all()
    # Para el listado no cargamos items (más rápido)
    return [_lote_to_dict(lote, include_items=False) for lote in lotes]


@router.get("/mi-bandeja", summary="Lotes asignados al usuario actual")
async def mi_bandeja(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna los lotes activos asignados al usuario actual (para la vista de bandeja)."""
    q = (
        select(Lote)
        .options(_opts_lote_completo())
        .where(
            Lote.revisor_id == str(current_user.id),
            Lote.estado.in_(["pendiente", "en_revision"]),
        )
        .order_by(Lote.asignado_en.asc())
    )
    result = await db.execute(q)
    lotes = result.scalars().all()
    return [_lote_to_dict(lote, include_items=True) for lote in lotes]


@router.get("/{lote_id}", summary="Detalle de un lote")
async def obtener_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    lote = await _cargar_lote(db, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    return _lote_to_dict(lote, include_items=True)


@router.post("/{lote_id}/asignar", summary="Asignar revisor al lote")
async def asignar_revisor(
    lote_id: str,
    body: AsignarRevisorBody,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    lote = await db.get(Lote, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    if lote.estado not in ("pendiente",):
        raise BusinessError("Solo se puede asignar revisor a lotes en estado 'pendiente'.")

    lote.revisor_id = body.revisor_id
    lote.asignado_en = datetime.now(timezone.utc)
    db.add(lote)
    await db.commit()

    lote_cargado = await _cargar_lote(db, lote_id)
    return _lote_to_dict(lote_cargado)


@router.post("/{lote_id}/iniciar", summary="El revisor inicia la revisión del lote")
async def iniciar_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Marca el lote como 'en_revision' y registra el timestamp de inicio."""
    lote = await db.get(Lote, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    if lote.estado == "completado":
        raise BusinessError("El lote ya está completado.")
    if lote.estado == "archivado":
        raise BusinessError("El lote está archivado y no puede modificarse.")

    if lote.estado == "pendiente":
        lote.estado = "en_revision"
        lote.iniciado_en = datetime.now(timezone.utc)
        db.add(lote)
        await db.commit()

    lote_cargado = await _cargar_lote(db, lote_id)
    return _lote_to_dict(lote_cargado, include_items=True)


@router.post("/{lote_id}/items/{item_id}/revisar", summary="Registrar resultado de revisión de un item")
async def revisar_item(
    lote_id: str,
    item_id: str,
    body: ItemRevisionBody,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Registra el dictamen del revisor sobre un DEPP específico del lote.
    Actualiza también el estado del DEPP en la tabla principal.
    """
    if body.estado not in ("aprobado", "rechazado", "omitido"):
        raise BusinessError("Estado inválido. Opciones: aprobado | rechazado | omitido")

    lote = await db.get(Lote, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    if lote.estado == "completado":
        raise BusinessError("El lote ya está completado.")
    if lote.estado == "archivado":
        raise BusinessError("El lote está archivado.")

    item = await db.get(LoteDepp, item_id)
    if not item or item.lote_id != lote_id:
        raise NotFoundError("Item del lote")

    now = datetime.now(timezone.utc)
    item.estado = body.estado
    item.observaciones = body.observaciones
    item.revisado_en = now
    item.revisado_por_id = str(current_user.id)
    if body.tiempo_seg:
        item.tiempo_seg = body.tiempo_seg
    db.add(item)

    # Propagar el dictamen al DEPP si no es 'omitido'
    if body.estado in ("aprobado", "rechazado"):
        depp = await db.get(DEPP, item.depp_id)
        if depp:
            depp.estado = body.estado
            depp.puede_aprobar = (body.estado == "aprobado")
            depp.fecha_validacion = now
            depp.validado_por_id = str(current_user.id)
            db.add(depp)

    await db.flush()

    # Verificar si el lote está completo — contar via query (evita cargar relaciones)
    total_q = await db.execute(
        select(LoteDepp).where(LoteDepp.lote_id == lote_id)
    )
    todos_items = total_q.scalars().all()
    total = len(todos_items)
    revisados = sum(1 for i in todos_items if i.estado in ("aprobado", "rechazado", "omitido"))

    if revisados >= total:
        lote.estado = "completado"
        lote.completado_en = now
        tiempos = [i.tiempo_seg for i in todos_items if i.tiempo_seg]
        lote.tiempo_total_seg = sum(tiempos) if tiempos else None
        db.add(lote)

    await db.commit()

    # Recargar con relaciones completas
    lote_cargado = await _cargar_lote(db, lote_id)
    return _lote_to_dict(lote_cargado, include_items=True)


@router.post("/{lote_id}/completar", summary="Completar el lote manualmente")
async def completar_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Cierra el lote aunque no todos los items estén revisados."""
    lote = await db.get(Lote, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    if lote.estado in ("completado", "archivado"):
        raise BusinessError(f"El lote ya está en estado '{lote.estado}'.")

    lote.estado = "completado"
    lote.completado_en = datetime.now(timezone.utc)
    db.add(lote)
    await db.commit()

    lote_cargado = await _cargar_lote(db, lote_id)
    return _lote_to_dict(lote_cargado)


@router.get("/{lote_id}/resumen", summary="Resumen y métricas del lote")
async def resumen_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna las métricas consolidadas del lote para el reporte del supervisor."""
    lote = await _cargar_lote(db, lote_id)
    if not lote:
        raise NotFoundError("Lote")

    items = lote.items or []
    tiempos = [i.tiempo_seg for i in items if i.tiempo_seg]

    return {
        "lote_id": lote.id,
        "nombre": lote.nombre,
        "estado": lote.estado,
        "revisor_id": lote.revisor_id,
        "ejercicio": lote.ejercicio,
        "mes": lote.mes,
        "metricas": {
            "total": len(items),
            "aprobados": sum(1 for i in items if i.estado == "aprobado"),
            "rechazados": sum(1 for i in items if i.estado == "rechazado"),
            "omitidos": sum(1 for i in items if i.estado == "omitido"),
            "pendientes": sum(1 for i in items if i.estado == "pendiente"),
            "progreso_pct": round(
                sum(1 for i in items if i.estado in ("aprobado", "rechazado", "omitido"))
                / max(len(items), 1) * 100
            ),
            "tiempo_promedio_seg": round(sum(tiempos) / len(tiempos)) if tiempos else None,
            "tiempo_total_seg": lote.tiempo_total_seg or (sum(tiempos) if tiempos else None),
        },
        "items": [
            {
                "orden": i.orden,
                "estado": i.estado,
                "depp_folio": i.depp.folio if i.depp else None,
                "depp_upp": i.depp.upp if i.depp else None,
                "depp_monto": float(i.depp.monto_total or 0) if i.depp else None,
                "observaciones": i.observaciones,
                "tiempo_seg": i.tiempo_seg,
            }
            for i in items
        ],
        "iniciado_en": lote.iniciado_en.isoformat() if lote.iniciado_en else None,
        "completado_en": lote.completado_en.isoformat() if lote.completado_en else None,
    }


@router.delete("/{lote_id}", summary="Eliminar lote (solo si está pendiente)")
async def eliminar_lote(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    lote = await db.get(Lote, lote_id)
    if not lote:
        raise NotFoundError("Lote")
    if lote.estado != "pendiente":
        raise BusinessError("Solo se pueden eliminar lotes en estado 'pendiente'.")
    await db.delete(lote)
    await db.commit()
    return {"message": f"Lote '{lote.nombre}' eliminado."}
