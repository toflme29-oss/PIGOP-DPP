from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.exceptions import UnauthorizedError
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.crud.user import crud_usuario
from app.models.user import Usuario
from app.schemas.token import LoginRequest, RefreshRequest, Token
from app.schemas.user import UsuarioResponse

router = APIRouter()


@router.post("/login", response_model=Token, summary="Iniciar sesión")
async def login(
    credentials: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Autentica al usuario y retorna access + refresh tokens JWT."""
    user = await crud_usuario.authenticate(db, credentials.email, credentials.password)
    if not user:
        raise UnauthorizedError("Credenciales incorrectas.")
    if not user.activo:
        raise UnauthorizedError("Cuenta desactivada.")

    # Actualizar último acceso usando SQL directo (compatible ORM + SQLite)
    from sqlalchemy import text as _text
    await db.execute(
        _text("UPDATE usuarios SET ultimo_acceso=:ts WHERE id=:uid"),
        {"ts": datetime.now(timezone.utc).isoformat(), "uid": str(user.id)},
    )
    await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=Token, summary="Renovar token")
async def refresh_token(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Genera un nuevo access token usando el refresh token."""
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("tipo") != "refresh":
            raise UnauthorizedError("Se requiere refresh token.")
        user_id: str = payload.get("sub")
    except JWTError:
        raise UnauthorizedError("Refresh token inválido o expirado.")

    user = await crud_usuario.get(db, UUID(user_id))
    if not user or not user.activo:
        raise UnauthorizedError("Usuario no encontrado o desactivado.")

    access_token = create_access_token(user.id)
    new_refresh_token = create_refresh_token(user.id)

    return Token(access_token=access_token, refresh_token=new_refresh_token)


@router.get("/me", response_model=UsuarioResponse, summary="Información del usuario actual")
async def get_me(
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna la información del usuario autenticado."""
    return current_user
