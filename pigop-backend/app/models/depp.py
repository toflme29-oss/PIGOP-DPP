import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class DEPP(Base):
    """Documento de Ejecución Presupuestaria y Pago."""

    __tablename__ = "depps"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=False)

    # ── Identificación ──────────────────────────────────────────────────────────
    folio = Column(String(100), nullable=False)
    expediente_id = Column(String(25), nullable=True)
    upp = Column(String(10), nullable=False)
    ejercicio = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=True)

    # ── Tipo de DEPP (de cabecera del PDF) ──────────────────────────────────────
    # "PAGO"    → genera afectación presupuestal Y pago financiero
    # "NO_PAGO" → solo regularización presupuestal (comprobación de vale previo)
    tipo_depp = Column(String(10), nullable=True)          # "PAGO" | "NO_PAGO"

    # ── Clasificación presupuestal ───────────────────────────────────────────────
    clasificador_tipo = Column(String(50), nullable=True)  # Normativa: "I.1","II.1"…
    clasificador_sap  = Column(String(20), nullable=True)  # Clasif. SAP: "21111"
    capitulo = Column(Integer, nullable=True)
    concepto = Column(Integer, nullable=True)
    partida  = Column(Integer, nullable=True)
    partida_nombre = Column(String(255), nullable=True)

    # ── Fuente de financiamiento ─────────────────────────────────────────────────
    # La regla clave: UN DEPP nunca mezcla fuentes ni capítulos de gasto.
    fuente_financiamiento = Column(String(30), nullable=True)   # código: "261528091"
    fuente_nombre         = Column(String(120), nullable=True)  # "FONDO GRAL. DE PARTICIPACIONES"
    programa = Column(String(100), nullable=True)

    # ── Unidades ─────────────────────────────────────────────────────────────────
    ue = Column(String(40), nullable=True)   # Unidad Ejecutora: "25-04 DELEGACIÓN ADMIN."
    ur = Column(String(40), nullable=True)   # Unidad Responsable: "04"

    # ── Montos ───────────────────────────────────────────────────────────────────
    monto_total      = Column(Numeric(15, 2), nullable=True)
    monto_comprobado = Column(Numeric(15, 2), nullable=True)

    # ── Estado ───────────────────────────────────────────────────────────────────
    # Flujo: "en_revision" → "aprobado" | "rechazado"
    # Legacy: "en_tramite" (→en_revision), "observado" (→rechazado), "pagado" (→aprobado)
    estado      = Column(String(50), default="en_revision", index=True)
    fecha_estado = Column(DateTime(timezone=True), server_default=func.now())

    # ── Metadata extraída por IA/OCR del PDF DEPP ────────────────────────────────
    beneficiario      = Column(String(255), nullable=True)
    clave_acreedor    = Column(String(20), nullable=True)   # clave SAP del proveedor
    cuenta_abono      = Column(String(50), nullable=True)   # cuenta bancaria destino (PAGO)
    solicitud_numero  = Column(String(20), nullable=True)   # folio solicitud
    tipo_pago         = Column(String(50), nullable=True)   # legacy → usar tipo_depp
    clave_presupuestaria = Column(String(250), nullable=True)  # clave completa

    # Para DEPP NO_PAGO: vale/provisional que se regulariza
    provisional_vale  = Column(String(50), nullable=True)   # ej: "0913"

    # Notas y/o aclaraciones del DEPP (texto libre, importante para IA)
    notas_aclaraciones = Column(Text, nullable=True)

    # Validación
    validado_automaticamente = Column(Boolean, default=False)
    puede_aprobar = Column(Boolean, default=False)
    fecha_validacion = Column(DateTime(timezone=True), nullable=True)
    validado_por_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)

    # Auditoría
    creado_por_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("cliente_id", "folio", "ejercicio", name="uq_depp_folio"),
        Index("idx_depp_upp_ejercicio", "cliente_id", "upp", "ejercicio"),
    )

    # Relaciones
    cliente = relationship("Cliente", back_populates="depps")
    documentos = relationship(
        "DocumentoDEPP",
        back_populates="depp",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    validaciones = relationship(
        "ValidacionDEPP",
        back_populates="depp",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    creado_por = relationship("Usuario", foreign_keys=[creado_por_id])
    validado_por = relationship("Usuario", foreign_keys=[validado_por_id])

    def __repr__(self) -> str:
        return f"<DEPP {self.folio} {self.tipo_depp or ''} ({self.estado})>"

    @property
    def es_pago(self) -> bool:
        """True si el DEPP genera movimiento financiero (pago al proveedor)."""
        if self.tipo_depp:
            return self.tipo_depp.upper() == "PAGO"
        if self.tipo_pago:
            return "NO" not in self.tipo_pago.upper()
        return True  # default: asumir pago

    @property
    def es_no_pago(self) -> bool:
        """True si el DEPP es solo regularización presupuestal (sin pago)."""
        return not self.es_pago


class DocumentoDEPP(Base):
    """Documentos adjuntos al DEPP."""

    __tablename__ = "documentos_depp"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    depp_id = Column(
        String(36), ForeignKey("depps.id", ondelete="CASCADE"), nullable=False
    )

    # Tipo: "DEPP","CFDI","MCL","CTT","PCH","AUR","FUC","OTR"
    tipo = Column(String(50), nullable=False)
    nombre_archivo = Column(String(255), nullable=False)
    url_storage = Column(Text, nullable=True)      # Path local o GCS
    mime_type = Column(String(100), nullable=True)
    tamanio_bytes = Column(BigInteger, nullable=True)

    # Datos extraídos por IA/OCR
    datos_extraidos = Column(JSON, nullable=True)
    texto_extraido = Column(Text, nullable=True)

    # Validación
    validado = Column(Boolean, default=False)
    errores_validacion = Column(JSON, nullable=True)

    subido_en = Column(DateTime(timezone=True), server_default=func.now())
    subido_por_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)

    # Relaciones
    depp = relationship("DEPP", back_populates="documentos")
    subido_por = relationship("Usuario", foreign_keys=[subido_por_id])

    def __repr__(self) -> str:
        return f"<DocumentoDEPP {self.tipo} - {self.nombre_archivo}>"
