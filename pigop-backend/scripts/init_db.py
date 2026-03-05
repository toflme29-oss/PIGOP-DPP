"""
Script de inicialización de base de datos.
Crea el superadmin inicial y un cliente DPP de ejemplo si no existen.
"""
import asyncio
import sys
import os

# Asegurar que el path de la app esté disponible
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.core.security import get_password_hash
from app.crud.user import crud_cliente, crud_usuario
from app.schemas.user import ClienteCreate, UsuarioCreate


async def init_db():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        # Crear cliente DPP si no existe
        cliente_dpp = await crud_cliente.get_by_codigo_upp(db, "DPP")
        if not cliente_dpp:
            cliente_dpp = await crud_cliente.create(
                db,
                obj_in={
                    "codigo_upp": "DPP",
                    "nombre": "Dirección de Programación y Presupuesto",
                    "tipo": "centralizada",
                    "activo": True,
                    "configuracion": {},
                },
            )
            await db.commit()
            print(f"✅ Cliente creado: {cliente_dpp.nombre} ({cliente_dpp.codigo_upp})")
        else:
            print(f"ℹ️  Cliente ya existe: {cliente_dpp.nombre}")

        # Crear superadmin si no existe
        superadmin = await crud_usuario.get_by_email(db, settings.SUPERADMIN_EMAIL)
        if not superadmin:
            superadmin = await crud_usuario.create_with_password(
                db,
                obj_in=UsuarioCreate(
                    email=settings.SUPERADMIN_EMAIL,
                    password=settings.SUPERADMIN_PASSWORD,
                    nombre_completo="Administrador PIGOP",
                    rol="superadmin",
                    activo=True,
                    cliente_id=None,
                ),
            )
            await db.commit()
            print(f"✅ Superadmin creado: {superadmin.email}")
        else:
            print(f"ℹ️  Superadmin ya existe: {superadmin.email}")

    await engine.dispose()
    print("🎉 Inicialización completada.")


if __name__ == "__main__":
    asyncio.run(init_db())
