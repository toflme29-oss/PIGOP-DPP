import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class FeedbackReporte(Base):
    __tablename__ = "feedback_reportes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=True)
    usuario_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)

    # Datos del reportante (desnormalizados para facilitar lectura)
    usuario_nombre = Column(String(255), nullable=False)
    area_codigo = Column(String(20), nullable=True)

    # Detalles del reporte
    modulo = Column(String(100), nullable=False, default="General")   # Gestión Documental, DEPPs, etc.
    tipo = Column(String(30), nullable=False, default="bug")           # bug | mejora | consulta
    descripcion = Column(Text, nullable=False)

    # Captura de pantalla
    captura_nombre = Column(String(255), nullable=True)
    captura_path = Column(String(500), nullable=True)
    captura_mime = Column(String(100), nullable=True)

    # Estado del reporte
    estado = Column(String(30), nullable=False, default="pendiente")   # pendiente | en_revision | resuelto
    notas_admin = Column(Text, nullable=True)

    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    usuario = relationship("Usuario", foreign_keys=[usuario_id])
