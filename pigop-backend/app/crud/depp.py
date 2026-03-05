from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.crud.base import CRUDBase
from app.models.depp import DEPP, DocumentoDEPP
from app.schemas.depp import DEPPCreate, DEPPUpdate


class CRUDDEPP(CRUDBase[DEPP]):
    async def get_with_documents(
        self, db: AsyncSession, id: str
    ) -> Optional[DEPP]:
        """Carga DEPP junto con sus documentos adjuntos y validaciones."""
        result = await db.execute(
            select(DEPP)
            .options(
                selectinload(DEPP.documentos),
                selectinload(DEPP.validaciones),
            )
            .where(DEPP.id == str(id))
        )
        return result.scalar_one_or_none()

    async def get_by_folio(
        self, db: AsyncSession, folio: str, cliente_id: str, ejercicio: int
    ) -> Optional[DEPP]:
        result = await db.execute(
            select(DEPP).where(
                DEPP.folio == folio,
                DEPP.cliente_id == str(cliente_id),
                DEPP.ejercicio == ejercicio,
            )
        )
        return result.scalar_one_or_none()

    async def get_multi_by_cliente(
        self,
        db: AsyncSession,
        cliente_id: str,
        *,
        skip: int = 0,
        limit: int = 100,
        upp: Optional[str] = None,
        ejercicio: Optional[int] = None,
        estado: Optional[str] = None,
    ) -> List[DEPP]:
        filters = [DEPP.cliente_id == str(cliente_id)]
        if upp:
            filters.append(DEPP.upp == upp)
        if ejercicio:
            filters.append(DEPP.ejercicio == ejercicio)
        if estado:
            filters.append(DEPP.estado == estado)
        return await self.get_multi(db, skip=skip, limit=limit, filters=filters)

    async def create_depp(
        self, db: AsyncSession, *, obj_in: DEPPCreate, creado_por_id: str
    ) -> DEPP:
        data = obj_in.model_dump()
        data["creado_por_id"] = str(creado_por_id)
        return await self.create(db, obj_in=data)

    async def update_depp(
        self, db: AsyncSession, *, db_obj: DEPP, obj_in: DEPPUpdate
    ) -> DEPP:
        update_data = obj_in.model_dump(exclude_unset=True)
        return await self.update(db, db_obj=db_obj, obj_in=update_data)

    async def cambiar_estado(
        self, db: AsyncSession, *, db_obj: DEPP, nuevo_estado: str
    ) -> DEPP:
        from datetime import datetime, timezone
        db_obj.estado = nuevo_estado
        db_obj.fecha_estado = datetime.now(timezone.utc)
        db.add(db_obj)
        await db.flush()
        await db.refresh(db_obj)
        return db_obj


class CRUDDocumentoDEPP(CRUDBase[DocumentoDEPP]):
    async def get_by_depp(
        self, db: AsyncSession, depp_id: str
    ) -> List[DocumentoDEPP]:
        result = await db.execute(
            select(DocumentoDEPP).where(DocumentoDEPP.depp_id == str(depp_id))
        )
        return list(result.scalars().all())


crud_depp = CRUDDEPP(DEPP)
crud_documento_depp = CRUDDocumentoDEPP(DocumentoDEPP)
