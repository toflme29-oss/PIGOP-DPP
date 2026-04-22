"""
Endpoints de overrides de permisos por cliente.

Los valores por defecto viven en el frontend (rolePermissions.ts).
Aquí solo guardamos las desviaciones respecto a esos defaults, por cliente.

- GET  /permisos/         → {overrides, version}  (todo usuario autenticado del cliente)
- GET  /permisos/version  → {version}             (idem, endpoint liviano para polling)
- PUT  /permisos/         → reemplaza overrides   (solo admin_cliente o superadmin)
"""
from typing import Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.exceptions import ForbiddenError
from app.models.permiso import PermisoOverride
from app.models.user import Cliente, Usuario

router = APIRouter()


class PermisosResponse(BaseModel):
    overrides: Dict[str, bool]
    version: float


class VersionResponse(BaseModel):
    version: float


class PermisosUpdateRequest(BaseModel):
    overrides: Dict[str, bool]


async def _resolve_cliente_id(db: AsyncSession, user: Usuario) -> str:
    """Devuelve el cliente del usuario; para superadmin sin cliente usa el primer cliente activo."""
    if user.cliente_id:
        return str(user.cliente_id)
    if user.rol == "superadmin":
        stmt = select(Cliente.id).where(Cliente.activo == True).limit(1)  # noqa: E712
        result = await db.execute(stmt)
        row = result.scalar()
        if row:
            return str(row)
    return ""


async def _compute_version(db: AsyncSession, cliente_id: str) -> float:
    stmt = select(func.max(PermisoOverride.updated_en)).where(
        PermisoOverride.cliente_id == cliente_id
    )
    result = await db.execute(stmt)
    max_date = result.scalar()
    if max_date is None:
        return 0.0
    return max_date.timestamp()


@router.get("/", response_model=PermisosResponse, summary="Obtener overrides de permisos del cliente")
async def get_permisos(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    cliente_id = await _resolve_cliente_id(db, current_user)
    if not cliente_id:
        return PermisosResponse(overrides={}, version=0.0)
    stmt = select(PermisoOverride).where(PermisoOverride.cliente_id == cliente_id)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    overrides = {r.key: bool(r.value) for r in rows}
    version = await _compute_version(db, cliente_id)
    return PermisosResponse(overrides=overrides, version=version)


@router.get("/version", response_model=VersionResponse, summary="Versión actual de permisos (polling liviano)")
async def get_permisos_version(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    cliente_id = await _resolve_cliente_id(db, current_user)
    if not cliente_id:
        return VersionResponse(version=0.0)
    return VersionResponse(version=await _compute_version(db, cliente_id))


@router.put("/", response_model=PermisosResponse, summary="Reemplazar overrides de permisos del cliente")
async def update_permisos(
    data: PermisosUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo Director o superadmin pueden modificar permisos.")

    cliente_id = await _resolve_cliente_id(db, current_user)
    if not cliente_id:
        raise ForbiddenError("El usuario no pertenece a un cliente válido.")

    await db.execute(delete(PermisoOverride).where(PermisoOverride.cliente_id == cliente_id))
    for key, value in data.overrides.items():
        db.add(
            PermisoOverride(
                cliente_id=cliente_id,
                key=str(key),
                value=bool(value),
                updated_by=str(current_user.id),
            )
        )
    await db.commit()
    version = await _compute_version(db, cliente_id)
    return PermisosResponse(overrides=dict(data.overrides), version=version)
