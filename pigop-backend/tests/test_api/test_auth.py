"""Tests de autenticación: login, refresh token, /me."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """El endpoint /health debe responder 200."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.asyncio
async def test_login_exitoso(client: AsyncClient, superadmin_token: str):
    """El token de superadmin debe ser un string no vacío."""
    assert isinstance(superadmin_token, str)
    assert len(superadmin_token) > 10


@pytest.mark.asyncio
async def test_login_credenciales_incorrectas(client: AsyncClient):
    """Login con credenciales incorrectas debe retornar 401."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "noexiste@pigop.gob.mx", "password": "mal_password"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client: AsyncClient, superadmin_token: str):
    """GET /auth/me debe retornar el usuario autenticado."""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "test-admin@pigop.gob.mx"
    assert data["rol"] == "superadmin"


@pytest.mark.asyncio
async def test_get_me_sin_token(client: AsyncClient):
    """GET /auth/me sin token debe retornar 403."""
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient, db_session):
    """El refresh token debe generar un nuevo access token."""
    from app.core.security import get_password_hash
    from app.models.user import Usuario

    user = Usuario(
        email="refresh-test@pigop.gob.mx",
        password_hash=get_password_hash("Test.Pass1!"),
        nombre_completo="Refresh Test",
        rol="analista",
        activo=True,
    )
    db_session.add(user)
    await db_session.commit()

    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "refresh-test@pigop.gob.mx", "password": "Test.Pass1!"},
    )
    assert login_resp.status_code == 200
    refresh_token = login_resp.json()["refresh_token"]

    refresh_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()
