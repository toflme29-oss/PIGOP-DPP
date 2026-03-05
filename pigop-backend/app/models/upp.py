"""
Modelo para Unidades Programáticas Presupuestales (UPPs).
Fuente: Listado UPPs 2026 — Secretaría de Finanzas y Administración de Michoacán.
"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class UnidadProgramatica(Base):
    """
    Unidad Programática Presupuestal (UPP) del Gobierno del Estado de Michoacán.
    Representa las dependencias y entidades ejecutoras del gasto público.
    """

    __tablename__ = "upps"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Código de la UPP (puede ser numérico o alfanumérico como "A13")
    codigo = Column(String(10), unique=True, nullable=False, index=True)

    # Nombre oficial de la dependencia/entidad
    nombre = Column(String(500), nullable=False)

    # Clasificación administrativa
    # CENTRALIZADA | PARAESTATAL | AUTÓNOMA | PODER
    clasificacion_admin = Column(String(30), nullable=False)

    # Código de organismo presupuestal (21111, 21112, 21113, 21114, 21120, etc.)
    organismo_code = Column(String(10), nullable=True)

    # Sigla/acrónimo de uso común (se puede editar manualmente)
    sigla = Column(String(20), nullable=True)

    # Ejercicio fiscal al que corresponde el listado
    ejercicio = Column(Integer, default=2026, nullable=False)

    activa = Column(Boolean, default=True)
    creada_en = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<UPP {self.codigo} — {self.nombre[:40]}>"
