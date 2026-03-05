"""
Endpoints para Firma Electrónica por Lote.

Flujo:
  1. POST /validar-certificado  →  Valida .cer + .key + password
  2. POST /crear                →  Crea lote con N documento IDs
  3. POST /{id}/ejecutar        →  Firma todos los documentos del lote
  4. GET  /{id}                 →  Consultar estado (polling)
  5. GET  /                     →  Listar lotes de firma

Con bóveda:
  - Si el usuario tiene certificado registrado, solo pide password
  - Abre sesión de firma de 5 min para firmar todos los docs
  - Cierra sesión automáticamente al terminar
  - Cada firma se registra en la bitácora
"""
import io
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.exceptions import BusinessError, ForbiddenError, NotFoundError
from app.crud.documento import crud_documento
from app.models.documento import DocumentoOficial, HistorialDocumento
from app.models.lote_firma import LoteFirma, LoteFirmaItem
from app.models.user import Usuario
from app.schemas.documento import (
    CertificadoValidationResponse,
    DocumentoUpdate,
    FirmaLoteInput,
    FirmaLoteResultResponse,
    LoteFirmaItemResponse,
    LoteFirmaResponse,
)
from app.services.firma_electronica_service import firma_electronica_service
from app.services.boveda_certificados_service import boveda_certificados_service
from app.services.sesion_firma_service import sesion_firma_service

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _load_lote(db: AsyncSession, lote_id: str) -> LoteFirma:
    """Carga un LoteFirma con items y documentos."""
    result = await db.execute(
        select(LoteFirma)
        .options(
            selectinload(LoteFirma.items).selectinload(LoteFirmaItem.documento),
            selectinload(LoteFirma.firmado_por),
        )
        .where(LoteFirma.id == str(lote_id))
    )
    return result.scalar_one_or_none()


def _lote_to_response(lote: LoteFirma) -> LoteFirmaResponse:
    """Convierte un LoteFirma a su response con info de documentos."""
    items = []
    for item in (lote.items or []):
        doc = item.documento
        items.append(LoteFirmaItemResponse(
            id=item.id,
            documento_id=item.documento_id,
            orden=item.orden,
            estado=item.estado,
            hash_documento=item.hash_documento,
            qr_data=item.qr_data,
            error_mensaje=item.error_mensaje,
            firmado_en=item.firmado_en,
            asunto=doc.asunto if doc else None,
            numero_oficio_origen=doc.numero_oficio_origen if doc else None,
            folio_respuesta=doc.folio_respuesta if doc else None,
        ))

    return LoteFirmaResponse(
        id=lote.id,
        nombre=lote.nombre,
        estado=lote.estado,
        certificado_serial=lote.certificado_serial,
        certificado_rfc=lote.certificado_rfc,
        certificado_nombre=lote.certificado_nombre,
        total_documentos=lote.total_documentos,
        total_firmados=lote.total_firmados,
        total_errores=lote.total_errores,
        progreso_pct=lote.progreso_pct,
        items=items,
        creado_en=lote.creado_en,
        completado_en=lote.completado_en,
    )


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/validar-certificado",
    response_model=CertificadoValidationResponse,
    summary="Validar certificado .cer + .key",
)
async def validar_certificado(
    cer_file: UploadFile = File(..., description="Archivo .cer del certificado"),
    key_file: UploadFile = File(..., description="Archivo .key de la clave privada"),
    password: str = Form(..., description="Contraseña de la clave privada"),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Valida un certificado de firma electrónica. Solo admin/superadmin."""
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden usar firma por lote.")

    cer_bytes = await cer_file.read()
    key_bytes = await key_file.read()

    result = firma_electronica_service.validar_certificado(cer_bytes, key_bytes, password)

    return CertificadoValidationResponse(
        valido=result["valido"],
        serial=result.get("serial"),
        rfc=result.get("rfc", ""),
        nombre=result.get("nombre", ""),
        valido_desde=result.get("valido_desde"),
        valido_hasta=result.get("valido_hasta"),
        message=result.get("message", ""),
    )


@router.post(
    "/crear",
    response_model=LoteFirmaResponse,
    status_code=201,
    summary="Crear lote de firma con documentos seleccionados",
)
async def crear_lote_firma(
    data: FirmaLoteInput,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Crea un lote de firma con los documentos seleccionados.
    Valida que todos estén en estado 'en_atencion' y tengan borrador.
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden crear lotes de firma.")

    # Validar todos los documentos
    documentos = []
    errores = []
    for doc_id in data.documento_ids:
        doc = await crud_documento.get(db, doc_id)
        if not doc:
            errores.append(f"Documento {doc_id[:8]}... no encontrado.")
            continue
        if doc.estado != "en_atencion":
            errores.append(
                f"Documento '{doc.asunto[:30]}...' no está en 'en_atencion' (estado: {doc.estado})."
            )
            continue
        if not doc.borrador_respuesta:
            errores.append(f"Documento '{doc.asunto[:30]}...' no tiene borrador de respuesta.")
            continue
        documentos.append(doc)

    if errores:
        raise BusinessError("Documentos no válidos para firma:\n" + "\n".join(errores))

    if not documentos:
        raise BusinessError("No hay documentos válidos para firmar.")

    # Crear el lote
    ahora = datetime.now(timezone.utc)
    nombre = f"Firma Lote {ahora.strftime('%Y-%m-%d')} #{len(documentos)} docs"

    cliente_id = str(current_user.cliente_id) if current_user.cliente_id else str(documentos[0].cliente_id)

    lote = LoteFirma(
        cliente_id=cliente_id,
        nombre=nombre,
        estado="preparando",
        total_documentos=len(documentos),
        firmado_por_id=str(current_user.id),
    )
    db.add(lote)
    await db.flush()

    # Crear ítems
    for orden, doc in enumerate(documentos, start=1):
        item = LoteFirmaItem(
            lote_firma_id=lote.id,
            documento_id=doc.id,
            orden=orden,
            estado="pendiente",
        )
        db.add(item)

    await db.commit()

    # Recargar con relaciones
    lote = await _load_lote(db, lote.id)
    return _lote_to_response(lote)


@router.post(
    "/{lote_id}/ejecutar",
    response_model=FirmaLoteResultResponse,
    summary="Ejecutar firma de todos los documentos del lote",
)
async def ejecutar_firma_lote(
    lote_id: str,
    request: Request,
    password: str = Form(..., description="Contraseña de la clave privada"),
    cer_file: Optional[UploadFile] = File(None, description="Archivo .cer (opcional si tiene certificado registrado)"),
    key_file: Optional[UploadFile] = File(None, description="Archivo .key (opcional si tiene certificado registrado)"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Ejecuta la firma electrónica de todos los documentos del lote.

    Si el usuario tiene certificado registrado en la bóveda, solo necesita password.
    Se abre una sesión segura de 5 minutos para firmar todos los docs.
    La sesión se cierra automáticamente al finalizar.
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden ejecutar firma por lote.")

    lote = await _load_lote(db, lote_id)
    if not lote:
        raise NotFoundError("Lote de firma no encontrado.")

    if lote.estado not in ("preparando",):
        raise BusinessError(
            f"El lote ya fue procesado o está en proceso. Estado: {lote.estado}"
        )

    usuario_id = str(current_user.id)
    ip = _get_client_ip(request)
    key_bytes = b""
    cer_bytes = b""
    cert_info = None
    using_boveda = False

    # Intentar obtener certificado de la bóveda
    cert_record = await boveda_certificados_service.obtener_certificado(db, usuario_id)

    if cert_record:
        # Usar certificado de la bóveda
        try:
            key_bytes, cer_bytes, cert_record = await boveda_certificados_service.descifrar_clave_privada(
                db, usuario_id=usuario_id, password=password, ip_origen=ip,
            )
            cert_info = {
                "serial": cert_record.numero_serie,
                "rfc": cert_record.rfc,
                "nombre": cert_record.nombre_titular,
                "valido_desde": cert_record.valido_desde.isoformat() if cert_record.valido_desde else "",
                "valido_hasta": cert_record.valido_hasta.isoformat() if cert_record.valido_hasta else "",
            }
            using_boveda = True
        except ValueError as e:
            raise BusinessError(str(e))
    elif cer_file and key_file:
        # Fallback: subir archivos directamente
        cer_bytes = await cer_file.read()
        key_bytes = await key_file.read()
        cert_result = firma_electronica_service.validar_certificado(cer_bytes, key_bytes, password)
        if not cert_result.get("valido"):
            raise BusinessError("Certificado inválido: " + cert_result.get("message", ""))
        cert_info = {
            "serial": cert_result["serial"],
            "rfc": cert_result["rfc"],
            "nombre": cert_result["nombre"],
            "valido_desde": cert_result.get("valido_desde", ""),
            "valido_hasta": cert_result.get("valido_hasta", ""),
        }
    else:
        raise BusinessError(
            "Debe proporcionar la contraseña de su e.firma. "
            "Si no tiene certificado registrado, suba los archivos .cer y .key."
        )

    # Abrir sesión de firma segura (5 min)
    sesion_id = sesion_firma_service.abrir_sesion(
        usuario_id=usuario_id,
        key_bytes=key_bytes,
        cer_bytes=cer_bytes,
        cert_info=cert_info,
    )

    # Registrar apertura de sesión en bitácora
    await boveda_certificados_service._registrar_bitacora(
        db, usuario_id=usuario_id, accion="sesion_firma_abierta",
        lote_firma_id=lote.id, rfc=cert_info["rfc"],
        serial=cert_info["serial"], ip_origen=ip,
        detalle=f"Sesión de firma abierta para lote de {lote.total_documentos} documentos.",
    )

    # Guardar info del certificado en el lote
    lote.certificado_serial = cert_info["serial"]
    lote.certificado_rfc = cert_info["rfc"]
    lote.certificado_nombre = cert_info["nombre"]
    lote.certificado_valido_desde = cert_info.get("valido_desde", "")
    lote.certificado_valido_hasta = cert_info.get("valido_hasta", "")
    lote.estado = "en_proceso"
    await db.flush()

    # Firmar cada documento usando la sesión activa
    total_firmados = 0
    total_errores = 0

    for item in lote.items:
        try:
            doc = item.documento
            if not doc or not doc.borrador_respuesta:
                item.estado = "error"
                item.error_mensaje = "Documento sin borrador de respuesta."
                total_errores += 1
                continue

            if doc.estado != "en_atencion":
                item.estado = "error"
                item.error_mensaje = f"Estado inválido: {doc.estado}. Se requiere 'en_atencion'."
                total_errores += 1
                continue

            # Obtener clave de la sesión activa
            session_key = sesion_firma_service.obtener_clave(usuario_id)
            if not session_key:
                item.estado = "error"
                item.error_mensaje = "Sesión de firma expirada."
                total_errores += 1
                continue

            # Firmar con criptografía real
            firma_result = firma_electronica_service.firmar_documento(
                contenido_borrador=doc.borrador_respuesta,
                serial_certificado=cert_info["serial"],
                rfc_firmante=cert_info["rfc"],
                nombre_firmante=cert_info["nombre"],
                folio=doc.folio_respuesta or "SIN-FOLIO",
                certificado_valido_desde=cert_info.get("valido_desde", ""),
                certificado_valido_hasta=cert_info.get("valido_hasta", ""),
                key_bytes=session_key,
                password=password,
            )

            # Generar QR
            qr_bytes, qr_json = firma_electronica_service.generar_qr(
                hash_documento=firma_result["hash_documento"],
                fecha_firma=firma_result["fecha_firma"],
                serial_certificado=cert_info["serial"],
                valido_desde=cert_info.get("valido_desde", ""),
                valido_hasta=cert_info.get("valido_hasta", ""),
                folio=doc.folio_respuesta or "SIN-FOLIO",
                documento_id=doc.id,
            )

            # Guardar QR como archivo
            qr_url = firma_electronica_service.guardar_qr(doc.id, qr_bytes)

            # Actualizar el item del lote
            item.estado = "firmado"
            item.hash_documento = firma_result["hash_documento"]
            item.cadena_original = firma_result["cadena_original"]
            item.sello_digital = firma_result["sello_digital"]
            item.qr_data = qr_json
            item.qr_url = qr_url
            item.firmado_en = datetime.now(timezone.utc)

            # Actualizar el DocumentoOficial
            firma_result["firmado_por_usuario"] = current_user.email
            firma_result["cargo"] = "Director de Programación y Presupuesto"
            firma_result["qr_url"] = qr_url
            firma_result["qr_data"] = qr_json

            update_data = DocumentoUpdate(
                firmado_digitalmente=True,
                firma_metadata=firma_result,
                estado="respondido",
            )
            await crud_documento.actualizar_documento(db, db_obj=doc, obj_in=update_data)

            # Registrar en historial
            await crud_documento.registrar_firma_historial(
                db,
                documento_id=doc.id,
                usuario_id=usuario_id,
                version=doc.version or 1,
                observaciones=f"Firma electrónica por lote '{lote.nombre}'.",
            )

            # Registrar en bitácora individual
            await boveda_certificados_service._registrar_bitacora(
                db, usuario_id=usuario_id, accion="firma_lote",
                documento_id=doc.id, lote_firma_id=lote.id,
                rfc=cert_info["rfc"], serial=cert_info["serial"],
                hash_doc=firma_result["hash_documento"], ip_origen=ip,
                detalle=f"Doc firmado en lote: {doc.asunto[:50]}",
            )

            total_firmados += 1

        except Exception as e:
            item.estado = "error"
            item.error_mensaje = str(e)[:500]
            total_errores += 1

    # Cerrar sesión de firma (limpiar clave de memoria)
    sesion_firma_service.cerrar_sesion(usuario_id)

    # Registrar cierre de sesión
    await boveda_certificados_service._registrar_bitacora(
        db, usuario_id=usuario_id, accion="sesion_firma_cerrada",
        lote_firma_id=lote.id, rfc=cert_info["rfc"],
        serial=cert_info["serial"], ip_origen=ip,
        detalle=f"Sesión cerrada. {total_firmados} firmados, {total_errores} errores.",
    )

    # Actualizar contador de firmas en bóveda
    if using_boveda and total_firmados > 0:
        for _ in range(total_firmados):
            await boveda_certificados_service.incrementar_firmas(db, usuario_id)

    # Actualizar contadores del lote
    lote.total_firmados = total_firmados
    lote.total_errores = total_errores
    lote.estado = "completado"
    lote.completado_en = datetime.now(timezone.utc)
    await db.commit()

    # Recargar
    lote = await _load_lote(db, lote_id)
    return FirmaLoteResultResponse(
        lote_firma=_lote_to_response(lote),
        message=f"Firma por lote completada. {total_firmados} firmados, {total_errores} errores.",
    )


@router.get(
    "/{lote_id}",
    response_model=LoteFirmaResponse,
    summary="Consultar estado de un lote de firma",
)
async def obtener_lote_firma(
    lote_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Para polling de progreso durante la firma."""
    lote = await _load_lote(db, lote_id)
    if not lote:
        raise NotFoundError("Lote de firma no encontrado.")
    return _lote_to_response(lote)


@router.get(
    "/",
    response_model=List[LoteFirmaResponse],
    summary="Listar lotes de firma",
)
async def listar_lotes_firma(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Lista todas las sesiones de firma por lote."""
    stmt = (
        select(LoteFirma)
        .options(
            selectinload(LoteFirma.items).selectinload(LoteFirmaItem.documento),
        )
        .order_by(LoteFirma.creado_en.desc())
        .limit(50)
    )
    if current_user.rol != "superadmin":
        stmt = stmt.where(LoteFirma.firmado_por_id == str(current_user.id))

    result = await db.execute(stmt)
    lotes = list(result.scalars().all())
    return [_lote_to_response(l) for l in lotes]
