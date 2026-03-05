"""
Servicio de importación SAP — Ingesta de DEPPs desde archivos Excel/CSV.

Flujo:
  1. El analista exporta DEPPs de SAP (FBL1N, ZDEPP, etc.) a Excel
  2. Sube el archivo a PIGOP via /sap/import/archivo
  3. Este servicio parsea cada fila y crea DEPPs en estado "en_tramite"
  4. Folios duplicados se omiten (idempotente)
  5. Se retorna un log detallado con creados/omitidos/errores

Columnas esperadas en el Excel (en cualquier orden, insensible a mayúsculas):
  FOLIO_DEPP, UPP, EJERCICIO, MES, CAPITULO, CONCEPTO, PARTIDA,
  MONTO_TOTAL, BENEFICIARIO, RFC_BENEFICIARIO, CLAVE_PRESUPUESTARIA,
  FUENTE_FINANCIAMIENTO, TIPO_PAGO, NRO_DOC_SAP, CLASIFICADOR
"""
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.depp import DEPP
from app.models.sap import SAPImportLog

logger = logging.getLogger(__name__)

# ── Mapeo flexible de columnas ─────────────────────────────────────────────────
# Soporta nombres de columnas tal como aparecen en la "Descarga masiva" del
# Monitor de Autorizaciones de Folios DEPP del SAP GRP (pantalla ZFE_MON_DEPP).
#
# Columnas visibles en el monitor SAP (segunda vista):
#   Eje. | Folio DEPP | Clasif. | Fondo | Descripción Fondo | UPP | UR |
#   Descripción | Monto | Fecha | Fecha Rece. | BL. | Des. |
#   Revi. | Validó | ST | V. | Autorizó | ST | Vo. Bo.
#
COLUMN_ALIASES: dict[str, list[str]] = {
    # ── Identificación ──────────────────────────────────────────────────────────
    "folio": [
        "folio_depp", "folio", "num_depp", "numero_depp", "nro_depp",
        "solicitud", "numero_solicitud", "documento",
    ],
    "upp": [
        "upp", "unidad_programatica", "unidad_presupuestal", "codigo_upp",
        "cod_upp",
    ],
    "ur": [
        "ur", "unidad_responsable", "cod_ur", "codigo_ur",
    ],
    "ejercicio": [
        "ejercicio", "eje", "año", "anio", "year", "ejercicio_fiscal",
    ],
    "mes": [
        "mes", "month", "periodo_mes",
    ],
    # ── Clasificación SAP (campo "Clasif." del monitor) ──────────────────────────
    # Valor típico: "21111" (diferente a la clasificación normativa I.1/II.1)
    "clasificador_sap": [
        "clasif", "clasif_", "clasificador_sap", "clasificacion_sap",
        "tipo_clasif", "clasif_presup",
    ],
    # ── Clasificación normativa (tipo de trámite DPP) ────────────────────────────
    "clasificador_tipo": [
        "clasificador", "clasificador_tipo", "tipo_tramite",
        "tipo_depp", "modalidad", "tipo_depp_norm",
    ],
    # ── Capítulo / Concepto / Partida ────────────────────────────────────────────
    "capitulo": ["capitulo", "cap", "chapter"],
    "concepto": ["concepto"],
    "partida":  ["partida", "partida_presupuestal", "partida_gasto"],
    # ── Clave presupuestaria completa ────────────────────────────────────────────
    "clave_presupuestaria": [
        "clave_presupuestaria", "clave_prog", "clave_programatica", "clave_pp",
        "clave_presup",
    ],
    # ── Fuente de financiamiento / Fondo ────────────────────────────────────────
    # "Fondo" en el monitor SAP → código numérico (ej: 261101021)
    "fuente_financiamiento": [
        "fondo", "fuente_financiamiento", "fuente", "fuente_fin",
        "financiamiento", "cod_fondo", "codigo_fondo",
    ],
    # "Descripción Fondo" → nombre legible del fondo
    "fuente_nombre": [
        "descripcion_fondo", "desc_fondo", "nombre_fondo", "fondo_nombre",
        "descripcion_fuente",
    ],
    # ── Tipo DEPP (PAGO / NO PAGO) ───────────────────────────────────────────────
    "tipo_depp": [
        "tipo_pago", "tipo", "modalidad_pago", "pago_nopago",
        "tipo_depp_pago", "genera_pago",
    ],
    # ── Montos ───────────────────────────────────────────────────────────────────
    "monto_total": [
        "monto_total", "monto", "importe", "total", "amount", "importe_total",
        "cargo_presup", "cargo", "liquido",
    ],
    # ── Beneficiario / Proveedor ─────────────────────────────────────────────────
    "beneficiario": [
        "beneficiario", "proveedor", "razon_social",
        "nombre_beneficiario", "nombre_proveedor",
    ],
    "rfc_beneficiario": [
        "rfc_beneficiario", "rfc_proveedor", "rfc",
    ],
    "clave_acreedor": [
        "clave_acreedor", "acreedor", "cod_acreedor", "numero_acreedor",
        "vendor", "id_proveedor",
    ],
    "cuenta_abono": [
        "cuenta_abono", "clabe", "cuenta_bancaria", "cuenta_destino",
        "banco_cuenta",
    ],
    # ── Documento SAP ────────────────────────────────────────────────────────────
    "nro_doc_sap": [
        "nro_doc_sap", "doc_sap", "numero_documento_sap",
        "documento_fi", "fi_doc",
    ],
    # ── Para DEPP NO PAGO ────────────────────────────────────────────────────────
    "provisional_vale": [
        "provisional", "vale", "provisional_vale", "num_vale",
        "folio_vale", "nro_vale",
    ],
    # ── Descripción del concepto (col "Descripción" en SAP) ─────────────────────
    "descripcion_concepto": [
        "descripcion", "descripcion_concepto", "concepto_gasto",
        "desc_concepto", "partida_nombre",
    ],
    # ── Unidad ejecutora ─────────────────────────────────────────────────────────
    "ue": [
        "ue", "unidad_ejecutora", "cod_ue", "codigo_ue",
    ],
    # ── Fecha de expedición ──────────────────────────────────────────────────────
    "fecha_expedicion": [
        "fecha", "fecha_expedicion", "fecha_depp", "fecha_doc",
        "fec_expedicion",
    ],
}


def _normalize_header(h: str) -> str:
    """Normaliza un encabezado: minúsculas, sin espacios, sin acentos."""
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "ñ": "n", " ": "_", "-": "_", ".": "", "/": "_",
    }
    result = h.strip().lower()
    for old, new in replacements.items():
        result = result.replace(old, new)
    return result


def _build_column_map(headers: list[str]) -> dict[str, int]:
    """
    Construye un mapa de campo_lógico → índice_columna.
    Retorna solo los campos que se encuentran en los headers.
    """
    norm_headers = [_normalize_header(h) for h in headers]
    column_map: dict[str, int] = {}

    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            norm_alias = _normalize_header(alias)
            if norm_alias in norm_headers:
                column_map[field] = norm_headers.index(norm_alias)
                break

    return column_map


def _get_cell(row: list[Any], col_map: dict[str, int], field: str, default: Any = None) -> Any:
    """Obtiene el valor de una celda por campo lógico."""
    idx = col_map.get(field)
    if idx is None or idx >= len(row):
        return default
    val = row[idx]
    if val is None or str(val).strip() in ("", "-", "N/A", "nan", "None"):
        return default
    return str(val).strip()


async def parse_excel_file(file_bytes: bytes) -> tuple[list[str], list[list[Any]]]:
    """
    Parsea un archivo Excel o CSV.
    Retorna (headers, filas_de_datos).
    """
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise ValueError("El archivo Excel está vacío.")
        headers = [str(c) if c is not None else "" for c in rows[0]]
        data = [list(r) for r in rows[1:] if any(c is not None for c in r)]
        return headers, data
    except ImportError:
        pass

    # Fallback CSV
    import csv
    text = file_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows_list = list(reader)
    if not rows_list:
        raise ValueError("El archivo CSV está vacío.")
    headers = rows_list[0]
    data = rows_list[1:]
    return headers, data


async def importar_depps_desde_archivo(
    db: AsyncSession,
    file_bytes: bytes,
    filename: str,
    cliente_id: str,
    usuario_id: str,
    ejercicio: int,
    mes: Optional[int] = None,
    upp_filtro: Optional[str] = None,
    dry_run: bool = False,
) -> SAPImportLog:
    """
    Importa DEPPs desde un archivo Excel/CSV exportado de SAP.

    Args:
        dry_run: Si True, solo genera preview sin crear registros.

    Returns:
        SAPImportLog con el resumen de la operación.
    """
    log = SAPImportLog(
        id=str(uuid.uuid4()),
        cliente_id=cliente_id,
        importado_por=usuario_id,
        modo="archivo",
        nombre_archivo=filename,
        ejercicio=ejercicio,
        mes=mes,
        upp_filtro=upp_filtro,
        estado="procesando",
        iniciado_en=datetime.now(timezone.utc),
    )
    db.add(log)
    await db.flush()

    try:
        headers, data_rows = await parse_excel_file(file_bytes)
    except Exception as e:
        log.estado = "fallido"
        log.errores_detalle = [{"fila": 0, "error": f"Error al parsear archivo: {e}"}]
        log.completado_en = datetime.now(timezone.utc)
        await db.flush()
        return log

    col_map = _build_column_map(headers)

    # Verificar que tenga la columna mínima requerida (folio)
    if "folio" not in col_map:
        log.estado = "fallido"
        log.errores_detalle = [{
            "fila": 0,
            "error": f"No se encontró la columna de folio. "
                     f"Columnas detectadas: {', '.join(headers[:10])}. "
                     f"Se esperaba una de: {', '.join(COLUMN_ALIASES['folio'])}."
        }]
        log.completado_en = datetime.now(timezone.utc)
        await db.flush()
        return log

    log.total_filas = len(data_rows)

    # Preview: primeras 5 filas para mostrar en frontend antes de confirmar
    log.preview_data = {
        "headers": headers,
        "rows": [
            {field: _get_cell(row, col_map, field) for field in COLUMN_ALIASES}
            for row in data_rows[:5]
        ],
        "col_map_detected": {k: headers[v] for k, v in col_map.items()},
        "total_filas": len(data_rows),
    }

    if dry_run:
        log.estado = "pendiente"
        await db.flush()
        return log

    creados = 0
    omitidos = 0
    errores = 0
    errores_detalle = []

    for i, row in enumerate(data_rows, start=2):
        folio = _get_cell(row, col_map, "folio")
        if not folio:
            errores += 1
            errores_detalle.append({"fila": i, "folio": None, "error": "Folio vacío, fila omitida."})
            continue

        upp = _get_cell(row, col_map, "upp") or upp_filtro or "N/A"

        # Filtro por UPP si se especificó
        if upp_filtro and upp != upp_filtro:
            omitidos += 1
            continue

        # Verificar si ya existe
        existing = await db.scalar(
            select(DEPP).where(
                DEPP.cliente_id == cliente_id,
                DEPP.folio == folio,
                DEPP.ejercicio == ejercicio,
            )
        )
        if existing:
            omitidos += 1
            continue

        # Parsear valores numéricos
        try:
            monto_raw = _get_cell(row, col_map, "monto_total")
            monto = float(str(monto_raw).replace(",", "").replace("$", "")) if monto_raw else None

            capitulo_raw = _get_cell(row, col_map, "capitulo")
            capitulo = int(float(capitulo_raw)) if capitulo_raw else None

            concepto_raw = _get_cell(row, col_map, "concepto")
            concepto = int(float(concepto_raw)) if concepto_raw else None

            partida_raw = _get_cell(row, col_map, "partida")
            partida = int(float(partida_raw)) if partida_raw else None

            mes_row = _get_cell(row, col_map, "mes")
            mes_val = int(float(mes_row)) if mes_row else mes
        except (ValueError, TypeError) as e:
            errores += 1
            errores_detalle.append({"fila": i, "folio": folio, "error": f"Error de tipo en valores numéricos: {e}"})
            continue

        try:
            # ── Parsear tipo_depp desde "tipo_pago" o "tipo_depp" ──────────────
            tipo_depp_raw = (
                _get_cell(row, col_map, "tipo_depp") or ""
            ).upper()
            if "NO" in tipo_depp_raw or "REGULARIZ" in tipo_depp_raw:
                tipo_depp_norm = "NO_PAGO"
            elif "PAGO" in tipo_depp_raw or tipo_depp_raw == "P":
                tipo_depp_norm = "PAGO"
            else:
                tipo_depp_norm = None  # sin información

            # ── Capítulo desde partida si no viene explícito ───────────────────
            # En SAP el capítulo no siempre viene como columna separada;
            # se puede inferir del primer dígito de la partida × 1000.
            if not capitulo and partida:
                capitulo_inferido = (partida // 1000) * 1000
                if capitulo_inferido > 0:
                    capitulo = capitulo_inferido

            # ── Descripción concepto → partida_nombre ─────────────────────────
            desc_concepto = _get_cell(row, col_map, "descripcion_concepto")

            depp = DEPP(
                id=str(uuid.uuid4()),
                cliente_id=cliente_id,
                folio=folio,
                upp=upp,
                ur=_get_cell(row, col_map, "ur"),
                ue=_get_cell(row, col_map, "ue"),
                ejercicio=ejercicio,
                mes=mes_val,
                tipo_depp=tipo_depp_norm,
                capitulo=capitulo,
                concepto=concepto,
                partida=partida,
                partida_nombre=desc_concepto,
                monto_total=monto,
                beneficiario=_get_cell(row, col_map, "beneficiario"),
                clave_acreedor=_get_cell(row, col_map, "clave_acreedor"),
                cuenta_abono=_get_cell(row, col_map, "cuenta_abono"),
                clave_presupuestaria=_get_cell(row, col_map, "clave_presupuestaria"),
                fuente_financiamiento=_get_cell(row, col_map, "fuente_financiamiento"),
                fuente_nombre=_get_cell(row, col_map, "fuente_nombre"),
                tipo_pago=_get_cell(row, col_map, "tipo_depp"),       # legacy compat
                clasificador_tipo=_get_cell(row, col_map, "clasificador_tipo"),
                clasificador_sap=_get_cell(row, col_map, "clasificador_sap"),
                provisional_vale=_get_cell(row, col_map, "provisional_vale"),
                estado="en_tramite",
                creado_por_id=usuario_id,
            )
            db.add(depp)
            await db.flush()
            creados += 1
        except Exception as e:
            logger.error(f"Error creando DEPP fila {i} (folio={folio}): {e}")
            errores += 1
            errores_detalle.append({"fila": i, "folio": folio, "error": str(e)})

    log.depps_creados = creados
    log.depps_omitidos = omitidos
    log.depps_error = errores
    log.errores_detalle = errores_detalle if errores_detalle else None
    log.estado = "completado" if errores == 0 else ("error_parcial" if creados > 0 else "fallido")
    log.completado_en = datetime.now(timezone.utc)

    await db.flush()
    return log
