import sys, os, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
if os.path.exists(_env_file):
    with open(_env_file) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())
if 'DATABASE_URL' not in os.environ:
    os.environ['DATABASE_URL'] = 'sqlite+aiosqlite:///./pigop_prod.db'
NUEVA_PASSWORD = 'Admin.2026!'
EMAIL_ADMIN = os.environ.get('SUPERADMIN_EMAIL', 'admin@pigop.gob.mx')
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text
from app.core.security import get_password_hash
from app.core.config import settings
async def reset():
    db_url = settings.DATABASE_URL
    print(f'Conectando a: {db_url}')
    engine = create_async_engine(db_url, echo=False)
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    nuevo_hash = get_password_hash(NUEVA_PASSWORD)
    async with AsyncSessionLocal() as db:
        result = await db.execute(text('SELECT id, email FROM usuarios WHERE email = :email'), {'email': EMAIL_ADMIN})
        usuario = result.fetchone()
        if not usuario:
            print(f'No se encontro usuario: {EMAIL_ADMIN}')
            todos = await db.execute(text('SELECT email, rol FROM usuarios'))
            for row in todos.fetchall():
                print(f'  - {row[0]} ({row[1]})')
        else:
            await db.execute(text('UPDATE usuarios SET password_hash = :hash WHERE email = :email'), {'hash': nuevo_hash, 'email': EMAIL_ADMIN})
            await db.commit()
            print(f'EXITO: Contrasena reseteada para {EMAIL_ADMIN}')
            print(f'Nueva contrasena: {NUEVA_PASSWORD}')
    await engine.dispose()
if __name__ == '__main__':
    asyncio.run(reset())
