"""
Servicio de Constancia de Firma Electrónica — Genera PDF oficial.

Genera un PDF profesional con:
  - Logo gobierno + encabezado institucional
  - Título: "CONSTANCIA DE FIRMA ELECTRÓNICA AVANZADA"
  - Tabla con info del documento (asunto, folio, fecha, remitente)
  - Sección criptográfica: hash, cadena, sello, serial, RFC, vigencia
  - QR de verificación (embebido)
  - URL de verificación
  - Pie institucional

Dependencias:
  - reportlab==4.0.7
  - qrcode[pil]>=7.4 (para QR embebido)
"""
import io
import json
import os
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Color institucional guinda
GUINDA = colors.HexColor("#911A3A")
GUINDA_LIGHT = colors.HexColor("#FDF0F3")
EMERALD = colors.HexColor("#065F46")
EMERALD_LIGHT = colors.HexColor("#D1FAE5")

QR_DIR = Path("uploads/qr_firmas")


class ConstanciaFirmaService:
    """Genera PDF de constancia de firma electrónica."""

    def generar_constancia_pdf(
        self,
        *,
        documento_id: str,
        asunto: str,
        folio_respuesta: str,
        numero_oficio_origen: str = "",
        remitente_nombre: str = "",
        remitente_dependencia: str = "",
        area_turno_nombre: str = "",
        firma_metadata: dict,
        version: int = 1,
    ) -> bytes:
        """
        Genera un PDF de constancia de firma electrónica.

        Returns:
            bytes del PDF generado
        """
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            topMargin=0.8 * inch,
            bottomMargin=0.6 * inch,
            leftMargin=0.75 * inch,
            rightMargin=0.75 * inch,
        )

        styles = getSampleStyleSheet()
        elements = []

        # ── Estilos personalizados ───────────────────────────────────────────
        title_style = ParagraphStyle(
            "Title",
            parent=styles["Title"],
            fontSize=14,
            textColor=GUINDA,
            spaceAfter=6,
            alignment=1,
            fontName="Helvetica-Bold",
        )
        subtitle_style = ParagraphStyle(
            "Subtitle",
            parent=styles["Normal"],
            fontSize=9,
            textColor=colors.gray,
            alignment=1,
            spaceAfter=12,
        )
        section_header = ParagraphStyle(
            "SectionHeader",
            parent=styles["Normal"],
            fontSize=10,
            textColor=GUINDA,
            fontName="Helvetica-Bold",
            spaceAfter=6,
            spaceBefore=12,
        )
        normal_style = ParagraphStyle(
            "CustomNormal",
            parent=styles["Normal"],
            fontSize=9,
            textColor=colors.black,
            leading=12,
        )
        mono_style = ParagraphStyle(
            "Mono",
            parent=styles["Normal"],
            fontSize=7,
            fontName="Courier",
            textColor=colors.HexColor("#374151"),
            leading=9,
            wordWrap="CJK",
        )

        # ── Encabezado ──────────────────────────────────────────────────────
        elements.append(Paragraph(
            "GOBIERNO DEL ESTADO DE MICHOACÁN DE OCAMPO",
            ParagraphStyle("GobHeader", parent=styles["Normal"], fontSize=8,
                           textColor=colors.gray, alignment=1, spaceAfter=2),
        ))
        elements.append(Paragraph(
            "Secretaría de Finanzas y Administración",
            ParagraphStyle("SFAHeader", parent=styles["Normal"], fontSize=9,
                           textColor=GUINDA, alignment=1, spaceAfter=2,
                           fontName="Helvetica-Bold"),
        ))
        elements.append(Paragraph(
            "Dirección de Programación y Presupuesto",
            ParagraphStyle("DPPHeader", parent=styles["Normal"], fontSize=8,
                           textColor=colors.gray, alignment=1, spaceAfter=12),
        ))

        # Línea divisoria
        elements.append(Table(
            [[""]], colWidths=[doc.width],
            style=TableStyle([
                ("LINEBELOW", (0, 0), (-1, -1), 1.5, GUINDA),
            ]),
        ))
        elements.append(Spacer(1, 12))

        # ── Título ──────────────────────────────────────────────────────────
        elements.append(Paragraph(
            "CONSTANCIA DE FIRMA ELECTRÓNICA AVANZADA",
            title_style,
        ))
        elements.append(Paragraph(
            f"Documento ID: {documento_id}",
            subtitle_style,
        ))

        # ── Información del documento ────────────────────────────────────────
        elements.append(Paragraph("INFORMACIÓN DEL DOCUMENTO", section_header))

        doc_data = [
            ["Asunto:", asunto[:100]],
            ["Folio de respuesta:", folio_respuesta or "—"],
            ["No. oficio origen:", numero_oficio_origen or "—"],
            ["Remitente:", remitente_nombre or "—"],
            ["Dependencia:", remitente_dependencia or "—"],
            ["Área de turno:", area_turno_nombre or "—"],
            ["Versión:", str(version)],
        ]

        doc_table = Table(doc_data, colWidths=[1.8 * inch, 4.7 * inch])
        doc_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#374151")),
            ("TEXTCOLOR", (1, 0), (1, -1), colors.black),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [GUINDA_LIGHT, colors.white]),
        ]))
        elements.append(doc_table)

        # ── Sección criptográfica ────────────────────────────────────────────
        elements.append(Spacer(1, 8))
        elements.append(Paragraph("DATOS CRIPTOGRÁFICOS DE LA FIRMA", section_header))

        hash_doc = firma_metadata.get("hash_documento", "—")
        cadena = firma_metadata.get("cadena_original", "—")
        sello = firma_metadata.get("sello_digital", "—")
        fecha = firma_metadata.get("fecha_firma", "—")
        rfc = firma_metadata.get("rfc_firmante", "—")
        nombre = firma_metadata.get("nombre_firmante", "—")
        serial = firma_metadata.get("serial_certificado", "—")
        valido_desde = firma_metadata.get("certificado_valido_desde", "—")
        valido_hasta = firma_metadata.get("certificado_valido_hasta", "—")
        algoritmo = firma_metadata.get("algoritmo", "SHA256withRSA")

        # Formatear fecha
        try:
            fecha_fmt = datetime.fromisoformat(fecha.replace("Z", "+00:00")).strftime(
                "%d/%m/%Y %H:%M:%S UTC"
            )
        except Exception:
            fecha_fmt = fecha

        crypto_data = [
            ["Hash SHA-256:", hash_doc],
            ["Cadena original:", cadena[:80] + ("..." if len(cadena) > 80 else "")],
            ["Sello digital:", sello[:80] + ("..." if len(sello) > 80 else "")],
            ["Algoritmo:", algoritmo],
            ["Fecha de firma:", fecha_fmt],
            ["RFC firmante:", rfc],
            ["Nombre firmante:", nombre],
            ["No. serie certificado:", str(serial)[:40]],
            ["Válido desde:", valido_desde[:30] if valido_desde else "—"],
            ["Válido hasta:", valido_hasta[:30] if valido_hasta else "—"],
        ]

        crypto_table = Table(crypto_data, colWidths=[1.8 * inch, 4.7 * inch])
        crypto_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 0), (1, -1), "Courier"),
            ("FONTSIZE", (0, 0), (0, -1), 8),
            ("FONTSIZE", (1, 0), (1, -1), 7),
            ("TEXTCOLOR", (0, 0), (0, -1), EMERALD),
            ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#1F2937")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [EMERALD_LIGHT, colors.white]),
        ]))
        elements.append(crypto_table)

        # ── Datos completos (sin truncar) ────────────────────────────────────
        elements.append(Spacer(1, 8))
        elements.append(Paragraph("CADENA ORIGINAL COMPLETA", section_header))
        elements.append(Paragraph(cadena, mono_style))

        elements.append(Spacer(1, 6))
        elements.append(Paragraph("SELLO DIGITAL COMPLETO", section_header))
        elements.append(Paragraph(sello, mono_style))

        # ── QR de verificación ───────────────────────────────────────────────
        elements.append(Spacer(1, 12))
        qr_path = QR_DIR / f"qr_{documento_id}.png"
        if qr_path.exists():
            elements.append(Paragraph("VERIFICACIÓN", section_header))
            qr_img = Image(str(qr_path), width=1.5 * inch, height=1.5 * inch)
            url_text = Paragraph(
                f'<font size="7" color="#911A3A">https://pigop.michoacan.gob.mx/verificar/{documento_id}</font>',
                ParagraphStyle("URL", parent=styles["Normal"], alignment=1),
            )

            qr_table = Table(
                [[qr_img, url_text]],
                colWidths=[1.8 * inch, 4.7 * inch],
            )
            qr_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (0, 0), "CENTER"),
                ("ALIGN", (1, 0), (1, 0), "LEFT"),
            ]))
            elements.append(qr_table)

        # ── Línea divisoria final ────────────────────────────────────────────
        elements.append(Spacer(1, 16))
        elements.append(Table(
            [[""]], colWidths=[doc.width],
            style=TableStyle([
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.gray),
            ]),
        ))

        # ── Pie institucional ────────────────────────────────────────────────
        elements.append(Spacer(1, 6))
        elements.append(Paragraph(
            "Este documento ha sido firmado electrónicamente mediante el sistema PIGOP "
            "(Plataforma Integral de Gestión y Optimización Presupuestaria) de la "
            "Secretaría de Finanzas y Administración del Gobierno del Estado de Michoacán.",
            ParagraphStyle("Footer", parent=styles["Normal"], fontSize=7,
                           textColor=colors.gray, alignment=1, leading=9),
        ))
        elements.append(Spacer(1, 4))
        elements.append(Paragraph(
            f"Generado: {datetime.utcnow().strftime('%d/%m/%Y %H:%M:%S UTC')}",
            ParagraphStyle("Timestamp", parent=styles["Normal"], fontSize=6,
                           textColor=colors.lightgrey, alignment=1),
        ))

        # ── Build ────────────────────────────────────────────────────────────
        doc.build(elements)
        return buffer.getvalue()


# Singleton
constancia_firma_service = ConstanciaFirmaService()
