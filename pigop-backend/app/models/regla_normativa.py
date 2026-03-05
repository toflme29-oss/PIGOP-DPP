import uuid

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, JSON, String, Text
)
from sqlalchemy.sql import func

from app.core.database import Base


class ReglaNormativa(Base):
    """
    Reglas de validación configurables por normativa.
    Permite actualizar reglas sin tocar código cuando cambia el Manual.
    """

    __tablename__ = "reglas_normativas"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id = Column(String(36), ForeignKey("clientes.id"), nullable=True)

    # Identificación de la regla
    codigo = Column(String(50), unique=True, nullable=False)   # "ART_39_CFDI"
    articulo = Column(String(50), nullable=True)               # "Art. 39"
    titulo = Column(String(255), nullable=False)
    descripcion = Column(Text, nullable=True)

    # Aplicabilidad
    # Tipo: "documental", "presupuestal", "fiscal", "formato"
    tipo_validacion = Column(String(50), nullable=False, default="documental")
    # JSON: ["I.1", "II.4"] o null = aplica a todos
    aplica_clasificacion = Column(JSON, nullable=True)
    # JSON: [1000, 2000] o null = aplica a todos los capítulos
    aplica_capitulo = Column(JSON, nullable=True)

    # Tipo de condición: "documento_requerido", "monto_limite", "campo_obligatorio"
    condicion_tipo = Column(String(50), nullable=True)
    condicion_codigo = Column(Text, nullable=True)

    # Severidad
    gravedad = Column(String(20), default="alto")    # "critico","alto","medio","bajo"
    bloquea_aprobacion = Column(Boolean, default=True)

    # Mensajes de error y corrección
    mensaje_error_template = Column(Text, nullable=True)
    sugerencia_correccion = Column(Text, nullable=True)

    # Estado y versionado
    activa = Column(Boolean, default=True)
    version = Column(Integer, default=1)
    fecha_vigencia = Column(Date, nullable=True)

    creada_en = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<ReglaNormativa {self.codigo} ({self.articulo})>"
