"""CRUD — Oficios Recibidos."""

from typing import Any, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud.base import CRUDBase
from app.models.oficio import OficioRecibido


class CRUDOficio(CRUDBase[OficioRecibido]):

    async def get_multi_ordered(
        self,
        db: AsyncSession,
        *,
        skip: int = 0,
        limit: int = 100,
        filters: Optional[List[Any]] = None,
    ) -> List[OficioRecibido]:
        """Listar oficios ordenados por fecha de registro descendente (más recientes primero)."""
        stmt = select(OficioRecibido)
        if filters:
            for f in filters:
                stmt = stmt.where(f)
        stmt = stmt.order_by(OficioRecibido.fecha_registro.desc())
        stmt = stmt.offset(skip).limit(limit)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_numero_oficio(
        self, db: AsyncSession, numero_oficio: str, cliente_id: str
    ) -> Optional[OficioRecibido]:
        result = await db.execute(
            select(OficioRecibido).where(
                OficioRecibido.numero_oficio == numero_oficio,
                OficioRecibido.cliente_id == cliente_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_next_folio(self, db: AsyncSession, cliente_id: str) -> int:
        result = await db.execute(
            select(func.coalesce(func.max(OficioRecibido.folio), 0)).where(
                OficioRecibido.cliente_id == cliente_id
            )
        )
        return result.scalar_one() + 1


crud_oficio = CRUDOficio(OficioRecibido)
