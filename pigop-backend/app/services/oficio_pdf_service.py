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

        # ── Header institucional ────────────────────────────────────────────
        header_path = LOGOS_DIR / "header_dpp.png"
        if header_path.exists():
            img = Image(str(header_path), width=6.5 * inch, height=0.75 * inch)
            img.hAlign = "CENTER"
            elements.append(img)
        else:
            elements.append(Paragraph(
                '<font color="#911A3A"><b>SECRETARÍA DE FINANZAS Y ADMINISTRACIÓN</b></font>',
                ParagraphStyle("H1", parent=s_center, fontSize=10, textColor=GUINDA),
            ))
            elements.append(Paragraph(
                '<font color="#911A3A"><b>DIRECCIÓN DE PROGRAMACIÓN Y PRESUPUESTO</b></font>',
                ParagraphStyle("H2", parent=s_center, fontSize=9, textColor=GUINDA),
            ))

        # Línea separadora guinda
        elements.append(Spacer(1, 4))
        elements.append(Table(
            [[""]],
            colWidths=[doc.width],
            style=TableStyle([
                ("LINEBELOW", (0, 0), (-1, -1), 1.5, GUINDA),
            ]),
        ))
        elements.append(Spacer(1, 10))

        # ── Folio + Fecha (derecha) ─────────────────────────────────────────
        elements.append(Paragraph(
            f'<b>OFICIO No. {folio_respuesta}</b>',
            s_right,
        ))
        elements.append(Paragraph(
            f'{lugar}, {fecha_respuesta}',
            s_right,
        ))
        elements.append(Spacer(1, 24))

        # ── Destinatario ────────────────────────────────────────────────────
        elements.append(Paragraph(f'<b>C. {destinatario_nombre.upper()}</b>', s_bold))
        elements.append(Paragraph(f'<b>{destinatario_cargo.upper()}</b>', s_bold))
        elements.append(Paragraph(f'<b>{destinatario_dependencia.upper()}.</b>', s_bold))
        elements.append(Paragraph('<b>PRESENTE.</b>', s_bold))
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
            elements.append(Spacer(1, 24))
            for i, copia in enumerate(copias):
                prefix = "c.c.p.- " if i == 0 else "        "
                elements.append(Paragraph(f'{prefix}{copia}', s_small))

        # ── Referencia ──────────────────────────────────────────────────────
        if referencia_elaboro or referencia_reviso:
            elements.append(Spacer(1, 12))
            ref = f"MAFM/{referencia_elaboro or '???'}/{referencia_reviso or '???'}"
            elements.append(Paragraph(ref, s_small))

        # ── Build ───────────────────────────────────────────────────────────
        doc.build(elements)
        return buffer.getvalue()

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
