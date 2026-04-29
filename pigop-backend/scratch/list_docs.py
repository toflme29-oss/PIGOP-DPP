import asyncio
import os
import sys
sys.path.append(os.getcwd())
from app.core.database import AsyncSessionLocal
from app.models.documento import DocumentoOficial
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(DocumentoOficial.id, DocumentoOficial.asunto, DocumentoOficial.estado))
        docs = res.all()
        for d in docs:
            print(f"ID: {d.id}, Asunto: {d.asunto}, Estado: {d.estado}")

if __name__ == "__main__":
    asyncio.run(run())
