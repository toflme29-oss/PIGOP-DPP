"""
Override de permisos por cliente.
Se guardan aquí los cambios hechos desde AdminPermisos respecto a los
valores por defecto definidos en el frontend (rolePermissions.ts).
La versión efectiva se deriva del máximo updated_en por cliente.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class PermisoOverride(Base):
    __tablename__ = "permisos_overrides"
    __table_args__ = (
        UniqueConstraint("cliente_id", "key", name="uq_permisos_cliente_key"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), nullable=False, index=True)
    key = Column(String(120), nullable=False)
    value = Column(Boolean, nullable=False)
    updated_by = Column(String(36), nullable=True)
    updated_en = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<PermisoOverride {self.cliente_id[:8]}…/{self.key}={self.value}>"
