"""
Motor de Validación Inteligente con Gemini IA — Fase 3.

Pipeline:
  1. Para cada documento del DEPP:
     a. Descarga el archivo desde storage
     b. Extrae texto (OCR o lectura directa)
     c. Llama a Gemini para extraer datos estructurados
  2. Con todos los datos extraídos, pide a Gemini validar consistencia
  3. Guarda cada validación como ValidacionDEPP con tipo="normativa_ia"
  4. Actualiza puede_aprobar del DEPP

Dependencias: GeminiService, OCRService, StorageService
"""
import uuid
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.depp import DEPP, DocumentoDEPP
from app.models.validacion import ValidacionDEPP
from app.services.gemini_service import gemini_service
from app.services.ocr_service import ocr_service
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

# Tipos de documento que vale la pena procesar con IA
TIPOS_PROCESABLES = {"CFDI", "MCL", "CTT", "PCH", "AUR", "FUC", "DEPP"}


class AIValidationService:
    """
    Orquesta la validación inteligente de un expediente DEPP
    usando Gemini AI para extracción y análisis de consistencia.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Pipeline principal ─────────────────────────────────────────────────────

    async def validar_con_ia(
        self,
        depp: DEPP,
        usuario_id: Optional[str] = None,
    ) -> List[ValidacionDEPP]:
        """
        Ejecuta la validación IA del expediente completo.

        Returns:
            Lista de ValidacionDEPP persistidas (tipo="normativa_ia")
        """
        ejecutada_por = f"ia:{usuario_id}" if usuario_id else "ia"
        resultados: List[ValidacionDEPP] = []

        if not gemini_service.available:
            v = await self._guardar({
                "tipo_validacion": "normativa_ia",
                "resultado": "advertencia",
                "gravedad": "bajo",
                "articulo_manual": None,
                "descripcion_regla": "Validación IA con Gemini",
                "mensaje": (
                    "Gemini no está configurado. "
                    "Establece GEMINI_API_KEY en .env para activar la validación inteligente."
                ),
                "detalles": {"modo": "mock", "gemini_disponible": False},
            }, depp.id, ejecutada_por)
            resultados.append(v)
            return resultados

        # ── Paso 1: Extraer datos de cada documento ─────────────────────────────
        documentos_datos = await self._extraer_todos_documentos(depp.documentos)

        # ── Paso 2: Validación de consistencia con Gemini ───────────────────────
        resultado_ia = await gemini_service.validar_consistencia_expediente(
            folio=depp.folio,
            upp=depp.upp,
            beneficiario=str(depp.beneficiario or ""),
            monto_total=float(depp.monto_total or 0),
            clasificacion=str(depp.clasificador_tipo or ""),
            capitulo=int(depp.capitulo or 0),
            documentos_datos=documentos_datos,
            # Campos extendidos — nuevos en el modelo DEPP
            tipo_depp=str(depp.tipo_depp or ""),
            fuente_financiamiento=str(depp.fuente_financiamiento or ""),
            fuente_nombre=str(depp.fuente_nombre or ""),
            notas_aclaraciones=str(depp.notas_aclaraciones or ""),
            provisional_vale=str(depp.provisional_vale or ""),
            cuenta_abono=str(depp.cuenta_abono or ""),
        )

        # ── Paso 3: Guardar cada validación individual ──────────────────────────
        validaciones_gemini = resultado_ia.get("validaciones", [])
        resumen = resultado_ia.get("resumen_ia", "")

        # Detectar error retornado por Gemini (ej. rate limit, modelo no disponible)
        tiene_error_ia = any(
            "error" in str(d.get("datos_extraidos", {})).lower()
            for d in documentos_datos
            if isinstance(d.get("datos_extraidos"), dict) and "error" in d["datos_extraidos"]
        )

        if not validaciones_gemini:
            # Determinar si fue un error técnico (resumen con "Error IA:") o simplemente sin datos
            es_error_tecnico = resumen.startswith("Error IA:")
            v = await self._guardar({
                "tipo_validacion": "normativa_ia",
                "resultado": "advertencia",
                "gravedad": "medio" if es_error_tecnico else "bajo",
                "articulo_manual": None,
                "descripcion_regla": "Validación IA con Gemini",
                "mensaje": resumen if resumen else "Gemini no retornó validaciones estructuradas. Verifica la conectividad y el modelo.",
                "detalles": {
                    "respuesta_raw": str(resultado_ia)[:500],
                    "documentos_procesados": len(documentos_datos),
                    "es_error_tecnico": es_error_tecnico,
                },
            }, depp.id, ejecutada_por)
            resultados.append(v)
            return resultados

        for val in validaciones_gemini:
            tipo = f"normativa_ia_{val.get('tipo_validacion', 'GENERAL').lower()}"
            v = await self._guardar({
                "tipo_validacion": tipo,
                "resultado": val.get("resultado", "advertencia"),
                "gravedad": val.get("gravedad", "medio"),
                "articulo_manual": val.get("articulo_manual"),
                "descripcion_regla": f"IA: {val.get('tipo_validacion', '')}",
                "mensaje": val.get("mensaje", ""),
                "detalles": {
                    **(val.get("detalles") or {}),
                    "tipo_validacion_ia": val.get("tipo_validacion"),
                    "resumen_ia": resumen,
                },
            }, depp.id, ejecutada_por)
            resultados.append(v)

        # ── Paso 4: Guardar resumen general ────────────────────────────────────
        if resumen:
            v = await self._guardar({
                "tipo_validacion": "normativa_ia_resumen",
                "resultado": self._resultado_global(validaciones_gemini),
                "gravedad": self._gravedad_global(validaciones_gemini),
                "articulo_manual": None,
                "descripcion_regla": "Resumen IA del expediente",
                "mensaje": resumen,
                "detalles": {
                    "total_validaciones": len(validaciones_gemini),
                    "documentos_procesados": len(documentos_datos),
                },
            }, depp.id, ejecutada_por)
            resultados.append(v)

        # ── Paso 5: Actualizar DEPP si es necesario ─────────────────────────────
        await self._actualizar_depp_postia(depp, resultados)

        return resultados

    # ── Extracción de documentos ───────────────────────────────────────────────

    async def _extraer_todos_documentos(
        self, documentos: List[DocumentoDEPP]
    ) -> list:
        """
        Descarga y extrae datos de cada documento.
        Retorna lista de dicts con datos estructurados para Gemini.
        """
        datos = []

        for doc in documentos:
            if doc.tipo not in TIPOS_PROCESABLES:
                continue

            try:
                datos_doc = await self._procesar_documento(doc)
                datos.append(datos_doc)
            except Exception as e:
                logger.warning(f"Error procesando documento {doc.id} ({doc.tipo}): {e}")
                datos.append({
                    "tipo": doc.tipo,
                    "nombre": doc.nombre_archivo,
                    "error": str(e),
                    "datos_extraidos": {},
                })

        return datos

    async def _procesar_documento(self, doc: DocumentoDEPP) -> dict:
        """
        Procesa un documento individual:
        1. Descarga del storage
        2. Extracción de texto/OCR
        3. Extracción de datos estructurados con Gemini
        """
        resultado_base = {
            "tipo": doc.tipo,
            "nombre": doc.nombre_archivo,
            "mime_type": doc.mime_type or "",
            "datos_extraidos": {},
            "texto_extraido": "",
            "metodo_ocr": "",
        }

        # Si ya tiene datos extraídos en BD, usarlos directamente
        if doc.datos_extraidos and not doc.datos_extraidos.get("_mock"):
            resultado_base["datos_extraidos"] = doc.datos_extraidos
            return resultado_base

        if not doc.url_storage:
            resultado_base["error"] = "Sin archivo en storage"
            return resultado_base

        # Descargar archivo
        try:
            file_bytes = await storage_service.get_file_bytes(doc.url_storage)
        except FileNotFoundError:
            resultado_base["error"] = "Archivo no encontrado en storage"
            return resultado_base

        mime = doc.mime_type or ""
        nombre = doc.nombre_archivo or ""

        # ── CFDI (XML) ──────────────────────────────────────────────────────────
        if doc.tipo == "CFDI" or (
            mime in ("text/xml", "application/xml") or nombre.lower().endswith(".xml")
        ):
            texto_xml = ocr_service._extraer_xml(file_bytes)
            datos_extraidos = await gemini_service.extraer_datos_cfdi(texto_xml)
            resultado_base.update({
                "texto_extraido": texto_xml[:500],
                "metodo_ocr": "xml_directo",
                "datos_extraidos": datos_extraidos,
            })
            # Persistir en BD
            await self._actualizar_datos_documento(doc, datos_extraidos, texto_xml)

        # ── Documento PDF ───────────────────────────────────────────────────────
        elif mime == "application/pdf" or nombre.lower().endswith(".pdf"):
            texto, metodo = await ocr_service._extraer_pdf(file_bytes)
            texto_limpio = ocr_service.limpiar_texto(texto, max_chars=6000)

            if len(texto_limpio) >= ocr_service.MIN_TEXTO_UTIL:
                # PDF con texto → Gemini texto
                datos_extraidos = await gemini_service.extraer_datos_documento(
                    texto_limpio, doc.tipo
                )
            else:
                # PDF escaneado → Gemini Vision
                datos_extraidos = await gemini_service.extraer_datos_imagen(
                    file_bytes, mime, doc.tipo
                )
                metodo = "gemini_vision"

            resultado_base.update({
                "texto_extraido": texto_limpio[:300],
                "metodo_ocr": metodo,
                "datos_extraidos": datos_extraidos,
            })
            await self._actualizar_datos_documento(doc, datos_extraidos, texto_limpio[:5000])

        # ── Imagen ──────────────────────────────────────────────────────────────
        elif mime.startswith("image/"):
            datos_extraidos = await gemini_service.extraer_datos_imagen(
                file_bytes, mime, doc.tipo
            )
            resultado_base.update({
                "metodo_ocr": "gemini_vision",
                "datos_extraidos": datos_extraidos,
            })
            await self._actualizar_datos_documento(doc, datos_extraidos, "")

        return resultado_base

    # ── Helpers de persistencia ────────────────────────────────────────────────

    async def _actualizar_datos_documento(
        self, doc: DocumentoDEPP, datos: dict, texto: str
    ) -> None:
        """Actualiza datos_extraidos y texto_extraido en el DocumentoDEPP."""
        try:
            doc.datos_extraidos = datos
            if texto:
                doc.texto_extraido = texto[:10000]
            self.db.add(doc)
            await self.db.flush()
        except Exception as e:
            logger.warning(f"No se pudo actualizar documento {doc.id}: {e}")

    async def _guardar(
        self, data: dict, depp_id: str, ejecutada_por: str
    ) -> ValidacionDEPP:
        """Persiste una ValidacionDEPP en la BD."""
        obj = ValidacionDEPP(
            id=str(uuid.uuid4()),
            depp_id=depp_id,
            tipo_validacion=data["tipo_validacion"],
            resultado=data["resultado"],
            gravedad=data.get("gravedad"),
            articulo_manual=data.get("articulo_manual"),
            descripcion_regla=data.get("descripcion_regla"),
            mensaje=data.get("mensaje"),
            detalles=data.get("detalles"),
            ejecutada_por=ejecutada_por,
        )
        self.db.add(obj)
        await self.db.flush()
        return obj

    async def _actualizar_depp_postia(
        self, depp: DEPP, validaciones: List[ValidacionDEPP]
    ) -> None:
        """
        Determina resultado final: APROBADO o RECHAZADO.

        Reglas:
        - Si hay algún resultado "error" (cualquier gravedad) → RECHAZADO
        - Si solo hay "advertencia"/"exitosa" → APROBADO (con alertas opcionales)
        - Las "advertencias" en un expediente APROBADO son alertas de supervisión,
          no impiden la aprobación salvo que sean de gravedad "critico".
        """
        tiene_error = any(v.resultado == "error" for v in validaciones)
        tiene_critico = any(
            v.resultado in ("error", "advertencia") and v.gravedad == "critico"
            for v in validaciones
        )
        rechazado = tiene_error or tiene_critico

        nuevo_estado = "rechazado" if rechazado else "aprobado"
        depp.estado = nuevo_estado
        depp.puede_aprobar = not rechazado
        depp.validado_automaticamente = True
        depp.fecha_validacion = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        )
        self.db.add(depp)
        await self.db.flush()

    # ── Helpers de análisis ────────────────────────────────────────────────────

    def _resultado_global(self, validaciones: list) -> str:
        """
        Mapea el resultado global para la validación de resumen.
        'error' → 'error' (rechazado)
        'advertencia' → 'advertencia' (aprobado con alertas)
        sin problemas → 'exitosa' (aprobado limpio)
        """
        resultados = {v.get("resultado") for v in validaciones}
        if "error" in resultados:
            return "error"
        if "advertencia" in resultados:
            return "advertencia"
        return "exitosa"

    def _gravedad_global(self, validaciones: list) -> str:
        gravedades = {v.get("gravedad") for v in validaciones}
        for g in ("critico", "alto", "medio", "bajo"):
            if g in gravedades:
                return g
        return "bajo"


def get_ai_validation_service(db: AsyncSession) -> AIValidationService:
    return AIValidationService(db)
