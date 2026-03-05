import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class DocumentoOficial(Base):
    """
    Documento oficial institucional de la DPP.

    Flujo RECIBIDO:
      recibido → turnado → en_atencion → respondido → archivado
                                │  ↑
                                ▼  │
                            devuelto  (corregir, reenviar)

    Flujo EMITIDO (circulares, oficios de la DPP hacia exterior):
      borrador → vigente → archivado
    """

    __tablename__ = "documentos_oficiales"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=False)

    # ── Tipo de flujo ─────────────────────────────────────────────────────────
    # "recibido" = oficio que llega a la DPP (flujo completo OCR→turno→respuesta)
    # "emitido"  = documento que genera/emite la DPP
    flujo = Column(String(20), default="emitido", nullable=False, index=True)

    # ── Identificación del documento ──────────────────────────────────────────
    numero_control = Column(String(100), nullable=True)   # DPP/OFICIO/00001/2026 (emitidos)
    numero_oficio_origen = Column(String(150), nullable=True)  # SCOP/DA/E0167/2026 (recibidos)
    tipo = Column(String(50), nullable=False)             # oficio|circular|memorandum|etc.
    asunto = Column(String(500), nullable=False)

    # ── Remitente (para recibidos) ────────────────────────────────────────────
    remitente_nombre = Column(String(200), nullable=True)
    remitente_cargo  = Column(String(200), nullable=True)
    remitente_dependencia = Column(String(200), nullable=True)

    # ── Destinatario / dependencias (para emitidos) ───────────────────────────
    dependencia_origen  = Column(String(200), nullable=True)
    dependencia_destino = Column(String(200), nullable=True)

    # ── Fechas ────────────────────────────────────────────────────────────────
    fecha_documento = Column(String(10), nullable=True)   # YYYY-MM-DD (fecha del doc)
    fecha_recibido  = Column(String(10), nullable=True)   # cuándo llegó físicamente a DPP
    fecha_limite    = Column(String(10), nullable=True)   # plazo de atención (días hábiles)

    # ── Prioridad / urgencia (manual, ya que llega anotado a lápiz/post-it) ──
    # "normal" | "urgente" | "muy_urgente"
    prioridad = Column(String(20), default="normal", nullable=False)

    # ── Estado ───────────────────────────────────────────────────────────────
    # Recibidos:  recibido | turnado | en_atencion | devuelto | respondido | archivado
    # Emitidos:   borrador | vigente | archivado
    estado = Column(String(30), default="borrador", nullable=False, index=True)

    # ── Descripción / notas adicionales ──────────────────────────────────────
    descripcion = Column(Text, nullable=True)

    # ── Archivo adjunto (scan/foto del oficio o PDF emitido) ──────────────────
    nombre_archivo = Column(String(255), nullable=True)
    url_storage    = Column(Text, nullable=True)
    mime_type      = Column(String(100), nullable=True)

    # ── Etiquetas ─────────────────────────────────────────────────────────────
    tags = Column(JSON, nullable=True)

    # ── OCR e IA (para recibidos) ─────────────────────────────────────────────
    texto_extraido_ocr  = Column(Text, nullable=True)      # texto bruto del OCR
    datos_extraidos_ia  = Column(JSON, nullable=True)      # JSON estructurado por Gemini
    ocr_procesado       = Column(Boolean, default=False)   # si ya se procesó con Gemini

    # ── Clasificación / turno IA ─────────────────────────────────────────────
    sugerencia_area_codigo  = Column(String(10),  nullable=True)   # "DREP", "DCP", etc.
    sugerencia_area_nombre  = Column(String(200), nullable=True)
    sugerencia_fundamento   = Column(Text, nullable=True)          # Art. 27 Fracc. XIV...
    sugerencia_plazo_dias   = Column(Integer, nullable=True)
    confianza_clasificacion = Column(Float, nullable=True)         # 0.0 – 1.0
    regla_turno_codigo      = Column(String(30), nullable=True)    # "TURNO-CERT"
    genera_tramite          = Column(String(50), nullable=True)    # "certificacion_presupuestal"

    # ── Turno confirmado por el usuario ───────────────────────────────────────
    area_turno          = Column(String(10),  nullable=True)   # código confirmado
    area_turno_nombre   = Column(String(200), nullable=True)
    area_turno_confirmada = Column(Boolean, default=False)
    turnado_por_id      = Column(String(36), ForeignKey("usuarios.id"), nullable=True)
    turnado_en          = Column(DateTime(timezone=True), nullable=True)

    # ── Borrador de respuesta ─────────────────────────────────────────────────
    borrador_respuesta = Column(Text, nullable=True)           # texto del borrador
    folio_respuesta    = Column(String(100), nullable=True)    # DPP/OFICIO/00001/2026
    # Referencia interna: MAFM/iniciales_elaboro/iniciales_reviso
    referencia_elaboro  = Column(String(50), nullable=True)    # "maca"
    referencia_reviso   = Column(String(50), nullable=True)    # "beos"

    # Asignación de responsables (quién atiende dentro de DPP)
    upp_solicitante          = Column(String(20),  nullable=True)   # "016" — extraída del OCR
    termino_contestacion     = Column(String(150), nullable=True)   # "N/A" | "3 días hábiles" | fecha
    subdirector_nombre       = Column(String(200), nullable=True)   # nombre subdirector asignado
    jefe_departamento_nombre = Column(String(200), nullable=True)   # nombre jefe depto asignado

    # ── Devolución y versionamiento ─────────────────────────────────────────
    version            = Column(Integer, default=1, nullable=False)
    devuelto_por_id    = Column(String(36), ForeignKey("usuarios.id"), nullable=True)
    devuelto_en        = Column(DateTime(timezone=True), nullable=True)
    motivo_devolucion  = Column(Text, nullable=True)   # razón más reciente

    # Firma electrónica avanzada (e.firma / FIEL)
    firmado_digitalmente = Column(Boolean, default=False)
    firma_metadata       = Column(JSON, nullable=True)
    # firma_metadata stores: {rfc, nombre_firmante, numero_certificado,
    #   valido_desde, valido_hasta, algoritmo, cadena_original, sello_digital, fecha_firma}

    # ── Vinculación con otros módulos ─────────────────────────────────────────
    certificacion_id = Column(String(36), nullable=True)   # FK futuro a Certificaciones

    # ── Auditoría ────────────────────────────────────────────────────────────
    creado_por_id  = Column(String(36), ForeignKey("usuarios.id"), nullable=True)
    creado_en      = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("idx_doc_cliente_flujo",   "cliente_id", "flujo"),
        Index("idx_doc_estado",          "estado"),
        Index("idx_doc_prioridad",       "prioridad"),
        Index("idx_doc_area_turno",      "area_turno"),
    )

    # Relaciones
    cliente      = relationship("Cliente",  foreign_keys=[cliente_id])
    creado_por   = relationship("Usuario",  foreign_keys=[creado_por_id])
    turnado_por  = relationship("Usuario",  foreign_keys=[turnado_por_id])
    devuelto_por = relationship("Usuario",  foreign_keys=[devuelto_por_id])
    historial    = relationship(
        "HistorialDocumento",
        back_populates="documento",
        order_by="HistorialDocumento.timestamp.desc()",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def has_borrador(self) -> bool:
        """Indica si el documento tiene borrador de respuesta (para filtrar en listas)."""
        return bool(self.borrador_respuesta)

    def __repr__(self) -> str:
        ref = self.numero_oficio_origen or self.numero_control or self.id[:8]
        return f"<DocumentoOficial {self.flujo.upper()} {ref} ({self.estado})>"


class HistorialDocumento(Base):
    """
    Historial de acciones, devoluciones y observaciones sobre un documento.

    Cada entrada registra una acción significativa: devolución, reenvío,
    firma, cambio de estado, con snapshot del borrador para trazabilidad.
    """

    __tablename__ = "historial_documentos"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    documento_id = Column(
        String(36),
        ForeignKey("documentos_oficiales.id", ondelete="CASCADE"),
        nullable=False,
    )
    usuario_id = Column(String(36), ForeignKey("usuarios.id"), nullable=False)

    # devolucion | reenvio | firma | cambio_estado | observacion
    tipo_accion = Column(String(30), nullable=False)

    estado_anterior = Column(String(30), nullable=True)
    estado_nuevo    = Column(String(30), nullable=True)

    observaciones = Column(Text, nullable=False)

    # Versión del documento al momento de la acción
    version = Column(Integer, default=1, nullable=False)

    # Snapshot del borrador al momento (para historial de versiones)
    borrador_snapshot = Column(Text, nullable=True)

    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relaciones
    documento = relationship("DocumentoOficial", back_populates="historial")
    usuario   = relationship("Usuario")

    __table_args__ = (
        Index("idx_historial_doc", "documento_id"),
        Index("idx_historial_timestamp", "timestamp"),
    )
