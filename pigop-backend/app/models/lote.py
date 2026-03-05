"""
Modelos para el módulo de Revisión por Lotes (Bandeja de Trabajo).

Flujo:
  Supervisor crea un Lote con N DEPPs (5, 10 ó 15).
  Lo asigna a un revisor.
  El revisor trabaja en la Bandeja: revisa cada DEPP secuencialmente,
  registra su resultado (aprobado/rechazado) y observaciones.
  Al completar, el supervisor ve el resumen del lote.

Estados del Lote:
  pendiente   → Creado, sin asignar o asignado sin iniciar
  en_revision → El revisor lo abrió y está trabajando en él
  completado  → Todos los items revisados
  archivado   → Cerrado, solo lectura

Estados de LoteDepp (cada item):
  pendiente   → Aún no revisado
  en_revision → El revisor está viendo este DEPP ahora
  aprobado    → Revisor dictaminó aprobado
  rechazado   → Revisor dictaminó rechazado
  omitido     → Revisor decidió omitirlo (ej. necesita más info)
"""
import uuid

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey,
    Integer, JSON, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Lote(Base):
    """Lote de revisión — agrupa N DEPPs para un revisor."""

    __tablename__ = "lotes"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cliente_id      = Column(String(36), ForeignKey("clientes.id"), nullable=False)

    # ── Identificación ─────────────────────────────────────────────────────────
    nombre          = Column(String(120), nullable=False)
    # ej: "Lote FEB-2026 #01 · Beneficiarios Directos"
    descripcion     = Column(Text, nullable=True)

    # ── Configuración ──────────────────────────────────────────────────────────
    tamaño          = Column(Integer, nullable=False, default=10)   # 5 | 10 | 15
    ejercicio       = Column(Integer, nullable=False, default=2026)
    mes             = Column(Integer, nullable=True)
    tipo_tramite    = Column(String(80), nullable=True)  # filtro: viaticos | fondo_revolvente | etc.
    upp_filtro      = Column(String(10), nullable=True)  # filtrar por UPP específica

    # ── Asignación ─────────────────────────────────────────────────────────────
    creado_por_id   = Column(String(36), ForeignKey("usuarios.id"), nullable=False)
    revisor_id      = Column(String(36), ForeignKey("usuarios.id"), nullable=True)

    # ── Estado ─────────────────────────────────────────────────────────────────
    estado          = Column(String(20), nullable=False, default="pendiente")
    # pendiente | en_revision | completado | archivado

    # ── Timestamps ─────────────────────────────────────────────────────────────
    creado_en       = Column(DateTime(timezone=True), server_default=func.now())
    asignado_en     = Column(DateTime(timezone=True), nullable=True)
    iniciado_en     = Column(DateTime(timezone=True), nullable=True)
    completado_en   = Column(DateTime(timezone=True), nullable=True)

    # ── Métricas calculadas ────────────────────────────────────────────────────
    tiempo_total_seg = Column(Integer, nullable=True)   # segundos totales de revisión

    # ── Relaciones ─────────────────────────────────────────────────────────────
    items          = relationship(
        "LoteDepp",
        back_populates="lote",
        order_by="LoteDepp.orden",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    creado_por     = relationship("Usuario", foreign_keys=[creado_por_id])
    revisor        = relationship("Usuario", foreign_keys=[revisor_id])

    def __repr__(self) -> str:
        return f"<Lote '{self.nombre}' {self.estado} {len(self.items or [])}items>"

    @property
    def total_revisados(self) -> int:
        return sum(1 for i in (self.items or []) if i.estado in ("aprobado", "rechazado", "omitido"))

    @property
    def total_aprobados(self) -> int:
        return sum(1 for i in (self.items or []) if i.estado == "aprobado")

    @property
    def total_rechazados(self) -> int:
        return sum(1 for i in (self.items or []) if i.estado == "rechazado")

    @property
    def progreso_pct(self) -> int:
        total = len(self.items or [])
        if total == 0:
            return 0
        return round(self.total_revisados / total * 100)


class LoteDepp(Base):
    """Item de un lote — un DEPP específico en la cola de revisión."""

    __tablename__ = "lote_depps"

    id              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    lote_id         = Column(String(36), ForeignKey("lotes.id", ondelete="CASCADE"), nullable=False)
    depp_id         = Column(String(36), ForeignKey("depps.id"), nullable=False)
    orden           = Column(Integer, nullable=False)   # 1..N — posición en la cola

    # ── Resultado de la revisión ───────────────────────────────────────────────
    estado          = Column(String(20), nullable=False, default="pendiente")
    # pendiente | en_revision | aprobado | rechazado | omitido

    observaciones   = Column(Text, nullable=True)       # Notas del revisor
    revisado_en     = Column(DateTime(timezone=True), nullable=True)
    revisado_por_id = Column(String(36), ForeignKey("usuarios.id"), nullable=True)
    tiempo_seg      = Column(Integer, nullable=True)    # segundos en revisar este DEPP

    # ── Relaciones ─────────────────────────────────────────────────────────────
    lote            = relationship("Lote", back_populates="items")
    depp            = relationship("DEPP", lazy="selectin")
    revisado_por    = relationship("Usuario", foreign_keys=[revisado_por_id])

    def __repr__(self) -> str:
        return f"<LoteDepp orden={self.orden} estado={self.estado}>"
