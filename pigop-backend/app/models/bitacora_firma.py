"""
Modelo BitacoraFirma — Auditoría de todas las operaciones de firma electrónica.

Cada acción significativa queda registrada: registro de certificado,
firma individual, firma por lote, apertura/cierre de sesión, etc.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class BitacoraFirma(Base):
    """Bitácora de auditoría para operaciones de firma electrónica."""

    __tablename__ = "bitacora_firma"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    usuario_id = Column(String(36), ForeignKey("usuarios.id"), nullable=False)

    # Acción realizada:
    #   registro_certificado | firma_individual | firma_lote |
    #   sesion_firma_abierta | sesion_firma_cerrada |
    #   certificado_renovado | certificado_revocado |
    #   validacion_certificado | error_password
    accion = Column(String(50), nullable=False)

    # Detalles opcionales
    documento_id = Column(String(36), nullable=True)
    lote_firma_id = Column(String(36), nullable=True)
    rfc_certificado = Column(String(20), nullable=True)
    numero_serie = Column(String(100), nullable=True)
    hash_documento = Column(String(128), nullable=True)
    ip_origen = Column(String(45), nullable=True)

    # Resultado
    exitoso = Column(Boolean, default=True, nullable=False)
    detalle = Column(Text, nullable=True)

    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Relación
    usuario = relationship("Usuario", foreign_keys=[usuario_id])

    def __repr__(self) -> str:
        return f"<BitacoraFirma {self.accion} {self.rfc_certificado or ''} ({self.timestamp})>"
