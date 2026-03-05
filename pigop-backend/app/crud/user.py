from typing import Optional


from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.crud.base import CRUDBase
from app.models.user import Cliente, Usuario
from app.schemas.user import ClienteCreate, UsuarioCreate


class CRUDCliente(CRUDBase[Cliente]):
    async def get_by_codigo_upp(
        self, db: AsyncSession, codigo_upp: str
    ) -> Optional[Cliente]:
        result = await db.execute(
            select(Cliente).where(Cliente.codigo_upp == codigo_upp)
        )
        return result.scalar_one_or_none()


class CRUDUsuario(CRUDBase[Usuario]):
    async def get_by_email(
        self, db: AsyncSession, email: str
    ) -> Optional[Usuario]:
        result = await db.execute(
            select(Usuario).where(Usuario.email == email)
        )
        return result.scalar_one_or_none()

    async def create_with_password(
        self, db: AsyncSession, *, obj_in: UsuarioCreate
    ) -> Usuario:
        data = obj_in.model_dump(exclude={"password"})
        data["password_hash"] = get_password_hash(obj_in.password)
        return await self.create(db, obj_in=data)

    async def authenticate(
        self, db: AsyncSession, email: str, password: str
    ) -> Optional[Usuario]:
        user = await self.get_by_email(db, email)
        if not user:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user


crud_cliente = CRUDCliente(Cliente)
crud_usuario = CRUDUsuario(Usuario)
