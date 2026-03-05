"""Tablas Fase 2: validaciones_depp y reglas_normativas

Revision ID: 002
Revises: 001
Create Date: 2026-02-24

Agrega:
  - validaciones_depp  → resultados del pipeline de validación
  - reglas_normativas  → catálogo configurable de reglas del Manual
  - columna clasificador_tipo en depps (si no existe)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── validaciones_depp ─────────────────────────────────────────────────────
    op.create_table(
        "validaciones_depp",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("depp_id", sa.String(36), nullable=False),
        sa.Column("tipo_validacion", sa.String(100), nullable=False),
        sa.Column("resultado", sa.String(50), nullable=False),
        sa.Column("articulo_manual", sa.String(50), nullable=True),
        sa.Column("descripcion_regla", sa.Text(), nullable=True),
        sa.Column("mensaje", sa.Text(), nullable=True),
        sa.Column("detalles", sa.JSON(), nullable=True),
        sa.Column("gravedad", sa.String(20), nullable=True),
        sa.Column(
            "ejecutada_en",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column("ejecutada_por", sa.String(50), nullable=True),
        sa.ForeignKeyConstraint(["depp_id"], ["depps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_validacion_depp_tipo",
        "validaciones_depp",
        ["depp_id", "tipo_validacion"],
    )

    # ── reglas_normativas ─────────────────────────────────────────────────────
    # Esquema completo alineado al modelo ReglaNormativa (models/regla_normativa.py)
    op.create_table(
        "reglas_normativas",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("cliente_id", sa.String(36), nullable=True),
        sa.Column("codigo", sa.String(50), nullable=False),
        sa.Column("articulo", sa.String(50), nullable=True),
        sa.Column("titulo", sa.String(255), nullable=False),
        sa.Column("descripcion", sa.Text(), nullable=True),
        sa.Column(
            "tipo_validacion",
            sa.String(50),
            nullable=False,
            server_default="documental",
        ),
        sa.Column("aplica_clasificacion", sa.JSON(), nullable=True),
        sa.Column("aplica_capitulo", sa.JSON(), nullable=True),
        sa.Column("condicion_tipo", sa.String(50), nullable=True),
        sa.Column("condicion_codigo", sa.Text(), nullable=True),
        sa.Column("gravedad", sa.String(20), nullable=True),
        sa.Column("bloquea_aprobacion", sa.Boolean(), server_default="true", nullable=True),
        sa.Column("mensaje_error_template", sa.Text(), nullable=True),
        sa.Column("sugerencia_correccion", sa.Text(), nullable=True),
        sa.Column("activa", sa.Boolean(), server_default="true", nullable=True),
        sa.Column("version", sa.Integer(), nullable=True),
        sa.Column("fecha_vigencia", sa.Date(), nullable=True),
        sa.Column(
            "creada_en",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["cliente_id"], ["clientes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("codigo", name="uq_regla_codigo"),
    )
    op.create_index("ix_reglas_activa", "reglas_normativas", ["activa"])
    op.create_index(
        "ix_reglas_tipo_validacion", "reglas_normativas", ["tipo_validacion"]
    )


def downgrade() -> None:
    op.drop_index("ix_reglas_tipo_validacion", table_name="reglas_normativas")
    op.drop_index("ix_reglas_activa", table_name="reglas_normativas")
    op.drop_table("reglas_normativas")

    op.drop_index("idx_validacion_depp_tipo", table_name="validaciones_depp")
    op.drop_table("validaciones_depp")
