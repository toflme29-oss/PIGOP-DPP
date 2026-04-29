import asyncio
import os
import sys

# Add current directory to path so it can find 'app'
sys.path.append(os.getcwd())

from app.core.database import AsyncSessionLocal
from app.models.permiso import PermisoOverride
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(PermisoOverride))
        overrides = res.scalars().all()
        if not overrides:
            print("No hay overrides de permisos.")
        for o in overrides:
            print(f"Key: {o.key}, Value: {o.value}, ClienteID: {o.cliente_id}")

if __name__ == "__main__":
    asyncio.run(run())
