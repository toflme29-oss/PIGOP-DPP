from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Documento adjunto ─────────────────────────────────────────────────────────

class DocumentoDEPPBase(BaseModel):
    tipo: str = Field(..., description="DEPP | CFDI | MCL | CTT | PCH | AUR | FUC | OTR")
    nombre_archivo: str
    mime_type: Optional[str] = None


class DocumentoDEPPCreate(DocumentoDEPPBase):
    pass


class DocumentoDEPPResponse(DocumentoDEPPBase):
    id: str
    depp_id: str
    url_storage: Optional[str] = None
    tamanio_bytes: Optional[int] = None
    datos_extraidos: Optional[Dict[str, Any]] = None
    texto_extraido: Optional[str] = None
    validado: bool
    subido_en: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Validación ────────────────────────────────────────────────────────────────

class ValidacionResultSchema(BaseModel):
    """Resultado de una validación ejecutada sobre un DEPP."""

    id: str
    tipo_validacion: str
    resultado: str                          # "exitosa" | "advertencia" | "error"
    gravedad: Optional[str] = None          # "critico" | "alto" | "medio" | "bajo"
    articulo_manual: Optional[str] = None
    descripcion_regla: Optional[str] = None
    mensaje: Optional[str] = None
    detalles: Optional[Dict[str, Any]] = None
    ejecutada_en: Optional[datetime] = None
    ejecutada_por: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ── DEPP ──────────────────────────────────────────────────────────────────────

class DEPPBase(BaseModel):
    folio: str = Field(..., min_length=1, max_length=100)
    expediente_id: Optional[str] = Field(None, max_length=25)
    upp: str = Field(..., max_length=10)
    ejercicio: int = Field(..., ge=2020, le=2050)
    mes: Optional[int] = Field(None, ge=1, le=12)

    # Tipo DEPP
    tipo_depp: Optional[str] = None           # "PAGO" | "NO_PAGO"

    # Clasificación presupuestal
    clasificador_tipo: Optional[str] = None   # Normativa: "I.1", "II.1"…
    clasificador_sap: Optional[str] = None    # Clasif. SAP: "21111"
    capitulo: Optional[int] = None
    concepto: Optional[int] = None
    partida: Optional[int] = None
    partida_nombre: Optional[str] = None

    # Fuente de financiamiento
    fuente_financiamiento: Optional[str] = None  # código: "261528091"
    fuente_nombre: Optional[str] = None           # "FONDO GENERAL DE PARTICIPACIONES"
    programa: Optional[str] = None

    # Unidades
    ue: Optional[str] = None   # Unidad Ejecutora
    ur: Optional[str] = None   # Unidad Responsable

    # Montos
    monto_total: Optional[Decimal] = None
    monto_comprobado: Optional[Decimal] = None

    # Identificación beneficiario / pago
    beneficiario: Optional[str] = None
    clave_acreedor: Optional[str] = None       # clave SAP proveedor
    cuenta_abono: Optional[str] = None         # CLABE destino (PAGO)
    solicitud_numero: Optional[str] = None
    tipo_pago: Optional[str] = None            # legacy — usar tipo_depp
    clave_presupuestaria: Optional[str] = None
    provisional_vale: Optional[str] = None     # vale que regulariza (NO_PAGO)
    notas_aclaraciones: Optional[str] = None   # texto de notas del DEPP


class DEPPCreate(DEPPBase):
    cliente_id: str


class DEPPUpdate(BaseModel):
    estado: Optional[str] = None
    tipo_depp: Optional[str] = None
    monto_total: Optional[Decimal] = None
    beneficiario: Optional[str] = None
    clasificador_tipo: Optional[str] = None
    clasificador_sap: Optional[str] = None
    capitulo: Optional[int] = None
    concepto: Optional[int] = None
    partida: Optional[int] = None
    partida_nombre: Optional[str] = None
    fuente_financiamiento: Optional[str] = None
    fuente_nombre: Optional[str] = None
    programa: Optional[str] = None
    mes: Optional[int] = None
    tipo_pago: Optional[str] = None
    ue: Optional[str] = None
    ur: Optional[str] = None
    clave_presupuestaria: Optional[str] = None
    clave_acreedor: Optional[str] = None
    cuenta_abono: Optional[str] = None
    provisional_vale: Optional[str] = None
    notas_aclaraciones: Optional[str] = None


class DEPPResponse(DEPPBase):
    id: str
    cliente_id: str
    estado: str
    fecha_estado: datetime
    puede_aprobar: bool
    validado_automaticamente: bool
    fecha_validacion: Optional[datetime] = None
    documentos: List[DocumentoDEPPResponse] = []
    validaciones: List[ValidacionResultSchema] = []
    creado_en: datetime
    actualizado_en: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class DEPPListResponse(BaseModel):
    """Respuesta simplificada para listar DEPPs."""

    id: str
    folio: str
    upp: str
    ejercicio: int
    estado: str
    tipo_depp: Optional[str] = None
    clasificador_tipo: Optional[str] = None
    capitulo: Optional[int] = None
    monto_total: Optional[Decimal] = None
    beneficiario: Optional[str] = None
    puede_aprobar: bool
    validado_automaticamente: bool = False
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    """Respuesta al subir documentos a un DEPP."""

    depp_id: str
    documentos_subidos: int
    documentos: List[DocumentoDEPPResponse]
    clasificacion_detectada: Optional[str] = None
    mensaje: str
