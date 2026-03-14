"""Modelo: Oficios Recibidos — Control y trazabilidad."""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class OficioRecibido(Base):
    __tablename__ = "oficios_recibidos"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    folio = Column(Integer, nullable=False, comment="Folio interno secuencial por cliente")
    numero_oficio = Column(String(100), nullable=False, comment="Número de oficio del remitente")
    remitente = Column(String(255), nullable=False)
    dependencia = Column(String(255), nullable=False)
    asunto = Column(String(500), nullable=False)
    descripcion = Column(Text, nullable=True)
    observaciones = Column(Text, nullable=True)
    fecha_oficio = Column(Date, nullable=False, comment="Fecha impresa en el oficio")
    fecha_registro = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="Fecha/hora de captura en el sistema",
    )

    # ── Relaciones ────────────────────────────────────────────────────────────────
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=False)
    registrado_por = Column(String(36), ForeignKey("usuarios.id"), nullable=False)

    cliente = relationship("Cliente", lazy="selectin")
    registrador = relationship("Usuario", lazy="selectin")

    # ── Constraints ───────────────────────────────────────────────────────────────
    __table_args__ = (
        UniqueConstraint("cliente_id", "numero_oficio", name="uq_oficio_cliente_numero"),
        Index("ix_oficio_fecha", "fecha_oficio"),
        Index("ix_oficio_cliente", "cliente_id"),
    )

    def __repr__(self) -> str:
        return f"<OficioRecibido folio={self.folio} numero={self.numero_oficio}>"
