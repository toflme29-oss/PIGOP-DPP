"""
Servicio de generación de oficios en formato PDF (reportlab).

Genera un PDF institucional equivalente al DOCX que produce
oficio_generator_service.py, usado para vista previa embebida
y descarga directa sin necesidad de Word.

Dependencias:
  - reportlab==4.0.7+
"""
import io
from datetime import datetime
from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, cm, mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY

STATIC_DIR = Path(__file__).parent.parent / "static"
LOGOS_DIR = STATIC_DIR / "logos"
FIRMAS_DIR = STATIC_DIR / "firmas"

# ── Membrete activo ────────────────────────────────────────────────────────────
def _get_membrete_activo() -> Optional[str]:
    """Devuelve la ruta al membrete activo (PNG/JPG) si existe."""
    for ext in (".png", ".jpg", ".jpeg"):
        p = LOGOS_DIR / f"membrete_activo{ext}"
        if p.exists():
            return str(p)
    return None

# ── Configuración de posición del recuadro (coordenadas exactas por campo) ─────
# Coordenadas en puntos (1 pt = 1/72 pulgada). Origen = esquina inferior izquierda.
# Página carta: 612 × 792 pts
MEMBRETE_CAMPOS = [
    {"key": "dependencia",   "x": 400, "y": 753},
    {"key": "subdep",        "x": 420, "y": 720},
    {"key": "oficina",       "x": 400, "y": 703},
    {"key": "nooficio",      "x": 400, "y": 687},
    {"key": "expediente",    "x": 400, "y": 670},
    {"key": "asunto",        "x": 400, "y": 654},
]
MEMBRETE_FECHA_Y  = 630   # Y de la línea de lugar y fecha
MEMBRETE_FONT     = "Helvetica"
MEMBRETE_FONTSIZE = 7
MEMBRETE_MAX_CHARS = 55   # truncar si el valor es muy largo

# Colores institucionales
GUINDA = colors.HexColor("#911A3A")
GUINDA_LIGHT = colors.HexColor("#FDF0F3")
GRAY_TEXT = colors.HexColor("#374151")
LIGHT_GRAY = colors.HexColor("#9CA3AF")


class OficioPdfService:
    """Genera oficios de respuesta en formato PDF con reportlab."""

    def generar_oficio_pdf(
        self,
        *,
        folio_respuesta: str,
        fecha_respuesta: str,
        lugar: str = "Morelia, Michoacán",
        destinatario_nombre: str,
        destinatario_cargo: str,
        destinatario_dependencia: str,
        seccion_fundamento: str = "",
        seccion_referencia: str = "",
        seccion_objeto: str = "",
        seccion_cierre: str = "",
        firmante_nombre: str = "Mtro. Marco Antonio Flores Mejía",
        firmante_cargo: str = "Director de Programación y Presupuesto",
        referencia_elaboro: Optional[str] = None,
        referencia_reviso: Optional[str] = None,
        copias: Optional[list[str]] = None,
        incluir_firma_visual: bool = False,
        sello_digital_data: Optional[dict] = None,
        asunto: Optional[str] = None,
        tabla_imagen_path: Optional[str] = None,
        tabla_datos_json: Optional[list] = None,
    ) -> bytes:
        """
        Genera un PDF del oficio institucional.
        Returns: bytes del PDF generado.
        """
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            topMargin=0.6 * inch,
            bottomMargin=0.6 * inch,
            leftMargin=1.1 * inch,
            rightMargin=0.87 * inch,
        )

        styles = getSampleStyleSheet()
        elements = []

        # ── Estilos ─────────────────────────────────────────────────────────
        s_normal = ParagraphStyle(
            "OfNormal",
            parent=styles["Normal"],
            fontSize=11,
            fontName="Helvetica",
            leading=14,
        )
        s_bold = ParagraphStyle(
            "OfBold",
            parent=s_normal,
            fontName="Helvetica-Bold",
        )
        s_center = ParagraphStyle(
            "OfCenter",
            parent=s_normal,
            alignment=TA_CENTER,
        )
        s_right = ParagraphStyle(
            "OfRight",
            parent=s_normal,
            alignment=TA_RIGHT,
        )
        s_justify = ParagraphStyle(
            "OfJustify",
            parent=s_normal,
            alignment=TA_JUSTIFY,
            firstLineIndent=28,
            spaceAfter=6,
            leading=15,
        )
        s_small = ParagraphStyle(
            "OfSmall",
            parent=s_normal,
            fontSize=6,
            leading=8,
        )
        s_firma_label = ParagraphStyle(
            "OfFirmaLabel",
            parent=s_normal,
            fontSize=7,
            fontName="Helvetica-Bold",
            leading=9,
        )
        s_firma_value = ParagraphStyle(
            "OfFirmaValue",
            parent=s_normal,
            fontSize=7,
            fontName="Helvetica",
            leading=9,
        )

        # ── Detectar si hay membrete activo ────────────────────────────────
        membrete_path = _get_membrete_activo()
        membrete_activo = membrete_path is not None

        asunto_corto = self._truncar_asunto(asunto or "El que se indica")

        if membrete_activo:
            # ── Con membrete: el encabezado se dibuja vía canvas (absoluto) ─
            # Calculamos el espacio a reservar desde el top hasta debajo del
            # último campo (Asunto) + fecha, para que el cuerpo empiece ahí.
            y_mas_alto = max(c["y"] for c in MEMBRETE_CAMPOS)  # y=753
            y_mas_bajo = min(c["y"] for c in MEMBRETE_CAMPOS)  # y=653
            espacio_header = (792 - y_mas_alto) + (y_mas_alto - MEMBRETE_FECHA_Y) + 20
            elements.append(Spacer(1, espacio_header))

        else:
            # ── Sin membrete: encabezado completo con escudo y recuadro ────
            s_left = ParagraphStyle("Left", parent=s_normal, alignment=0)
            escudo_path_logo = LOGOS_DIR / "escudo_mich.png"
            if escudo_path_logo.exists():
                esc_img = Image(str(escudo_path_logo), width=0.6 * inch, height=0.6 * inch)
                esc_img.hAlign = "LEFT"
                elements.append(esc_img)
                elements.append(Spacer(1, 2))

            elements.append(Paragraph(
                '<b>Gobierno del Estado<br/>de Michoacán de Ocampo</b>',
                ParagraphStyle("H1", parent=s_left, fontSize=8, textColor=colors.HexColor("#333333")),
            ))
            elements.append(Spacer(1, 6))

            s_recuadro_label = ParagraphStyle(
                "RecLabel", fontSize=7, fontName="Helvetica-Bold",
                leading=9, textColor=colors.HexColor("#333333"),
            )
            s_recuadro_value = ParagraphStyle(
                "RecValue", fontSize=7, fontName="Helvetica",
                leading=9, textColor=colors.HexColor("#333333"),
            )
            recuadro_data = [
                ["Dependencia:", "Secretaría de Finanzas y Administración"],
                ["Sub-dependencia:", "Subsecretaría de Finanzas"],
                ["Oficina:", "Dirección de Programación y Presupuesto"],
                ["No. de oficio:", folio_respuesta or "—"],
                ["Expediente:", "General"],
                ["Asunto:", asunto_corto],
            ]
            recuadro_rows = [
                [
                    Paragraph(f'<b>{row[0]}</b>', s_recuadro_label),
                    Paragraph(row[1], s_recuadro_value),
                ]
                for row in recuadro_data
            ]
            recuadro_table = Table(
                recuadro_rows,
                colWidths=[1.0 * inch, 2.2 * inch],
                hAlign="RIGHT",
            )
            recuadro_table.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]))
            elements.append(recuadro_table)
            elements.append(Spacer(1, 8))

            # Fecha solo en modo sin membrete (con membrete va en canvas)
            elements.append(Paragraph(f'{lugar}, {fecha_respuesta}', s_right))
            elements.append(Spacer(1, 14))

        # ── Destinatario ────────────────────────────────────────────────────
        # Estructura: nombre / cargo / dependencia / PRESENTE.
        # Solo incluir líneas que tengan contenido real (no "---" ni vacías)
        dest_lines = []
        if destinatario_nombre and destinatario_nombre.strip() not in ("", "---"):
            dest_lines.append(destinatario_nombre.upper())
        if destinatario_cargo and destinatario_cargo.strip() not in ("", "---"):
            dest_lines.append(destinatario_cargo.upper())
        if destinatario_dependencia and destinatario_dependencia.strip() not in ("", "---"):
            dep_text = destinatario_dependencia.upper()
            if not dep_text.endswith('.'):
                dep_text += '.'
            dest_lines.append(dep_text)
        dest_lines.append('PRESENTE.')
        for line in dest_lines:
            elements.append(Paragraph(f'<b>{line}</b>', s_bold))
        elements.append(Spacer(1, 14))

        # ── Cuerpo ──────────────────────────────────────────────────────────
        body_text = "\n\n".join(
            s for s in [seccion_fundamento, seccion_referencia,
                        seccion_objeto, seccion_cierre]
            if s and s.strip()
        )
        if body_text:
            for paragraph_text in body_text.split("\n\n"):
                paragraph_text = paragraph_text.strip()
                if not paragraph_text:
                    continue
                # Escapar caracteres especiales de reportlab
                safe_text = (
                    paragraph_text
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                )
                elements.append(Paragraph(safe_text, s_justify))

        # ── Tabla Excel o imagen (si se subió) ──────────────────────────
        if tabla_datos_json and len(tabla_datos_json) > 0:
            elements.append(Spacer(1, 8))
            self._add_tabla_datos_pdf(elements, doc, tabla_datos_json)
            elements.append(Spacer(1, 8))
        elif tabla_imagen_path:
            import os
            if os.path.exists(tabla_imagen_path):
                elements.append(Spacer(1, 8))
                tabla_img = Image(tabla_imagen_path)
                # Escalar al ancho disponible manteniendo proporción
                max_w = doc.width
                iw, ih = tabla_img.imageWidth, tabla_img.imageHeight
                if iw > 0 and ih > 0:
                    ratio = min(max_w / iw, 1.0)
                    tabla_img._restrictSize(iw * ratio, ih * ratio)
                tabla_img.hAlign = "CENTER"
                elements.append(tabla_img)
                elements.append(Spacer(1, 8))

        elements.append(Spacer(1, 14))

        # ── ATENTAMENTE ───────────────────────────────────────────────────
        elements.append(Paragraph(
            '<b>ATENTAMENTE.</b>',
            ParagraphStyle("Att", parent=s_center, fontSize=11,
                           fontName="Helvetica-Bold"),
        ))

        # Espacio para firma visual o espacio en blanco
        if not sello_digital_data:
            if incluir_firma_visual:
                firma_path = FIRMAS_DIR / "firma_mafm.png"
                if firma_path.exists():
                    elements.append(Spacer(1, 4))
                    firma_img = Image(str(firma_path), width=2 * inch, height=0.6 * inch)
                    firma_img.hAlign = "CENTER"
                    elements.append(firma_img)
                    elements.append(Spacer(1, 4))
                else:
                    elements.append(Spacer(1, 50))
            else:
                elements.append(Spacer(1, 50))
        else:
            elements.append(Spacer(1, 16))

        # ── Nombre + Cargo (SIEMPRE antes del sello) ─────────────────────
        elements.append(Paragraph(
            f'<b>{firmante_nombre.upper()}.</b>',
            ParagraphStyle("Nombre", parent=s_center, fontName="Helvetica-Bold"),
        ))
        elements.append(Paragraph(
            f'<b>{firmante_cargo.upper()}.</b>',
            ParagraphStyle("Cargo", parent=s_center, fontName="Helvetica-Bold"),
        ))

        # ── Sello digital (si firmado) — DESPUÉS del nombre ──────────────
        if sello_digital_data:
            self._add_sello_digital_pdf(
                elements, doc,
                sello_digital_data, s_firma_label, s_firma_value,
            )

        # ── Copias ──────────────────────────────────────────────────────────
        if copias:
            s_copias = ParagraphStyle(
                "OfCopias", parent=s_normal,
                fontSize=7, leading=9,
            )
            elements.append(Spacer(1, 24))
            for i, copia in enumerate(copias):
                prefix = "c.c.p. " if i == 0 else "       "
                safe_copia = copia.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                elements.append(Paragraph(f'{prefix}{safe_copia}', s_copias))

        # ── Referencia ──────────────────────────────────────────────────────
        if referencia_elaboro or referencia_reviso:
            from app.services.correspondencia_service import generar_referencia_oficio
            elements.append(Spacer(1, 12))
            ref = generar_referencia_oficio("DIR", referencia_elaboro, referencia_reviso)
            elements.append(Paragraph(ref, s_small))

        # ── Build con membrete de fondo y valores absolutos ──────────────
        if membrete_path:
            from reportlab.lib.pagesizes import letter as _letter

            _valores_map = {
                "dependencia": "Secretaría de Finanzas y Administración",
                "subdep":      "Subsecretaría de Finanzas",
                "oficina":     "Dirección de Programación y Presupuesto",
                "nooficio":    folio_respuesta or "—",
                "expediente":  "General",
                "asunto":      asunto_corto,
            }
            _fecha_txt = f"{lugar}, {fecha_respuesta}"

            def _draw_page(canvas, _doc,
                           _path=membrete_path,
                           _vals=_valores_map,
                           _fecha=_fecha_txt):
                canvas.saveState()
                # 1) Fondo membrete
                canvas.drawImage(
                    _path, 0, 0,
                    width=_letter[0], height=_letter[1],
                    preserveAspectRatio=False,
                    mask="auto",
                )
                # 2) Valores en coordenadas exactas por campo
                canvas.setFont(MEMBRETE_FONT, MEMBRETE_FONTSIZE)
                canvas.setFillColor(colors.HexColor("#1a1a1a"))
                for campo in MEMBRETE_CAMPOS:
                    val = _vals.get(campo["key"], "")
                    canvas.drawString(campo["x"], campo["y"],
                                      val[:MEMBRETE_MAX_CHARS])
                # 3) Fecha (alineada a la derecha)
                canvas.setFont("Helvetica", 9)
                canvas.drawRightString(
                    _letter[0] - 0.87 * 72,
                    MEMBRETE_FECHA_Y,
                    _fecha,
                )
                canvas.restoreState()

            doc.build(elements, onFirstPage=_draw_page, onLaterPages=_draw_page)
        else:
            doc.build(elements)

        return buffer.getvalue()

    def _add_tabla_datos_pdf(self, elements: list, doc, tabla_datos: list[list[str]]) -> None:
        """Inserta una tabla con datos Excel en el PDF."""
        if not tabla_datos or not tabla_datos[0]:
            return

        num_cols = max(len(row) for row in tabla_datos)
        # Calcular ancho de columnas proporcional
        col_width = doc.width / num_cols

        s_cell = ParagraphStyle(
            "TabCell", fontSize=7, fontName="Helvetica", leading=9,
            textColor=colors.HexColor("#333333"),
        )
        s_cell_header = ParagraphStyle(
            "TabCellH", fontSize=7, fontName="Helvetica-Bold", leading=9,
            textColor=colors.HexColor("#333333"),
        )

        table_rows = []
        for i, row_data in enumerate(tabla_datos):
            style = s_cell_header if i == 0 else s_cell
            cells = []
            for j in range(num_cols):
                cell_text = row_data[j] if j < len(row_data) else ""
                safe = cell_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                cells.append(Paragraph(safe, style))
            table_rows.append(cells)

        pdf_table = Table(table_rows, colWidths=[col_width] * num_cols)
        style_cmds = [
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#333333")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            # Header row background
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8E8")),
        ]
        pdf_table.setStyle(TableStyle(style_cmds))
        pdf_table.hAlign = "CENTER"
        elements.append(pdf_table)

    @staticmethod
    def _truncar_asunto(asunto: str, max_chars: int = 55) -> str:
        """Trunca el asunto para que quepa en el recuadro PDF."""
        if len(asunto) <= max_chars:
            return asunto
        return asunto[:max_chars - 3].rstrip() + "..."

    def _add_sello_digital_pdf(
        self,
        elements: list,
        doc,
        data: dict,
        s_label: ParagraphStyle,
        s_value: ParagraphStyle,
    ) -> None:
        """Agrega bloque de firma electrónica institucional al PDF (QR + datos)."""
        elements.append(Spacer(1, 14))

        qr_png_bytes = data.get("qr_png_bytes", b"")
        nombre = data.get("nombre_firmante", "")
        serial = data.get("serial_certificado", "")
        fecha = data.get("fecha_firma", "")
        correo = data.get("correo_firmante", "")
        folio = data.get("folio_firma", "")

        # Formatear fecha
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(fecha.replace("Z", "+00:00"))
            fecha_fmt = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            fecha_fmt = fecha

        # ── Estilos para el bloque de firma ──
        s_firma_titulo = ParagraphStyle(
            "FirmaTitulo",
            fontSize=7.5,
            fontName="Helvetica-Bold",
            leading=10,
            textColor=colors.HexColor("#333333"),
        )
        s_firma_dato = ParagraphStyle(
            "FirmaDato",
            fontSize=7,
            fontName="Helvetica",
            leading=9,
            textColor=colors.HexColor("#444444"),
        )

        # ── Columna derecha: datos de firma ──
        meta_lines = []
        meta_lines.append(Paragraph('<b>Firmado electrónicamente por:</b>', s_firma_titulo))
        meta_lines.append(Paragraph(nombre.upper(), s_firma_dato))
        meta_lines.append(Spacer(1, 5))
        meta_lines.append(Paragraph('<b>No.Certificado:</b>', s_firma_titulo))
        meta_lines.append(Paragraph(serial or "—", s_firma_dato))
        meta_lines.append(Spacer(1, 5))
        meta_lines.append(Paragraph('<b>Fecha:</b>', s_firma_titulo))
        meta_lines.append(Paragraph(fecha_fmt, s_firma_dato))
        meta_lines.append(Spacer(1, 5))
        meta_lines.append(Paragraph('<b>Folio:</b>', s_firma_titulo))
        meta_lines.append(Paragraph(folio or "—", s_firma_dato))
        meta_lines.append(Spacer(1, 5))
        meta_lines.append(Paragraph('<b>Correo electrónico:</b>', s_firma_titulo))
        meta_lines.append(Paragraph(correo or "—", s_firma_dato))

        # Crear mini-table interna para apilar los datos en una celda
        meta_table = Table(
            [[item] for item in meta_lines],
            colWidths=[doc.width - 2 * inch],
        )
        meta_table.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))

        # ── QR image ──
        qr_size = 1.4 * inch  # ~3.5cm
        if qr_png_bytes:
            qr_stream = io.BytesIO(qr_png_bytes)
            qr_img = Image(qr_stream, width=qr_size, height=qr_size)
        else:
            qr_img = Paragraph("[QR]", s_firma_dato)

        # ── Tabla principal: QR izq | Datos der ──
        firma_table = Table(
            [[qr_img, meta_table]],
            colWidths=[1.8 * inch, doc.width - 1.8 * inch],
        )
        firma_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (0, 0), "CENTER"),
            ("LEFTPADDING", (0, 0), (0, 0), 6),
            ("RIGHTPADDING", (0, 0), (0, 0), 6),
            ("LEFTPADDING", (1, 0), (1, 0), 10),
            ("RIGHTPADDING", (1, 0), (1, 0), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            # Borde sutil alrededor del bloque completo
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            # Línea separadora vertical entre QR y datos
            ("LINEAFTER", (0, 0), (0, -1), 0.5, colors.HexColor("#DDDDDD")),
        ]))

        elements.append(firma_table)


# Singleton
oficio_pdf_service = OficioPdfService()
