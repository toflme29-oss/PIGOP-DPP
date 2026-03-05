"""
Modelo CertificadoFirma — Bóveda cifrada de certificados e.firma (FIEL).

La clave privada (.key) se almacena cifrada con AES-256-GCM.
El certificado (.cer) se almacena en base64 (es público).
La contraseña del usuario NUNCA se almacena.
"""
import uuid

from sqlalchemy import (
    Boolean,
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


class CertificadoFirma(Base):
    """Bóveda cifrada de certificados e.firma (FIEL) del SAT."""

    __tablename__ = "certificados_firma"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    usuario_id = Column(
        String(36), ForeignKey("usuarios.id"), unique=True, nullable=False
    )

    # ── Certificado (.cer) — almacenado en base64 (público) ──────────────────
    cer_data = Column(Text, nullable=False)

    # ── Clave privada (.key) — cifrada con AES-256-GCM ──────────────────────
    key_data_cifrada = Column(Text, nullable=False)  # base64(AES(key_bytes))
    key_iv = Column(String(64), nullable=False)  # IV del cifrado (hex)
    key_tag = Column(String(64), nullable=False)  # Tag de autenticación GCM (hex)

    # ── Metadata del certificado (extraída al cargar) ────────────────────────
    rfc = Column(String(20), nullable=False)
    nombre_titular = Column(String(300), nullable=False)
    numero_serie = Column(String(100), nullable=False)
    valido_desde = Column(DateTime(timezone=True), nullable=True)
    valido_hasta = Column(DateTime(timezone=True), nullable=True)
    emisor = Column(String(300), nullable=True)

    # ── Estado ───────────────────────────────────────────────────────────────
    activo = Column(Boolean, default=True, nullable=False)

    # ── Auditoría ────────────────────────────────────────────────────────────
    registrado_en = Column(DateTime(timezone=True), server_default=func.now())
    ultima_firma_en = Column(DateTime(timezone=True), nullable=True)
    total_firmas = Column(Integer, default=0, nullable=False)

    # ── Relación ─────────────────────────────────────────────────────────────
    usuario = relationship("Usuario", foreign_keys=[usuario_id])

    def __repr__(self) -> str:
        return f"<CertificadoFirma {self.rfc} ({self.numero_serie[:12]}...)>"
