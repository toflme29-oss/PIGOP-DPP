import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Cliente(Base):
    """Entidad gubernamental (UPP o dependencia) — soporte multi-tenant."""

    __tablename__ = "clientes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    codigo_upp = Column(String(10), unique=True, nullable=False, index=True)
    nombre = Column(String(255), nullable=False)
    tipo = Column(String(50), nullable=True)   # centralizada|paraestatal|autonoma|poder
    activo = Column(Boolean, default=True)
    configuracion = Column(JSON, default={})

    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    usuarios = relationship("Usuario", back_populates="cliente")
    depps = relationship("DEPP", back_populates="cliente")

    def __repr__(self) -> str:
        return f"<Cliente {self.codigo_upp} - {self.nombre}>"


class Usuario(Base):
    """Usuarios del sistema."""

    __tablename__ = "usuarios"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=True)

    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    nombre_completo = Column(String(255), nullable=True)

    # superadmin | admin_cliente | analista | consulta
    rol = Column(String(50), nullable=False, default="analista")

    activo = Column(Boolean, default=True)
    ultimo_acceso = Column(DateTime(timezone=True), nullable=True)

    creado_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizado_en = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    cliente = relationship("Cliente", back_populates="usuarios")

    def __repr__(self) -> str:
        return f"<Usuario {self.email} ({self.rol})>"
