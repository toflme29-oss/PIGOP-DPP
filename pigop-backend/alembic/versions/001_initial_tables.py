"""Tablas iniciales PIGOP - Fase 1

Revision ID: 001
Revises:
Create Date: 2026-02-24

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Tabla clientes ────────────────────────────────────────────────────────
    op.create_table(
        "clientes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("codigo_upp", sa.String(length=10), nullable=False),
        sa.Column("nombre", sa.String(length=255), nullable=False),
        sa.Column("tipo", sa.String(length=50), nullable=True),
        sa.Column("activo", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("configuracion", postgresql.JSON(astext_type=sa.Text()), nullable=True, server_default="{}"),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("actualizado_en", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clientes_codigo_upp", "clientes", ["codigo_upp"], unique=True)

    # ── Tabla usuarios ────────────────────────────────────────────────────────
    op.create_table(
        "usuarios",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cliente_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("nombre_completo", sa.String(length=255), nullable=True),
        sa.Column("rol", sa.String(length=50), nullable=False, server_default="analista"),
        sa.Column("activo", sa.Boolean(), nullable=True, server_default="true"),
        sa.Column("ultimo_acceso", sa.DateTime(timezone=True), nullable=True),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("actualizado_en", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["cliente_id"], ["clientes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usuarios_email", "usuarios", ["email"], unique=True)

    # ── Tabla depps ───────────────────────────────────────────────────────────
    op.create_table(
        "depps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cliente_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("folio", sa.String(length=100), nullable=False),
        sa.Column("expediente_id", sa.String(length=25), nullable=True),
        sa.Column("upp", sa.String(length=10), nullable=False),
        sa.Column("ejercicio", sa.Integer(), nullable=False),
        sa.Column("mes", sa.Integer(), nullable=True),
        sa.Column("clasificador_tipo", sa.String(length=50), nullable=True),
        sa.Column("capitulo", sa.Integer(), nullable=True),
        sa.Column("concepto", sa.Integer(), nullable=True),
        sa.Column("partida", sa.Integer(), nullable=True),
        sa.Column("fuente_financiamiento", sa.String(length=100), nullable=True),
        sa.Column("programa", sa.String(length=100), nullable=True),
        sa.Column("monto_total", sa.Numeric(15, 2), nullable=True),
        sa.Column("monto_comprobado", sa.Numeric(15, 2), nullable=True),
        sa.Column("estado", sa.String(length=50), nullable=True, server_default="borrador"),
        sa.Column("fecha_estado", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("beneficiario", sa.String(length=255), nullable=True),
        sa.Column("solicitud_numero", sa.String(length=20), nullable=True),
        sa.Column("tipo_pago", sa.String(length=50), nullable=True),
        sa.Column("ur", sa.Text(), nullable=True),
        sa.Column("clave_presupuestaria", sa.String(length=100), nullable=True),
        sa.Column("partida_nombre", sa.String(length=255), nullable=True),
        sa.Column("validado_automaticamente", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("puede_aprobar", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("fecha_validacion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validado_por_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("creado_por_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("actualizado_en", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["cliente_id"], ["clientes.id"]),
        sa.ForeignKeyConstraint(["creado_por_id"], ["usuarios.id"]),
        sa.ForeignKeyConstraint(["validado_por_id"], ["usuarios.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cliente_id", "folio", "ejercicio", name="uq_depp_folio"),
    )
    op.create_index("ix_depps_estado", "depps", ["estado"])
    op.create_index("idx_depp_upp_ejercicio", "depps", ["cliente_id", "upp", "ejercicio"])

    # ── Tabla documentos_depp ─────────────────────────────────────────────────
    op.create_table(
        "documentos_depp",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("depp_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tipo", sa.String(length=50), nullable=False),
        sa.Column("nombre_archivo", sa.String(length=255), nullable=False),
        sa.Column("url_storage", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("tamanio_bytes", sa.BigInteger(), nullable=True),
        sa.Column("datos_extraidos", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("texto_extraido", sa.Text(), nullable=True),
        sa.Column("validado", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("errores_validacion", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("subido_en", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("subido_por_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["depp_id"], ["depps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subido_por_id"], ["usuarios.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Tabla auditoria ───────────────────────────────────────────────────────
    op.create_table(
        "auditoria",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cliente_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("usuario_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entidad", sa.String(length=100), nullable=False),
        sa.Column("entidad_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("accion", sa.String(length=50), nullable=False),
        sa.Column("datos_anteriores", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("datos_nuevos", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["cliente_id"], ["clientes.id"]),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuarios.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_auditoria_entidad", "auditoria", ["entidad", "entidad_id"])
    op.create_index("idx_auditoria_timestamp", "auditoria", ["timestamp"])
    op.create_index("idx_auditoria_usuario", "auditoria", ["usuario_id"])


def downgrade() -> None:
    op.drop_table("auditoria")
    op.drop_table("documentos_depp")
    op.drop_table("depps")
    op.drop_table("usuarios")
    op.drop_table("clientes")
