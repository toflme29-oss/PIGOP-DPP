import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class AuditoriaLog(Base):
    """Log de auditoría de todas las operaciones del sistema."""

    __tablename__ = "auditoria"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=True)
    usuario_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)

    entidad = Column(String(100), nullable=False)   # "depp","oficio","usuario"
    entidad_id = Column(String(36), nullable=True)

    # crear | modificar | eliminar | aprobar | rechazar | login
    accion = Column(String(50), nullable=False)

    datos_anteriores = Column(JSON, nullable=True)
    datos_nuevos = Column(JSON, nullable=True)

    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)

    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    usuario = relationship("Usuario")

    __table_args__ = (
        Index("idx_auditoria_entidad", "entidad", "entidad_id"),
        Index("idx_auditoria_timestamp", "timestamp"),
        Index("idx_auditoria_usuario", "usuario_id"),
    )

    def __repr__(self) -> str:
        return f"<AuditoriaLog {self.accion} {self.entidad} @ {self.timestamp}>"
