from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user, get_current_admin, get_current_superadmin
from app.core.database import get_db
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.crud.user import crud_cliente, crud_usuario
from app.models.user import Usuario
from app.schemas.common import MessageResponse
from app.schemas.user import (
    ClienteCreate,
    ClienteResponse,
    ClienteUpdate,
    UsuarioCreate,
    UsuarioResponse,
    UsuarioUpdate,
    UsuarioWithClienteResponse,
)

router = APIRouter()


# ── Clientes (UPPs) ───────────────────────────────────────────────────────────

@router.post(
    "/clientes",
    response_model=ClienteResponse,
    status_code=201,
    summary="Crear cliente (UPP)",
)
async def crear_cliente(
    data: ClienteCreate,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_superadmin),
):
    """Solo superadmin puede crear clientes (UPPs)."""
    existente = await crud_cliente.get_by_codigo_upp(db, data.codigo_upp)
    if existente:
        raise ConflictError(f"Ya existe un cliente con código UPP '{data.codigo_upp}'.")
    return await crud_cliente.create(db, obj_in=data.model_dump())


@router.get(
    "/clientes",
    response_model=List[ClienteResponse],
    summary="Listar clientes",
)
async def listar_clientes(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    return await crud_cliente.get_multi(db, skip=skip, limit=limit)


@router.get(
    "/clientes/{cliente_id}",
    response_model=ClienteResponse,
    summary="Obtener cliente por ID",
)
async def obtener_cliente(
    cliente_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_admin),
):
    cliente = await crud_cliente.get(db, cliente_id)
    if not cliente:
        raise NotFoundError("Cliente")
    return cliente


@router.put(
    "/clientes/{cliente_id}",
    response_model=ClienteResponse,
    summary="Actualizar cliente",
)
async def actualizar_cliente(
    cliente_id: UUID,
    data: ClienteUpdate,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_superadmin),
):
    cliente = await crud_cliente.get(db, cliente_id)
    if not cliente:
        raise NotFoundError("Cliente")
    return await crud_cliente.update(db, db_obj=cliente, obj_in=data.model_dump(exclude_unset=True))


# ── Usuarios ──────────────────────────────────────────────────────────────────

@router.post(
    "/",
    response_model=UsuarioResponse,
    status_code=201,
    summary="Crear usuario",
)
async def crear_usuario(
    data: UsuarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """Admins crean usuarios. Solo superadmin puede crear otros superadmins."""
    if data.rol == "superadmin" and current_user.rol != "superadmin":
        raise ForbiddenError("Solo superadmin puede crear otros superadmins.")

    existente = await crud_usuario.get_by_email(db, data.email)
    if existente:
        raise ConflictError(f"Ya existe un usuario con email '{data.email}'.")

    return await crud_usuario.create_with_password(db, obj_in=data)


@router.get(
    "/",
    response_model=List[UsuarioResponse],
    summary="Listar usuarios",
)
async def listar_usuarios(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    cliente_id: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    filters = []
    if cliente_id:
        from app.models.user import Usuario as UsuarioModel
        filters.append(UsuarioModel.cliente_id == cliente_id)
    elif current_user.rol == "admin_cliente":
        # admin_cliente solo ve usuarios de su propio cliente
        from app.models.user import Usuario as UsuarioModel
        filters.append(UsuarioModel.cliente_id == current_user.cliente_id)
    return await crud_usuario.get_multi(db, skip=skip, limit=limit, filters=filters)


@router.get(
    "/{usuario_id}",
    response_model=UsuarioResponse,
    summary="Obtener usuario por ID",
)
async def obtener_usuario(
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    usuario = await crud_usuario.get(db, usuario_id)
    if not usuario:
        raise NotFoundError("Usuario")
    # Un usuario normal solo puede verse a sí mismo
    if current_user.rol not in ("superadmin", "admin_cliente") and current_user.id != usuario_id:
        raise ForbiddenError()
    return usuario


@router.put(
    "/{usuario_id}",
    response_model=UsuarioResponse,
    summary="Actualizar usuario",
)
async def actualizar_usuario(
    usuario_id: UUID,
    data: UsuarioUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    usuario = await crud_usuario.get(db, usuario_id)
    if not usuario:
        raise NotFoundError("Usuario")
    # Solo admin o el mismo usuario pueden actualizar
    if current_user.rol not in ("superadmin", "admin_cliente") and current_user.id != usuario_id:
        raise ForbiddenError()
    # No puede cambiar su propio rol
    if current_user.id == usuario_id and data.rol is not None:
        raise ForbiddenError("No puedes cambiar tu propio rol.")
    return await crud_usuario.update(db, db_obj=usuario, obj_in=data.model_dump(exclude_unset=True))


@router.delete(
    "/{usuario_id}",
    response_model=MessageResponse,
    summary="Desactivar usuario",
)
async def desactivar_usuario(
    usuario_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    """Desactiva usuario (no elimina, para preservar auditoría)."""
    usuario = await crud_usuario.get(db, usuario_id)
    if not usuario:
        raise NotFoundError("Usuario")
    if current_user.id == usuario_id:
        raise ForbiddenError("No puedes desactivar tu propia cuenta.")
    await crud_usuario.update(db, db_obj=usuario, obj_in={"activo": False})
    return MessageResponse(message="Usuario desactivado correctamente.")
