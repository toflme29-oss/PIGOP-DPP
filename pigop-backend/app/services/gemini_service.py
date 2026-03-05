"""
Servicio de integración con Google Gemini AI — Fase 3.

Responsabilidades:
- Llamadas al modelo Gemini (texto y visión multimodal)
- Extracción de datos estructurados desde documentos
- Análisis de consistencia entre documentos
- Manejo de errores y reintentos con backoff

SDK usado: google-genai >= 1.0  (paquete nuevo — reemplaza google-generativeai)

Modelos usados:
  gemini-2.0-flash-exp  →  texto + análisis rápido
  gemini-1.5-flash      →  imágenes / PDFs escaneados (fallback)
"""
import json
import logging
import re
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Configuración global ──────────────────────────────────────────────────────
_gemini_client = None
_gemini_ready = False


def _init_gemini():
    global _gemini_client, _gemini_ready
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "placeholder":
        try:
            from google import genai
            _gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
            _gemini_ready = True
            logger.info("Gemini AI inicializado correctamente (SDK google-genai).")
        except Exception as e:
            logger.error(f"Error inicializando Gemini: {e}")
    else:
        logger.warning("GEMINI_API_KEY no configurada — Fase 3 en modo mock.")


_init_gemini()

# ── Prompts del sistema ───────────────────────────────────────────────────────

_PROMPT_EXTRAER_CFDI = """
Analiza este XML de CFDI (Comprobante Fiscal Digital por Internet) mexicano y extrae los
siguientes campos en formato JSON estricto. Si un campo no existe, usa null.

Campos a extraer:
{
  "uuid_fiscal": "UUID del TimbreFiscalDigital (atributo UUID)",
  "rfc_emisor": "RFC del emisor (atributo Rfc de cfdi:Emisor)",
  "nombre_emisor": "Nombre del emisor",
  "rfc_receptor": "RFC del receptor",
  "nombre_receptor": "Nombre del receptor",
  "total": número (float),
  "subtotal": número (float),
  "fecha_emision": "fecha en formato YYYY-MM-DD",
  "moneda": "MXN u otra",
  "forma_pago": "código de forma de pago",
  "metodo_pago": "PUE o PPD",
  "uso_cfdi": "código de uso CFDI del receptor",
  "concepto_principal": "descripción del primer concepto/partida",
  "num_conceptos": número entero
}

Responde ÚNICAMENTE con el JSON, sin texto adicional, sin markdown, sin explicaciones.

XML del CFDI:
{xml_content}
"""

_PROMPT_EXTRAER_PDF = """
Eres un analista experto en documentos presupuestarios del Gobierno del Estado de Michoacán.
Analiza el siguiente texto extraído de un documento de tipo "{tipo_documento}" y extrae
los campos relevantes en formato JSON estricto. Si un campo no existe, usa null.

CONTEXTO IMPORTANTE sobre el DEPP (Documento de Ejecución Presupuestaria y Pago):
El DEPP es generado por SAP GRP del Gobierno de Michoacán. Tiene dos tipos:
  - PAGO: genera movimiento financiero Y presupuestal (pago al proveedor/beneficiario)
  - NO GENERÓ PAGO: solo regularización presupuestal (comprobación de un vale previo,
    frecuentemente para ADEFAS — gastos de ejercicios anteriores)

Estructura del DEPP:
  - Encabezado: UE (Unidad Ejecutora), UPP, tipo (PAGO/NO PAGO), número de solicitud,
    fecha de expedición, número de folio poliza
  - Clave presupuestaria: formato "CLASIF-PROYECTOUPPUUR-CONTRATO-MES-REFERENCIA-FONDO-0"
    (ej: "21111-1600999999046004-2163NAMMMQ0ZZ800-02-FEB-313011-261528091-000000")
  - Beneficiario: nombre completo, clave de acreedor SAP, cuenta ABONO (CLABE)
  - Concepto: descripción del gasto, cargo presupuestal, deducciones, líquido
  - Notas y/o aclaraciones: descripción detallada (incluye referencias a contratos,
    oficios, nros de vale para NO PAGO, motivo de regularización)
  - OPERADO: código y nombre del fondo (fuente de financiamiento)
  - PROVISIONAL: número de vale (solo para NO PAGO)
  - Firmas: Validó (Responsable del Programa UPP), Autorizó (Titular UPP),
    Por el Trámite Presupuestal (Dirección de Programación y Presupuesto)

Tipos de documento y campos esperados:

- DEPP (Documento principal de Ejecución Presupuestaria y Pago):
  {{
    "solicitud_numero": "número de solicitud / folio (ej: 0460000000011)",
    "upp": "código UPP (ej: '046')",
    "ue": "Unidad Ejecutora (ej: '25-04 DELEGACIÓN ADMINISTRATIVA')",
    "ur": "Unidad Responsable (ej: '04')",
    "tipo_depp": "PAGO o NO_PAGO",
    "fecha_expedicion": "YYYY-MM-DD",
    "mes": "número de mes (1-12)",
    "ejercicio": "año fiscal (ej: 2026)",
    "clave_presupuestaria": "clave completa tal como aparece",
    "fuente_financiamiento": "código del fondo (ej: '261528091')",
    "fuente_nombre": "nombre del fondo (ej: 'FONDO GENERAL DE PARTICIPACIONES')",
    "capitulo": "número de capítulo (ej: 3000, 1000, 2000)",
    "partida": "número de partida (ej: 3131, 3221)",
    "beneficiario": "nombre completo del beneficiario",
    "clave_acreedor": "clave SAP del acreedor (ej: '0000003741')",
    "cuenta_abono": "CLABE o número de cuenta destino",
    "monto_cargo_presup": "monto del cargo presupuestal (float)",
    "monto_deducciones": "monto deducciones (float)",
    "monto_liquido": "monto líquido neto (float)",
    "concepto_gasto": "descripción del concepto",
    "notas_aclaraciones": "texto de las notas y/o aclaraciones",
    "provisional_vale": "número de vale para NO PAGO (ej: '0913')",
    "numero_contrato": "número de contrato si se menciona",
    "validó": "nombre del responsable que validó (UPP)",
    "autorizó": "nombre del titular que autorizó (UPP)",
    "por_el_tramite": "nombre del director de DPP que firma",
    "es_adefas": "true si es gasto de ejercicio anterior"
  }}

- MCL (Manifiesto de Cumplimiento Legal):
  {{
    "fecha": "YYYY-MM-DD",
    "nombre_proveedor": "nombre del proveedor",
    "rfc_proveedor": "RFC",
    "numero_contrato": "número de contrato (si aplica)",
    "confirma_cumplimiento": true/false,
    "observaciones": "texto de observaciones"
  }}

- CTT (Contrato):
  {{
    "fecha_contrato": "YYYY-MM-DD",
    "numero_contrato": "número",
    "nombre_proveedor": "nombre",
    "rfc_proveedor": "RFC",
    "monto_contrato": número float,
    "objeto_contrato": "descripción del objeto",
    "fecha_inicio": "YYYY-MM-DD",
    "fecha_fin": "YYYY-MM-DD"
  }}

- PCH (Póliza de Cheque/Transferencia):
  {{
    "fecha_operacion": "YYYY-MM-DD",
    "monto": número float,
    "beneficiario": "nombre",
    "banco": "institución bancaria",
    "referencia": "referencia o folio"
  }}

- AUR (Acuerdo Único de Reasignación):
  {{
    "fecha": "YYYY-MM-DD",
    "upp_origen": "UPP origen",
    "upp_destino": "UPP destino",
    "monto_reasignado": número float,
    "concepto": "descripción"
  }}

- FUC (Formato Único de Comisión):
  {{
    "fecha": "YYYY-MM-DD",
    "nombre_comisionado": "nombre",
    "monto_viaticos": número float,
    "destino": "lugar",
    "duracion_dias": número entero,
    "motivo": "descripción de la comisión"
  }}

Responde ÚNICAMENTE con el JSON correspondiente al tipo {tipo_documento}, sin texto adicional,
sin markdown, sin explicaciones.

Tipo de documento: {tipo_documento}
Texto del documento:
{texto}
"""

_PROMPT_VALIDAR_CONSISTENCIA = """
Eres un auditor experto en normativa presupuestaria del Gobierno del Estado de Michoacán,
especialista en el Manual de Procedimientos de la Dirección de Programación y Presupuesto (DPP),
el Reglamento Interior de la Secretaría de Finanzas y Administración (RISFA Art. 20),
y las Leyes: LGCG, LAASSP, Presupuesto de Egresos del Estado de Michoacán.

CONTEXTO DEPP:
El DEPP (Documento de Ejecución Presupuestaria y Pago) puede ser:
  - PAGO: genera movimiento presupuestal Y pago financiero al proveedor
  - NO_PAGO: solo regularización presupuestal de un vale/provisional anterior
             (común para comprobación de viáticos, ADEFAS)

REGLAS PRESUPUESTALES CLAVE:
  1. Un DEPP NUNCA mezcla fuentes/fondos de financiamiento distintos
     (Ej: no puede tener "Fondo General de Participaciones" + "Ingresos de Fuentes Locales")
  2. Un DEPP NUNCA mezcla capítulos de gasto distintos
     (Ej: no puede combinar Cap.1000 Servicios Personales + Cap.3000 Servicios Generales)
     SÍ se permiten múltiples partidas del mismo capítulo
  3. La clave presupuestaria debe ser consistente con UPP, fondo y capítulo del encabezado
  4. DEPP DE PAGO requiere: beneficiario identificado + cuenta ABONO + monto líquido > 0
  5. DEPP NO PAGO requiere: referencia al vale/provisional que regulariza + motivo claro

DATOS DEL DEPP:
- Folio/Solicitud: {folio}
- UPP: {upp}
- Tipo DEPP: {tipo_depp}
- Beneficiario declarado: {beneficiario}
- Monto total: ${monto_total}
- Clasificación normativa: {clasificacion}
- Capítulo presupuestal: {capitulo}
- Fuente de financiamiento: {fuente_financiamiento}

DATOS EXTRAÍDOS DE DOCUMENTOS ADJUNTOS:
{documentos_json}

Verifica los siguientes puntos y genera una validación para cada uno que aplique:

1. CRUCE_RFC: ¿El RFC del receptor en el CFDI corresponde exactamente al beneficiario del DEPP?
   (Para organismos públicos sin RFC empresarial, verificar nombre/razón social)

2. CRUCE_MONTOS: ¿El total del CFDI coincide con el monto del DEPP?
   Alerta si el CFDI supera el monto del DEPP o hay diferencia significativa (>5%).

3. CRUCE_FECHAS: ¿La fecha de expedición del CFDI es anterior o igual a la del DEPP?
   Los CFDIs no pueden ser posteriores al DEPP que los ampara.

4. CRUCE_CONTRATO: Para clasificación I.1 (contrato con CFDI), ¿el número de contrato
   en el MCL/CTT coincide con el referenciado en las notas del DEPP?

5. CONCEPTO_CAPITULO: ¿El concepto del gasto es coherente con el capítulo {capitulo}?
   Cap.1000=Servicios Personales (sueldos/honorarios), Cap.2000=Materiales,
   Cap.3000=Servicios Generales (agua, luz, teléfono, viáticos, arrendamientos),
   Cap.4000=Transferencias, Cap.5000=Bienes Muebles/Inmuebles.

6. TIPO_DEPP_CONSISTENCIA: Para DEPP NO_PAGO, ¿las notas mencionan el vale/provisional
   que regulariza y el motivo? ¿Para DEPP PAGO existe cuenta ABONO?

7. CONSISTENCIA_GENERAL: Evaluación integral del expediente. ¿Existen inconsistencias
   entre los documentos que impedirían aprobar el trámite?

Para cada validación, usa:
- resultado: "exitosa" | "advertencia" | "error"
- gravedad: "critico" | "alto" | "medio" | "bajo"
- articulo_manual: artículo del RISFA o Manual DPP más relevante

Si no hay documentos adjuntos o son insuficientes para evaluar un punto, indica resultado
"advertencia" con gravedad "bajo" y mensaje explicando qué falta.

Responde ÚNICAMENTE con este JSON, sin texto adicional ni markdown:
{{
  "validaciones": [
    {{
      "tipo_validacion": "CRUCE_RFC",
      "resultado": "exitosa|advertencia|error",
      "gravedad": "critico|alto|medio|bajo",
      "articulo_manual": "Art. XX RISFA o Lineamiento DPP",
      "mensaje": "descripción precisa y accionable del hallazgo",
      "detalles": {{}}
    }}
  ],
  "resumen_ia": "Párrafo conciso con la evaluación general: qué está correcto, qué requiere atención y la recomendación (aprobar/rechazar/observar)."
}}
"""


class GeminiService:
    """Cliente de Gemini AI para validación inteligente de DEPPs."""

    def __init__(self):
        self.model_text   = settings.GEMINI_MODEL        # gemini-2.5-flash
        self.model_vision = "gemini-2.5-flash"           # para imágenes/PDFs escaneados (mismo modelo)

    @property
    def available(self) -> bool:
        return _gemini_ready

    # ── Extracción de CFDI ────────────────────────────────────────────────────

    async def extraer_datos_cfdi(self, xml_content: str) -> dict:
        """Extrae datos estructurados de un XML CFDI usando Gemini."""
        if not self.available:
            return self._mock_cfdi()
        try:
            prompt = _PROMPT_EXTRAER_CFDI.replace("{xml_content}", xml_content[:8000])
            resp   = _gemini_client.models.generate_content(
                model=self.model_text,
                contents=prompt,
            )
            return self._parse_json_response(resp.text)
        except Exception as e:
            logger.error(f"Error Gemini extraer_datos_cfdi: {e}")
            return {"error": str(e)}

    # ── Extracción de documento PDF ────────────────────────────────────────────

    async def extraer_datos_documento(
        self, texto: str, tipo_documento: str
    ) -> dict:
        """Extrae datos estructurados del texto de un PDF usando Gemini."""
        if not self.available:
            return self._mock_documento(tipo_documento)
        try:
            prompt = (
                _PROMPT_EXTRAER_PDF
                .replace("{tipo_documento}", tipo_documento)
                .replace("{texto}", texto[:6000])
            )
            resp = _gemini_client.models.generate_content(
                model=self.model_text,
                contents=prompt,
            )
            return self._parse_json_response(resp.text)
        except Exception as e:
            logger.error(f"Error Gemini extraer_datos_documento: {e}")
            return {"error": str(e)}

    # ── Extracción desde imagen/PDF escaneado (Gemini Vision) ─────────────────

    async def extraer_datos_imagen(
        self, image_bytes: bytes, mime_type: str, tipo_documento: str
    ) -> dict:
        """Extrae datos de un PDF escaneado (imagen) usando Gemini Vision."""
        if not self.available:
            return self._mock_documento(tipo_documento)
        try:
            from google.genai import types

            prompt_text = (
                f"Extrae todos los datos relevantes de este documento "
                f"de tipo {tipo_documento} en formato JSON estricto. "
                f"Incluye: fecha, montos, nombres, RFC, número de documento, "
                f"y cualquier dato relevante. Sin texto adicional."
            )
            resp = _gemini_client.models.generate_content(
                model=self.model_vision,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    prompt_text,
                ],
            )
            return self._parse_json_response(resp.text)
        except Exception as e:
            logger.error(f"Error Gemini Vision: {e}")
            return {"error": str(e)}

    # ── Validación de consistencia ─────────────────────────────────────────────

    async def validar_consistencia_expediente(
        self,
        folio: str,
        upp: str,
        beneficiario: str,
        monto_total: float,
        clasificacion: str,
        capitulo: int,
        documentos_datos: list[dict],
        # Campos extendidos del nuevo modelo DEPP
        tipo_depp: str = "",
        fuente_financiamiento: str = "",
        fuente_nombre: str = "",
        notas_aclaraciones: str = "",
        provisional_vale: str = "",
        cuenta_abono: str = "",
    ) -> dict:
        """
        Valida la consistencia entre todos los documentos del expediente DEPP.
        Retorna lista de ValidacionDEPP-like dicts con los hallazgos de IA.
        """
        if not self.available:
            return self._mock_consistencia(clasificacion)

        try:
            docs_json = json.dumps(documentos_datos, ensure_ascii=False, indent=2)
            # Enriquecer el contexto con los nuevos campos
            fuente_completa = f"{fuente_financiamiento} - {fuente_nombre}".strip(" -") if fuente_financiamiento else "no especificada"
            tipo_depp_texto = tipo_depp if tipo_depp else "no especificado"
            if tipo_depp == "NO_PAGO" and provisional_vale:
                tipo_depp_texto += f" (regulariza vale: {provisional_vale})"
            if tipo_depp == "PAGO" and cuenta_abono:
                tipo_depp_texto += f" (cuenta abono: {cuenta_abono})"

            prompt = (
                _PROMPT_VALIDAR_CONSISTENCIA
                .replace("{folio}", folio)
                .replace("{upp}", upp)
                .replace("{tipo_depp}", tipo_depp_texto)
                .replace("{beneficiario}", str(beneficiario))
                .replace("{monto_total}", f"{monto_total:,.2f}")
                .replace("{clasificacion}", str(clasificacion))
                .replace("{capitulo}", str(capitulo))
                .replace("{fuente_financiamiento}", fuente_completa)
                .replace("{documentos_json}", docs_json[:5000])
            )
            resp = _gemini_client.models.generate_content(
                model=self.model_text,
                contents=prompt,
            )
            return self._parse_json_response(resp.text)
        except Exception as e:
            logger.error(f"Error Gemini validar_consistencia: {e}")
            return {"validaciones": [], "resumen_ia": f"Error IA: {e}"}

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _parse_json_response(self, text: str) -> dict:
        """Extrae y parsea JSON de la respuesta de Gemini (maneja markdown)."""
        # Remover bloques ```json ... ```
        text = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Intentar encontrar el primer objeto JSON en el texto
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except Exception:
                    pass
            logger.warning(f"No se pudo parsear JSON de Gemini: {text[:200]}")
            return {"raw_response": text}

    # ── Mocks para cuando Gemini no está disponible ────────────────────────────

    def _mock_cfdi(self) -> dict:
        return {
            "uuid_fiscal": "MOCK-UUID-0000-0000-0000",
            "rfc_emisor": "XAXX010101000",
            "nombre_emisor": "Proveedor Mock SA de CV",
            "rfc_receptor": "GEM261011I62",
            "nombre_receptor": "Gobierno del Estado de Michoacán",
            "total": 0.0,
            "fecha_emision": None,
            "moneda": "MXN",
            "concepto_principal": "[MOCK - Gemini no disponible]",
            "_mock": True,
        }

    def _mock_documento(self, tipo: str) -> dict:
        return {
            "tipo": tipo,
            "nota": "[MOCK - Gemini no disponible]",
            "_mock": True,
        }

    def _mock_consistencia(self, clasificacion: str) -> dict:
        return {
            "validaciones": [
                {
                    "tipo_validacion": "CONSISTENCIA_GENERAL",
                    "resultado": "advertencia",
                    "gravedad": "bajo",
                    "articulo_manual": None,
                    "mensaje": "Validación IA no disponible (GEMINI_API_KEY no configurada). "
                               "Configure la API Key en .env para activar la validación inteligente.",
                    "detalles": {"clasificacion": clasificacion, "modo": "mock"},
                }
            ],
            "resumen_ia": "Gemini no disponible — configure GEMINI_API_KEY.",
        }


# Singleton
gemini_service = GeminiService()
