"""
Modelos para integración SAP GRP / Ingesta de DEPPs.

Soporta tres modos de ingesta:
  - archivo : El usuario exporta de SAP a Excel/CSV y lo carga en PIGOP
  - rfc     : Llamadas directas vía pyrfc (requiere SAP NW RFC SDK)
  - odata   : REST via SAP Gateway (si está habilitado)
  - manual  : Registro manual de DEPP (sin SAP)
"""
import uuid

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class SAPImportLog(Base):
    """Registro de cada operación de importación de DEPPs desde SAP."""

    __tablename__ = "sap_import_logs"

    id             = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id     = Column(String(36), ForeignKey("clientes.id"), nullable=False)
    importado_por  = Column(String(36), ForeignKey("usuarios.id"), nullable=False)

    # ── Fuente ─────────────────────────────────────────────────────────────────
    modo           = Column(String(20), nullable=False, default="archivo")
    # archivo | rfc | odata | manual
    nombre_archivo = Column(String(255), nullable=True)   # "DEPPS_FEB_2026.xlsx"
    ejercicio      = Column(Integer, nullable=False, default=2026)
    mes            = Column(Integer, nullable=True)
    upp_filtro     = Column(String(10), nullable=True)    # Filtro UPP aplicado

    # ── Resultado ──────────────────────────────────────────────────────────────
    total_filas    = Column(Integer, default=0)
    depps_creados  = Column(Integer, default=0)
    depps_omitidos = Column(Integer, default=0)   # folio ya existe, se omite
    depps_error    = Column(Integer, default=0)
    errores_detalle = Column(JSON, nullable=True)  # [{fila, folio, error}]
    preview_data   = Column(JSON, nullable=True)   # primeras 5 filas para previsualización

    # ── Estado ─────────────────────────────────────────────────────────────────
    estado         = Column(String(20), default="pendiente")
    # pendiente | procesando | completado | error_parcial | fallido

    iniciado_en    = Column(DateTime(timezone=True), server_default=func.now())
    completado_en  = Column(DateTime(timezone=True), nullable=True)

    # ── Relaciones ─────────────────────────────────────────────────────────────
    cliente        = relationship("Cliente")
    importado_por_usuario = relationship("Usuario", foreign_keys=[importado_por])

    def __repr__(self) -> str:
        return f"<SAPImportLog {self.modo} {self.estado} {self.depps_creados}creados>"
