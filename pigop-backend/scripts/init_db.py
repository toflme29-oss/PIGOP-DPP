"""
Script de inicialización de base de datos.
Crea el superadmin inicial, un cliente DPP y usuarios de prueba por rol.

Usuarios de prueba:
  - director@pigop.gob.mx  (admin_cliente) → Director DPP
  - secretaria@pigop.gob.mx (secretaria)   → Secretaría DPP
  - area@pigop.gob.mx       (analista)     → Área responsable
  - admin@pigop.gob.mx      (superadmin)   → Superadministrador
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
from uuid import UUID


# Usuarios de prueba para validar el flujo completo del sistema
USUARIOS_PRUEBA = [
    {
        "email": "director@pigop.gob.mx",
        "password": "Director.2026!",
        "nombre_completo": "Mtro. Marco Antonio Flores Mejía",
        "rol": "admin_cliente",
        "modulos_acceso": ["gestion_documental", "validacion_depp", "certificaciones", "minutas"],
    },
    {
        "email": "secretaria@pigop.gob.mx",
        "password": "Secretaria.2026!",
        "nombre_completo": "Secretaría DPP",
        "rol": "secretaria",
        "modulos_acceso": ["gestion_documental"],
    },
    {
        "email": "area@pigop.gob.mx",
        "password": "Area.2026!",
        "nombre_completo": "Eduardo Cortés Jaramillo",
        "rol": "analista",
        "modulos_acceso": ["gestion_documental", "validacion_depp", "certificaciones"],
    },
]


async def init_db():
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as db:
        # ── 1. Crear cliente DPP si no existe ──────────────────────────────
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
            print(f"  Cliente creado: {cliente_dpp.nombre} ({cliente_dpp.codigo_upp})")
        else:
            print(f"  Cliente ya existe: {cliente_dpp.nombre}")

        # ── 2. Crear superadmin si no existe ───────────────────────────────
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
            print(f"  Superadmin creado: {superadmin.email}")
        else:
            print(f"  Superadmin ya existe: {superadmin.email}")

        # ── 3. Crear usuarios de prueba ────────────────────────────────────
        for u_data in USUARIOS_PRUEBA:
            existente = await crud_usuario.get_by_email(db, u_data["email"])
            if not existente:
                nuevo = await crud_usuario.create_with_password(
                    db,
                    obj_in=UsuarioCreate(
                        email=u_data["email"],
                        password=u_data["password"],
                        nombre_completo=u_data["nombre_completo"],
                        rol=u_data["rol"],
                        activo=True,
                        modulos_acceso=u_data["modulos_acceso"],
                        cliente_id=str(cliente_dpp.id),
                    ),
                )
                await db.commit()
                print(f"  Usuario [{u_data['rol']}] creado: {u_data['email']}")
            else:
                print(f"  Usuario ya existe: {u_data['email']}")

    await engine.dispose()
    print("\n  Inicializacion completada.")
    print("  Usuarios disponibles:")
    print(f"    admin@pigop.gob.mx      / Admin.2026!      (superadmin)")
    print(f"    director@pigop.gob.mx   / Director.2026!   (admin_cliente → Director)")
    print(f"    secretaria@pigop.gob.mx / Secretaria.2026! (secretaria)")
    print(f"    area@pigop.gob.mx       / Area.2026!       (analista → Area responsable)")


if __name__ == "__main__":
    asyncio.run(init_db())
