from typing import List, Optional
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.crud.base import CRUDBase
from app.models.documento import DocumentoOficial, HistorialDocumento
from app.schemas.documento import (
    DocumentoRecibidoCreate,
    DocumentoEmitidoCreate,
    DocumentoUpdate,
)


class CRUDDocumento(CRUDBase[DocumentoOficial]):

    async def get_with_relations(
        self, db: AsyncSession, id: str
    ) -> Optional[DocumentoOficial]:
        result = await db.execute(
            select(DocumentoOficial)
            .options(
                selectinload(DocumentoOficial.creado_por),
                selectinload(DocumentoOficial.turnado_por),
            )
            .where(DocumentoOficial.id == str(id))
        )
        return result.scalar_one_or_none()

    async def list_documentos(
        self,
        db: AsyncSession,
        *,
        cliente_id: Optional[str] = None,
        flujo: Optional[str] = None,
        tipo: Optional[str] = None,
        estado: Optional[str] = None,
        area_turno: Optional[str] = None,
        busqueda: Optional[str] = None,
        fecha_desde: Optional[str] = None,
        fecha_hasta: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[DocumentoOficial]:
        stmt = select(DocumentoOficial)

        if cliente_id:
            stmt = stmt.where(DocumentoOficial.cliente_id == str(cliente_id))
        if flujo:
            stmt = stmt.where(DocumentoOficial.flujo == flujo)
        if tipo:
            stmt = stmt.where(DocumentoOficial.tipo == tipo)
        if estado:
            stmt = stmt.where(DocumentoOficial.estado == estado)
        if area_turno:
            stmt = stmt.where(DocumentoOficial.area_turno == area_turno)
        if busqueda and len(busqueda) >= 2:
            term = f"%{busqueda}%"
            stmt = stmt.where(
                DocumentoOficial.asunto.ilike(term)
                | DocumentoOficial.numero_oficio_origen.ilike(term)
                | DocumentoOficial.numero_control.ilike(term)
                | DocumentoOficial.remitente_nombre.ilike(term)
                | DocumentoOficial.remitente_dependencia.ilike(term)
                | DocumentoOficial.folio_respuesta.ilike(term)
                | DocumentoOficial.dependencia_destino.ilike(term)
                | DocumentoOficial.dependencia_origen.ilike(term)
            )
        if fecha_desde:
            try:
                desde = datetime.fromisoformat(fecha_desde).replace(tzinfo=None)
                stmt = stmt.where(DocumentoOficial.creado_en >= desde)
            except ValueError:
                pass
        if fecha_hasta:
            try:
                hasta = datetime.fromisoformat(fecha_hasta).replace(
                    hour=23, minute=59, second=59, tzinfo=None
                )
                stmt = stmt.where(DocumentoOficial.creado_en <= hasta)
            except ValueError:
                pass

        stmt = stmt.order_by(DocumentoOficial.creado_en.desc()).offset(skip).limit(limit)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def crear_recibido(
        self,
        db: AsyncSession,
        *,
        obj_in: DocumentoRecibidoCreate,
        creado_por_id: str,
    ) -> DocumentoOficial:
        from datetime import date
        data = obj_in.model_dump()
        data["flujo"]         = "recibido"
        # Auto-asignar "de_conocimiento" si no requiere respuesta
        if data.get("requiere_respuesta") is False:
            data["estado"] = "de_conocimiento"
        else:
            data["estado"] = "recibido"
        data["creado_por_id"] = creado_por_id
        if not data.get("fecha_recibido"):
            data["fecha_recibido"] = date.today().isoformat()
        return await self.create(db, obj_in=data)

    async def crear_emitido(
        self,
        db: AsyncSession,
        *,
        obj_in: DocumentoEmitidoCreate,
        creado_por_id: str,
    ) -> DocumentoOficial:
        data = obj_in.model_dump()
        data["flujo"]         = "emitido"
        data["creado_por_id"] = creado_por_id
        if not data.get("estado"):
            data["estado"] = "borrador"
        return await self.create(db, obj_in=data)

    async def actualizar_documento(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        obj_in: DocumentoUpdate,
    ) -> DocumentoOficial:
        data = {k: v for k, v in obj_in.model_dump().items() if v is not None}
        return await self.update(db, db_obj=db_obj, obj_in=data)

    async def registrar_ocr(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        datos_extraidos: dict,
        clasificacion: dict,
        fecha_limite: str,
    ) -> DocumentoOficial:
        """Guarda el resultado del OCR y la clasificación IA."""
        datos = datos_extraidos
        upd = {
            "datos_extraidos_ia":      datos,
            "ocr_procesado":           True,
            "sugerencia_area_codigo":  clasificacion.get("area_codigo"),
            "sugerencia_area_nombre":  clasificacion.get("area_nombre"),
            "sugerencia_fundamento":   clasificacion.get("fundamento"),
            "sugerencia_plazo_dias":   clasificacion.get("plazo_dias"),
            "confianza_clasificacion": clasificacion.get("confianza"),
            "regla_turno_codigo":      clasificacion.get("regla_codigo"),
            "genera_tramite":          clasificacion.get("genera_tramite"),
            "fecha_limite":            fecha_limite,
        }
        # Rellenar campos básicos si el OCR los detectó y aún están vacíos
        if not db_obj.asunto and datos.get("asunto"):
            upd["asunto"] = datos["asunto"]
        if not db_obj.numero_oficio_origen and datos.get("numero_oficio"):
            upd["numero_oficio_origen"] = datos["numero_oficio"]
        if not db_obj.fecha_documento and datos.get("fecha_documento"):
            upd["fecha_documento"] = datos["fecha_documento"]
        if not db_obj.remitente_nombre and datos.get("remitente_nombre"):
            upd["remitente_nombre"] = datos["remitente_nombre"]
        if not db_obj.remitente_cargo and datos.get("remitente_cargo"):
            upd["remitente_cargo"] = datos["remitente_cargo"]
        if not db_obj.remitente_dependencia and datos.get("remitente_dependencia"):
            upd["remitente_dependencia"] = datos["remitente_dependencia"]

        return await self.update(db, db_obj=db_obj, obj_in=upd)

    async def confirmar_turno(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        area_codigo: str,
        area_nombre: str,
        turnado_por_id: str,
        instrucciones: str | None = None,
    ) -> DocumentoOficial:
        from app.services.correspondencia_service import AREAS_DPP
        info = AREAS_DPP.get(area_codigo, {})
        upd: dict = {
            "area_turno":           area_codigo,
            "area_turno_nombre":    area_nombre or info.get("nombre", area_codigo),
            "area_turno_confirmada": True,
            "estado":               "turnado",
            "turnado_por_id":       turnado_por_id,
            "turnado_en":           datetime.now(timezone.utc),
        }
        if instrucciones:
            upd["instrucciones_turno"] = instrucciones
        return await self.update(db, db_obj=db_obj, obj_in=upd)

    async def guardar_borrador(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        borrador: str,
    ) -> DocumentoOficial:
        return await self.update(
            db,
            db_obj=db_obj,
            obj_in={"borrador_respuesta": borrador},
        )

    async def actualizar_archivo(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        nombre_archivo: str,
        url_storage: str,
        mime_type: str,
    ) -> DocumentoOficial:
        return await self.update(
            db,
            db_obj=db_obj,
            obj_in={
                "nombre_archivo": nombre_archivo,
                "url_storage":    url_storage,
                "mime_type":      mime_type,
            },
        )


    # ── Devolución y reenvío ─────────────────────────────────────────────────

    async def devolver_documento(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        observaciones: str,
        devuelto_por_id: str,
    ) -> DocumentoOficial:
        """Transiciona documento a 'devuelto' con observaciones obligatorias."""
        estado_anterior = db_obj.estado

        upd = {
            "estado": "devuelto",
            "devuelto_por_id": devuelto_por_id,
            "devuelto_en": datetime.now(timezone.utc),
            "motivo_devolucion": observaciones,
        }
        doc = await self.update(db, db_obj=db_obj, obj_in=upd)

        # Crear entrada en historial
        historial = HistorialDocumento(
            documento_id=db_obj.id,
            usuario_id=devuelto_por_id,
            tipo_accion="devolucion",
            estado_anterior=estado_anterior,
            estado_nuevo="devuelto",
            observaciones=observaciones,
            version=db_obj.version or 1,
            borrador_snapshot=db_obj.borrador_respuesta,
        )
        db.add(historial)
        await db.flush()
        await db.refresh(historial)
        return doc

    async def reenviar_documento(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        comentario: str,
        reenviado_por_id: str,
    ) -> DocumentoOficial:
        """Transiciona documento de 'devuelto' a 'en_atencion' tras correcciones."""
        nueva_version = (db_obj.version or 1) + 1

        upd = {
            "estado": "en_atencion",
            "version": nueva_version,
            "motivo_devolucion": None,  # limpiar razón más reciente
        }
        doc = await self.update(db, db_obj=db_obj, obj_in=upd)

        historial = HistorialDocumento(
            documento_id=db_obj.id,
            usuario_id=reenviado_por_id,
            tipo_accion="reenvio",
            estado_anterior="devuelto",
            estado_nuevo="en_atencion",
            observaciones=comentario or "Documento corregido y reenviado para revisión.",
            version=nueva_version,
            borrador_snapshot=db_obj.borrador_respuesta,
        )
        db.add(historial)
        await db.flush()
        return doc

    async def registrar_firma_historial(
        self,
        db: AsyncSession,
        *,
        documento_id: str,
        usuario_id: str,
        version: int,
        estado_anterior: str = "en_atencion",
        estado_nuevo: str = "firmado",
        observaciones: str = "Firma electrónica aplicada.",
    ) -> HistorialDocumento:
        """Registra la acción de firma en el historial."""
        historial = HistorialDocumento(
            documento_id=documento_id,
            usuario_id=usuario_id,
            tipo_accion="firma",
            estado_anterior=estado_anterior,
            estado_nuevo=estado_nuevo,
            observaciones=observaciones,
            version=version,
        )
        db.add(historial)
        await db.flush()
        await db.refresh(historial)
        return historial

    async def get_historial(
        self,
        db: AsyncSession,
        documento_id: str,
    ) -> List[HistorialDocumento]:
        """Obtiene historial completo de un documento ordenado desc."""
        result = await db.execute(
            select(HistorialDocumento)
            .options(selectinload(HistorialDocumento.usuario))
            .where(HistorialDocumento.documento_id == str(documento_id))
            .order_by(HistorialDocumento.timestamp.desc())
        )
        return list(result.scalars().all())

    async def list_devueltos(
        self,
        db: AsyncSession,
        *,
        cliente_id: Optional[str] = None,
        area_turno: Optional[str] = None,
    ) -> List[DocumentoOficial]:
        """Lista documentos en estado 'devuelto' para el área responsable."""
        stmt = select(DocumentoOficial).where(
            DocumentoOficial.estado == "devuelto"
        )
        if cliente_id:
            stmt = stmt.where(DocumentoOficial.cliente_id == str(cliente_id))
        if area_turno:
            stmt = stmt.where(DocumentoOficial.area_turno == area_turno)
        stmt = stmt.order_by(DocumentoOficial.devuelto_en.desc())
        result = await db.execute(stmt)
        return list(result.scalars().all())


    async def acusar_conocimiento(
        self,
        db: AsyncSession,
        *,
        db_obj: DocumentoOficial,
        usuario_id: str,
        area_nombre: str,
    ) -> DocumentoOficial:
        """Registra acuse de conocimiento. El estado se mantiene como de_conocimiento
        (estado terminal) pero se registra quién lo revisó y cuándo."""
        from datetime import datetime, timezone

        updates = {
            "atendido_por_id": usuario_id,
            "atendido_en": datetime.now(timezone.utc),
            "atendido_area": area_nombre,
        }
        updated = await self.update(db, db_obj=db_obj, obj_in=updates)

        historial = HistorialDocumento(
            documento_id=str(db_obj.id),
            usuario_id=usuario_id,
            tipo_accion="acuse_conocimiento",
            estado_anterior="de_conocimiento",
            estado_nuevo="de_conocimiento",
            observaciones=f"Acuse de conocimiento registrado por área: {area_nombre}",
            version=db_obj.version or 1,
        )
        db.add(historial)
        await db.flush()
        return updated


crud_documento = CRUDDocumento(DocumentoOficial)
