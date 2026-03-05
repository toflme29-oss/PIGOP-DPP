import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.exceptions import BusinessError, ForbiddenError, NotFoundError
from app.crud.documento import crud_documento
from app.models.user import Usuario
from app.schemas.common import MessageResponse
from fastapi.responses import StreamingResponse
from app.schemas.documento import (
    ConfirmarTurnoInput,
    DevolucionInput,
    DevolucionResponse,
    DocumentoEmitidoCreate,
    DocumentoListResponse,
    DocumentoRecibidoCreate,
    DocumentoResponse,
    DocumentoUpdate,
    FirmaResponse,
    HistorialItemResponse,
    OficioEstructuradoResponse,
    PreviewOCRResponse,
    ProcesarOCRResponse,
    ReenvioInput,
    ESTADOS_EMITIDO,
    ESTADOS_RECIBIDO,
)
from app.services.correspondencia_service import (
    AREAS_DPP,
    correspondencia_service,
    clasificar_oficio,
)

router = APIRouter()

UPLOAD_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "uploads", "documentos"
)
os.makedirs(UPLOAD_DIR, exist_ok=True)

MIME_PERMITIDOS = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/tiff", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE_MB = 20


def _assert_acceso(current_user: Usuario, cliente_id: str) -> None:
    if current_user.rol == "superadmin":
        return
    if str(current_user.cliente_id) != str(cliente_id):
        raise ForbiddenError("No tienes acceso a recursos de este cliente.")


# ---------- Listado ----------------------------------------------------------

@router.get("/", response_model=List[DocumentoListResponse], summary="Listar documentos")
async def listar_documentos(
    skip:       int  = Query(0, ge=0),
    limit:      int  = Query(200, ge=1, le=500),
    flujo:      Optional[str] = Query(None, description="recibido | emitido"),
    tipo:       Optional[str] = Query(None),
    estado:     Optional[str] = Query(None),
    area_turno: Optional[str] = Query(None),
    cliente_id: Optional[str] = Query(None),
    busqueda:   Optional[str] = Query(None),
    fecha_desde: Optional[str] = Query(None, description="Fecha inicio YYYY-MM-DD"),
    fecha_hasta: Optional[str] = Query(None, description="Fecha fin YYYY-MM-DD"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    if current_user.rol != "superadmin":
        cliente_id = str(current_user.cliente_id)

    return await crud_documento.list_documentos(
        db,
        cliente_id=cliente_id,
        flujo=flujo,
        tipo=tipo,
        estado=estado,
        area_turno=area_turno,
        busqueda=busqueda,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        skip=skip,
        limit=limit,
    )


# ---------- Siguiente folio consecutivo -------------------------------------

@router.get("/siguiente-folio", summary="Obtener siguiente folio consecutivo")
async def siguiente_folio(
    tipo: str = Query("OFICIO", description="Tipo de documento: OFICIO, CIRCULAR, MEMO"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Genera el siguiente folio consecutivo para oficios de respuesta.
    Formato: DPP/{TIPO}/{NNNNN}/{AÑO}
    Busca el máximo folio existente del mismo tipo/año y retorna el siguiente.
    """
    from datetime import datetime
    from sqlalchemy import text

    anio = datetime.now().year
    tipo_upper = tipo.upper()[:8]
    prefix = f"DPP/{tipo_upper}/"
    suffix = f"/{anio}"

    # Buscar el maximo folio existente con este patron
    query = text(
        "SELECT folio_respuesta FROM documentos_oficiales "
        "WHERE folio_respuesta LIKE :pattern ORDER BY folio_respuesta DESC LIMIT 1"
    )
    result = await db.execute(query, {"pattern": f"{prefix}%{suffix}"})
    row = result.first()

    next_num = 1
    if row and row[0]:
        # Extraer numero del folio: DPP/OFICIO/00012/2026 -> 12
        try:
            parts = row[0].split("/")
            if len(parts) >= 3:
                next_num = int(parts[2]) + 1
        except (ValueError, IndexError):
            pass

    folio = f"{prefix}{str(next_num).zfill(5)}{suffix}"
    return {"folio": folio, "numero": next_num, "tipo": tipo_upper, "anio": anio}


# ---------- Catalogo de areas ------------------------------------------------

@router.get("/areas", summary="Catalogo de areas DPP para turno")
async def listar_areas(
    current_user: Usuario = Depends(get_current_active_user),
):
    return [
        {"codigo": k, **v}
        for k, v in AREAS_DPP.items()
    ]


# ---------- Crear recibido ---------------------------------------------------

@router.post(
    "/recibido",
    response_model=DocumentoResponse,
    status_code=201,
    summary="Registrar oficio recibido",
)
async def crear_recibido(
    data: DocumentoRecibidoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Registra un oficio recibido en la DPP.
    Acepta datos pre-llenados por preview-ocr (archivo, OCR, clasificacion).
    """
    _assert_acceso(current_user, data.cliente_id)
    doc = await crud_documento.crear_recibido(
        db, obj_in=data, creado_por_id=str(current_user.id)
    )
    return await crud_documento.get_with_relations(db, doc.id)


# ---------- Crear emitido ----------------------------------------------------

@router.post(
    "/emitido",
    response_model=DocumentoResponse,
    status_code=201,
    summary="Registrar documento emitido por DPP",
)
async def crear_emitido(
    data: DocumentoEmitidoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    _assert_acceso(current_user, data.cliente_id)
    doc = await crud_documento.crear_emitido(
        db, obj_in=data, creado_por_id=str(current_user.id)
    )
    return await crud_documento.get_with_relations(db, doc.id)


# ---------- Preview OCR (sin crear documento) --------------------------------

@router.post(
    "/preview-ocr",
    response_model=PreviewOCRResponse,
    summary="Subir scan, procesar OCR y devolver datos extraidos (sin crear documento)",
)
async def preview_ocr(
    file: UploadFile = File(...),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Primer paso del flujo inteligente:
    1. Recibe scan/foto del oficio
    2. Guarda el archivo
    3. Procesa OCR con Gemini Vision
    4. Clasifica area de turno
    5. Devuelve datos extraidos + info del archivo guardado
    El documento NO se crea todavia -- el frontend muestra los datos
    para que la secretaria revise/corrija antes de confirmar.
    """
    if file.content_type not in MIME_PERMITIDOS:
        raise BusinessError(f"Tipo de archivo no permitido: {file.content_type}")

    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise BusinessError(f"El archivo supera el limite de {MAX_SIZE_MB} MB.")

    # Guardar archivo
    ext = os.path.splitext(file.filename or "oficio.pdf")[1] or ".pdf"
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Procesar OCR + clasificar
    resultado = await correspondencia_service.procesar_oficio_escaneado(
        image_bytes=content,
        mime_type=file.content_type or "image/jpeg",
    )

    return PreviewOCRResponse(
        datos_extraidos=resultado["datos_extraidos"],
        clasificacion=resultado["clasificacion"],
        fecha_limite=resultado["fecha_limite"],
        archivo={
            "nombre_archivo": file.filename or filename,
            "url_storage": filepath,
            "mime_type": file.content_type or "application/octet-stream",
        },
        message="Datos extraidos correctamente. Revise y confirme.",
    )


# ---------- Listar documentos devueltos (ANTES de /{doc_id}) ----------------

@router.get(
    "/devueltos",
    response_model=List[DocumentoListResponse],
    summary="Listar documentos devueltos",
)
async def listar_devueltos(
    area_turno: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Lista documentos en estado 'devuelto' para el área responsable."""
    cliente_id = (
        None if current_user.rol == "superadmin" else str(current_user.cliente_id)
    )
    return await crud_documento.list_devueltos(
        db, cliente_id=cliente_id, area_turno=area_turno
    )


# ---------- Obtener uno ------------------------------------------------------

@router.get("/{doc_id}", response_model=DocumentoResponse, summary="Obtener documento")
async def obtener_documento(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get_with_relations(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    return doc


# ---------- Actualizar -------------------------------------------------------

@router.put("/{doc_id}", response_model=DocumentoResponse, summary="Actualizar documento")
async def actualizar_documento(
    doc_id: str,
    data: DocumentoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    updated = await crud_documento.actualizar_documento(db, db_obj=doc, obj_in=data)
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Cambiar estado ---------------------------------------------------

@router.post("/{doc_id}/estado", response_model=DocumentoResponse, summary="Cambiar estado")
async def cambiar_estado(
    doc_id: str,
    nuevo_estado: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    validos = ESTADOS_RECIBIDO + ESTADOS_EMITIDO
    if nuevo_estado not in validos:
        raise BusinessError(f"Estado invalido. Opciones: {', '.join(validos)}")
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    updated = await crud_documento.update(db, db_obj=doc, obj_in={"estado": nuevo_estado})
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Procesar OCR -----------------------------------------------------

@router.post(
    "/{doc_id}/procesar-ocr",
    response_model=ProcesarOCRResponse,
    summary="Procesar scan con OCR + clasificar area de turno",
)
async def procesar_ocr(
    doc_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    1. Recibe el scan/foto del oficio
    2. Guarda el archivo
    3. Envia a Gemini Vision para OCR
    4. Clasifica el asunto -> area de turno
    5. Calcula fecha limite
    6. Guarda todo en el documento
    """
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if file.content_type not in MIME_PERMITIDOS:
        raise BusinessError(f"Tipo de archivo no permitido: {file.content_type}")

    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise BusinessError(f"El archivo supera el limite de {MAX_SIZE_MB} MB.")

    # Guardar archivo
    ext = os.path.splitext(file.filename or "oficio.pdf")[1] or ".pdf"
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Actualizar archivo en el registro
    await crud_documento.actualizar_archivo(
        db,
        db_obj=doc,
        nombre_archivo=file.filename or filename,
        url_storage=filepath,
        mime_type=file.content_type or "application/octet-stream",
    )
    # Refrescar
    doc = await crud_documento.get(db, doc_id)

    # Procesar con Gemini Vision + clasificar
    resultado = await correspondencia_service.procesar_oficio_escaneado(
        image_bytes=content,
        mime_type=file.content_type or "image/jpeg",
    )

    # Guardar resultados
    await crud_documento.registrar_ocr(
        db,
        db_obj=doc,
        datos_extraidos=resultado["datos_extraidos"],
        clasificacion=resultado["clasificacion"],
        fecha_limite=resultado["fecha_limite"],
    )

    return ProcesarOCRResponse(
        datos_extraidos=resultado["datos_extraidos"],
        clasificacion=resultado["clasificacion"],
        fecha_limite=resultado["fecha_limite"],
        message="OCR procesado. Revise los datos extraidos y confirme el area de turno.",
    )


# ---------- Clasificar por asunto (sin archivo) ------------------------------

@router.post(
    "/{doc_id}/clasificar",
    response_model=DocumentoResponse,
    summary="Clasificar area de turno por asunto (sin OCR)",
)
async def clasificar_por_asunto(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Clasifica el area de turno usando solo el asunto ya registrado."""
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    from app.services.correspondencia_service import calcular_fecha_limite
    from datetime import date

    clasificacion = clasificar_oficio(doc.asunto or "", "")
    fecha_limite = calcular_fecha_limite(date.today(), clasificacion["plazo_dias"])

    await crud_documento.registrar_ocr(
        db,
        db_obj=doc,
        datos_extraidos=doc.datos_extraidos_ia or {},
        clasificacion=clasificacion,
        fecha_limite=fecha_limite.isoformat(),
    )
    return await crud_documento.get_with_relations(db, doc.id)


# ---------- Confirmar turno --------------------------------------------------

@router.post(
    "/{doc_id}/confirmar-turno",
    response_model=DocumentoResponse,
    summary="Confirmar area de turno (secretaria / habilitado)",
)
async def confirmar_turno(
    doc_id: str,
    data: ConfirmarTurnoInput,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Solo analista, admin_cliente o superadmin pueden confirmar el turno."""
    if current_user.rol == "consulta":
        raise ForbiddenError("No tienes permisos para turnar correspondencia.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if data.area_codigo not in AREAS_DPP:
        raise BusinessError(
            f"Area invalida '{data.area_codigo}'. Validas: {', '.join(AREAS_DPP.keys())}"
        )

    area_info = AREAS_DPP[data.area_codigo]
    updated = await crud_documento.confirmar_turno(
        db,
        db_obj=doc,
        area_codigo=data.area_codigo,
        area_nombre=data.area_nombre or area_info["nombre"],
        turnado_por_id=str(current_user.id),
    )
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Generar borrador de respuesta ------------------------------------

@router.post(
    "/{doc_id}/generar-borrador",
    response_model=DocumentoResponse,
    summary="Generar borrador de respuesta con IA",
)
async def generar_borrador(
    doc_id: str,
    body: Optional[dict] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get_with_relations(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    instrucciones = ""
    if body and isinstance(body, dict):
        instrucciones = body.get("instrucciones", "")

    area_nombre  = doc.area_turno_nombre or doc.sugerencia_area_nombre or "Direccion de Programacion y Presupuesto"
    fundamento   = doc.sugerencia_fundamento or "Arts. 18 y 19 del Reglamento Interior de la SFA"

    if doc.flujo == "emitido":
        # For emitidos, generate based on asunto + instrucciones
        instrucciones_full = instrucciones or doc.asunto or "Genera un oficio formal."
        borrador = await correspondencia_service.generar_borrador_respuesta(
            numero_oficio_origen=doc.numero_control or "---",
            fecha_recibido=doc.fecha_documento or "---",
            remitente_nombre=doc.dependencia_destino or "---",
            remitente_cargo="",
            remitente_dependencia=doc.dependencia_destino or "---",
            asunto=doc.asunto,
            cuerpo_resumen=instrucciones_full,
            area_nombre="Dirección de Programación y Presupuesto",
            fundamento_legal="Arts. 18 y 19 del Reglamento Interior de la SFA",
            instrucciones=instrucciones,
        )
    else:
        # Existing recibido flow
        resumen_ocr = (doc.datos_extraidos_ia or {}).get("cuerpo_resumen", "")
        borrador = await correspondencia_service.generar_borrador_respuesta(
            numero_oficio_origen=doc.numero_oficio_origen or "---",
            fecha_recibido=doc.fecha_recibido or doc.fecha_documento or "---",
            remitente_nombre=doc.remitente_nombre or "---",
            remitente_cargo=doc.remitente_cargo or "---",
            remitente_dependencia=doc.remitente_dependencia or "---",
            asunto=doc.asunto,
            cuerpo_resumen=resumen_ocr,
            area_nombre=area_nombre,
            fundamento_legal=fundamento,
            instrucciones=instrucciones,
        )

    updated = await crud_documento.guardar_borrador(db, db_obj=doc, borrador=borrador)
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Upload de archivo (sin OCR) --------------------------------------

@router.post("/{doc_id}/upload", response_model=DocumentoResponse, summary="Adjuntar archivo")
async def subir_archivo(
    doc_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if file.content_type not in MIME_PERMITIDOS:
        raise BusinessError(f"Tipo de archivo no permitido: {file.content_type}")

    content = await file.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise BusinessError(f"El archivo supera el limite de {MAX_SIZE_MB} MB.")

    ext = os.path.splitext(file.filename or "doc.pdf")[1]
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    updated = await crud_documento.actualizar_archivo(
        db,
        db_obj=doc,
        nombre_archivo=file.filename or filename,
        url_storage=filepath,
        mime_type=file.content_type or "application/octet-stream",
    )
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Generar oficio estructurado (4 secciones) ----------------------

@router.post(
    "/{doc_id}/generar-oficio-estructurado",
    response_model=OficioEstructuradoResponse,
    summary="Generar borrador con estructura juridica de 4 secciones",
)
async def generar_oficio_estructurado(
    doc_id: str,
    body: Optional[dict] = None,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Genera un borrador de oficio de respuesta con estructura juridica obligatoria:
    1. Fundamento competencial
    2. Referencia del oficio
    3. Objeto del oficio
    4. Cierre institucional

    Inyecta contexto normativo (RISFA, Ley Disciplina, LGCG, Decreto) al prompt.
    """
    doc = await crud_documento.get_with_relations(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if doc.flujo != "recibido":
        raise BusinessError("Solo los oficios recibidos tienen flujo de respuesta.")

    instrucciones = ""
    if body and isinstance(body, dict):
        instrucciones = body.get("instrucciones", "")

    # Construir contexto normativo
    from app.services.normativa_context_service import normativa_context_service
    contexto_normativo = await normativa_context_service.build_context_for_oficio(
        db,
        regla_turno_codigo=doc.regla_turno_codigo,
        area_codigo=doc.area_turno,
        asunto=doc.asunto or "",
    )

    area_nombre = doc.area_turno_nombre or doc.sugerencia_area_nombre or "Direccion de Programacion y Presupuesto"
    fundamento = doc.sugerencia_fundamento or "Arts. 18 y 19 del Reglamento Interior de la SFA"
    resumen_ocr = (doc.datos_extraidos_ia or {}).get("cuerpo_resumen", "")

    secciones = await correspondencia_service.generar_oficio_estructurado(
        numero_oficio_origen=doc.numero_oficio_origen or "---",
        fecha_recibido=doc.fecha_recibido or doc.fecha_documento or "---",
        remitente_nombre=doc.remitente_nombre or "---",
        remitente_cargo=doc.remitente_cargo or "---",
        remitente_dependencia=doc.remitente_dependencia or "---",
        asunto=doc.asunto,
        cuerpo_resumen=resumen_ocr,
        area_nombre=area_nombre,
        fundamento_legal=fundamento,
        contexto_normativo=contexto_normativo,
        instrucciones=instrucciones,
    )

    # Concatenar secciones para el borrador completo
    borrador_completo = "\n\n".join(
        s for s in [
            secciones.get("fundamento", ""),
            secciones.get("referencia", ""),
            secciones.get("objeto", ""),
            secciones.get("cierre", ""),
        ] if s and s.strip()
    )

    # Guardar borrador en BD
    await crud_documento.guardar_borrador(db, db_obj=doc, borrador=borrador_completo)

    return OficioEstructuradoResponse(
        secciones=secciones,
        borrador_completo=borrador_completo,
        message="Oficio estructurado generado con 4 secciones juridicas.",
    )


# ---------- Descargar oficio DOCX -------------------------------------------

@router.post(
    "/{doc_id}/descargar-oficio",
    summary="Generar y descargar oficio en formato DOCX",
)
async def descargar_oficio(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Genera un documento DOCX con formato institucional y lo retorna para descarga."""
    doc = await crud_documento.get_with_relations(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if not doc.borrador_respuesta:
        raise BusinessError("No hay borrador de respuesta. Genere uno primero.")

    from app.services.oficio_generator_service import oficio_generator
    from app.services.correspondencia_service import CorrespondenciaService
    from datetime import date

    # Parsear secciones del borrador
    secciones = CorrespondenciaService._parse_secciones(doc.borrador_respuesta)

    # Formatear fecha
    hoy = date.today()
    from app.services.oficio_generator_service import MESES_ES
    fecha_str = f"{hoy.day} de {MESES_ES[hoy.month - 1]} de {hoy.year}"

    # --- Preparar datos de sello digital si está firmado ---
    sello_data = None
    if doc.firmado_digitalmente and doc.firma_metadata:
        import json as _json
        meta = doc.firma_metadata
        if isinstance(meta, str):
            try:
                meta = _json.loads(meta)
            except Exception:
                meta = {}

        # Leer QR PNG desde archivo
        qr_png_bytes = b""
        qr_path = meta.get("qr_url", "")
        if qr_path:
            from pathlib import Path as _Path
            qr_file = _Path(qr_path)
            if qr_file.exists():
                qr_png_bytes = qr_file.read_bytes()
            else:
                # Intentar ruta alternativa
                qr_alt = _Path(f"uploads/qr_firmas/qr_{doc_id}.png")
                if qr_alt.exists():
                    qr_png_bytes = qr_alt.read_bytes()

        sello_data = {
            "qr_png_bytes": qr_png_bytes,
            "nombre_firmante": meta.get("nombre_firmante", ""),
            "cargo_firmante": meta.get("cargo", "Director de Programación y Presupuesto"),
            "rfc_firmante": meta.get("rfc_firmante", ""),
            "serial_certificado": meta.get("serial_certificado", ""),
            "fecha_firma": meta.get("fecha_firma", ""),
            "correo_firmante": meta.get("firmado_por_usuario", ""),
            "folio_firma": doc.folio_respuesta or "",
        }

    docx_bytes = oficio_generator.generar_oficio_respuesta(
        folio_respuesta=doc.folio_respuesta or "DPP/OFICIO/____/2026",
        fecha_respuesta=fecha_str,
        destinatario_nombre=doc.remitente_nombre or "---",
        destinatario_cargo=doc.remitente_cargo or "---",
        destinatario_dependencia=doc.remitente_dependencia or "---",
        seccion_fundamento=secciones.get("fundamento", ""),
        seccion_referencia=secciones.get("referencia", ""),
        seccion_objeto=secciones.get("objeto", ""),
        seccion_cierre=secciones.get("cierre", ""),
        firmante_nombre="Mtro. Marco Antonio Flores Mejía",
        firmante_cargo="Director de Programación y Presupuesto",
        referencia_elaboro=doc.referencia_elaboro,
        referencia_reviso=doc.referencia_reviso,
        copias=["Expediente.", "Minutario."],
        incluir_firma_visual=bool(doc.firmado_digitalmente),
        sello_digital_data=sello_data,
    )

    import io
    folio_safe = (doc.folio_respuesta or "oficio").replace("/", "_")
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="oficio_{folio_safe}.docx"'},
    )


# ---------- Devolver documento -----------------------------------------------

@router.post(
    "/{doc_id}/devolver",
    response_model=DevolucionResponse,
    summary="Devolver documento al área responsable",
)
async def devolver_documento(
    doc_id: str,
    data: DevolucionInput,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Director devuelve un documento al área responsable para correcciones.
    Solo admin_cliente o superadmin.
    Transición: en_atencion → devuelto
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden devolver documentos.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if doc.estado != "en_atencion":
        raise BusinessError(
            f"Solo documentos 'en_atencion' pueden devolverse. Estado actual: {doc.estado}"
        )
    if not doc.borrador_respuesta:
        raise BusinessError("No hay borrador que devolver. El documento no tiene respuesta generada.")

    doc = await crud_documento.devolver_documento(
        db,
        db_obj=doc,
        observaciones=data.observaciones,
        devuelto_por_id=str(current_user.id),
    )

    # Obtener la entrada de historial recién creada
    historial = await crud_documento.get_historial(db, doc.id)
    entry = historial[0] if historial else None

    return DevolucionResponse(
        documento_id=doc.id,
        estado="devuelto",
        historial_entry=HistorialItemResponse(
            id=entry.id,
            tipo_accion=entry.tipo_accion,
            estado_anterior=entry.estado_anterior,
            estado_nuevo=entry.estado_nuevo,
            observaciones=entry.observaciones,
            version=entry.version,
            timestamp=entry.timestamp,
            usuario_nombre=(
                entry.usuario.nombre_completo if entry.usuario else None
            ),
        ) if entry else None,
        message="Documento devuelto al área responsable.",
    )


# ---------- Reenviar documento corregido ------------------------------------

@router.post(
    "/{doc_id}/reenviar",
    response_model=DocumentoResponse,
    summary="Reenviar documento corregido para revisión",
)
async def reenviar_documento(
    doc_id: str,
    data: ReenvioInput,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Área responsable reenvía documento corregido al Director.
    Transición: devuelto → en_atencion. Incrementa versión.
    """
    if current_user.rol == "consulta":
        raise ForbiddenError("No tienes permisos para reenviar documentos.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if doc.estado != "devuelto":
        raise BusinessError(
            f"Solo documentos 'devuelto' pueden reenviarse. Estado actual: {doc.estado}"
        )

    doc = await crud_documento.reenviar_documento(
        db,
        db_obj=doc,
        comentario=data.comentario or "",
        reenviado_por_id=str(current_user.id),
    )
    return await crud_documento.get_with_relations(db, doc.id)


# ---------- Historial de un documento ---------------------------------------

@router.get(
    "/{doc_id}/historial",
    response_model=List[HistorialItemResponse],
    summary="Obtener historial de acciones del documento",
)
async def obtener_historial(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Timeline de acciones: devoluciones, reenvíos, firmas."""
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    historial = await crud_documento.get_historial(db, doc_id)
    return [
        HistorialItemResponse(
            id=h.id,
            tipo_accion=h.tipo_accion,
            estado_anterior=h.estado_anterior,
            estado_nuevo=h.estado_nuevo,
            observaciones=h.observaciones,
            version=h.version,
            timestamp=h.timestamp,
            usuario_nombre=(
                h.usuario.nombre_completo if h.usuario else None
            ),
        )
        for h in historial
    ]


# ---------- Firmar documento ------------------------------------------------

@router.post(
    "/{doc_id}/firmar",
    response_model=FirmaResponse,
    summary="Firmar documento con e.firma",
)
async def firmar_documento(
    doc_id: str,
    request: Request,
    password: str = Form("", description="Contraseña de la clave privada"),
    cer_file: Optional[UploadFile] = File(None, description="Archivo .cer (opcional si tiene certificado registrado)"),
    key_file: Optional[UploadFile] = File(None, description="Archivo .key (opcional si tiene certificado registrado)"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Firma un documento con e.firma electrónica avanzada.

    Si el usuario tiene certificado registrado en la bóveda, solo necesita
    la contraseña. Si no, puede subir .cer + .key + password.

    Genera firma RSA real, QR de verificación y registra en bitácora.
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden firmar documentos.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if not doc.borrador_respuesta:
        raise BusinessError("No hay borrador de respuesta. Genere uno antes de firmar.")

    if doc.estado == "devuelto":
        raise BusinessError(
            "Este documento fue devuelto y requiere correcciones antes de firmarse. "
            "Corrija el borrador y reenvíe antes de intentar firmar."
        )
    if doc.estado not in ("en_atencion",):
        raise BusinessError(
            f"El documento debe estar 'en_atencion' para firmarse. Estado actual: {doc.estado}"
        )

    from app.services.firma_electronica_service import firma_electronica_service
    from app.services.boveda_certificados_service import boveda_certificados_service

    usuario_id = str(current_user.id)
    key_bytes = b""
    cer_bytes = b""
    cert_info = None

    # Intentar obtener certificado de la bóveda
    cert_record = await boveda_certificados_service.obtener_certificado(db, usuario_id)

    if cert_record and password:
        # Usar certificado de la bóveda
        try:
            key_bytes, cer_bytes, cert_record = await boveda_certificados_service.descifrar_clave_privada(
                db, usuario_id=usuario_id, password=password,
                ip_origen=request.client.host if request.client else "",
            )
            cert_info = {
                "serial": cert_record.numero_serie,
                "rfc": cert_record.rfc,
                "nombre": cert_record.nombre_titular,
                "valido_desde": cert_record.valido_desde.isoformat() if cert_record.valido_desde else "",
                "valido_hasta": cert_record.valido_hasta.isoformat() if cert_record.valido_hasta else "",
            }
        except ValueError as e:
            raise BusinessError(str(e))
    elif cer_file and key_file and password:
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
            "Debe proporcionar la contraseña de su e.firma para firmar. "
            "Si no tiene certificado registrado, suba los archivos .cer y .key."
        )

    # Firmar con criptografía real
    firma_result = firma_electronica_service.firmar_documento(
        contenido_borrador=doc.borrador_respuesta,
        serial_certificado=cert_info["serial"],
        rfc_firmante=cert_info["rfc"],
        nombre_firmante=cert_info["nombre"],
        folio=doc.folio_respuesta or "SIN-FOLIO",
        certificado_valido_desde=cert_info.get("valido_desde", ""),
        certificado_valido_hasta=cert_info.get("valido_hasta", ""),
        key_bytes=key_bytes,
        password=password,
    )
    firma_result["firmado_por_usuario"] = current_user.email
    firma_result["cargo"] = "Director de Programación y Presupuesto"

    # Generar QR de verificación
    qr_bytes, qr_json = firma_electronica_service.generar_qr(
        hash_documento=firma_result["hash_documento"],
        fecha_firma=firma_result["fecha_firma"],
        serial_certificado=cert_info["serial"],
        valido_desde=cert_info.get("valido_desde", ""),
        valido_hasta=cert_info.get("valido_hasta", ""),
        folio=doc.folio_respuesta or "SIN-FOLIO",
        documento_id=doc.id,
    )
    qr_url = firma_electronica_service.guardar_qr(doc.id, qr_bytes)
    firma_result["qr_url"] = qr_url
    firma_result["qr_data"] = qr_json

    # Actualizar en BD
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
    )

    # Actualizar contador de firmas en bóveda
    if cert_record:
        await boveda_certificados_service.incrementar_firmas(db, usuario_id)

    # Registrar en bitácora de firma
    await boveda_certificados_service._registrar_bitacora(
        db, usuario_id=usuario_id, accion="firma_individual",
        exitoso=True, documento_id=doc.id,
        rfc=cert_info["rfc"], serial=cert_info["serial"],
        hash_doc=firma_result["hash_documento"],
        ip_origen=request.client.host if request.client else "",
        detalle=f"Documento firmado: {doc.asunto[:50]}",
    )
    await db.commit()

    return FirmaResponse(
        firmado_digitalmente=True,
        firma_metadata=firma_result,
        message="Documento firmado exitosamente con e.firma. QR de verificación generado.",
    )


# ---------- Constancia de firma PDF -------------------------------------------

@router.get(
    "/{doc_id}/constancia-firma",
    summary="Descargar constancia de firma electrónica (PDF)",
)
async def descargar_constancia_firma(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Genera y descarga un PDF con la constancia de firma electrónica.
    Incluye datos criptográficos, QR de verificación y datos del documento.
    """
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if not doc.firmado_digitalmente or not doc.firma_metadata:
        raise BusinessError("El documento no ha sido firmado digitalmente.")

    from app.services.constancia_firma_service import constancia_firma_service

    # Extraer firma_metadata (puede ser dict o JSON string)
    meta = doc.firma_metadata
    if isinstance(meta, str):
        import json
        meta = json.loads(meta)

    pdf_bytes = constancia_firma_service.generar_constancia_pdf(
        documento_id=doc.id,
        asunto=doc.asunto,
        folio_respuesta=doc.folio_respuesta or "",
        numero_oficio_origen=doc.numero_oficio_origen or "",
        remitente_nombre=doc.remitente_nombre or "",
        remitente_dependencia=doc.remitente_dependencia or "",
        area_turno_nombre=doc.area_turno_nombre or "",
        firma_metadata=meta,
        version=doc.version or 1,
    )

    import io
    filename = f"constancia_firma_{doc.folio_respuesta or doc.id}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


# ---------- Oficio en PDF (vista previa / descarga) --------------------------

@router.get(
    "/{doc_id}/descargar-oficio-pdf",
    summary="Generar y descargar oficio en formato PDF",
)
async def descargar_oficio_pdf(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Genera un PDF del oficio de respuesta con formato institucional.
    Incluye sello digital / QR si el documento está firmado.
    Ideal para vista previa embebida o descarga directa.
    """
    doc = await crud_documento.get_with_relations(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if not doc.borrador_respuesta:
        raise BusinessError("No hay borrador de respuesta. Genere uno primero.")

    from app.services.oficio_pdf_service import oficio_pdf_service
    from app.services.correspondencia_service import CorrespondenciaService
    from app.services.oficio_generator_service import MESES_ES
    from datetime import date
    import json as _json

    # Parsear secciones
    secciones = CorrespondenciaService._parse_secciones(doc.borrador_respuesta)

    # Fecha
    hoy = date.today()
    fecha_str = f"{hoy.day} de {MESES_ES[hoy.month - 1]} de {hoy.year}"

    # Datos de sello digital si está firmado
    sello_data = None
    if doc.firmado_digitalmente and doc.firma_metadata:
        meta = doc.firma_metadata
        if isinstance(meta, str):
            try:
                meta = _json.loads(meta)
            except Exception:
                meta = {}

        qr_png_bytes = b""
        qr_path = meta.get("qr_url", "")
        if qr_path:
            from pathlib import Path as _Path
            qr_file = _Path(qr_path)
            if qr_file.exists():
                qr_png_bytes = qr_file.read_bytes()
            else:
                qr_alt = _Path(f"uploads/qr_firmas/qr_{doc_id}.png")
                if qr_alt.exists():
                    qr_png_bytes = qr_alt.read_bytes()

        sello_data = {
            "qr_png_bytes": qr_png_bytes,
            "nombre_firmante": meta.get("nombre_firmante", ""),
            "cargo_firmante": meta.get("cargo", "Director de Programación y Presupuesto"),
            "rfc_firmante": meta.get("rfc_firmante", ""),
            "serial_certificado": meta.get("serial_certificado", ""),
            "fecha_firma": meta.get("fecha_firma", ""),
            "correo_firmante": meta.get("firmado_por_usuario", ""),
            "folio_firma": doc.folio_respuesta or "",
        }

    pdf_bytes = oficio_pdf_service.generar_oficio_pdf(
        folio_respuesta=doc.folio_respuesta or "DPP/OFICIO/____/2026",
        fecha_respuesta=fecha_str,
        destinatario_nombre=doc.remitente_nombre or "---",
        destinatario_cargo=doc.remitente_cargo or "---",
        destinatario_dependencia=doc.remitente_dependencia or "---",
        seccion_fundamento=secciones.get("fundamento", ""),
        seccion_referencia=secciones.get("referencia", ""),
        seccion_objeto=secciones.get("objeto", ""),
        seccion_cierre=secciones.get("cierre", ""),
        firmante_nombre="Mtro. Marco Antonio Flores Mejía",
        firmante_cargo="Director de Programación y Presupuesto",
        referencia_elaboro=doc.referencia_elaboro,
        referencia_reviso=doc.referencia_reviso,
        copias=["Expediente.", "Minutario."],
        incluir_firma_visual=bool(doc.firmado_digitalmente),
        sello_digital_data=sello_data,
    )

    import io
    folio_safe = (doc.folio_respuesta or "oficio").replace("/", "_")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="oficio_{folio_safe}.pdf"',
        },
    )


# ---------- Ver archivo original (turnado/escaneado) --------------------------

@router.get("/{doc_id}/archivo-original", summary="Obtener archivo original del documento")
async def obtener_archivo_original(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Devuelve el archivo original (PDF/imagen) del documento."""
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if not doc.url_storage:
        raise BusinessError("Este documento no tiene archivo adjunto.")

    import io
    from pathlib import Path as _Path
    filepath = _Path(doc.url_storage)
    if not filepath.exists():
        raise BusinessError("El archivo no se encontró en el servidor.")

    content = filepath.read_bytes()
    mime = doc.mime_type or "application/pdf"
    filename = doc.nombre_archivo or f"documento_{doc_id}"

    return StreamingResponse(
        io.BytesIO(content),
        media_type=mime,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )


# ---------- Eliminar ---------------------------------------------------------

@router.delete("/{doc_id}", response_model=MessageResponse, summary="Eliminar documento")
async def eliminar_documento(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    await crud_documento.delete(db, id=doc_id)
    return {"message": "Documento eliminado correctamente.", "success": True}
