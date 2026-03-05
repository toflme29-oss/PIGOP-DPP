"""
Modelos para el módulo de Firma Electrónica por Lote.

Flujo:
  Director/admin selecciona N documentos listos para firma (en_atencion + borrador).
  Sube certificado (.cer) y clave privada (.key) con contraseña FIEL.
  El sistema valida el certificado y firma todos los documentos en una sesión.
  Cada documento recibe: hash SHA-256, cadena original, sello digital, QR.

Estados del LoteFirma:
  preparando  → Creado, documentos seleccionados pero no firmados aún
  en_proceso  → El proceso de firma está ejecutándose
  completado  → Todos los ítems procesados (firmados o con error)
  error       → Error fatal en el lote (certificado inválido, etc.)

Estados de LoteFirmaItem:
  pendiente   → Aún no firmado
  firmado     → Firmado exitosamente con sello digital y QR
  error       → Error al firmar este documento específico
"""
import uuid

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class LoteFirma(Base):
    """Lote de firma electrónica — agrupa N documentos para firma por lote."""

    __tablename__ = "lotes_firma"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=False)

    # ── Identificación ─────────────────────────────────────────────────────────
    nombre = Column(String(200), nullable=True)  # "Firma Lote 2026-03-03 #01"

    # ── Información del certificado (del .cer validado) ─────────────────────────
    certificado_serial       = Column(String(100), nullable=True)
    certificado_rfc          = Column(String(13),  nullable=True)
    certificado_nombre       = Column(String(200), nullable=True)
    certificado_valido_desde = Column(String(30),  nullable=True)
    certificado_valido_hasta = Column(String(30),  nullable=True)
    certificado_emisor       = Column(String(200), nullable=True)

    # ── Estado ─────────────────────────────────────────────────────────────────
    # preparando | en_proceso | completado | error
    estado = Column(String(20), nullable=False, default="preparando")

    # ── Contadores ─────────────────────────────────────────────────────────────
    total_documentos = Column(Integer, default=0)
    total_firmados   = Column(Integer, default=0)
    total_errores    = Column(Integer, default=0)

    # ── Auditoría ──────────────────────────────────────────────────────────────
    firmado_por_id = Column(String(36), ForeignKey("usuarios.id"), nullable=False)
    creado_en      = Column(DateTime(timezone=True), server_default=func.now())
    completado_en  = Column(DateTime(timezone=True), nullable=True)

    # ── Relaciones ─────────────────────────────────────────────────────────────
    items = relationship(
        "LoteFirmaItem",
        back_populates="lote_firma",
        order_by="LoteFirmaItem.orden",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    firmado_por = relationship("Usuario", foreign_keys=[firmado_por_id])
    cliente     = relationship("Cliente", foreign_keys=[cliente_id])

    def __repr__(self) -> str:
        return f"<LoteFirma '{self.nombre}' {self.estado} {self.total_firmados}/{self.total_documentos}>"

    @property
    def progreso_pct(self) -> int:
        if self.total_documentos == 0:
            return 0
        return round((self.total_firmados + self.total_errores) / self.total_documentos * 100)


class LoteFirmaItem(Base):
    """Ítem de un lote de firma — un documento a firmar con su resultado."""

    __tablename__ = "lote_firma_items"

    id             = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lote_firma_id  = Column(
        String(36), ForeignKey("lotes_firma.id", ondelete="CASCADE"), nullable=False,
    )
    documento_id   = Column(String(36), ForeignKey("documentos_oficiales.id"), nullable=False)
    orden          = Column(Integer, nullable=False)  # 1..N — posición en el lote

    # ── Resultado de la firma ──────────────────────────────────────────────────
    # pendiente | firmado | error
    estado = Column(String(20), nullable=False, default="pendiente")

    # ── Datos criptográficos ───────────────────────────────────────────────────
    hash_documento  = Column(String(64),  nullable=True)  # SHA-256 hexdigest
    cadena_original = Column(Text,        nullable=True)  # ||1.0|serial|rfc|fecha|folio|hash||
    sello_digital   = Column(Text,        nullable=True)  # base64 del sello

    # ── QR de verificación ─────────────────────────────────────────────────────
    qr_data = Column(Text, nullable=True)  # JSON con datos de verificación
    qr_url  = Column(Text, nullable=True)  # Path al PNG generado

    # ── Error ──────────────────────────────────────────────────────────────────
    error_mensaje = Column(Text, nullable=True)

    # ── Timestamp ──────────────────────────────────────────────────────────────
    firmado_en = Column(DateTime(timezone=True), nullable=True)

    # ── Relaciones ─────────────────────────────────────────────────────────────
    lote_firma = relationship("LoteFirma", back_populates="items")
    documento  = relationship("DocumentoOficial", lazy="selectin")

    def __repr__(self) -> str:
        return f"<LoteFirmaItem orden={self.orden} estado={self.estado}>"
