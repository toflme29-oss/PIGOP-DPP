"""
Fixtures compartidos para tests.
Usa SQLite en memoria para evitar dependencia de PostgreSQL real en CI.
"""
import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.database import Base, get_db
from app.core.security import get_password_hash
from app.main import app

# Base de datos SQLite en memoria para tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    TestSessionLocal = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with TestSessionLocal() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def superadmin_token(client: AsyncClient, db_session: AsyncSession) -> str:
    """Crea superadmin y retorna su token JWT."""
    from app.models.user import Usuario

    # Crear superadmin directamente en DB
    admin = Usuario(
        email="test-admin@pigop.gob.mx",
        password_hash=get_password_hash("Admin.Test1!"),
        nombre_completo="Test Admin",
        rol="superadmin",
        activo=True,
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)

    # Login
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "test-admin@pigop.gob.mx", "password": "Admin.Test1!"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest_asyncio.fixture
async def cliente_upp(db_session: AsyncSession):
    """Crea un cliente (UPP) de prueba."""
    from app.models.user import Cliente

    cliente = Cliente(
        codigo_upp="TST",
        nombre="UPP de Prueba",
        tipo="centralizada",
        activo=True,
        configuracion={},
    )
    db_session.add(cliente)
    await db_session.commit()
    await db_session.refresh(cliente)
    return cliente
