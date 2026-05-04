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
import asyncio
import logging
import re
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


# ── Helper: llamada a Gemini con retry automático + fallback de modelo ─────────
# Modelos probados en orden: primario → fallback cuando el principal está saturado
GEMINI_MODEL_PRIMARY = "gemini-2.5-flash"
GEMINI_MODEL_FALLBACK = "gemini-2.5-flash-lite"

def _is_overload_error(err_str: str) -> bool:
    """Detecta si el error de Gemini es por saturación (reintentable)."""
    e = err_str.lower()
    return (
        "503" in err_str
        or "unavailable" in e
        or "overloaded" in e
        or "429" in err_str
        or "resource_exhausted" in e
        or "rate" in e
        or "quota" in e
    )

async def _gemini_generate_with_retry(client, contents, *, max_retries: int = 3) -> str:
    """
    Llama a Gemini con retry automático y fallback a modelo secundario.

    Estrategia:
      1. Intenta con gemini-2.5-flash (hasta `max_retries` veces, backoff 1s, 2s, 4s)
      2. Si sigue saturado, intenta con gemini-2.5-flash-lite (2 intentos más)
      3. Si todo falla, propaga la excepción para que el caller muestre el error

    Retorna el texto generado (ya strip()).
    """
    last_exc: Exception | None = None

    # Fase 1: modelo primario con backoff exponencial
    for attempt in range(max_retries):
        try:
            resp = client.models.generate_content(
                model=GEMINI_MODEL_PRIMARY,
                contents=contents,
            )
            return resp.text.strip()
        except Exception as e:
            last_exc = e
            err_str = str(e)
            if not _is_overload_error(err_str):
                # Error no recuperable (API key inválida, prompt malformado, etc.)
                raise
            if attempt < max_retries - 1:
                delay = 2 ** attempt  # 1s, 2s, 4s
                logger.warning(
                    f"Gemini {GEMINI_MODEL_PRIMARY} saturado (intento {attempt+1}/{max_retries}). "
                    f"Reintentando en {delay}s..."
                )
                await asyncio.sleep(delay)

    # Fase 2: fallback a modelo lite (2 intentos adicionales)
    logger.warning(f"Gemini {GEMINI_MODEL_PRIMARY} agotado. Probando {GEMINI_MODEL_FALLBACK}...")
    for attempt in range(2):
        try:
            resp = client.models.generate_content(
                model=GEMINI_MODEL_FALLBACK,
                contents=contents,
            )
            logger.info(f"Gemini fallback {GEMINI_MODEL_FALLBACK} respondió OK.")
            return resp.text.strip()
        except Exception as e:
            last_exc = e
            err_str = str(e)
            if not _is_overload_error(err_str):
                raise
            if attempt < 1:
                await asyncio.sleep(1.5)

    # Todo falló — propagar última excepción
    raise last_exc if last_exc else RuntimeError("Gemini no respondió tras todos los reintentos.")

# ── Áreas de la DPP ────────────────────────────────────────────────────────────
AREAS_DPP = {
    "DIR":  {"nombre": "Dirección de Programación y Presupuesto",
             "titular": "Marco Antonio Flores Mejía",
             "cargo":   "Director de Programación y Presupuesto"},
    # "SEC" representa la bandeja de la Secretaría del Director: cuando el Director
    # instruye a su asistente (rol=secretaria) contestar un oficio en su nombre.
    # SOLO el Director (o superadmin) puede turnar a esta bandeja — ninguna otra
    # área tiene autoridad para asignar trabajo directamente a la secretaría.
    "SEC":  {"nombre": "Secretaría de la Dirección",
             "titular": "Secretaría del Director",
             "cargo":   "Secretaría Particular del Director"},
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

def obtener_iniciales(nombre: str) -> str:
    """Genera iniciales en mayúscula a partir de un nombre completo.
    Ejemplo: 'Marco Antonio Flores Mejía' -> 'MAFM'
    Ignora prefijos honoríficos como Mtro., Lic., etc.
    """
    prefijos = {"mtro", "mtra", "lic", "ing", "dr", "dra", "c", "cp", "arq", "prof"}
    partes = nombre.strip().split()
    iniciales = []
    for p in partes:
        limpio = p.strip(".").lower()
        if limpio in prefijos:
            continue
        if p and p[0].isalpha():
            iniciales.append(p[0].upper())
    return "".join(iniciales) if iniciales else "XX"


def generar_referencia_oficio(
    area_codigo: str,
    referencia_elaboro: str | None = None,
    referencia_reviso: str | None = None,
) -> str:
    """Genera la línea de referencia con iniciales institucionales.

    Formato según jerarquía:
    - Si participa estructura operativa: DIR / SUBDIRECTOR / JEFE_DEPTO
    - Si el oficio es directo del Director: DIRECTOR como elaborador
    - Secretaría: iniciales_secretaria / iniciales_director
    """
    dir_info = AREAS_DPP.get("DIR", {})
    dir_iniciales = obtener_iniciales(dir_info.get("titular", ""))

    elaboro = referencia_elaboro or "???"
    reviso = referencia_reviso or "???"

    return f"{dir_iniciales}/{elaboro}/{reviso}"


# ── Prefijos de folio por área de origen ──────────────────────────────────────
# Formato institucional: PREFIJO/XXXX/AÑO (4 dígitos consecutivos)
# Ejemplo: SFA/SF/DPP/SPFP/0001/2026
# Al iniciar operación se configurará el número consecutivo de arranque.
PREFIJOS_FOLIO = {
    "DIR":  "SFA/SF/DPP",
    "SCG":  "SFA/SF/DPP-SCEG",
    "DREP": "SFA/SF/DPP-SCEG",
    "DCP":  "SFA/SF/DPP-SCEG",
    "SPF":  "SFA/SF/DPP-SPFP",
    "DASP": "SFA/SF/DPP-SPFP",
    "DFNP": "SFA/SF/DPP-SPFP",
}

# ── Copias institucionales estándar ───────────────────────────────────────────
COPIAS_PRESUPUESTALES = [
    "L.A.E. Luis Navarro García. – Secretario de Finanzas y Administración. – Para su conocimiento.",
    "C.P. José Luis Tapia Zavala. – Subsecretario de Finanzas. – Para su conocimiento.",
    "Expediente/Minutario",
]
COPIAS_ADMINISTRATIVAS = [
    "Expediente",
    "Minutario",
]

# ── Catálogo de plantillas de oficios ─────────────────────────────────────────
# Cada plantilla define el tipo de oficio, área, fundamento legal y ejemplo
# de redacción institucional para alimentar la IA.
PLANTILLAS_OFICIO = [
    # ── Dirección: Administrativos internos ────────────────────────────────────
    {
        "categoria": "PERM_CUIDADO_HIJOS",
        "nombre": "Permiso cuidado de hijos menores",
        "area_origen": "DIR",
        "palabras_clave": ["cuidado de hijos", "hijos menores", "permiso hijo", "artículo 67"],
        "fundamento_legal": "Artículo 67 de las Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "Me refiero al artículo 67 de las Condiciones Generales de Trabajo, cuarto párrafo, "
            "que dice: Las trabajadoras dispondrán de permiso con goce de sueldo para atender a "
            "sus hijos menores de hasta doce años, en caso de enfermedad grave o accidente que "
            "requiera atención médica u hospitalización."
        ),
    },
    {
        "categoria": "DIA_ECONOMICO",
        "nombre": "Día económico",
        "area_origen": "DIR",
        "palabras_clave": ["día económico", "ausentarse de sus labores", "artículo 65", "fracción vii"],
        "fundamento_legal": "Artículo 65, Fracción VII de las Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "Hago de su conocimiento que a petición del empleado {NOMBRE_EMPLEADO}, se le autoriza "
            "ausentarse de sus labores el día {FECHA_SOLICITADA}, de conformidad con el artículo 65, "
            "Fracción VII de las Condiciones Generales de Trabajo."
        ),
    },
    {
        "categoria": "PERMISO_PERSONAL",
        "nombre": "Permiso personal",
        "area_origen": "DIR",
        "palabras_clave": ["permiso personal", "ausentarse", "permiso con goce"],
        "fundamento_legal": "Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "Por medio del presente informo que, a petición de la/el C. {NOMBRE_EMPLEADO}, "
            "adscrita a esta Dirección a mi cargo, se le autoriza ausentarse de sus labores "
            "el {FECHA_SOLICITADA}."
        ),
    },
    {
        "categoria": "INCAPACIDAD",
        "nombre": "Incapacidad temporal para el trabajo",
        "area_origen": "DIR",
        "palabras_clave": ["incapacidad", "certificado de incapacidad", "artículo 36", "incapacidad temporal"],
        "fundamento_legal": "Artículo 36, Fracción I de las Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "De conformidad con el artículo 36 Fracción I de las Condiciones Generales de Trabajo, "
            "adjunto el siguiente Certificado de Incapacidad Temporal para el Trabajo a nombre de "
            "{NOMBRE_EMPLEADO}."
        ),
    },
    {
        "categoria": "PERMISO_ECONOMICO",
        "nombre": "Permiso económico con goce de sueldo",
        "area_origen": "DIR",
        "palabras_clave": ["permiso económico", "artículo 61", "permiso con goce de sueldo"],
        "fundamento_legal": "Artículo 61 de las Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "De conformidad con el artículo 61 de las Condiciones Generales de Trabajo, informo que "
            "a petición del empleado C. {NOMBRE_EMPLEADO} se le concede permiso económico con goce "
            "de sueldo el día {FECHA_SOLICITADA}."
        ),
    },
    {
        "categoria": "VACACIONES",
        "nombre": "Periodo vacacional",
        "area_origen": "DIR",
        "palabras_clave": ["vacaciones", "periodo vacacional", "artículo 68", "disfrutar vacaciones"],
        "fundamento_legal": "Artículo 68 de las Condiciones Generales de Trabajo",
        "copias": "administrativas",
        "ejemplo_redaccion": (
            "De conformidad con el artículo 68 de las Condiciones Generales de Trabajo, informo a "
            "usted que a petición del empleado C. {NOMBRE_EMPLEADO}, se le autoriza disfrutar el "
            "{FECHA_SOLICITADA} su periodo vacacional correspondiente."
        ),
    },
    # ── SCEG: Presupuestales ───────────────────────────────────────────────────
    {
        "categoria": "TRASPASO_SALDOS",
        "nombre": "Traspaso de saldos / apertura de cuentas",
        "area_origen": "SCG",
        "palabras_clave": ["traspaso de saldos", "apertura de cuenta", "fuente de financiamiento", "remanente fam", "fafef", "empréstito"],
        "fundamento_legal": "Artículos 18 y 27 del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "En ejercicio de las atribuciones conferidas en los artículos 18 y 27 del Reglamento "
            "Interior, y con la finalidad de dar atención al oficio número {NUMERO_OFICIO} de la "
            "{DEPENDENCIA}, mediante el cual se solicita el traspaso de saldos de las siguientes "
            "fuentes de financiamiento:"
        ),
    },
    {
        "categoria": "AMPLIACION_PRESUPUESTAL",
        "nombre": "Ampliación / modificación presupuestal",
        "area_origen": "SCG",
        "palabras_clave": ["ampliación presupuestal", "modificación presupuestal", "adecuación presupuestal", "ampliación líquida"],
        "fundamento_legal": "Artículos 18 Fracción XVI y 27 Fracciones XVIII y XXIX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "En ejercicio de las atribuciones conferidas por los artículos 18, fracción XVI, y 27, "
            "fracciones XVIII y XXIX, del Reglamento Interior de la Secretaría de Finanzas y "
            "Administración, y en atención a su oficio número {NUMERO_OFICIO}, mediante el cual "
            "solicita se autorice la ampliación presupuestal."
        ),
    },
    {
        "categoria": "VALIDACION_OFICIOS",
        "nombre": "Validación y firma de oficios de modificación",
        "area_origen": "SCG",
        "palabras_clave": ["validación de oficios", "firma de oficios", "oficios de modificación", "zfe_monitor"],
        "fundamento_legal": "Artículos 18 Fracción XVI y 27 Fracciones XVIII y XXIX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "En ejercicio de las atribuciones conferidas en los artículos 18 en su fracción XVI y "
            "27 fracciones XVIII y XXIX del Reglamento Interior de la Secretaría de Finanzas y "
            "Administración; y derivado de la revisión efectuada, solicito atentamente se lleve a "
            "cabo el proceso de validación y firma de los oficios señalados."
        ),
    },
    {
        "categoria": "RECLASIFICACION",
        "nombre": "Reclasificación presupuestal",
        "area_origen": "SCG",
        "palabras_clave": ["reclasificación", "reclasificación presupuestal", "junta de gobierno"],
        "fundamento_legal": "Artículos 18 y 27 del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "En ejercicio de las atribuciones conferidas en el artículo 18 y 27 del Reglamento "
            "Interior de la Secretaría de Finanzas y Administración, me permito dar atención a su "
            "oficio en el que solicita la reclasificación presupuestal. Lo referente a Servicios "
            "Personales es responsabilidad de la Dirección de Recursos Humanos."
        ),
    },
    {
        "categoria": "ECONOMIAS",
        "nombre": "Economías presupuestales / recursos no ejercidos",
        "area_origen": "SCG",
        "palabras_clave": ["economías presupuestales", "recursos no ejercidos", "presupuesto no ejercido", "calendario de gasto"],
        "fundamento_legal": "Artículos 18 Fracción XVI, 27 Fracciones XVIII, XXIV, XXVIII y XXIX del Reglamento Interior de la SFA; Arts. 33 y 34 del Decreto del Presupuesto de Egresos",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "Se informa a usted que los recursos no ejercidos en el periodo correspondiente se "
            "consideran economías presupuestales. En ese sentido, se reitera la importancia de "
            "ajustarse estrictamente a la distribución del Presupuesto de Egresos autorizado."
        ),
    },
    {
        "categoria": "SOLICITUD_DOCUMENTACION",
        "nombre": "Solicitud de documentación complementaria",
        "area_origen": "SCG",
        "palabras_clave": ["documentación complementaria", "apertura de programa", "convenio", "programa nuevo"],
        "fundamento_legal": "Artículos 18 Fracción XVI y 27 Fracciones XVIII y XXIX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "En ejercicio de las atribuciones conferidas en los artículos 18 en su fracción XVI y "
            "27 fracciones XVIII y XXIX del Reglamento Interior de la Secretaría de Finanzas y "
            "Administración; y con el propósito de estar en condiciones de atender su solicitud, "
            "se requiere la siguiente documentación:"
        ),
    },
    # ── SPF: Programación ──────────────────────────────────────────────────────
    {
        "categoria": "VALIDACION_CENTROS",
        "nombre": "Validación de centros gestores / centros de costos SAP",
        "area_origen": "SPF",
        "palabras_clave": ["centros gestores", "centros de costos", "validación sap", "centro gestor"],
        "fundamento_legal": "Artículos 18 y 27 Fracciones I y XXX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "Con fundamento en los artículos 18 y 27 fracciones I y XXX del Reglamento Interior "
            "de la Secretaría de Finanzas y Administración, en atención a su oficio, mediante el "
            "cual solicita la validación de los Centros Gestores, Centros de Costos y Posiciones "
            "Presupuestales."
        ),
    },
    {
        "categoria": "USUARIO_SAP",
        "nombre": "Creación / renovación de usuario SAP",
        "area_origen": "SPF",
        "palabras_clave": ["usuario sap", "contraseña sap", "acceso sap", "unidad programática"],
        "fundamento_legal": "Artículos 18 y 27 Fracciones I y XXX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "Con fundamento en los artículos 18 y 27 fracciones I y XXX del Reglamento Interior "
            "de la Secretaría de Finanzas y Administración, y en atención a su oficio, informo que "
            "fue creado un nuevo usuario y contraseña para su Unidad Programática Presupuestaria."
        ),
    },
    {
        "categoria": "PROGRAMACION_GRAL",
        "nombre": "Respuesta sobre programación presupuestal",
        "area_origen": "SPF",
        "palabras_clave": ["programación presupuestal", "formulación presupuestal", "presupuesto de egresos", "inversión pública"],
        "fundamento_legal": "Artículos 18 y 27 Fracciones I y XXX del Reglamento Interior de la SFA",
        "copias": "presupuestales",
        "ejemplo_redaccion": (
            "Con fundamento en los artículos 18 y 27 fracciones I y XXX del Reglamento Interior "
            "de la Secretaría de Finanzas y Administración, y en atención a su oficio, me permito "
            "dar respuesta respecto a la programación presupuestal solicitada."
        ),
    },
]


def detectar_plantilla(asunto: str, instrucciones: str = "") -> dict | None:
    """Detecta la plantilla más adecuada por palabras clave en asunto/instrucciones."""
    texto = (asunto + " " + instrucciones).lower()
    mejor = None
    mejor_score = 0
    for p in PLANTILLAS_OFICIO:
        score = sum(1 for kw in p["palabras_clave"] if kw in texto)
        if score > mejor_score:
            mejor = p
            mejor_score = score
    return mejor if mejor_score > 0 else None


def obtener_copias(tipo: str = "presupuestales") -> list[str]:
    """Retorna las copias estándar según el tipo de oficio."""
    if tipo == "administrativas":
        return list(COPIAS_ADMINISTRATIVAS)
    return list(COPIAS_PRESUPUESTALES)


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
_PROMPT_OCR_OFICIO = """### INSTRUCCIÓN DE IDIOMA (MÁXIMA PRIORIDAD — NO NEGOCIABLE) ###
Responde SIEMPRE Y ÚNICAMENTE EN ESPAÑOL (es-MX). PROHIBIDO cualquier contenido
en inglés (incluso palabras sueltas como "Subject", "From", "Date", "Attached",
"Memorandum", "Report", "Request", "Invoice", etc.). Si encuentras cualquiera
de esas palabras en el documento, TRADÚCELAS al español antes de escribirlas
en el JSON (p.ej. "Subject" → "Asunto"). Esta regla aplica a TODOS los campos,
sin excepción, incluyendo resúmenes, descripciones, etiquetas y anexos.

Eres un experto en lectura de correspondencia oficial del Gobierno del Estado de Michoacán.
Analiza este documento oficial (oficio institucional) y extrae los datos en formato JSON estricto.

IDIOMA OBLIGATORIO: TODA la información extraída, incluyendo resúmenes, descripciones, campos de texto
libre y cualquier contenido que generes, DEBE estar en ESPAÑOL. No traduzcas nombres propios ni términos
técnicos en español. NUNCA respondas en inglés ni en otro idioma, aunque el documento parezca
contener palabras en otro idioma o el OCR esté confuso.

COBERTURA MULTI-PÁGINA: El documento puede tener VARIAS CUARTILLAS/PÁGINAS. DEBES analizar
EXHAUSTIVAMENTE TODAS las páginas del documento antes de extraer los datos. Las firmas, el pie
de oficio, las iniciales de elaboración/revisión y los anexos suelen estar en las ÚLTIMAS
páginas, nunca asumas que están en la primera. Si hay varios firmantes distribuidos en
distintas páginas, identifícalos TODOS.

Extrae ÚNICAMENTE los campos que puedas identificar claramente. Si un campo no es visible o no existe, usa null.

{
  "numero_oficio": "número de folio/oficio del remitente (ej: SCOP/DA/E0167/2026)",
  "fecha_documento": "fecha en formato YYYY-MM-DD",
  "lugar_fecha": "lugar y fecha como aparece en el documento",
  "asunto": "contenido exacto del campo Asunto",
  "remitente_nombre": "nombre completo del firmante PRINCIPAL (ver REGLAS DE FIRMANTES)",
  "remitente_cargo": "cargo del firmante PRINCIPAL",
  "remitente_dependencia": "institución o dependencia que envía",
  "firmantes_adicionales": [
    {
      "nombre": "nombre de firmante secundario (ej: visto bueno, autorización)",
      "cargo": "cargo del firmante secundario",
      "rol": "visto_bueno | autoriza | elaboró | revisó | otro"
    }
  ],
  "destinatario_nombre": "nombre del destinatario",
  "destinatario_cargo": "cargo del destinatario",
  "cuerpo_resumen": "resumen EN ESPAÑOL del contenido principal del oficio (máximo 150 palabras)",
  "numero_paginas": "número total de páginas/cuartillas del oficio principal (no cuentes anexos)",
  "anexos": [
    {
      "tipo": "oficio | tabla | comprobante | factura | contrato | listado | otro",
      "descripcion": "breve descripción EN ESPAÑOL del anexo",
      "paginas": "rango de páginas donde se encuentra (ej: '3-5')"
    }
  ],
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
  "sello_recibido": "texto del sello de recibido si aparece (fecha, área)",
  "plazo_respuesta_detectado": "plazo textual detectado en el documento si existe, ej: '3 días hábiles', '5 días naturales', '48 horas', null si no hay",
  "plazo_dias_numero": null,
  "origen_requiere_urgencia": false,
  "tipo_origen": "dependencia_externa|juridico|transparencia|organo_control|auditoria|otro"
}

=== REGLAS DE FIRMANTES (CRÍTICO) ===
Un oficio puede tener VARIOS firmantes. Debes distinguir quién es el REMITENTE PRINCIPAL
(la persona que emite el oficio y con quien se debe dirigir la respuesta) de quienes firman
como visto bueno, autorización, elaboración o revisión.

Jerarquía para identificar al REMITENTE PRINCIPAL:
  1. Es el firmante de MAYOR JERARQUÍA en el pie del oficio (Secretario > Subsecretario >
     Director General > Director > Subdirector > Jefe de Departamento > Titular/Responsable).
  2. Es quien aparece con cargo ejecutivo/directivo, NO el que firma con etiqueta "Elaboró",
     "Revisó", "Vo.Bo.", "Visto Bueno", "Autoriza" o iniciales al pie.
  3. Cuando dos firmantes tienen el mismo nivel, el REMITENTE es el primero en el orden
     del oficio (generalmente a la izquierda o arriba).
  4. Las INICIALES AL PIE (ej: "MAFM/hda/jlpe") NO son firmantes — son solo referencias
     de quien elaboró/revisó. NO las uses como remitente_nombre.
  5. Si el oficio está firmado por UNA sola persona, esa es el remitente y "firmantes_adicionales"
     debe ser [] (array vacío).

Coloca los demás firmantes (visto bueno, autoriza, elaboró, revisó) en "firmantes_adicionales".
NUNCA confundas a un firmante de visto bueno con el remitente principal.

=== REGLAS DE ANEXOS ===
Si el documento incluye ANEXOS (tablas, listados, comprobantes, oficios adjuntos, fotos, etc.):
  - Identifica CADA anexo en el array "anexos" con su tipo y descripción en español.
  - No describas el anexo en lugar del oficio principal — el "cuerpo_resumen" debe ser
    del oficio principal, no de los anexos.
  - Si el oficio principal menciona "se adjunta X", "anexo al presente", "se acompaña",
    etc., ahí hay anexos que debes registrar.

=== REGLAS DE PLAZOS ===
- Si el documento contiene un plazo explícito de respuesta (ej: "deberá responder en un plazo de 3 días hábiles"), EXTRAE el plazo en "plazo_respuesta_detectado" y el número en "plazo_dias_numero".
- Si el remitente es un órgano jurisdiccional, jurídico, de transparencia, órgano de control interno (OCI), auditoría, o ente fiscalizador, marca "origen_requiere_urgencia": true y en "tipo_origen" indica la categoría.
- Busca frases como: "se le requiere", "apercibimiento", "término de ley", "plazo perentorio", "días hábiles para contestar", "vencimiento".

Responde ÚNICAMENTE con el JSON, sin texto adicional ni markdown. TODO el contenido del JSON DEBE estar en ESPAÑOL."""

# ── Prompt generación de borrador (unificado para documentos recibidos) ────────
# Basado en los modelos institucionales reales de la DPP.
# Tres tipos de respuesta: positiva, negativa, informativa.
_PROMPT_BORRADOR = """### INSTRUCCIÓN DE IDIOMA (MÁXIMA PRIORIDAD — NO NEGOCIABLE) ###
Redacta el oficio ÍNTEGRAMENTE EN ESPAÑOL (es-MX). PROHIBIDO cualquier palabra
o frase en inglés. Si el documento de referencia adjunto contiene texto en
inglés, TRADÚCELO al español antes de usarlo en la respuesta. Si no sabes una
traducción, usa el término en español equivalente más cercano. Bajo ninguna
circunstancia incluyas texto en inglés en el oficio final.

Eres redactor de oficios de la Dirección de Programación y Presupuesto (DPP),
Subsecretaría de Finanzas, Secretaría de Finanzas y Administración del Gobierno de Michoacán.
El Director es el MTRO. MARCO ANTONIO FLORES MEJÍA.

OFICIO QUE SE CONTESTA:
- No. de oficio: {numero_oficio_origen}
- Fecha: {fecha_recibido}
- Remitente: {remitente_nombre}, {remitente_cargo}
- Dependencia: {remitente_dependencia}
- Asunto: {asunto}
- Resumen: {cuerpo_resumen}

ÁREA QUE ATIENDE: {area_nombre}
FUNDAMENTO LEGAL: {fundamento_legal}

{ejemplo_modelo}

=== TIPO DE RESPUESTA ===
Determina el tipo según las instrucciones del Director y el contenido del oficio:

1. RESPUESTA POSITIVA (la solicitud procede):
   Estructura: fundamento legal → referencia al oficio → resolución favorable con datos específicos → cierre.
   Ejemplo de apertura: "En ejercicio de las atribuciones conferidas en los artículos [X] del Reglamento Interior de la SFA, y con la finalidad de dar atención al oficio número [X]..."

2. RESPUESTA NEGATIVA (la solicitud NO procede):
   Estructura: fundamento legal → referencia al oficio → explicación técnica del motivo de improcedencia → cierre.
   Motivos comunes: datos maestros incorrectos, insuficiencia presupuestal, falta de documentación, incumplimiento normativo.
   Redactar con firmeza pero respeto. Indicar qué debe corregir o presentar el solicitante.

3. RESPUESTA INFORMATIVA (comunicación administrativa breve):
   Estructura: referencia o contexto → información que se comunica → cierre.
   Para avisos, notificaciones, remisión de documentos o respuestas breves.

=== REGLAS OBLIGATORIAS ===
1. NO inventes artículos, fracciones ni normativa. Usa SOLO la normativa indicada en FUNDAMENTO LEGAL.
2. Sé CONCISO: párrafos cortos, sin repetir información ni usar lenguaje excesivamente jurídico.
3. Estilo formal del Gobierno de Michoacán: trato de "Usted", "C." para personas.
4. Apertura: cita el fundamento legal y referencia al oficio que se contesta.
5. Cierre OBLIGATORIO: "Sin otro particular, me despido de usted no sin antes asegurarle mi más alta consideración y respeto."
6. NO incluyas encabezado, recuadro institucional, fecha, destinatario, firma, copias ni referencia — se generan automáticamente.
7. Si hay un EJEMPLO DE MODELO proporcionado arriba, REPLICA su estructura y estilo adaptándolo al caso concreto.
8. RESPETA ESTRICTAMENTE las instrucciones del Director proporcionadas abajo.
9. TABLAS: Cuando el contenido incluya tablas o cuadros de datos, SIEMPRE usa formato markdown con | (pipe).
   Ejemplo:
   | Columna 1 | Columna 2 | Columna 3 |
   |---|---|---|
   | dato 1 | dato 2 | dato 3 |
   Reproduce FIELMENTE todas las columnas, filas y datos. NO omitas ni simplifiques tablas.
10. Si las instrucciones piden incluir la fecha con un valor específico, USA ESA FECHA en el texto del oficio.

Redacta ÚNICAMENTE el cuerpo del oficio de respuesta:"""


# ── Prompt para oficios emitidos (documentos originados en DPP) ───────────────
_PROMPT_BORRADOR_EMITIDO = """### INSTRUCCIÓN DE IDIOMA (MÁXIMA PRIORIDAD — NO NEGOCIABLE) ###
Redacta el oficio ÍNTEGRAMENTE EN ESPAÑOL (es-MX). PROHIBIDO cualquier palabra
o frase en inglés. Si el documento de referencia contiene texto en inglés,
TRADÚCELO al español antes de usarlo en la respuesta.

Eres redactor de oficios de la Dirección de Programación y Presupuesto (DPP),
Subsecretaría de Finanzas, Secretaría de Finanzas y Administración del Gobierno de Michoacán.
El Director es el MTRO. MARCO ANTONIO FLORES MEJÍA.

OFICIO A GENERAR:
- Destinatario: {destinatario}
- Dependencia destino: {dependencia_destino}
- Asunto: {asunto}
- Área de origen: {area_origen}
{plantilla_info}

=== REGLAS OBLIGATORIAS ===
1. NO inventes artículos, fracciones ni normativa. Usa SOLO la normativa que aparece en la PLANTILLA DETECTADA.
2. Sé CONCISO: párrafos cortos, lenguaje institucional directo sin ser excesivamente jurídico.
3. Estilo formal del Gobierno de Michoacán: trato de "Usted", "C." para personas.
4. Estructura del cuerpo:
   a) Fundamento legal: "Con fundamento en lo dispuesto por los artículos [de la plantilla]..."
   b) Desarrollo: contenido técnico del asunto, preciso y sustentado.
   c) Cierre: "Sin otro particular, me despido de usted no sin antes asegurarle mi más alta consideración y respeto."
5. Si hay EJEMPLO DE REDACCIÓN en la plantilla, REPLICA su estructura y estilo adaptándolo al caso.
6. Oficio presupuestal → cita artículos del RISFA.
   Oficio administrativo interno → cita artículos de las Condiciones Generales de Trabajo.
7. NO incluyas encabezado, recuadro, fecha, destinatario, firma, copias ni referencia — se generan automáticamente.
8. RESPETA ESTRICTAMENTE las instrucciones proporcionadas abajo.
9. TABLAS: Cuando el contenido incluya tablas o cuadros de datos, SIEMPRE usa formato markdown con | (pipe).
   Ejemplo:
   | Columna 1 | Columna 2 | Columna 3 |
   |---|---|---|
   | dato 1 | dato 2 | dato 3 |
   Reproduce FIELMENTE todas las columnas, filas y datos.
10. Si las instrucciones piden una fecha específica, USA ESA FECHA en el texto del oficio.

{instrucciones_extra}

Redacta ÚNICAMENTE el cuerpo del oficio:"""


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

    # ── Extracción de texto Word (docx) ───────────────────────────────────────

    def _extraer_texto_word(self, file_bytes: bytes) -> str:
        """Extrae texto plano de un archivo .docx usando python-docx."""
        try:
            import io
            import docx
            doc_word = docx.Document(io.BytesIO(file_bytes))
            parts = []
            for element in doc_word.element.body:
                if element.tag.endswith('}p'):
                    from docx.oxml.ns import qn
                    texts = [node.text or "" for node in element.iter(qn('w:t'))]
                    line = "".join(texts).strip()
                    if line:
                        parts.append(line)
                elif element.tag.endswith('}tbl'):
                    from docx.table import Table as DocxTable
                    table = DocxTable(element, doc_word)
                    for row in table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        parts.append(" | ".join(cells))
            return "\n".join(parts)
        except ImportError:
            logger.warning("[OCR-WORD] python-docx no instalado. Instala: pip install python-docx")
            return ""
        except Exception as e:
            logger.error(f"[OCR-WORD] Error al leer .docx: {e}")
            return ""

    async def procesar_oficio_escaneado(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict:
        """
        Procesa un oficio (PDF, imagen o Word):
          1. OCR / extracción de texto según formato
          2. Clasificación automática
          3. Cálculo de fecha límite

        Returns dict con: datos_extraidos + clasificacion + fecha_limite
        """
        from app.services.gemini_service import gemini_service

        # ── Tipos soportados nativamente por Gemini Vision ────────────────────
        _MIME_VISION = {
            "application/pdf",
            "image/jpeg", "image/jpg", "image/png",
            "image/tiff", "image/webp", "image/gif",
        }
        # ── Tipos Word: extraer texto y enviar como texto ─────────────────────
        _MIME_WORD = {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        }

        datos: dict = {}
        if gemini_service.available:
            try:
                from app.core.config import settings
                from google import genai

                client = genai.Client(api_key=settings.GEMINI_API_KEY)
                mime_norm = (mime_type or "").lower().split(";")[0].strip()

                if mime_norm in _MIME_WORD:
                    # ── Ruta Word: extraer texto → Gemini texto ────────────────
                    logger.info(f"[OCR] Archivo Word detectado ({mime_norm}), extrayendo texto con python-docx...")
                    texto_word = self._extraer_texto_word(image_bytes)
                    if not texto_word.strip():
                        logger.warning("[OCR] No se pudo extraer texto del archivo Word.")
                        datos = {"error": "No se pudo leer el texto del archivo Word.", "_mock": True}
                    else:
                        logger.info(f"[OCR] Texto Word extraído ({len(texto_word)} chars). Enviando a Gemini texto...")
                        prompt_texto = (
                            f"{_PROMPT_OCR_OFICIO}\n\n"
                            f"=== TEXTO DEL DOCUMENTO ===\n{texto_word[:8000]}"
                        )
                        resp = client.models.generate_content(
                            model="gemini-2.5-flash",
                            contents=[prompt_texto],
                        )
                        raw_text = resp.text or ""
                        logger.info(f"[OCR-WORD] Respuesta Gemini (primeros 500 chars): {raw_text[:500]}")
                        datos = gemini_service._parse_json_response(raw_text)
                        if not datos or datos.get("raw_response") or datos.get("error"):
                            logger.warning(f"[OCR-WORD] Parseo fallido. raw_text:\n{raw_text[:2000]}")
                        else:
                            logger.info(f"[OCR-WORD] Campos extraídos: {list(datos.keys())}")

                elif mime_norm in _MIME_VISION:
                    # ── Ruta Vision: PDF / imagen → Gemini Vision ─────────────
                    from google.genai import types
                    _MODELOS_VISION = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
                    raw_text = ""
                    for _modelo in _MODELOS_VISION:
                        try:
                            logger.info(f"[OCR] Intentando modelo {_modelo}...")
                            resp = client.models.generate_content(
                                model=_modelo,
                                contents=[
                                    types.Part.from_bytes(data=image_bytes, mime_type=mime_norm),
                                    _PROMPT_OCR_OFICIO,
                                ],
                            )
                            raw_text = resp.text or ""
                            if raw_text.strip():
                                logger.info(f"[OCR] Modelo {_modelo} respondió OK ({len(raw_text)} chars).")
                                break
                            else:
                                logger.warning(f"[OCR] Modelo {_modelo} devolvió respuesta vacía, probando siguiente.")
                        except Exception as _em:
                            logger.warning(f"[OCR] Modelo {_modelo} falló: {type(_em).__name__}: {_em}. Probando siguiente.")
                    datos = gemini_service._parse_json_response(raw_text) if raw_text else {}
                    if not datos or datos.get("raw_response") or datos.get("error"):
                        logger.warning(f"[OCR] Parseo fallido o vacío. raw_text completo:\n{raw_text[:2000]}")
                    else:
                        logger.info(f"[OCR] Campos extraídos: {list(datos.keys())}")

                else:
                    logger.warning(f"[OCR] Tipo de archivo no soportado para extracción IA: {mime_norm}")
                    datos = {"error": f"Tipo de archivo no soportado para extracción IA: {mime_norm}", "_mock": True}

            except Exception as e:
                logger.error(f"[OCR] Error Gemini: {type(e).__name__}: {e}", exc_info=True)
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

        # ── Detección de prioridad urgente (Punto 6) ──
        prioridad_sugerida = "normal"
        plazo_detectado = datos.get("plazo_respuesta_detectado")
        origen_urgente = datos.get("origen_requiere_urgencia", False)
        tipo_origen = datos.get("tipo_origen", "otro")

        # Auto-urgente si: IA detectó plazo explícito, o es de jurídico/transparencia/OCI
        if origen_urgente or tipo_origen in ("juridico", "transparencia", "organo_control", "auditoria"):
            prioridad_sugerida = "urgente"
        elif plazo_detectado and datos.get("plazo_dias_numero"):
            try:
                dias = int(datos["plazo_dias_numero"])
                if dias <= 5:
                    prioridad_sugerida = "urgente"
            except (ValueError, TypeError):
                pass

        # Si la IA detectó un plazo numérico, usar ese para fecha_limite
        if datos.get("plazo_dias_numero"):
            try:
                plazo_ia = int(datos["plazo_dias_numero"])
                if 1 <= plazo_ia <= 60:
                    fecha_limite = calcular_fecha_limite(hoy, plazo_ia)
            except (ValueError, TypeError):
                pass

        return {
            "datos_extraidos": datos,
            "clasificacion":   clasificacion,
            "fecha_limite":    fecha_limite.isoformat(),
            "prioridad_sugerida": prioridad_sugerida,
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
        contenido_referencia: str = "",
        referencia_archivo_bytes: bytes | None = None,
        referencia_mime_type: str = "",
    ) -> str:
        """
        Genera un borrador de oficio de respuesta usando Gemini.
        Usa modelos institucionales como referencia para estructura y estilo.
        Retorna el cuerpo del oficio (sin membrete ni firma).
        """
        from app.services.gemini_service import gemini_service

        # Detectar plantilla por asunto/instrucciones para dar contexto al modelo
        plantilla = detectar_plantilla(asunto or "", instrucciones)
        ejemplo_modelo = ""
        if plantilla:
            ejemplo_modelo = (
                f"\nEJEMPLO DE MODELO INSTITUCIONAL (usa como referencia de estructura y estilo):\n"
                f"Tipo: {plantilla['nombre']}\n"
                f"Fundamento: {plantilla['fundamento_legal']}\n"
                f"Redacción modelo: \"{plantilla['ejemplo_redaccion']}\"\n"
            )

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
            .replace("{ejemplo_modelo}", ejemplo_modelo)
        )

        if instrucciones:
            prompt += f"\n\nINSTRUCCIONES DEL DIRECTOR (RESPETAR ESTRICTAMENTE):\n{instrucciones}"

        # ── Referencia: texto extraído (fallback) o indicación de archivo adjunto
        if contenido_referencia and not referencia_archivo_bytes:
            prompt += (
                f"\n\nDOCUMENTO DE REFERENCIA ADJUNTADO POR EL USUARIO "
                f"(REPRODUCIR FIELMENTE tablas, datos y estructura del documento):\n"
                f"---INICIO REFERENCIA---\n{contenido_referencia[:30000]}\n---FIN REFERENCIA---"
            )
        elif referencia_archivo_bytes:
            prompt += (
                "\n\nIMPORTANTE: Se adjunta un DOCUMENTO DE REFERENCIA como archivo. "
                "Analiza el archivo adjunto y REPRODUCE FIELMENTE en tu respuesta:\n"
                "- Tablas: replica la estructura exacta con todos los datos, columnas y filas\n"
                "- Cifras y montos: copia tal cual, sin redondear ni alterar\n"
                "- Formato: respeta encabezados, listas y estructura del documento\n"
                "- Si las instrucciones del Director indican 'usa el oficio adjunto' o similar, "
                "basa tu respuesta en el contenido del archivo adjunto\n"
                "- Si las instrucciones piden 'no generes cambios' o 'solo mejora redacción', "
                "mantén el contenido íntegro y solo mejora la redacción formal\n"
            )

        if not gemini_service.available:
            return (
                f"Con fundamento en lo dispuesto por {fundamento_legal}, "
                f"y en atención a su oficio número {numero_oficio_origen}, "
                f"de fecha {fecha_recibido}, mediante el cual {asunto}, "
                f"me permito hacer de su conocimiento lo siguiente:\n\n"
                f"[Contenido de respuesta — complete manualmente]\n\n"
                f"Sin otro particular, me despido de usted no sin antes asegurarle "
                f"mi más alta consideración y respeto."
            )

        try:
            from app.core.config import settings
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)

            # ── Contenido multimodal: prompt + archivo de referencia si existe
            # NOTA: Gemini solo soporta imágenes y PDF como multimodal.
            # Para .docx/.xlsx/.csv/.txt se usa el texto extraído en el prompt.
            GEMINI_MULTIMODAL_MIMES = {
                "image/jpeg", "image/png", "image/webp", "image/tiff",
                "application/pdf",
            }
            contents: list = []

            if referencia_archivo_bytes and referencia_mime_type and referencia_mime_type in GEMINI_MULTIMODAL_MIMES:
                contents.append(
                    types.Part.from_bytes(data=referencia_archivo_bytes, mime_type=referencia_mime_type)
                )
            elif referencia_archivo_bytes and referencia_mime_type and contenido_referencia:
                # Archivo no soportado por Gemini multimodal — usar texto extraído
                prompt += (
                    f"\n\nDOCUMENTO DE REFERENCIA (texto extraído del archivo adjunto):\n"
                    f"---INICIO REFERENCIA---\n{contenido_referencia[:30000]}\n---FIN REFERENCIA---"
                )

            contents.append(prompt)

            # Llamada con retry automático + fallback a modelo lite
            texto = await _gemini_generate_with_retry(client, contents)
            # Limpiar encabezados que la IA incluyó a pesar de las instrucciones
            return self._limpiar_encabezados_ia(texto)
        except Exception as e:
            logger.error(f"Error Gemini generar_borrador (tras reintentos): {e}")
            err_str = str(e)
            if _is_overload_error(err_str):
                return "[⚠️ El servicio de IA está sobrecargado tras varios intentos automáticos. Por favor, espere 1-2 minutos y use el botón 'Regenerar IA'.]\n\nMientras tanto, puede escribir el contenido manualmente."
            return f"[⚠️ Error al generar borrador. Intente nuevamente o complete manualmente.]\n\nDetalle técnico: {e}"

    # ── Generación de borrador para documentos EMITIDOS ─────────────────────

    async def generar_borrador_emitido(
        self,
        *,
        asunto: str,
        destinatario: str = "",
        dependencia_destino: str = "",
        area_codigo: str = "DIR",
        instrucciones: str = "",
        contenido_referencia: str = "",
        referencia_archivo_bytes: bytes | None = None,
        referencia_mime_type: str = "",
    ) -> str:
        """
        Genera un borrador de oficio emitido por la DPP usando Gemini.
        Detecta la plantilla apropiada y usa ejemplos reales de redacción.
        Retorna el cuerpo del oficio (sin encabezado, firma ni copias).
        """
        from app.services.gemini_service import gemini_service

        # Detectar plantilla apropiada
        plantilla = detectar_plantilla(asunto, instrucciones)

        # Construir info de plantilla para el prompt
        plantilla_info = ""
        if plantilla:
            plantilla_info = (
                f"\nPLANTILLA DETECTADA: {plantilla['nombre']}\n"
                f"FUNDAMENTO LEGAL: {plantilla['fundamento_legal']}\n"
                f"EJEMPLO DE REDACCIÓN INSTITUCIONAL (úsalo como referencia de estilo):\n"
                f"\"{plantilla['ejemplo_redaccion']}\"\n"
            )
        else:
            plantilla_info = "\nNo se detectó plantilla específica. Usa estilo formal genérico.\n"

        # Obtener nombre del área
        area_info = AREAS_DPP.get(area_codigo, AREAS_DPP["DIR"])
        area_origen = area_info["nombre"]

        prompt = (
            _PROMPT_BORRADOR_EMITIDO
            .replace("{destinatario}", destinatario or "---")
            .replace("{dependencia_destino}", dependencia_destino or "---")
            .replace("{asunto}", asunto or "---")
            .replace("{area_origen}", area_origen)
            .replace("{plantilla_info}", plantilla_info)
            .replace("{instrucciones_extra}",
                      f"INSTRUCCIONES ADICIONALES:\n{instrucciones}" if instrucciones else "")
        )

        if contenido_referencia and not referencia_archivo_bytes:
            prompt += (
                f"\n\nDOCUMENTO DE REFERENCIA ADJUNTADO POR EL USUARIO "
                f"(REPRODUCIR FIELMENTE tablas, datos y estructura):\n"
                f"---INICIO REFERENCIA---\n{contenido_referencia[:30000]}\n---FIN REFERENCIA---"
            )
        elif referencia_archivo_bytes:
            prompt += (
                "\n\nIMPORTANTE: Se adjunta un DOCUMENTO DE REFERENCIA como archivo. "
                "REPRODUCE FIELMENTE tablas, cifras, estructura y datos del archivo adjunto."
            )

        if not gemini_service.available:
            fundamento = plantilla["fundamento_legal"] if plantilla else "Arts. 18 y 19 del RISFA"
            return (
                f"Con fundamento en lo dispuesto por {fundamento}, "
                f"me permito comunicar a usted lo siguiente:\n\n"
                f"[Contenido del oficio — complete manualmente]\n\n"
                f"Sin otro particular, me despido de usted no sin antes asegurarle "
                f"mi más alta consideración y respeto."
            )

        try:
            from app.core.config import settings
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)

            GEMINI_MULTIMODAL_MIMES = {
                "image/jpeg", "image/png", "image/webp", "image/tiff",
                "application/pdf",
            }
            contents: list = []
            if referencia_archivo_bytes and referencia_mime_type and referencia_mime_type in GEMINI_MULTIMODAL_MIMES:
                contents.append(
                    types.Part.from_bytes(data=referencia_archivo_bytes, mime_type=referencia_mime_type)
                )
            elif referencia_archivo_bytes and referencia_mime_type and contenido_referencia:
                prompt += (
                    f"\n\nDOCUMENTO DE REFERENCIA (texto extraído del archivo adjunto):\n"
                    f"---INICIO REFERENCIA---\n{contenido_referencia[:30000]}\n---FIN REFERENCIA---"
                )
            contents.append(prompt)

            # Llamada con retry automático + fallback a modelo lite
            texto = await _gemini_generate_with_retry(client, contents)
            # Limpiar encabezados que la IA incluyó a pesar de las instrucciones
            return self._limpiar_encabezados_ia(texto)
        except Exception as e:
            logger.error(f"Error Gemini generar_borrador_emitido (tras reintentos): {e}")
            err_str = str(e)
            if _is_overload_error(err_str):
                return "[⚠️ El servicio de IA está sobrecargado tras varios intentos automáticos. Por favor, espere 1-2 minutos y use el botón 'Regenerar IA'.]\n\nMientras tanto, puede escribir el contenido manualmente."
            return f"[⚠️ Error al generar borrador. Intente nuevamente o complete manualmente.]\n\nDetalle técnico: {e}"

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
        # Primero limpiar encabezados que la IA no debió incluir
        text = CorrespondenciaService._limpiar_encabezados_ia(text)

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

    @staticmethod
    def _limpiar_encabezados_ia(text: str) -> str:
        """
        Elimina encabezados/destinatarios que la IA genera a veces
        a pesar de las instrucciones de no hacerlo.
        Estos ya los agrega automáticamente el generador de PDF/DOCX.
        """
        import re as _re

        # Eliminar líneas de lugar/fecha tipo "Morelia, Michoacán, 25 de marzo de 2026"
        text = _re.sub(
            r'^[ \t]*Morelia,?\s+Michoac[áa]n,?\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}\.?\s*\n',
            '', text, flags=_re.MULTILINE | _re.IGNORECASE
        )

        # Eliminar bloque de destinatario:
        # Patrón: "C. " o "C.P." o "LIC." o "MTRO." seguido de nombre en MAYÚSCULAS
        # y líneas subsiguientes con cargo/dependencia/PRESENTE.
        # Hasta encontrar una línea en blanco o inicio de párrafo normal
        text = _re.sub(
            r'^[ \t]*\*{0,2}C\.?\s+[A-ZÁÉÍÓÚÑ\s\.\,]+\*{0,2}\s*\n'   # "C. NOMBRE COMPLETO"
            r'(?:[ \t]*\*{0,2}[\-—]+\*{0,2}\s*\n)?'                     # posible línea "---"
            r'(?:[ \t]*\*{0,2}[A-ZÁÉÍÓÚÑ\.\s\,]+\*{0,2}\.?\s*\n)*'     # cargo/dependencia/nombre
            r'(?:[ \t]*\*{0,2}PRESENTE\.?\*{0,2}\s*\n)?',               # "PRESENTE."
            '', text, count=1, flags=_re.MULTILINE
        )

        # Eliminar línea suelta "PRESENTE." que pueda quedar
        text = _re.sub(r'^[ \t]*\*{0,2}PRESENTE\.?\*{0,2}\s*$', '', text, count=1, flags=_re.MULTILINE)

        # Eliminar encabezado institucional que la IA genera
        text = _re.sub(
            r'^[ \t]*\*{0,2}Gobierno\s+del\s+Estado\s*(de\s+Michoac[áa]n\s*(de\s+Ocampo)?)?\*{0,2}\s*\n',
            '', text, flags=_re.MULTILINE | _re.IGNORECASE
        )
        # Eliminar "Secretaría de Finanzas y Administración" suelto al inicio
        text = _re.sub(
            r'^[ \t]*\*{0,2}Secretar[íi]a\s+de\s+Finanzas\s+y\s+Administraci[óo]n\*{0,2}\s*\n',
            '', text, flags=_re.MULTILINE | _re.IGNORECASE
        )
        # Eliminar "Dirección de Programación y Presupuesto" suelto al inicio
        text = _re.sub(
            r'^[ \t]*\*{0,2}Direcci[óo]n\s+de\s+Programaci[óo]n\s+y\s+Presupuesto\*{0,2}\s*\n',
            '', text, flags=_re.MULTILINE | _re.IGNORECASE
        )

        # Eliminar líneas de datos institucionales que la IA a veces incluye
        for pattern in [
            r'^[ \t]*\*{0,2}Depend?encia:\*{0,2}\s+.*$',
            r'^[ \t]*\*{0,2}Sub-depend?encia:\*{0,2}\s+.*$',
            r'^[ \t]*\*{0,2}Oficina:\*{0,2}\s+.*$',
            r'^[ \t]*\*{0,2}No\.\s*de\s*oficio:\*{0,2}\s+.*$',
            r'^[ \t]*\*{0,2}Expediente:\*{0,2}\s+.*$',
            r'^[ \t]*\*{0,2}Asunto:\*{0,2}\s+.*$',
        ]:
            text = _re.sub(pattern, '', text, flags=_re.MULTILINE | _re.IGNORECASE)

        # Eliminar bloque de firma al final (ATENTAMENTE, nombre, cargo)
        text = _re.sub(
            r'\n\s*\*{0,2}A\s*T\s*E\s*N\s*T\s*A\s*M\s*E\s*N\s*T\s*E\*{0,2}\s*'
            r'(?:\n.*){0,5}$',
            '', text, flags=_re.IGNORECASE
        )

        # Limpiar líneas en blanco múltiples al inicio
        text = text.lstrip('\n')

        return text


# Singleton
correspondencia_service = CorrespondenciaService()
