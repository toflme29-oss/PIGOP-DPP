from typing import Optional

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_token
from app.crud.user import crud_usuario
from app.models.user import Usuario

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Usuario:
    """Extrae y valida el usuario desde el JWT Bearer token."""
    token = credentials.credentials
    try:
        payload = decode_token(token)
        if payload.get("tipo") != "access":
            raise UnauthorizedError("Token de tipo incorrecto.")
        user_id: str = payload.get("sub")
        if user_id is None:
            raise UnauthorizedError()
    except JWTError:
        raise UnauthorizedError("Token inválido o expirado.")

    # Usar str directamente — modelos usan String(36), no UUID nativo de PostgreSQL
    user = await crud_usuario.get(db, str(user_id))
    if not user:
        raise UnauthorizedError("Usuario no encontrado.")
    return user


async def get_current_active_user(
    current_user: Usuario = Depends(get_current_user),
) -> Usuario:
    if not current_user.activo:
        raise ForbiddenError("Cuenta desactivada.")
    return current_user


async def get_current_admin(
    current_user: Usuario = Depends(get_current_active_user),
) -> Usuario:
    if current_user.rol not in ("superadmin", "admin_cliente"):
        raise ForbiddenError("Se requieren permisos de administrador.")
    return current_user


async def get_current_superadmin(
    current_user: Usuario = Depends(get_current_active_user),
) -> Usuario:
    if current_user.rol != "superadmin":
        raise ForbiddenError("Se requieren permisos de superadministrador.")
    return current_user
