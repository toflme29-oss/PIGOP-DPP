import uuid
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings
from app.core.security import get_password_hash


def _engine_kwargs() -> dict:
    """Pool config: SQLite no soporta pool_size ni max_overflow."""
    if "sqlite" in settings.DATABASE_URL:
        return {"echo": settings.DB_ECHO, "connect_args": {"check_same_thread": False}}
    return {
        "echo": settings.DB_ECHO,
        "pool_pre_ping": True,
        "pool_size": 10,
        "max_overflow": 20,
    }


engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs())

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    """Crea todas las tablas (solo para desarrollo, en prod usar Alembic)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def init_db_data():
    """Siembra o actualiza datos iniciales (Admin y Cliente DPP)."""
    async with AsyncSessionLocal() as db:
        # 1. Crear Cliente DPP
        res = await db.execute(text("SELECT id FROM clientes WHERE codigo_upp='DPP'"))
        if not res.fetchone():
            await db.execute(text(
                "INSERT INTO clientes (id, codigo_upp, nombre, tipo, activo, configuracion) "
                "VALUES (:id, 'DPP', 'Dirección de Programación y Presupuesto', 'centralizada', 1, '{}')"
            ), {"id": str(uuid.uuid4())})
            print("✅ Cliente DPP inicializado")

        # 2. Crear o Actualizar Superadmin (Reseteo de clave forzado)
        pwd_hash = get_password_hash(settings.SUPERADMIN_PASSWORD)
        res = await db.execute(text("SELECT id FROM usuarios WHERE email=:e"), {"e": settings.SUPERADMIN_EMAIL})
        user = res.fetchone()
        
        if not user:
            await db.execute(text(
                "INSERT INTO usuarios (id, email, password_hash, nombre_completo, rol, activo, modulos_acceso) "
                "VALUES (:id, :email, :pwd, 'Administrador PIGOP', 'superadmin', 1, '[]')"
            ), {
                "id": str(uuid.uuid4()),
                "email": settings.SUPERADMIN_EMAIL,
                "pwd": pwd_hash
            })
            print(f"✅ Superadmin {settings.SUPERADMIN_EMAIL} creado")
        else:
            # Forzar actualización de clave en caso de que haya cambiado o esté corrupta
            await db.execute(text(
                "UPDATE usuarios SET password_hash=:pwd, activo=1, rol='superadmin' WHERE email=:email"
            ), {"pwd": pwd_hash, "email": settings.SUPERADMIN_EMAIL})
            print(f"✅ Superadmin {settings.SUPERADMIN_EMAIL} actualizado/reseteado")

        await db.commit()
