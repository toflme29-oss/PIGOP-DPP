"""
Servicio OCR — Fase 3.

Extrae texto plano de archivos adjuntos para alimentar a Gemini:
  - PDF con texto nativo  →  pypdf
  - PDF escaneado/imagen  →  Gemini Vision (fallback)
  - XML (CFDI)            →  lectura directa de bytes
  - Imágenes              →  Gemini Vision

Uso:
    from app.services.ocr_service import ocr_service
    texto = await ocr_service.extraer_texto(file_bytes, mime_type, nombre)
"""
import io
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class OCRService:
    """Extrae texto de documentos en múltiples formatos."""

    MIN_TEXTO_UTIL = 50   # caracteres mínimos para considerar extracción exitosa

    # ── API pública ────────────────────────────────────────────────────────────

    async def extraer_texto(
        self,
        file_bytes: bytes,
        mime_type: str,
        nombre_archivo: str = "",
    ) -> Tuple[str, str]:
        """
        Extrae texto del archivo.

        Returns:
            (texto, metodo) donde metodo es "pypdf", "xml_directo" o "gemini_vision"
        """
        mime = (mime_type or "").lower()

        if mime in ("text/xml", "application/xml") or nombre_archivo.lower().endswith(".xml"):
            return self._extraer_xml(file_bytes), "xml_directo"

        if mime == "application/pdf" or nombre_archivo.lower().endswith(".pdf"):
            texto, metodo = await self._extraer_pdf(file_bytes)
            return texto, metodo

        if mime in ("image/jpeg", "image/png", "image/tiff", "image/webp"):
            texto = await self._extraer_imagen_gemini(file_bytes, mime)
            return texto, "gemini_vision"

        # Fallback: intentar como texto plano
        try:
            return file_bytes.decode("utf-8", errors="replace"), "texto_plano"
        except Exception:
            return "", "sin_texto"

    async def extraer_texto_documento(
        self,
        file_bytes: bytes,
        mime_type: str,
        tipo_documento: str,
        nombre_archivo: str = "",
    ) -> dict:
        """
        Extrae texto y retorna dict con metadatos útiles para IA.
        """
        texto, metodo = await self.extraer_texto(file_bytes, mime_type, nombre_archivo)
        return {
            "texto": texto,
            "metodo_extraccion": metodo,
            "longitud": len(texto),
            "tiene_contenido": len(texto) >= self.MIN_TEXTO_UTIL,
            "tipo_documento": tipo_documento,
            "nombre_archivo": nombre_archivo,
        }

    # ── Extracción XML ─────────────────────────────────────────────────────────

    def _extraer_xml(self, file_bytes: bytes) -> str:
        """
        Retorna el contenido XML como texto (decodificado).
        Para CFDIs: el contenido completo se pasa al prompt de Gemini.
        """
        for enc in ("utf-8", "utf-8-sig", "latin-1", "iso-8859-1"):
            try:
                return file_bytes.decode(enc)
            except UnicodeDecodeError:
                continue
        return file_bytes.decode("utf-8", errors="replace")

    # ── Extracción PDF ─────────────────────────────────────────────────────────

    async def _extraer_pdf(self, file_bytes: bytes) -> Tuple[str, str]:
        """
        Intenta extraer texto con pypdf.
        Si el PDF está escaneado (sin texto útil), usa Gemini Vision.
        """
        texto = self._pypdf_extract(file_bytes)

        if len(texto.strip()) >= self.MIN_TEXTO_UTIL:
            return texto, "pypdf"

        # PDF escaneado o protegido → Gemini Vision
        logger.info("PDF sin texto nativo detectado, usando Gemini Vision...")
        texto_vision = await self._extraer_imagen_gemini(
            file_bytes, "application/pdf"
        )
        if texto_vision:
            return texto_vision, "gemini_vision"

        # Retornar lo que se pudo aunque sea poco
        return texto, "pypdf_parcial"

    def _pypdf_extract(self, file_bytes: bytes) -> str:
        """Extrae texto de un PDF con texto nativo usando pypdf."""
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(file_bytes))
            paginas = []
            for page in reader.pages:
                try:
                    paginas.append(page.extract_text() or "")
                except Exception as pe:
                    logger.debug(f"Error extracting page: {pe}")
            return "\n\n".join(paginas)
        except ImportError:
            logger.warning("pypdf no instalado. Instala: pip install pypdf")
            return ""
        except Exception as e:
            logger.warning(f"pypdf error: {e}")
            return ""

    # ── Extracción por Gemini Vision ───────────────────────────────────────────

    async def _extraer_imagen_gemini(
        self, file_bytes: bytes, mime_type: str
    ) -> str:
        """
        Extrae texto de imágenes y PDFs escaneados usando Gemini Vision.
        Solo se ejecuta si Gemini está disponible.
        """
        try:
            from app.services.gemini_service import gemini_service

            if not gemini_service.available:
                return ""

            import google.generativeai as genai

            model = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                "Extrae TODO el texto visible en este documento tal como aparece, "
                "sin reformatear ni resumir. Incluye fechas, números, nombres, importes, "
                "RFC, folios y cualquier otro dato textual. "
                "Si es un formulario, incluye etiquetas y valores."
            )
            resp = model.generate_content([
                prompt,
                {"mime_type": mime_type, "data": file_bytes},
            ])
            return resp.text or ""
        except Exception as e:
            logger.error(f"Gemini Vision OCR error: {e}")
            return ""

    # ── Utilidades ─────────────────────────────────────────────────────────────

    def limpiar_texto(self, texto: str, max_chars: int = 6000) -> str:
        """
        Limpia y trunca texto para enviar a Gemini.
        Elimina múltiples espacios en blanco y líneas vacías.
        """
        import re
        # Colapsar múltiples líneas vacías
        texto = re.sub(r"\n{3,}", "\n\n", texto)
        # Colapsar múltiples espacios
        texto = re.sub(r" {3,}", "  ", texto)
        return texto.strip()[:max_chars]


# Singleton
ocr_service = OCRService()
