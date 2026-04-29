import asyncio
import os
import sys
sys.path.append(os.getcwd())
from app.core.database import AsyncSessionLocal
from app.models.user import Usuario
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Usuario.id, Usuario.email, Usuario.nombre_completo))
        users = res.all()
        for u in users:
            print(f"ID: {u.id}, Email: {u.email}, Name: {u.nombre_completo}")

if __name__ == "__main__":
    asyncio.run(run())
