import logging
import os
import uuid
from typing import List, Optional

logger = logging.getLogger(__name__)

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
    PREFIJOS_FOLIO,
    PLANTILLAS_OFICIO,
    correspondencia_service,
    clasificar_oficio,
    detectar_plantilla,
    obtener_copias,
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
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "text/plain",
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
    tipo: str = Query("OFICIO", description="Tipo de documento (legacy)"),
    area_codigo: Optional[str] = Query(
        None,
        description="Código del área de origen (DIR, SCG, SPF...). "
                    "Si se proporciona, genera folio institucional SFA/SF/DPP[/AREA]/XXXX/AÑO.",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Genera el siguiente folio consecutivo para oficios.

    Formato institucional: `SFA/SF/DPP[/AREA]/XXXX/AÑO`
    Ejemplo: `SFA/SF/DPP/SPFP/0001/2026`

    Donde:
      - SFA = Secretaría de Finanzas y Administración
      - SF  = Subsecretaría de Finanzas
      - DPP = Dirección de Programación y Presupuesto
      - AREA = área emisora interna (SPFP, etc.) — opcional según prefijo
      - XXXX = número consecutivo (4 dígitos)
      - AÑO  = año en curso

    Sin area_codigo: formato legacy `DPP/{TIPO}/{NNNNN}/{AÑO}`.
    """
    from datetime import datetime
    from sqlalchemy import text

    anio = datetime.now().year

    if area_codigo and area_codigo.upper() in PREFIJOS_FOLIO:
        # ── Formato institucional por área ──────────────────────────────
        area = area_codigo.upper()
        prefijo = PREFIJOS_FOLIO[area]
        # Pattern: SFA/SF/DPP/%/2026  ó  SFA/SF/DPP/SPFP/%/2026
        pattern = f"{prefijo}/%/{anio}"

        query = text(
            "SELECT folio_respuesta FROM documentos_oficiales "
            "WHERE folio_respuesta LIKE :pattern "
            "ORDER BY folio_respuesta DESC LIMIT 1"
        )
        result = await db.execute(query, {"pattern": pattern})
        row = result.first()

        next_num = 1
        if row and row[0]:
            try:
                parts = row[0].split("/")
                # Número es el penúltimo segmento:
                #   SFA/SF/DPP/0001/2026 → parts[-2] = "0001"
                #   SFA/SF/DPP/SPFP/0001/2026 → parts[-2] = "0001"
                next_num = int(parts[-2]) + 1
            except (ValueError, IndexError):
                pass

        folio = f"{prefijo}/{str(next_num).zfill(4)}/{anio}"
        return {
            "folio": folio,
            "numero": next_num,
            "area_codigo": area,
            "prefijo": prefijo,
            "anio": anio,
        }

    # ── Formato legacy (sin área) ───────────────────────────────────────
    tipo_upper = tipo.upper()[:8]
    prefix = f"DPP/{tipo_upper}/"
    suffix = f"/{anio}"

    query = text(
        "SELECT folio_respuesta FROM documentos_oficiales "
        "WHERE folio_respuesta LIKE :pattern ORDER BY folio_respuesta DESC LIMIT 1"
    )
    result = await db.execute(query, {"pattern": f"{prefix}%{suffix}"})
    row = result.first()

    next_num = 1
    if row and row[0]:
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


# ---------- Catalogo de plantillas para emitidos ----------------------------

@router.get("/plantillas", summary="Catalogo de plantillas de oficios emitidos")
async def listar_plantillas(
    area_codigo: Optional[str] = Query(None, description="Filtrar por area de origen"),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna las plantillas de oficios disponibles, opcionalmente filtradas por área."""
    result = []
    for p in PLANTILLAS_OFICIO:
        if area_codigo and p["area_origen"] != area_codigo.upper():
            continue
        result.append({
            "categoria": p["categoria"],
            "nombre": p["nombre"],
            "area_origen": p["area_origen"],
            "fundamento_legal": p["fundamento_legal"],
        })
    return result


# ---------- Export Excel oficios recibidos ------------------------------------

@router.get("/export-recibidos", summary="Exportar oficios recibidos a Excel")
async def exportar_recibidos(
    fecha_desde: Optional[str] = Query(None),
    fecha_hasta: Optional[str] = Query(None),
    dependencia: Optional[str] = Query(None),
    busqueda: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Genera y descarga un archivo Excel con los oficios recibidos filtrados."""
    import io
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    # Filtrar documentos recibidos
    cliente_id = None if current_user.rol == "superadmin" else str(current_user.cliente_id)
    # Búsqueda por dependencia: se inyecta en busqueda general ya que el CRUD
    # busca en remitente_dependencia entre otros campos
    busqueda_final = busqueda
    if dependencia and busqueda:
        busqueda_final = f"{busqueda} {dependencia}"
    elif dependencia:
        busqueda_final = dependencia

    docs = await crud_documento.list_documentos(
        db,
        cliente_id=cliente_id,
        flujo="recibido",
        busqueda=busqueda_final,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        skip=0,
        limit=10000,
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Oficios Recibidos"

    # Estilos
    guinda_fill = PatternFill("solid", fgColor="911A3A")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    center = Alignment(horizontal="center", vertical="center")
    wrap = Alignment(vertical="top", wrap_text=True)
    thin = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )
    alt_fill = PatternFill("solid", fgColor="FDF2F4")

    # Título
    ws.merge_cells("A1:I1")
    title_cell = ws["A1"]
    title_cell.value = "Control de Oficios Recibidos — PIGOP"
    title_cell.font = Font(bold=True, size=14, color="911A3A")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    # Subtítulo con rango de fechas
    ws.merge_cells("A2:I2")
    rango = "Todos los registros"
    if fecha_desde and fecha_hasta:
        rango = f"Del {fecha_desde} al {fecha_hasta}"
    elif fecha_desde:
        rango = f"Desde {fecha_desde}"
    elif fecha_hasta:
        rango = f"Hasta {fecha_hasta}"
    ws["A2"].value = rango
    ws["A2"].font = Font(italic=True, size=9, color="666666")
    ws["A2"].alignment = Alignment(horizontal="center")

    # Encabezados
    columns = [
        ("Folio", 8),
        ("No. Oficio", 28),
        ("Asunto", 40),
        ("Remitente", 25),
        ("Dependencia", 30),
        ("Estado", 14),
        ("Prioridad", 12),
        ("Fecha Oficio", 14),
        ("Fecha Recibido", 14),
    ]

    header_row = 4
    for col_idx, (col_name, width) in enumerate(columns, start=1):
        cell = ws.cell(row=header_row, column=col_idx, value=col_name)
        cell.fill = guinda_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = thin
        ws.column_dimensions[cell.column_letter].width = width

    # Datos
    for row_idx, doc in enumerate(docs, start=header_row + 1):
        folio = row_idx - header_row
        values = [
            folio,
            doc.numero_oficio_origen or "",
            doc.asunto or "",
            doc.remitente_nombre or "",
            doc.remitente_dependencia or doc.dependencia_origen or "",
            doc.estado or "",
            doc.prioridad or "normal",
            doc.fecha_documento or "",
            doc.fecha_recibido or "",
        ]
        for col_idx, val in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = thin
            cell.alignment = wrap
            if (row_idx - header_row) % 2 == 0:
                cell.fill = alt_fill

    # Footer
    footer_row = header_row + len(docs) + 2
    ws.merge_cells(f"A{footer_row}:I{footer_row}")
    ws[f"A{footer_row}"].value = f"Total de oficios: {len(docs)}"
    ws[f"A{footer_row}"].font = Font(bold=True, size=10, color="911A3A")

    # Serializar
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    filename = "PIGOP_Control_Oficios"
    if fecha_desde:
        filename += f"_{fecha_desde}"
    if fecha_hasta:
        filename += f"_{fecha_hasta}"
    filename += ".xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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
    db: AsyncSession = Depends(get_db),
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

    # ── Detección de duplicados (Punto 10) ──
    numero_oficio_detectado = (resultado["datos_extraidos"] or {}).get("numero_oficio")
    duplicado_encontrado = None
    if numero_oficio_detectado:
        from sqlalchemy import select, func
        from app.models.documento import DocumentoOficial
        cid = str(current_user.cliente_id) if current_user.cliente_id else None
        stmt = select(DocumentoOficial.id, DocumentoOficial.numero_oficio_origen, DocumentoOficial.asunto, DocumentoOficial.fecha_documento).where(
            func.lower(DocumentoOficial.numero_oficio_origen) == numero_oficio_detectado.lower()
        )
        if cid:
            stmt = stmt.where(DocumentoOficial.cliente_id == cid)
        from app.core.database import get_db as _gdb
        dup_result = await db.execute(stmt)
        dup_row = dup_result.first()
        if dup_row:
            duplicado_encontrado = {
                "id": dup_row[0],
                "numero_oficio": dup_row[1],
                "asunto": dup_row[2],
                "fecha": dup_row[3],
            }

    msg = "Datos extraídos correctamente. Revise y confirme."
    if duplicado_encontrado:
        msg = f"⚠️ POSIBLE DUPLICADO: Ya existe un oficio con número '{numero_oficio_detectado}' registrado en el sistema."

    return PreviewOCRResponse(
        datos_extraidos=resultado["datos_extraidos"],
        clasificacion=resultado["clasificacion"],
        fecha_limite=resultado["fecha_limite"],
        archivo={
            "nombre_archivo": file.filename or filename,
            "url_storage": filepath,
            "mime_type": file.content_type or "application/octet-stream",
        },
        message=msg,
        prioridad_sugerida=resultado.get("prioridad_sugerida", "normal"),
        duplicado=duplicado_encontrado,
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

    # Regla operativa: si requiere_respuesta=True, no se puede pasar a de_conocimiento
    if nuevo_estado == "de_conocimiento" and doc.requiere_respuesta:
        raise BusinessError(
            "Este oficio requiere respuesta obligatoria. "
            "No puede marcarse como 'De conocimiento'. "
            "Debe atenderse: En atención → Respondido → Firmado."
        )

    updated = await crud_documento.update(db, db_obj=doc, obj_in={"estado": nuevo_estado})
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Acuse de conocimiento --------------------------------------------

@router.post(
    "/{doc_id}/acusar-conocimiento",
    response_model=DocumentoResponse,
    summary="Marcar documento de conocimiento como atendido",
)
async def acusar_conocimiento(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    if doc.estado != "de_conocimiento":
        raise BusinessError("Solo documentos con estado 'de_conocimiento' pueden acusarse como atendidos.")
    area_nombre = doc.area_turno_nombre or "Sin área asignada"
    await crud_documento.acusar_conocimiento(
        db, db_obj=doc, usuario_id=str(current_user.id), area_nombre=area_nombre,
    )
    return await crud_documento.get_with_relations(db, doc.id)


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
    """Director, Secretaría o superadmin pueden confirmar el turno."""
    if current_user.rol in ("consulta", "analista"):
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
        instrucciones=data.instrucciones,
    )
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Cambiar turno (re-turnar) -----------------------------------------

@router.post(
    "/{doc_id}/cambiar-turno",
    response_model=DocumentoResponse,
    summary="Cambiar área de turno de un documento ya turnado",
)
async def cambiar_turno(
    doc_id: str,
    data: ConfirmarTurnoInput,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Secretaría, Director o superadmin pueden re-turnar un documento ya asignado."""
    if current_user.rol in ("consulta", "analista"):
        raise ForbiddenError("No tienes permisos para cambiar el turno.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    if data.area_codigo not in AREAS_DPP:
        raise BusinessError(
            f"Área inválida '{data.area_codigo}'. Válidas: {', '.join(AREAS_DPP.keys())}"
        )

    # Registrar en historial el cambio de turno
    from app.models.documento import HistorialDocumento
    import uuid as _uuid
    historial = HistorialDocumento(
        id=str(_uuid.uuid4()),
        documento_id=doc.id,
        usuario_id=str(current_user.id),
        tipo_accion="cambio_turno",
        estado_anterior=doc.estado,
        estado_nuevo="turnado",
        observaciones=f"Cambio de turno: {doc.area_turno_nombre or '(sin área)'} → {AREAS_DPP[data.area_codigo]['nombre']}. {data.instrucciones or ''}",
        version=doc.version or 1,
    )
    db.add(historial)

    area_info = AREAS_DPP[data.area_codigo]
    updated = await crud_documento.confirmar_turno(
        db,
        db_obj=doc,
        area_codigo=data.area_codigo,
        area_nombre=data.area_nombre or area_info["nombre"],
        turnado_por_id=str(current_user.id),
        instrucciones=data.instrucciones,
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

    # Contenido de referencia cargado por el usuario (tabla, borrador previo, etc.)
    contenido_ref = doc.contenido_referencia or ""

    # Leer archivo de referencia como bytes para envío multimodal a Gemini
    # NOTA: Solo enviar bytes para tipos que Gemini soporta como multimodal
    # (imágenes y PDF). Para .docx/.xlsx/.csv/.txt usamos el texto extraído
    # que ya está en contenido_referencia.
    ref_bytes: bytes | None = None
    ref_mime: str = ""
    # MIME types que Gemini acepta como entrada multimodal
    GEMINI_MULTIMODAL_MIMES = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
        ".webp": "image/webp",
    }
    if doc.referencia_archivo_url and os.path.exists(doc.referencia_archivo_url):
        nombre = (doc.referencia_archivo_nombre or "").lower()
        # Buscar extensión soportada por Gemini multimodal
        ext = os.path.splitext(nombre)[1]
        if ext in GEMINI_MULTIMODAL_MIMES:
            try:
                with open(doc.referencia_archivo_url, "rb") as rf:
                    ref_bytes = rf.read()
                ref_mime = GEMINI_MULTIMODAL_MIMES[ext]
            except Exception as e:
                logger.warning(f"No se pudo leer archivo de referencia: {e}")
                ref_bytes = None
        else:
            # Para .docx, .xlsx, .csv, .txt etc. → usar solo texto extraído
            # (ya está en contenido_ref desde el proceso de carga)
            logger.info(f"Archivo referencia '{nombre}' no es multimodal Gemini, usando texto extraído.")

    if doc.flujo == "emitido":
        borrador = await correspondencia_service.generar_borrador_emitido(
            asunto=doc.asunto,
            destinatario=doc.dependencia_destino or "",
            dependencia_destino=doc.dependencia_destino or "",
            area_codigo=doc.area_turno or "DIR",
            instrucciones=instrucciones,
            contenido_referencia=contenido_ref,
            referencia_archivo_bytes=ref_bytes,
            referencia_mime_type=ref_mime,
        )
    else:
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
            contenido_referencia=contenido_ref,
            referencia_archivo_bytes=ref_bytes,
            referencia_mime_type=ref_mime,
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


# ---------- Cargar documento de referencia para IA --------------------------

@router.post(
    "/{doc_id}/cargar-referencia",
    response_model=DocumentoResponse,
    summary="Subir documento de referencia (tabla, respuesta borrador, info adicional) para enriquecer la generación IA",
)
async def cargar_referencia(
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

    # Guardar archivo
    ext = os.path.splitext(file.filename or "ref.pdf")[1]
    filename = f"ref_{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Extraer texto del documento de referencia
    texto_extraido = ""
    mime = file.content_type or ""

    if mime.startswith("image/") or mime == "image/tiff":
        # Usar Gemini Vision para extraer texto de imagen
        try:
            from app.services.gemini_service import gemini_service
            if gemini_service.available:
                texto_extraido = await gemini_service.extract_text_from_image(content, mime)
            else:
                texto_extraido = "[OCR no disponible — Gemini no configurado]"
        except Exception as e:
            logger.warning(f"Error OCR referencia: {e}")
            texto_extraido = f"[Error al extraer texto de imagen: {e}]"

    elif mime == "application/pdf":
        # Extraer texto de PDF
        try:
            import io
            try:
                import PyPDF2
                reader = PyPDF2.PdfReader(io.BytesIO(content))
                texto_extraido = "\n".join(page.extract_text() or "" for page in reader.pages)
            except ImportError:
                try:
                    import fitz  # PyMuPDF
                    pdf_doc = fitz.open(stream=content, filetype="pdf")
                    texto_extraido = "\n".join(page.get_text() for page in pdf_doc)
                except ImportError:
                    texto_extraido = "[Instalar PyPDF2 o PyMuPDF para extraer texto de PDF]"
        except Exception as e:
            texto_extraido = f"[Error al leer PDF: {e}]"

    elif mime in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  "application/msword"):
        # Extraer texto de Word — incluyendo tablas
        try:
            import io
            import docx
            doc_word = docx.Document(io.BytesIO(content))
            parts = []
            # Iterar sobre el body en orden (párrafos y tablas intercalados)
            for element in doc_word.element.body:
                if element.tag.endswith('}p'):
                    # Es un párrafo
                    from docx.oxml.ns import qn
                    texts = [node.text or "" for node in element.iter(qn('w:t'))]
                    line = "".join(texts).strip()
                    if line:
                        parts.append(line)
                elif element.tag.endswith('}tbl'):
                    # Es una tabla — extraer preservando estructura
                    from docx.table import Table as DocxTable
                    table = DocxTable(element, doc_word)
                    parts.append("\n[TABLA]")
                    for row in table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        parts.append(" | ".join(cells))
                    parts.append("[/TABLA]\n")
            texto_extraido = "\n".join(parts)
        except ImportError:
            texto_extraido = "[Instalar python-docx para extraer texto de Word]"
        except Exception as e:
            texto_extraido = f"[Error al leer DOCX: {e}]"

    elif mime in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  "application/vnd.ms-excel"):
        # Extraer texto de Excel
        try:
            import io
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
            rows = []
            for ws in wb.worksheets:
                rows.append(f"=== Hoja: {ws.title} ===")
                for row in ws.iter_rows(values_only=True):
                    vals = [str(c) if c is not None else "" for c in row]
                    if any(v.strip() for v in vals):
                        rows.append(" | ".join(vals))
            texto_extraido = "\n".join(rows)
        except ImportError:
            texto_extraido = "[Instalar openpyxl para extraer texto de Excel]"
        except Exception as e:
            texto_extraido = f"[Error al leer Excel: {e}]"

    else:
        # Texto plano o formato desconocido — intentar decodificar
        try:
            texto_extraido = content.decode("utf-8", errors="replace")[:50000]
        except Exception:
            texto_extraido = "[Formato no soportado para extracción de texto]"

    # Guardar en el documento
    updated = await crud_documento.update(db, db_obj=doc, obj_in={
        "referencia_archivo_nombre": file.filename or filename,
        "referencia_archivo_url": filepath,
        "contenido_referencia": texto_extraido[:100000],  # limitar a 100k chars
    })
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Eliminar referencia cargada ------------------------------------

@router.delete(
    "/{doc_id}/referencia",
    response_model=DocumentoResponse,
    summary="Eliminar documento de referencia",
)
async def eliminar_referencia(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    updated = await crud_documento.update(db, db_obj=doc, obj_in={
        "referencia_archivo_nombre": None,
        "referencia_archivo_url": None,
        "contenido_referencia": None,
    })
    return await crud_documento.get_with_relations(db, updated.id)


# ---------- Cargar tabla para insertar en DOCX (imagen o Excel) ------------

def _extract_excel_table(content: bytes) -> list[list[str]]:
    """Extrae datos de un archivo Excel como lista de filas (listas de strings)."""
    import openpyxl
    from io import BytesIO
    wb = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        return []
    rows: list[list[str]] = []
    for row in ws.iter_rows(values_only=True):
        # Ignorar filas completamente vacías
        if all(c is None for c in row):
            continue
        rows.append([str(c) if c is not None else "" for c in row])
    wb.close()
    return rows


ALLOWED_IMAGE_MIMES = ("image/png", "image/jpeg", "image/jpg", "image/webp")
ALLOWED_EXCEL_MIMES = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
)


@router.post(
    "/{doc_id}/tabla-imagen",
    response_model=DocumentoResponse,
    summary="Subir tabla para insertar en el oficio DOCX (imagen PNG/JPG/WEBP o Excel .xlsx)",
)
async def cargar_tabla_imagen(
    doc_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise BusinessError("El archivo no puede pesar más de 10 MB.")

    fname = file.filename or "archivo"
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    is_excel = file.content_type in ALLOWED_EXCEL_MIMES or ext in ("xlsx", "xls")
    is_image = file.content_type in ALLOWED_IMAGE_MIMES or ext in ("png", "jpg", "jpeg", "webp")

    if not is_excel and not is_image:
        raise BusinessError(
            f"Formato no soportado ({file.content_type}). "
            "Usa imágenes (PNG, JPG, WEBP) o archivos Excel (.xlsx)."
        )

    update_data: dict = {}

    if is_excel:
        # Extraer datos del Excel como tabla estructurada
        try:
            table_data = _extract_excel_table(content)
        except Exception as exc:
            raise BusinessError(f"No se pudo leer el archivo Excel: {exc}")
        if not table_data:
            raise BusinessError("El archivo Excel está vacío o no tiene datos.")
        update_data["tabla_datos_json"] = table_data
        update_data["tabla_imagen_url"] = None  # limpiar imagen si había
        update_data["tabla_imagen_nombre"] = fname
    else:
        # Guardar imagen
        os.makedirs("uploads/tablas", exist_ok=True)
        img_filename = f"tabla_{doc_id}.{ext or 'png'}"
        filepath = f"uploads/tablas/{img_filename}"
        with open(filepath, "wb") as f:
            f.write(content)
        update_data["tabla_imagen_url"] = filepath
        update_data["tabla_imagen_nombre"] = fname
        update_data["tabla_datos_json"] = None  # limpiar datos Excel si había

    updated = await crud_documento.update(db, db_obj=doc, obj_in=update_data)
    return await crud_documento.get_with_relations(db, updated.id)


@router.delete(
    "/{doc_id}/tabla-imagen",
    response_model=DocumentoResponse,
    summary="Eliminar tabla (imagen o datos Excel)",
)
async def eliminar_tabla_imagen(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    updated = await crud_documento.update(db, db_obj=doc, obj_in={
        "tabla_imagen_url": None,
        "tabla_imagen_nombre": None,
        "tabla_datos_json": None,
    })
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

    # Formatear fecha — usar fecha guardada si existe, si no usar hoy
    from app.services.oficio_generator_service import MESES_ES
    if doc.fecha_respuesta:
        fecha_str = doc.fecha_respuesta
    else:
        hoy = date.today()
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

    # --- Determinar destinatario según flujo ---
    if doc.flujo == "emitido":
        # Evitar duplicación: si solo hay dependencia_destino, usarla como dependencia
        # y dejar nombre/cargo vacíos en lugar de repetir el mismo valor
        datos_ia = doc.datos_extraidos_ia or {}
        dest_nombre = datos_ia.get("destinatario_nombre") or doc.dependencia_destino or "---"
        dest_cargo = datos_ia.get("destinatario_cargo") or ""
        dest_dep = doc.dependencia_destino or ""
        # Si nombre es igual a dependencia, limpiar para no duplicar
        if dest_nombre == dest_dep:
            dest_dep = ""
    else:
        dest_nombre = doc.remitente_nombre or "---"
        dest_cargo = doc.remitente_cargo or "---"
        dest_dep = doc.remitente_dependencia or "---"

    # --- Determinar copias estándar según área ---
    area_codigo = doc.area_turno or "DIR"
    plantilla = detectar_plantilla(doc.asunto or "", "")
    if plantilla:
        copias_doc = obtener_copias(plantilla.get("copias", "presupuestales"))
    else:
        # Áreas de subdirección → presupuestales; DIR → administrativas
        copias_doc = obtener_copias(
            "administrativas" if area_codigo == "DIR" else "presupuestales"
        )

    # Tabla: imagen o datos Excel extraídos
    tabla_img = doc.tabla_imagen_url if hasattr(doc, 'tabla_imagen_url') and doc.tabla_imagen_url and os.path.exists(doc.tabla_imagen_url) else None
    tabla_datos = doc.tabla_datos_json if hasattr(doc, 'tabla_datos_json') else None

    docx_bytes = oficio_generator.generar_oficio_respuesta(
        folio_respuesta=doc.folio_respuesta or "SFA/SF/DPP/____/2026",
        fecha_respuesta=fecha_str,
        destinatario_nombre=dest_nombre,
        destinatario_cargo=dest_cargo,
        destinatario_dependencia=dest_dep,
        seccion_fundamento=secciones.get("fundamento", ""),
        seccion_referencia=secciones.get("referencia", ""),
        seccion_objeto=secciones.get("objeto", ""),
        seccion_cierre=secciones.get("cierre", ""),
        firmante_nombre="Mtro. Marco Antonio Flores Mejía",
        firmante_cargo="Director de Programación y Presupuesto",
        referencia_elaboro=doc.referencia_elaboro,
        referencia_reviso=doc.referencia_reviso,
        copias=copias_doc,
        incluir_firma_visual=bool(doc.firmado_digitalmente),
        sello_digital_data=sello_data,
        asunto=doc.asunto,
        tabla_imagen_path=tabla_img,
        tabla_datos_json=tabla_datos,
    )

    import io
    folio_safe = (doc.folio_respuesta or "oficio").replace("/", "_")
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="oficio_{folio_safe}.docx"'},
    )


# ---------- Señal de módulo externo (certificaciones, etc.) -------------------

@router.post(
    "/{doc_id}/modulo-externo",
    response_model=DocumentoResponse,
    summary="Recibir señal de módulo externo (certificaciones) para actualizar estado",
)
async def señal_modulo_externo(
    doc_id: str,
    estado: str = Query(..., description="Estado a establecer (ej: 'firmado')"),
    referencia: str = Query("", description="Referencia del módulo externo (ej: folio certificación)"),
    modulo: str = Query("certificaciones", description="Nombre del módulo origen"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Permite que otro módulo (certificaciones presupuestales, minutas)
    actualice el estado de un documento en gestión documental.
    Ejemplo: certificación atendida → documento pasa a 'firmado'.
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden enviar señales entre módulos.")

    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))

    updated = await crud_documento.update(db, db_obj=doc, obj_in={
        "estado": estado,
        "modulo_externo_estado": f"atendido_{modulo}",
        "modulo_externo_ref": referencia,
    })
    return await crud_documento.get_with_relations(db, updated.id)


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

    if doc.estado not in ("en_atencion", "respondido"):
        raise BusinessError(
            f"Solo documentos 'en_atencion' o 'respondido' pueden devolverse. Estado actual: {doc.estado}"
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
    # Estados válidos para firma: cualquier estado con borrador listo
    estados_firmables = ("en_atencion", "respondido", "borrador", "en_revision", "turnado")
    if doc.estado not in estados_firmables:
        raise BusinessError(
            f"El documento debe estar en un estado válido para firmarse. Estado actual: {doc.estado}"
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

    # Auto-generar folio si no tiene
    if not doc.folio_respuesta:
        from datetime import datetime as dt_
        from sqlalchemy import text as sql_text

        anio_ = dt_.now().year
        area_ = (doc.area_turno or "DIR").upper()
        prefijo_ = PREFIJOS_FOLIO.get(area_, "SFA/SF/DPP")
        pattern_ = f"{prefijo_}/%/{anio_}"

        result_ = await db.execute(
            sql_text(
                "SELECT folio_respuesta FROM documentos_oficiales "
                "WHERE folio_respuesta LIKE :pattern "
                "ORDER BY folio_respuesta DESC LIMIT 1"
            ),
            {"pattern": pattern_},
        )
        row_ = result_.first()
        next_num_ = 1
        if row_ and row_[0]:
            try:
                parts_ = row_[0].split("/")
                next_num_ = int(parts_[-2]) + 1
            except (ValueError, IndexError):
                pass

        folio_auto = f"{prefijo_}/{str(next_num_).zfill(4)}/{anio_}"
        doc.folio_respuesta = folio_auto
        await db.flush()

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

    # Actualizar en BD — recibidos pasan a "firmado", emitidos a "vigente"
    estado_final = "firmado" if doc.flujo == "recibido" else "vigente"
    update_data = DocumentoUpdate(
        firmado_digitalmente=True,
        firma_metadata=firma_result,
        estado=estado_final,
    )
    await crud_documento.actualizar_documento(db, db_obj=doc, obj_in=update_data)

    # Registrar en historial
    await crud_documento.registrar_firma_historial(
        db,
        documento_id=doc.id,
        usuario_id=usuario_id,
        version=doc.version or 1,
        estado_anterior=doc.estado,
        estado_nuevo=estado_final,
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

    # Fecha — usar fecha guardada si existe, si no usar hoy
    if doc.fecha_respuesta:
        fecha_str = doc.fecha_respuesta
    else:
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

    # --- Determinar destinatario según flujo ---
    if doc.flujo == "emitido":
        pdf_dest_nombre = doc.dependencia_destino or "---"
        pdf_dest_cargo = "---"
        pdf_dest_dep = doc.dependencia_destino or "---"
    else:
        pdf_dest_nombre = doc.remitente_nombre or "---"
        pdf_dest_cargo = doc.remitente_cargo or "---"
        pdf_dest_dep = doc.remitente_dependencia or "---"

    # --- Determinar copias estándar según área ---
    pdf_area = doc.area_turno or "DIR"
    pdf_plantilla = detectar_plantilla(doc.asunto or "", "")
    if pdf_plantilla:
        pdf_copias = obtener_copias(pdf_plantilla.get("copias", "presupuestales"))
    else:
        pdf_copias = obtener_copias(
            "administrativas" if pdf_area == "DIR" else "presupuestales"
        )

    pdf_bytes = oficio_pdf_service.generar_oficio_pdf(
        folio_respuesta=doc.folio_respuesta or "SFA/SF/DPP/____/2026",
        fecha_respuesta=fecha_str,
        destinatario_nombre=pdf_dest_nombre,
        destinatario_cargo=pdf_dest_cargo,
        destinatario_dependencia=pdf_dest_dep,
        seccion_fundamento=secciones.get("fundamento", ""),
        seccion_referencia=secciones.get("referencia", ""),
        seccion_objeto=secciones.get("objeto", ""),
        seccion_cierre=secciones.get("cierre", ""),
        firmante_nombre="Mtro. Marco Antonio Flores Mejía",
        firmante_cargo="Director de Programación y Presupuesto",
        referencia_elaboro=doc.referencia_elaboro,
        referencia_reviso=doc.referencia_reviso,
        copias=pdf_copias,
        incluir_firma_visual=bool(doc.firmado_digitalmente),
        sello_digital_data=sello_data,
        asunto=doc.asunto,
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
    confirmar: str = Query("no", description="Debe enviar 'si' para confirmar eliminación"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    # Solo secretaría y admin pueden eliminar
    if current_user.rol not in ("secretaria", "admin_cliente", "superadmin"):
        raise ForbiddenError("Solo Secretaría y Administrador pueden eliminar documentos.")
    if confirmar != "si":
        raise BusinessError("Debe confirmar la eliminación enviando confirmar='si'.")
    doc = await crud_documento.get(db, doc_id)
    if not doc:
        raise NotFoundError("Documento no encontrado.")
    _assert_acceso(current_user, str(doc.cliente_id))
    await crud_documento.delete(db, id=doc_id)
    return {"message": "Documento eliminado correctamente.", "success": True}
