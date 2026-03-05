"""Modelos para la base de conocimiento normativa de PIGOP."""
import uuid

from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class Normativa(Base):
    """
    Documento normativo de referencia (ley, manual, lineamiento, reglamento, acuerdo).
    Los PDFs se almacenan en uploads/normativas/.
    """

    __tablename__ = "normativas"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Identificación
    clave = Column(String(80), unique=True, nullable=False)    # ej. "MANUAL_VIATICOS"
    titulo = Column(String(500), nullable=False)
    descripcion = Column(Text, nullable=True)

    # Tipo: ley | manual | lineamiento | reglamento | acuerdo | clasificador
    tipo = Column(String(50), nullable=False, default="manual")

    # Archivo PDF (ruta relativa a uploads/)
    filename = Column(String(255), nullable=True)              # "normativas/MANUAL_VIATICOS.pdf"
    tamano_bytes = Column(Integer, nullable=True)

    # Aplicabilidad — tipos de trámite donde es relevante
    # JSON: ["fondo_revolvente","viaticos"] o null = aplica a todos
    aplica_tramite = Column(JSON, nullable=True)

    # Artículos/referencias clave (para mostrar en la UI)
    referencias_clave = Column(JSON, nullable=True)   # [{"art": "Art. 39", "desc": "CFDI válidos"}]

    # Metadatos
    orden = Column(Integer, default=100)
    activa = Column(Boolean, default=True)
    creada_en = Column(DateTime(timezone=True), server_default=func.now())
    actualizada_en = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<Normativa {self.clave}>"


class ChecklistItem(Base):
    """
    Ítem de checklist de revisión documental por tipo de trámite.
    Corresponde a las hojas del Excel 'Checklist Revisión por tipo de trámite.xlsx'.
    """

    __tablename__ = "checklist_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Tipo de trámite (hoja del Excel)
    # fondo_revolvente | beneficiarios_directos | viaticos | reasignacion_paraestales
    tipo_tramite = Column(String(80), nullable=False, index=True)

    # Sección dentro del checklist
    seccion = Column(String(255), nullable=True)   # ej. "Requisitos de Montos y Conceptos"

    # Contenido del ítem
    pregunta = Column(Text, nullable=False)         # Texto del ítem a verificar
    detalle = Column(Text, nullable=True)           # Sub-bullets o notas adicionales
    is_header = Column(Boolean, default=False)      # True si es encabezado de sección
    is_subitem = Column(Boolean, default=False)     # True si es sub-ítem

    # Tipo de verificación: documental | presupuestal | fiscal | plazo | exclusion
    tipo_verificacion = Column(String(50), default="documental")

    # Referencia normativa
    normativa_clave = Column(String(80), nullable=True)   # FK lógica a Normativa.clave
    articulo_referencia = Column(String(100), nullable=True)

    # Aplica a clasificaciones presupuestales (null = todas)
    aplica_clasificacion = Column(JSON, nullable=True)

    # Orden de presentación
    orden = Column(Integer, default=100)
    activa = Column(Boolean, default=True)

    def __repr__(self) -> str:
        return f"<ChecklistItem {self.tipo_tramite}/{self.seccion[:30]}>"
