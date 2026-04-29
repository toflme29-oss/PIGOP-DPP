import asyncio
import os
import sys

# Add current directory to path so it can find 'app'
sys.path.append(os.getcwd())

from app.core.database import AsyncSessionLocal
from app.models.user import Usuario
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Usuario.email, Usuario.rol, Usuario.nombre_completo, Usuario.cliente_id))
        users = res.all()
        for u in users:
            print(f"Email: {u.email}, Role: {u.rol}, Name: {u.nombre_completo}, ClienteID: {u.cliente_id}")

if __name__ == "__main__":
    asyncio.run(run())
