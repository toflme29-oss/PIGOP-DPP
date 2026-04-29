import asyncio
import os
import sys

# Add current directory to path so it can find 'app'
sys.path.append(os.getcwd())

from app.core.database import create_tables, init_db_data
import app.models  # Crucial: esto puebla Base.metadata

async def run():
    print("Iniciando creacion de tablas...")
    await create_tables()
    print("Tablas creadas/verificadas.")
    print("Inicializando datos base...")
    try:
        await init_db_data()
        print("Datos base inicializados.")
    except Exception as e:
        print(f"Nota: init_db_data reporto algo (posiblemente encoding): {e}")

if __name__ == "__main__":
    asyncio.run(run())
