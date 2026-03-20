from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

# ── Catálogos ──────────────────────────────────────────────────────────────────
TIPOS_VALIDOS = [
    "oficio", "circular", "memorandum", "acuerdo",
    "convenio", "resolucion", "informe", "otro",
]
ESTADOS_RECIBIDO = ["recibido", "turnado", "en_atencion", "devuelto", "respondido", "firmado", "archivado", "de_conocimiento"]
ESTADOS_EMITIDO  = ["borrador", "en_revision", "vigente", "archivado"]
PRIORIDADES      = ["normal", "urgente", "muy_urgente"]
FLUJOS           = ["recibido", "emitido"]


# ── Schemas de creación ───────────────────────────────────────────────────────

class DocumentoRecibidoCreate(BaseModel):
    """Registro de un oficio recibido. Puede incluir datos de preview-ocr."""
    cliente_id: str
    tipo: str = Field("oficio", description="Tipo de documento")
    asunto: str = Field(..., min_length=3, max_length=500)
    numero_oficio_origen: Optional[str] = Field(None, max_length=150)
    remitente_nombre:      Optional[str] = Field(None, max_length=200)
    remitente_cargo:       Optional[str] = Field(None, max_length=200)
    remitente_dependencia: Optional[str] = Field(None, max_length=200)
    fecha_documento:  Optional[str] = None
    fecha_recibido:   Optional[str] = None
    prioridad:        Optional[str] = Field("normal")
    descripcion:      Optional[str] = None
    tags:             Optional[List[str]] = None
    requiere_respuesta: bool = True
    # ── Archivo pre-subido (desde preview-ocr) ──
    nombre_archivo: Optional[str] = None
    url_storage:    Optional[str] = None
    mime_type:      Optional[str] = None
    # ── Datos OCR pre-procesados (desde preview-ocr) ──
    datos_extraidos_ia:     Optional[dict] = None
    ocr_procesado:          bool = False
    sugerencia_area_codigo: Optional[str] = None
    sugerencia_area_nombre: Optional[str] = None
    sugerencia_fundamento:  Optional[str] = None
    sugerencia_plazo_dias:  Optional[int] = None
    confianza_clasificacion: Optional[float] = None
    regla_turno_codigo:     Optional[str] = None
    genera_tramite:         Optional[str] = None
    fecha_limite:           Optional[str] = None


class DocumentoEmitidoCreate(BaseModel):
    """Registro de un documento emitido por la DPP."""
    cliente_id: str
    tipo: str = Field(..., description=f"Uno de: {', '.join(TIPOS_VALIDOS)}")
    asunto: str = Field(..., min_length=3, max_length=500)
    numero_control:     Optional[str] = Field(None, max_length=100)
    dependencia_origen:  Optional[str] = Field(None, max_length=200)
    dependencia_destino: Optional[str] = Field(None, max_length=200)
    fecha_documento: Optional[str] = None
    estado:          Optional[str] = Field("borrador")
    descripcion:     Optional[str] = None
    referencia_elaboro: Optional[str] = Field(None, max_length=50)
    referencia_reviso:  Optional[str] = Field(None, max_length=50)
    area_turno:      Optional[str] = Field(None, max_length=10, description="Código del área de origen (DIR, SCG, SPF...)")
    area_turno_nombre: Optional[str] = Field(None, max_length=200, description="Nombre del área de origen")
    folio_respuesta: Optional[str] = Field(None, max_length=100, description="Folio institucional auto-generado")
    fecha_respuesta: Optional[str] = Field(None, max_length=50, description="Fecha del oficio de respuesta")
    tags: Optional[List[str]] = None


class DocumentoUpdate(BaseModel):
    asunto:             Optional[str] = Field(None, max_length=500)
    numero_control:     Optional[str] = Field(None, max_length=100)
    numero_oficio_origen: Optional[str] = Field(None, max_length=150)
    tipo:               Optional[str] = None
    remitente_nombre:   Optional[str] = Field(None, max_length=200)
    remitente_cargo:    Optional[str] = Field(None, max_length=200)
    remitente_dependencia: Optional[str] = Field(None, max_length=200)
    dependencia_origen:  Optional[str] = Field(None, max_length=200)
    dependencia_destino: Optional[str] = Field(None, max_length=200)
    fecha_documento:    Optional[str] = None
    fecha_recibido:     Optional[str] = None
    fecha_limite:       Optional[str] = None
    prioridad:          Optional[str] = None
    estado:             Optional[str] = None
    descripcion:        Optional[str] = None
    borrador_respuesta: Optional[str] = None
    folio_respuesta:    Optional[str] = Field(None, max_length=100)
    fecha_respuesta:    Optional[str] = Field(None, max_length=50)
    referencia_elaboro: Optional[str] = Field(None, max_length=50)
    referencia_reviso:  Optional[str] = Field(None, max_length=50)
    firmado_digitalmente: Optional[bool] = None
    firma_metadata:       Optional[dict] = None
    tags:               Optional[List[str]] = None


class ConfirmarTurnoInput(BaseModel):
    area_codigo: str = Field(..., description="Código del área (ej: DREP, DCP, DASP...)")
    area_nombre: Optional[str] = None
    instrucciones: Optional[str] = Field(None, max_length=2000, description="Instrucciones del Director al turnar")


# ── Schemas de respuesta ──────────────────────────────────────────────────────

class UsuarioInfo(BaseModel):
    id: str
    nombre_completo: str
    email: str
    model_config = {"from_attributes": True}


class DocumentoListResponse(BaseModel):
    id: str
    flujo: str
    numero_control:       Optional[str]
    numero_oficio_origen: Optional[str]
    tipo: str
    asunto: str
    remitente_nombre:      Optional[str]
    remitente_dependencia: Optional[str]
    dependencia_origen:    Optional[str]
    dependencia_destino:   Optional[str]
    fecha_documento:  Optional[str]
    fecha_recibido:   Optional[str]
    fecha_limite:     Optional[str]
    prioridad:        str
    estado:           str
    nombre_archivo:   Optional[str]
    ocr_procesado:    bool
    area_turno:       Optional[str]
    area_turno_nombre: Optional[str]
    area_turno_confirmada: bool
    genera_tramite:   Optional[str]
    instrucciones_turno: Optional[str] = None
    version:          int = 1
    motivo_devolucion: Optional[str] = None
    firmado_digitalmente: Optional[bool] = None
    requiere_respuesta: bool = True
    has_borrador:     bool = False
    tags:             Optional[List[str]]
    creado_en:        datetime
    model_config = {"from_attributes": True}


class DocumentoResponse(DocumentoListResponse):
    cliente_id:           str
    descripcion:          Optional[str]
    datos_extraidos_ia:   Optional[dict]
    sugerencia_area_codigo: Optional[str]
    sugerencia_area_nombre: Optional[str]
    sugerencia_fundamento:  Optional[str]
    sugerencia_plazo_dias:  Optional[int]
    confianza_clasificacion: Optional[float]
    regla_turno_codigo:   Optional[str]
    borrador_respuesta:   Optional[str]
    folio_respuesta:      Optional[str]
    fecha_respuesta:      Optional[str]
    referencia_elaboro:   Optional[str]
    referencia_reviso:    Optional[str]
    tabla_imagen_url:     Optional[str] = None
    tabla_imagen_nombre:  Optional[str] = None
    tabla_datos_json:     Optional[list] = None
    url_storage:          Optional[str]
    mime_type:            Optional[str]
    devuelto_por_id:      Optional[str] = None
    devuelto_en:          Optional[datetime] = None
    atendido_por_id:      Optional[str] = None
    atendido_en:          Optional[datetime] = None
    atendido_area:        Optional[str] = None
    referencia_archivo_nombre: Optional[str] = None
    referencia_archivo_url:    Optional[str] = None
    contenido_referencia:      Optional[str] = None
    firmado_digitalmente: Optional[bool] = None
    firma_metadata:       Optional[dict] = None
    actualizado_en:       Optional[datetime]
    creado_por:           Optional[UsuarioInfo]
    turnado_por:          Optional[UsuarioInfo]
    model_config = {"from_attributes": True}


class ProcesarOCRResponse(BaseModel):
    """Resultado del procesamiento OCR + clasificación."""
    datos_extraidos:  dict
    clasificacion:    dict
    fecha_limite:     str
    message:          str


class PreviewOCRResponse(BaseModel):
    """Resultado de preview-ocr: OCR + clasificación + info del archivo guardado."""
    datos_extraidos:  dict
    clasificacion:    dict
    fecha_limite:     str
    archivo:          dict   # {nombre_archivo, url_storage, mime_type}
    message:          str
    prioridad_sugerida: Optional[str] = "normal"  # normal | urgente | muy_urgente
    duplicado:        Optional[dict] = None        # {id, numero_oficio, asunto, fecha} si existe


class OficioEstructuradoResponse(BaseModel):
    """Resultado de generación de oficio con estructura jurídica de 4 secciones."""
    secciones: dict = Field(
        ...,
        description="Dict con keys: fundamento, referencia, objeto, cierre",
    )
    borrador_completo: str = Field(
        ...,
        description="Texto completo del borrador (las 4 secciones concatenadas)",
    )
    message: str


class FirmaResponse(BaseModel):
    """Resultado de aplicar firma institucional a un documento."""
    firmado_digitalmente: bool
    firma_metadata: dict
    message: str


# ── Schemas de devolución ────────────────────────────────────────────────────

class DevolucionInput(BaseModel):
    """Datos requeridos para devolver un documento al área responsable."""
    observaciones: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="Motivo detallado de la devolución. Obligatorio.",
    )


class ReenvioInput(BaseModel):
    """Datos opcionales al reenviar un documento corregido."""
    comentario: Optional[str] = Field(
        None,
        max_length=1000,
        description="Comentario sobre las correcciones realizadas.",
    )


class HistorialItemResponse(BaseModel):
    """Una entrada del historial de un documento."""
    id: str
    tipo_accion: str
    estado_anterior: Optional[str] = None
    estado_nuevo: Optional[str] = None
    observaciones: str
    version: int
    timestamp: datetime
    usuario_nombre: Optional[str] = None
    model_config = {"from_attributes": True}


class DevolucionResponse(BaseModel):
    """Resultado de devolver un documento."""
    documento_id: str
    estado: str
    historial_entry: HistorialItemResponse
    message: str


# ── Schemas de firma por lote ────────────────────────────────────────────────

class FirmaLoteInput(BaseModel):
    """IDs de documentos a firmar en lote."""
    documento_ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Lista de IDs de documentos a incluir en el lote de firma.",
    )


class CertificadoValidationResponse(BaseModel):
    """Resultado de validar un certificado .cer + .key."""
    valido: bool
    serial: Optional[str] = None
    rfc: str
    nombre: str
    valido_desde: Optional[str] = None
    valido_hasta: Optional[str] = None
    message: str


class LoteFirmaItemResponse(BaseModel):
    """Ítem individual dentro de un lote de firma."""
    id: str
    documento_id: str
    orden: int
    estado: str
    hash_documento: Optional[str] = None
    qr_data: Optional[str] = None
    error_mensaje: Optional[str] = None
    firmado_en: Optional[datetime] = None
    # Campos del documento para visualización
    asunto: Optional[str] = None
    numero_oficio_origen: Optional[str] = None
    folio_respuesta: Optional[str] = None
    model_config = {"from_attributes": True}


class LoteFirmaResponse(BaseModel):
    """Respuesta completa de un lote de firma."""
    id: str
    nombre: Optional[str] = None
    estado: str
    certificado_serial: Optional[str] = None
    certificado_rfc: Optional[str] = None
    certificado_nombre: Optional[str] = None
    total_documentos: int
    total_firmados: int
    total_errores: int
    progreso_pct: int
    items: List[LoteFirmaItemResponse]
    creado_en: datetime
    completado_en: Optional[datetime] = None
    model_config = {"from_attributes": True}


class FirmaLoteResultResponse(BaseModel):
    """Resultado final de la ejecución de firma por lote."""
    lote_firma: LoteFirmaResponse
    message: str
