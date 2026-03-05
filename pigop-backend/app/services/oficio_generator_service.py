"""
Servicio de generacion de oficios en formato DOCX.

Genera documentos oficiales de la DPP con formato institucional
del Gobierno del Estado de Michoacan, basado en el modelo de oficio
oficial proporcionado.
"""
import io
from pathlib import Path
from typing import Optional

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

STATIC_DIR = Path(__file__).parent.parent / "static"
LOGOS_DIR = STATIC_DIR / "logos"
FIRMAS_DIR = STATIC_DIR / "firmas"

GUINDA = RGBColor(0x91, 0x1A, 0x3A)

MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


class OficioGeneratorService:
    """Genera documentos DOCX institucionales para la DPP."""

    def generar_oficio_respuesta(
        self,
        *,
        folio_respuesta: str,
        fecha_respuesta: str,
        lugar: str = "Morelia, Michoacán",
        destinatario_nombre: str,
        destinatario_cargo: str,
        destinatario_dependencia: str,
        seccion_fundamento: str,
        seccion_referencia: str,
        seccion_objeto: str,
        seccion_cierre: str,
        firmante_nombre: str = "Mtro. Marco Antonio Flores Mejía",
        firmante_cargo: str = "Director de Programación y Presupuesto",
        referencia_elaboro: Optional[str] = None,
        referencia_reviso: Optional[str] = None,
        copias: Optional[list[str]] = None,
        incluir_firma_visual: bool = False,
        sello_digital_data: Optional[dict] = None,
    ) -> bytes:
        """
        Genera un oficio de respuesta completo en formato DOCX.
        Retorna los bytes del archivo .docx.
        """
        doc = Document()

        self._set_page_margins(doc)
        self._set_default_font(doc)
        self._add_header_image(doc)
        self._add_separator_line(doc)
        self._add_folio_fecha(doc, folio_respuesta, lugar, fecha_respuesta)
        self._add_empty_lines(doc, 2)
        self._add_destinatario(doc, destinatario_nombre, destinatario_cargo, destinatario_dependencia)
        self._add_empty_lines(doc, 1)

        # Cuerpo: 4 secciones
        body_text = "\n\n".join(
            s for s in [seccion_fundamento, seccion_referencia, seccion_objeto, seccion_cierre]
            if s and s.strip()
        )
        if body_text:
            self._add_body_text(doc, body_text)

        self._add_empty_lines(doc, 1)
        self._add_atentamente(doc)

        # Espacio para firma visual o espacio en blanco
        if sello_digital_data is None:
            if incluir_firma_visual:
                firma_path = FIRMAS_DIR / "firma_mafm.png"
                if firma_path.exists():
                    pf = doc.add_paragraph()
                    pf.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    pf.paragraph_format.space_after = Pt(0)
                    run_img = pf.add_run()
                    run_img.add_picture(str(firma_path), width=Inches(2))
                else:
                    self._add_empty_lines(doc, 4)
            else:
                self._add_empty_lines(doc, 4)
        else:
            self._add_empty_lines(doc, 2)

        # Nombre + Cargo SIEMPRE antes del sello
        self._add_firmante_nombre(doc, firmante_nombre, firmante_cargo)

        # Sello digital DESPUÉS del nombre (si aplica)
        if sello_digital_data is not None:
            self._add_sello_digital(
                doc,
                qr_png_bytes=sello_digital_data.get("qr_png_bytes", b""),
                nombre_firmante=sello_digital_data.get("nombre_firmante", ""),
                cargo_firmante=sello_digital_data.get("cargo_firmante", "Director de Programación y Presupuesto"),
                rfc_firmante=sello_digital_data.get("rfc_firmante", ""),
                serial_certificado=sello_digital_data.get("serial_certificado", ""),
                fecha_firma=sello_digital_data.get("fecha_firma", ""),
                correo_firmante=sello_digital_data.get("correo_firmante", ""),
                folio_firma=sello_digital_data.get("folio_firma", ""),
            )

        if copias:
            self._add_empty_lines(doc, 2)
            self._add_copias(doc, copias)

        if referencia_elaboro or referencia_reviso:
            self._add_referencia(doc, referencia_elaboro, referencia_reviso)

        buffer = io.BytesIO()
        doc.save(buffer)
        return buffer.getvalue()

    # ------- Internos -------

    def _set_page_margins(self, doc: Document) -> None:
        """Pagina carta con margenes del modelo oficial."""
        for section in doc.sections:
            section.page_width = Emu(7772400)     # ~21.6cm (carta)
            section.page_height = Emu(10058400)   # ~26.4cm (carta)
            section.top_margin = Cm(1.5)
            section.bottom_margin = Cm(1.5)
            section.left_margin = Cm(2.8)
            section.right_margin = Cm(2.2)

    def _set_default_font(self, doc: Document) -> None:
        """Establece la fuente por defecto."""
        style = doc.styles["Normal"]
        font = style.font
        font.name = "Arial"
        font.size = Pt(11)
        style.paragraph_format.space_after = Pt(0)
        style.paragraph_format.space_before = Pt(0)

    def _add_header_image(self, doc: Document) -> None:
        """Agrega la imagen del membrete institucional."""
        header_path = LOGOS_DIR / "header_dpp.png"
        if not header_path.exists():
            # Fallback: texto simple
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run("SECRETARÍA DE FINANZAS Y ADMINISTRACIÓN")
            run.bold = True
            run.font.size = Pt(10)
            run.font.color.rgb = GUINDA
            p2 = doc.add_paragraph()
            p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run2 = p2.add_run("DIRECCIÓN DE PROGRAMACIÓN Y PRESUPUESTO")
            run2.bold = True
            run2.font.size = Pt(9)
            run2.font.color.rgb = GUINDA
            return

        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run()
        # Ancho de contenido: ~16.6cm (pagina 21.6 - margenes 5.0)
        run.add_picture(str(header_path), width=Cm(16.6))

    def _add_separator_line(self, doc: Document) -> None:
        """Agrega linea separadora guinda."""
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(8)
        # Linea mediante border bottom en el parrafo
        pPr = p._p.get_or_add_pPr()
        pBdr = pPr.makeelement(qn("w:pBdr"), {})
        bottom = pBdr.makeelement(
            qn("w:bottom"),
            {
                qn("w:val"): "single",
                qn("w:sz"): "12",
                qn("w:space"): "1",
                qn("w:color"): "911A3A",
            },
        )
        pBdr.append(bottom)
        pPr.append(pBdr)

    def _add_folio_fecha(self, doc: Document, folio: str, lugar: str, fecha: str) -> None:
        """Bloque de folio y fecha, alineado a la derecha."""
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(f"OFICIO No. {folio}")
        run.bold = True
        run.font.size = Pt(11)

        p2 = doc.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p2.paragraph_format.space_after = Pt(0)
        run2 = p2.add_run(f"{lugar}, {fecha}")
        run2.font.size = Pt(11)

    def _add_empty_lines(self, doc: Document, count: int) -> None:
        """Agrega lineas vacias."""
        for _ in range(count):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.space_before = Pt(0)

    def _add_destinatario(
        self, doc: Document,
        nombre: str, cargo: str, dependencia: str,
    ) -> None:
        """Bloque de destinatario."""
        for text in [f"C. {nombre.upper()}", cargo.upper(), dependencia.upper() + ".", "PRESENTE."]:
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(text)
            run.bold = True
            run.font.size = Pt(11)

    def _add_body_text(self, doc: Document, text: str) -> None:
        """Agrega el cuerpo del oficio con formato justificado."""
        for paragraph_text in text.split("\n\n"):
            paragraph_text = paragraph_text.strip()
            if not paragraph_text:
                continue
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.space_after = Pt(6)
            p.paragraph_format.line_spacing = 1.15
            # Primera linea con sangria
            p.paragraph_format.first_line_indent = Cm(1.0)
            run = p.add_run(paragraph_text)
            run.font.name = "Arial"
            run.font.size = Pt(11)

    def _add_atentamente(self, doc: Document) -> None:
        """Agrega solo la palabra ATENTAMENTE centrada con espaciado."""
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run("ATENTAMENTE.")
        run.bold = True
        run.font.size = Pt(11)

    def _add_firmante_nombre(self, doc: Document, nombre: str, cargo: str) -> None:
        """Agrega nombre y cargo del firmante centrados."""
        # Nombre
        p_name = doc.add_paragraph()
        p_name.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_name.paragraph_format.space_after = Pt(0)
        run_name = p_name.add_run(f"{nombre.upper()}.")
        run_name.bold = True
        run_name.font.size = Pt(11)

        # Cargo
        p_cargo = doc.add_paragraph()
        p_cargo.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p_cargo.paragraph_format.space_after = Pt(0)
        run_cargo = p_cargo.add_run(f"{cargo.upper()}.")
        run_cargo.bold = True
        run_cargo.font.size = Pt(11)

    def _add_copias(self, doc: Document, copias: list[str]) -> None:
        """Bloque de copias (c.c.p.)."""
        for i, copia in enumerate(copias):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            prefix = "c.c.p.- " if i == 0 else "\t"
            run = p.add_run(f"{prefix}{copia}")
            run.font.size = Pt(6)
            run.font.color.rgb = RGBColor(0, 0, 0)

    def _add_referencia(
        self, doc: Document,
        elaboro: Optional[str], reviso: Optional[str],
    ) -> None:
        """Referencia interna: MAFM/elaboro/reviso."""
        self._add_empty_lines(doc, 1)
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        ref = f"MAFM/{elaboro or '???'}/{reviso or '???'}"
        run = p.add_run(ref)
        run.font.size = Pt(6)
        run.font.color.rgb = RGBColor(0, 0, 0)

    def _add_sello_digital(
        self,
        doc: Document,
        qr_png_bytes: bytes,
        nombre_firmante: str,
        cargo_firmante: str,
        rfc_firmante: str,
        serial_certificado: str,
        fecha_firma: str,
        correo_firmante: str = "",
        folio_firma: str = "",
    ) -> None:
        """
        Agrega bloque de firma electrónica institucional.
        Diseño: línea separadora + tabla [QR | Datos] con borde sutil.
        El nombre y cargo ya están arriba de este bloque.
        """
        from datetime import datetime

        # --- Línea separadora delgada gris ---
        self._add_empty_lines(doc, 1)
        p_sep = doc.add_paragraph()
        p_sep.paragraph_format.space_before = Pt(4)
        p_sep.paragraph_format.space_after = Pt(6)
        pPr = p_sep._p.get_or_add_pPr()
        pBdr = pPr.makeelement(qn("w:pBdr"), {})
        bottom = pBdr.makeelement(
            qn("w:bottom"),
            {qn("w:val"): "single", qn("w:sz"): "4", qn("w:space"): "1", qn("w:color"): "CCCCCC"},
        )
        pBdr.append(bottom)
        pPr.append(pBdr)

        # --- Tabla 2 columnas: QR | Datos de firma ---
        table = doc.add_table(rows=1, cols=2)
        table.autofit = False

        # Eliminar bordes predeterminados de la tabla
        tbl = table._tbl
        tblPr = tbl.tblPr if tbl.tblPr is not None else tbl.makeelement(qn("w:tblPr"), {})
        tblBorders = tblPr.makeelement(qn("w:tblBorders"), {})
        for border_name in ("top", "left", "bottom", "right", "insideH", "insideV"):
            border_el = tblBorders.makeelement(
                qn(f"w:{border_name}"),
                {qn("w:val"): "single", qn("w:sz"): "4", qn("w:space"): "0",
                 qn("w:color"): "DDDDDD" if border_name in ("insideV",) else "CCCCCC"},
            )
            tblBorders.append(border_el)
        tblPr.append(tblBorders)
        if tbl.tblPr is None:
            tbl.insert(0, tblPr)

        # Ancho de columnas: QR ~4cm | Datos ~12cm
        table.columns[0].width = Cm(4)
        table.columns[1].width = Cm(12)
        row = table.rows[0]

        # --- Columna izquierda: imagen QR (más grande ~3.5cm) ---
        cell_qr = row.cells[0]
        cell_qr.width = Cm(4)
        p_qr = cell_qr.paragraphs[0]
        p_qr.alignment = WD_ALIGN_PARAGRAPH.CENTER
        # Centrar verticalmente la celda del QR
        tc_pr = cell_qr._tc.get_or_add_tcPr()
        v_align = tc_pr.makeelement(qn("w:vAlign"), {qn("w:val"): "center"})
        tc_pr.append(v_align)
        if qr_png_bytes:
            run_qr = p_qr.add_run()
            qr_stream = io.BytesIO(qr_png_bytes)
            run_qr.add_picture(qr_stream, width=Cm(3.5))

        # --- Columna derecha: datos de firma ---
        cell_meta = row.cells[1]
        cell_meta.width = Cm(12)
        # Centrar verticalmente
        tc_pr2 = cell_meta._tc.get_or_add_tcPr()
        v_align2 = tc_pr2.makeelement(qn("w:vAlign"), {qn("w:val"): "center"})
        tc_pr2.append(v_align2)

        # Formatear fecha
        try:
            dt = datetime.fromisoformat(fecha_firma.replace("Z", "+00:00"))
            fecha_fmt = dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            fecha_fmt = fecha_firma

        # Datos de firma como pares etiqueta/valor
        firma_fields = [
            ("Firmado electrónicamente por:", nombre_firmante.upper()),
            ("No.Certificado:", serial_certificado or "—"),
            ("Fecha:", fecha_fmt),
            ("Folio:", folio_firma or "—"),
            ("Correo electrónico:", correo_firmante or "—"),
        ]

        first = True
        for label, value in firma_fields:
            if first:
                p_meta = cell_meta.paragraphs[0]
                first = False
            else:
                p_meta = cell_meta.add_paragraph()

            p_meta.paragraph_format.space_after = Pt(1)
            p_meta.paragraph_format.space_before = Pt(3)

            # Etiqueta en bold
            run_label = p_meta.add_run(label + "\n")
            run_label.bold = True
            run_label.font.size = Pt(7)
            run_label.font.name = "Arial"
            run_label.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

            # Valor
            run_value = p_meta.add_run(value)
            run_value.bold = False
            run_value.font.size = Pt(7)
            run_value.font.name = "Arial"
            run_value.font.color.rgb = RGBColor(0x44, 0x44, 0x44)


oficio_generator = OficioGeneratorService()
