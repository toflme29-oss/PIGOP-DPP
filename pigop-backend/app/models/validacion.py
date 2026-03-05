import uuid

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, JSON, String, Text
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


def _uuid_col(primary_key=False, fk=None, nullable=True):
    """Columna UUID compatible con PostgreSQL y SQLite."""
    return Column(
        String(36),
        primary_key=primary_key,
        default=lambda: str(uuid.uuid4()),
        nullable=nullable,
        **({"ForeignKey": fk} if fk else {}),
    )


class ValidacionDEPP(Base):
    """Resultados de validaciones ejecutadas sobre un DEPP."""

    __tablename__ = "validaciones_depp"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    depp_id = Column(
        String(36),
        ForeignKey("depps.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Tipo: "estructura", "documentos", "cfdi_sat", "normativa_ia", "presupuestal_sap"
    tipo_validacion = Column(String(100), nullable=False)

    # Resultado: "exitosa", "advertencia", "error"
    resultado = Column(String(50), nullable=False)

    # Regla aplicada
    articulo_manual = Column(String(50), nullable=True)
    descripcion_regla = Column(Text, nullable=True)

    # Hallazgo
    mensaje = Column(Text, nullable=True)
    detalles = Column(JSON, nullable=True)

    # Severidad: "critico", "alto", "medio", "bajo"
    gravedad = Column(String(20), nullable=True)

    ejecutada_en = Column(
        DateTime(timezone=True), server_default=func.now()
    )
    # "sistema", "ia", "usuario_{id}"
    ejecutada_por = Column(String(50), nullable=True)

    # Relaciones
    depp = relationship("DEPP", back_populates="validaciones")

    __table_args__ = (
        Index("idx_validacion_depp_tipo", "depp_id", "tipo_validacion"),
    )

    def __repr__(self) -> str:
        return f"<ValidacionDEPP {self.tipo_validacion} → {self.resultado}>"
