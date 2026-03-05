"""
Servicio de Correspondencia Institucional — DPP PIGOP.

Responsabilidades:
  1. OCR / extracción de datos de oficios escaneados (Gemini Vision)
  2. Clasificación automática → área de turno (reglas normativas DPP)
  3. Generación de borradores de respuesta (Gemini texto)

Reglas de turno derivadas de:
  - Reglamento Interior SFA, Art. 27 (fracciones I–XXX)
  - Manual de Organización SFA, secciones 1.1.1.x
  - Organigrama DPP (jefaturas de departamento)
"""
import logging
import re
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ── Áreas de la DPP ────────────────────────────────────────────────────────────
AREAS_DPP = {
    "DIR":  {"nombre": "Dirección de Programación y Presupuesto",
             "titular": "Marco Antonio Flores Mejía",
             "cargo":   "Director de Programación y Presupuesto"},
    "SCG":  {"nombre": "Subdirección de Control del Ejercicio del Gasto",
             "titular": "Eduardo Cortés Jaramillo",
             "cargo":   "Subdirector de Control del Ejercicio del Gasto"},
    "DREP": {"nombre": "Departamento de Registro del Ejercicio Presupuestal",
             "titular": "Luis Alberto Sánchez León",
             "cargo":   "Jefe del Departamento de Registro del Ejercicio Presupuestal"},
    "DCP":  {"nombre": "Departamento de Control Presupuestal",
             "titular": "Blanca Esthela Ortíz Soto",
             "cargo":   "Jefa del Departamento de Control Presupuestal"},
    "SPF":  {"nombre": "Subdirección de Programación y Formulación Presupuestal",
             "titular": "José Luis Pardo Escutia",
             "cargo":   "Subdirector de Programación y Formulación Presupuestal"},
    "DASP": {"nombre": "Departamento de Análisis y Seguimiento de Programas",
             "titular": "Seomara Mendoza Cárdenas",
             "cargo":   "Jefa del Departamento de Análisis y Seguimiento de Programas"},
    "DFNP": {"nombre": "Departamento de Formulación y Normatividad Presupuestal",
             "titular": "Hugo Díaz Arechiga",
             "cargo":   "Jefe del Departamento de Formulación y Normatividad Presupuestal"},
}

# ── Reglas de enrutamiento automático ─────────────────────────────────────────
# Orden importa: las reglas más específicas van primero.
# Cada entrada tiene:
#   palabras_clave → al menos UNA debe aparecer en asunto+texto del oficio (lowercase)
#   area_codigo    → clave en AREAS_DPP
#   fundamento     → base legal para el turno
#   plazo_dias     → días hábiles de respuesta
#   genera_tramite → None | "certificacion_presupuestal" (para crear en otro módulo)
REGLAS_TURNO = [
    # ── Certificación / suficiencia presupuestal ─────────────────────────────
    {
        "codigo":        "TURNO-CERT",
        "palabras_clave": [
            "suficiencia presupuestal", "certificación presupuestal",
            "disponibilidad presupuestal", "certificar disponibilidad",
            "validar disponibilidad", "constancia de suficiencia",
            "opinión de suficiencia",
        ],
        "area_codigo":    "DREP",
        "fundamento":     "Art. 27 Fracc. XIV y XXVI del Reglamento Interior de la SFA",
        "plazo_dias":     3,
        "genera_tramite": "certificacion_presupuestal",
    },
    # ── Refrendos / remanentes ────────────────────────────────────────────────
    {
        "codigo":        "TURNO-REF",
        "palabras_clave": [
            "refrendo presupuestal", "remanente presupuestal",
            "traslado de saldo", "traslado de remanente",
            "fam", "fafef", "empréstito", "fondo de aportaciones",
            "fondos federales remanentes",
        ],
        "area_codigo":    "DREP",
        "fundamento":     "Art. 27 Fracc. XVII del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── DEPP / documentación comprobatoria ───────────────────────────────────
    {
        "codigo":        "TURNO-DEPP",
        "palabras_clave": [
            "depp", "documento de ejecución presupuestaria",
            "documentación comprobatoria", "servicios personales",
            "pago de nómina", "gasto corriente comprobatorio",
            "adefas",
        ],
        "area_codigo":    "DREP",
        "fundamento":     "Art. 27 Fracc. XXI y XXIV del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Transferencias presupuestales / OMP ──────────────────────────────────
    {
        "codigo":        "TURNO-OMP",
        "palabras_clave": [
            "transferencia presupuestal", "omp",
            "oficio de modificación presupuestaria",
            "afectación presupuestal", "modificación presupuestal",
            "reasignación presupuestal", "adecuación presupuestal",
        ],
        "area_codigo":    "DCP",
        "fundamento":     "Art. 27 Fracc. III y XVII del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Conciliaciones contables ──────────────────────────────────────────────
    {
        "codigo":        "TURNO-CON",
        "palabras_clave": [
            "conciliación presupuestal", "cuenta pública",
            "dirección de contabilidad", "cierre contable",
            "registros contables conciliación",
        ],
        "area_codigo":    "DCP",
        "fundamento":     "Art. 27 Fracc. XXVII del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── POA / avance programático / metas ─────────────────────────────────────
    {
        "codigo":        "TURNO-POA",
        "palabras_clave": [
            "poa", "programa operativo anual",
            "avance programático", "avance físico-financiero",
            "cumplimiento de metas", "indicador de desempeño",
            "analisis programático presupuestal", "app presupuestal",
        ],
        "area_codigo":    "DASP",
        "fundamento":     "Art. 27 Fracc. VIII y XV del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Centros gestores / UPPs / actualización GRP ──────────────────────────
    {
        "codigo":        "TURNO-CGS",
        "palabras_clave": [
            "centro gestor", "centro de coste", "centro de beneficio",
            "actualización de upp", "denominación upp",
            "registro grp", "alta de centro gestor",
            "estructura programática actualización",
        ],
        "area_codigo":    "DASP",
        "fundamento":     "Manual de Organización SFA, sección 1.1.1.2.1",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Normativa / lineamientos / consultas jurídico-presupuestales ──────────
    {
        "codigo":        "TURNO-NORM",
        "palabras_clave": [
            "normativa presupuestal", "lineamiento presupuestal",
            "disposición normativa", "circular normativa",
            "consulta jurídico-presupuestal", "interpretación normativa",
            "criterio presupuestal",
        ],
        "area_codigo":    "DFNP",
        "fundamento":     "Art. 27 Fracc. I, VI y IX del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Anteproyecto / Decreto de Presupuesto ────────────────────────────────
    {
        "codigo":        "TURNO-PPE",
        "palabras_clave": [
            "decreto de presupuesto de egresos", "anteproyecto de presupuesto",
            "iniciativa de ley de presupuesto", "nueva partida presupuestal",
            "estructura programática nueva", "integración presupuestal",
        ],
        "area_codigo":    "DFNP",
        "fundamento":     "Art. 27 Fracc. X, XI y XII del Reglamento Interior de la SFA",
        "plazo_dias":     10,
        "genera_tramite": None,
    },
    # ── Estructuras orgánicas / plazas / factibilidad ────────────────────────
    {
        "codigo":        "TURNO-PLZ",
        "palabras_clave": [
            "estructura orgánica", "plantilla de personal",
            "nueva plaza", "factibilidad presupuestal",
            "opinión favorable de creación", "creación de plaza",
        ],
        "area_codigo":    "DIR",
        "fundamento":     "Art. 27 Fracc. XIII del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
    # ── Capacitación / asesoría ───────────────────────────────────────────────
    {
        "codigo":        "TURNO-CAP",
        "palabras_clave": [
            "capacitación presupuestal", "taller presupuestal",
            "asesoría presupuestal", "orientación en llenado",
        ],
        "area_codigo":    "SCG",
        "fundamento":     "Art. 27 Fracc. XVIII del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "genera_tramite": None,
    },
]

# ── Prompt OCR oficial ─────────────────────────────────────────────────────────
_PROMPT_OCR_OFICIO = """Eres un experto en lectura de correspondencia oficial del Gobierno del Estado de Michoacán.
Analiza este documento escaneado o fotografiado (oficio oficial) y extrae los datos en formato JSON estricto.

Extrae ÚNICAMENTE los campos que puedas identificar claramente. Si un campo no es visible o no existe, usa null.

{
  "numero_oficio": "número de folio/oficio del remitente (ej: SCOP/DA/E0167/2026)",
  "fecha_documento": "fecha en formato YYYY-MM-DD",
  "lugar_fecha": "lugar y fecha como aparece en el documento",
  "asunto": "contenido exacto del campo Asunto",
  "remitente_nombre": "nombre completo del firmante",
  "remitente_cargo": "cargo del firmante",
  "remitente_dependencia": "institución o dependencia que envía",
  "destinatario_nombre": "nombre del destinatario",
  "destinatario_cargo": "cargo del destinatario",
  "cuerpo_resumen": "resumen del contenido principal del oficio (máximo 150 palabras)",
  "datos_tecnicos": {
    "partidas": ["lista de partidas presupuestales mencionadas"],
    "montos": ["lista de montos con concepto (ej: '$633,308.50 — Remanentes FAM 2022')"],
    "centros_gestores": ["claves de centros gestores"],
    "fuentes_financiamiento": ["fuentes de financiamiento mencionadas"],
    "normas_referenciadas": ["artículos o leyes citadas en el documento"],
    "upp_mencionadas": ["UPPs o dependencias con código"]
  },
  "tipo_solicitud": "solicitud|consulta|informacion|instruccion|notificacion|otro",
  "tiene_firma_electronica": true,
  "copias_para": ["lista de personas o cargos que reciben copia"],
  "sello_recibido": "texto del sello de recibido si aparece (fecha, área)"
}

Responde ÚNICAMENTE con el JSON, sin texto adicional ni markdown."""

# ── Prompt generación de borrador ──────────────────────────────────────────────
_PROMPT_BORRADOR = """Eres un redactor experto en correspondencia oficial del Gobierno del Estado de Michoacán.
Redactas en nombre de la Dirección de Programación y Presupuesto, Secretaría de Finanzas y Administración.

DATOS DEL OFICIO RECIBIDO:
- Número de oficio: {numero_oficio_origen}
- Fecha: {fecha_recibido}
- Remitente: {remitente_nombre}, {remitente_cargo}
- Dependencia: {remitente_dependencia}
- Asunto: {asunto}
- Resumen del contenido: {cuerpo_resumen}

ÁREA QUE ATIENDE: {area_nombre}
FUNDAMENTO LEGAL: {fundamento_legal}

INSTRUCCIONES DE REDACCIÓN:
1. Usa el estilo formal institucional del Gobierno de Michoacán (trato de "Usted" y "C.")
2. Abre con referencia al oficio que se contesta: "En respuesta a su oficio número {numero_oficio_origen}, de fecha {fecha_recibido}, mediante el cual..."
3. Cita el fundamento legal en el cuerpo de la respuesta
4. El contenido debe ser conciso, preciso y dar respuesta directa al asunto planteado
5. Si el asunto es una solicitud de certificación presupuestal, indica que se atenderá en el plazo normativo de 3 días hábiles
6. Si el asunto es un refrendo de remanentes, indica el procedimiento o resultado de la revisión
7. Cierra con: "Sin otro particular, aprovecho la ocasión para enviarle un cordial saludo."
8. NO incluyas número de oficio DPP, fecha, membrete, ni datos de firma — esos se agregan manualmente

Redacta ÚNICAMENTE el cuerpo del oficio de respuesta:"""

# ── Prompt generación de oficio estructurado (4 secciones jurídicas) ──────────
_PROMPT_OFICIO_ESTRUCTURADO = """Eres un redactor juridico-administrativo experto del Gobierno del Estado de Michoacan.
Redactas oficios en nombre de la Direccion de Programacion y Presupuesto (DPP),
adscrita a la Secretaria de Finanzas y Administracion.

El Director de la DPP es el Mtro. Marco Antonio Flores Mejia.

DATOS DEL OFICIO QUE SE CONTESTA:
- Numero de oficio: {numero_oficio_origen}
- Fecha del oficio: {fecha_recibido}
- Remitente: {remitente_nombre}, {remitente_cargo}
- Dependencia remitente: {remitente_dependencia}
- Asunto: {asunto}
- Resumen del contenido: {cuerpo_resumen}

AREA QUE ATIENDE EL ASUNTO: {area_nombre}
FUNDAMENTO LEGAL PRIMARIO: {fundamento_legal}

{contexto_normativo}

=== ESTRUCTURA OBLIGATORIA DEL OFICIO ===

Tu respuesta DEBE contener EXACTAMENTE las siguientes 4 secciones, separadas por las etiquetas indicadas.
No omitas ninguna seccion. No agregues secciones adicionales.

[SECCION_1_FUNDAMENTO_COMPETENCIAL]
Cita textualmente el fundamento juridico que otorga competencia a la DPP para atender este asunto.
Usa la estructura: "Con fundamento en lo dispuesto por los articulos [X] del [nombre del ordenamiento],
que confiere a esta Direccion la atribucion de [atribucion especifica]..."
IMPORTANTE: Cita UNICAMENTE articulos que existan en el marco normativo proporcionado arriba.
No inventes articulos ni fracciones que no aparezcan en el contexto normativo.

[SECCION_2_REFERENCIA_OFICIO]
Haz referencia formal al oficio que se contesta: "En atencion a su oficio numero {numero_oficio_origen},
de fecha {fecha_recibido}, suscrito por el C. {remitente_nombre}, {remitente_cargo} de {remitente_dependencia},
mediante el cual [descripcion precisa de lo que solicita/comunica]..."

[SECCION_3_OBJETO_RESPUESTA]
Exposicion tecnico-juridica que responde al fondo del asunto:
- Argumenta con fundamento normativo (cita articulos especificos del marco normativo proporcionado)
- Si es una solicitud de certificacion presupuestal: indica que se atendera en el plazo normativo
- Si es una consulta normativa: cita los ordenamientos aplicables y da la respuesta tecnica
- Si es una transferencia: indica el procedimiento y requisitos
- Prioriza la jerarquia normativa: RISFA > Ley Disciplina Financiera > LGCG > Decreto Presupuesto
- Se preciso, conciso y sustentado. NO emitas opiniones sin respaldo normativo.

[SECCION_4_CIERRE_INSTITUCIONAL]
Cierre formal: "Sin otro particular, y reiterando la disposicion de esta Direccion para atender
cualquier asunto relacionado con la materia presupuestal, aprovecho la ocasion para enviarle
un cordial saludo."

=== REGLAS DE REDACCION ===
1. Estilo formal institucional del Gobierno de Michoacan (trato "Usted" y "C.")
2. Tono respetuoso pero firme y tecnico
3. Cita SOLO articulos que aparezcan en el MARCO NORMATIVO proporcionado
4. Si no hay suficiente informacion para una respuesta tecnica completa, indicalo y sugiere que datos faltan
5. NO incluyas encabezados, numero de oficio, fecha, destinatario, ni firma — esos se generan aparte
6. CADA seccion debe tener contenido sustantivo (minimo 2-3 oraciones)

Responde UNICAMENTE con las 4 secciones usando las etiquetas indicadas:"""


# ── Motor de clasificación ────────────────────────────────────────────────────

def clasificar_oficio(asunto: str, texto_adicional: str = "") -> dict:
    """
    Clasifica un oficio y determina el área de turno usando las reglas normativas.

    Returns:
        {
            area_codigo, area_nombre, titular, cargo,
            fundamento, plazo_dias, confianza, regla_codigo,
            genera_tramite, fecha_limite (calculada)
        }
    """
    texto_busqueda = (asunto + " " + texto_adicional).lower()

    for regla in REGLAS_TURNO:
        for kw in regla["palabras_clave"]:
            if kw.lower() in texto_busqueda:
                area = AREAS_DPP[regla["area_codigo"]]
                return {
                    "area_codigo":    regla["area_codigo"],
                    "area_nombre":    area["nombre"],
                    "titular":        area["titular"],
                    "cargo":          area["cargo"],
                    "fundamento":     regla["fundamento"],
                    "plazo_dias":     regla["plazo_dias"],
                    "confianza":      0.88,
                    "regla_codigo":   regla["codigo"],
                    "genera_tramite": regla["genera_tramite"],
                    "keyword_match":  kw,
                }

    # Fallback: Dirección (asuntos estratégicos o sin clasificar)
    area = AREAS_DPP["DIR"]
    return {
        "area_codigo":    "DIR",
        "area_nombre":    area["nombre"],
        "titular":        area["titular"],
        "cargo":          area["cargo"],
        "fundamento":     "Arts. 18 y 19 del Reglamento Interior de la SFA",
        "plazo_dias":     5,
        "confianza":      0.40,
        "regla_codigo":   None,
        "genera_tramite": None,
        "keyword_match":  None,
    }


def calcular_fecha_limite(fecha_inicio: date, dias_habiles: int) -> date:
    """Calcula fecha límite sumando días hábiles (excluye sábados y domingos)."""
    fecha = fecha_inicio
    dias_contados = 0
    while dias_contados < dias_habiles:
        fecha = fecha + timedelta(days=1)
        if fecha.weekday() < 5:   # 0-4 = lunes-viernes
            dias_contados += 1
    return fecha


def generar_folio_respuesta(tipo: str, numero: int, anio: int) -> str:
    """Genera folio DPP para oficio de respuesta: DPP/TIPO/NNNNN/AAAA"""
    tipo_upper = tipo.upper()[:6]
    return f"DPP/{tipo_upper}/{str(numero).zfill(5)}/{anio}"


# ── Servicio principal ────────────────────────────────────────────────────────

class CorrespondenciaService:
    """
    Servicio de gestión de correspondencia oficial DPP.
    Combina reglas deterministas con Gemini AI para OCR y redacción.
    """

    async def procesar_oficio_escaneado(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict:
        """
        Procesa un oficio escaneado/fotografiado:
          1. OCR via Gemini Vision
          2. Clasificación automática
          3. Cálculo de fecha límite

        Returns dict con: datos_extraidos + clasificacion + fecha_limite
        """
        from app.services.gemini_service import gemini_service

        datos: dict = {}
        if gemini_service.available:
            try:
                from google.genai import types
                from app.core.config import settings
                from google import genai

                client = genai.Client(api_key=settings.GEMINI_API_KEY)
                resp = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        _PROMPT_OCR_OFICIO,
                    ],
                )
                datos = gemini_service._parse_json_response(resp.text)
            except Exception as e:
                logger.error(f"Error OCR Gemini Vision: {e}")
                datos = {"error": str(e), "_mock": True}
        else:
            datos = {
                "numero_oficio": None,
                "asunto": "— Gemini no disponible, capture manualmente —",
                "_mock": True,
            }

        # Clasificación
        asunto = datos.get("asunto") or ""
        resumen = datos.get("cuerpo_resumen") or ""
        clasificacion = clasificar_oficio(asunto, resumen)

        # Fecha límite
        hoy = date.today()
        fecha_limite = calcular_fecha_limite(hoy, clasificacion["plazo_dias"])

        return {
            "datos_extraidos": datos,
            "clasificacion":   clasificacion,
            "fecha_limite":    fecha_limite.isoformat(),
        }

    async def generar_borrador_respuesta(
        self,
        numero_oficio_origen: str,
        fecha_recibido: str,
        remitente_nombre: str,
        remitente_cargo: str,
        remitente_dependencia: str,
        asunto: str,
        cuerpo_resumen: str,
        area_nombre: str,
        fundamento_legal: str,
        instrucciones: str = "",
    ) -> str:
        """
        Genera un borrador de oficio de respuesta usando Gemini.
        Retorna el cuerpo del oficio (sin membrete ni firma).
        """
        from app.services.gemini_service import gemini_service

        prompt = (
            _PROMPT_BORRADOR
            .replace("{numero_oficio_origen}", numero_oficio_origen or "—")
            .replace("{fecha_recibido}", fecha_recibido or "—")
            .replace("{remitente_nombre}", remitente_nombre or "—")
            .replace("{remitente_cargo}", remitente_cargo or "—")
            .replace("{remitente_dependencia}", remitente_dependencia or "—")
            .replace("{asunto}", asunto or "—")
            .replace("{cuerpo_resumen}", cuerpo_resumen or "—")
            .replace("{area_nombre}", area_nombre)
            .replace("{fundamento_legal}", fundamento_legal)
        )

        if instrucciones:
            prompt += f"\n\nINSTRUCCIONES ADICIONALES DEL DIRECTOR:\n{instrucciones}"

        if not gemini_service.available:
            return (
                f"En respuesta a su oficio número {numero_oficio_origen}, "
                f"de fecha {fecha_recibido}, mediante el cual solicita {asunto}, "
                f"me permito hacer de su conocimiento lo siguiente:\n\n"
                f"[Contenido de respuesta — complete manualmente]\n\n"
                f"Lo anterior con fundamento en {fundamento_legal}.\n\n"
                f"Sin otro particular, aprovecho la ocasión para enviarle un cordial saludo."
            )

        try:
            from app.core.config import settings
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            return resp.text.strip()
        except Exception as e:
            logger.error(f"Error Gemini generar_borrador: {e}")
            return f"[Error al generar borrador: {e}]\n\nComplete manualmente."

    # ── Generación de oficio estructurado (4 secciones) ─────────────────────

    async def generar_oficio_estructurado(
        self,
        *,
        numero_oficio_origen: str,
        fecha_recibido: str,
        remitente_nombre: str,
        remitente_cargo: str,
        remitente_dependencia: str,
        asunto: str,
        cuerpo_resumen: str,
        area_nombre: str,
        fundamento_legal: str,
        contexto_normativo: str,
        instrucciones: str = "",
    ) -> dict:
        """
        Genera un oficio de respuesta con estructura jurídica de 4 secciones.

        Returns:
            dict con claves: fundamento, referencia, objeto, cierre
        """
        from app.services.gemini_service import gemini_service

        prompt = (
            _PROMPT_OFICIO_ESTRUCTURADO
            .replace("{numero_oficio_origen}", numero_oficio_origen or "---")
            .replace("{fecha_recibido}", fecha_recibido or "---")
            .replace("{remitente_nombre}", remitente_nombre or "---")
            .replace("{remitente_cargo}", remitente_cargo or "---")
            .replace("{remitente_dependencia}", remitente_dependencia or "---")
            .replace("{asunto}", asunto or "---")
            .replace("{cuerpo_resumen}", cuerpo_resumen or "---")
            .replace("{area_nombre}", area_nombre)
            .replace("{fundamento_legal}", fundamento_legal)
            .replace("{contexto_normativo}", contexto_normativo)
        )

        if instrucciones:
            prompt += f"\n\nINSTRUCCIONES ADICIONALES DEL DIRECTOR:\n{instrucciones}"

        if not gemini_service.available:
            return {
                "fundamento": (
                    f"Con fundamento en lo dispuesto por los artículos 18 y 19 del "
                    f"Reglamento Interior de la Secretaría de Finanzas y Administración, "
                    f"y en particular el artículo 27 que confiere a esta Dirección las "
                    f"atribuciones en materia presupuestal..."
                ),
                "referencia": (
                    f"En atención a su oficio número {numero_oficio_origen}, "
                    f"de fecha {fecha_recibido}, suscrito por el C. {remitente_nombre}, "
                    f"{remitente_cargo} de {remitente_dependencia}, "
                    f"mediante el cual [complete la descripción]..."
                ),
                "objeto": (
                    f"[Contenido técnico-jurídico de respuesta — complete manualmente]\n\n"
                    f"Lo anterior con fundamento en {fundamento_legal}."
                ),
                "cierre": (
                    f"Sin otro particular, y reiterando la disposición de esta Dirección "
                    f"para atender cualquier asunto relacionado con la materia presupuestal, "
                    f"aprovecho la ocasión para enviarle un cordial saludo."
                ),
            }

        try:
            from app.core.config import settings
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            return self._parse_secciones(resp.text.strip())
        except Exception as e:
            logger.error(f"Error Gemini generar_oficio_estructurado: {e}")
            return {
                "fundamento": f"[Error: {e}]",
                "referencia": "",
                "objeto": "Complete manualmente.",
                "cierre": "Sin otro particular, aprovecho la ocasión para enviarle un cordial saludo.",
            }

    @staticmethod
    def _parse_secciones(text: str) -> dict:
        """Parsea la respuesta de Gemini en 4 secciones nombradas."""
        secciones = {}
        patterns = {
            "fundamento": r"\[SECCION_1[^\]]*\](.*?)(?=\[SECCION_2|\Z)",
            "referencia": r"\[SECCION_2[^\]]*\](.*?)(?=\[SECCION_3|\Z)",
            "objeto":     r"\[SECCION_3[^\]]*\](.*?)(?=\[SECCION_4|\Z)",
            "cierre":     r"\[SECCION_4[^\]]*\](.*?)(?=\Z)",
        }
        for key, pattern in patterns.items():
            match = re.search(pattern, text, re.DOTALL)
            secciones[key] = match.group(1).strip() if match else ""

        # Fallback: si no se encontraron secciones, poner todo en objeto
        if not any(secciones.values()):
            secciones = {
                "fundamento": "",
                "referencia": "",
                "objeto": text,
                "cierre": "",
            }
        return secciones


# Singleton
correspondencia_service = CorrespondenciaService()
