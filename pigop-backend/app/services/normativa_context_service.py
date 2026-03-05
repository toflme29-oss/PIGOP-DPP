"""
Servicio de construccion de contexto normativo para prompts de IA.

Extrae referencias clave de la base de datos de normativas y las combina
con la jerarquia normativa institucional para generar contexto que se
inyecta en los prompts de Gemini al redactar oficios.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.correspondencia_service import REGLAS_TURNO, AREAS_DPP

# ---------- Jerarquia normativa aplicable a la DPP ----------

JERARQUIA_NORMATIVA = [
    # ── 1. Normativa interna (competencia directa de la DPP) ──
    {
        "clave": "RISFA",
        "titulo": "Reglamento Interior de la Secretaria de Finanzas y Administracion",
        "nivel": "Estatal - Reglamento interno",
        "articulos_dpp": [
            "Art. 18 - Atribuciones del Secretario de Finanzas y Administracion",
            "Art. 19 - Atribuciones de los Directores Generales",
            "Art. 27 - Atribuciones de la Direccion de Programacion y Presupuesto",
            "Art. 27 Fracc. I - Integrar y formular el anteproyecto de Presupuesto de Egresos",
            "Art. 27 Fracc. III - Coordinar y supervisar las transferencias presupuestales",
            "Art. 27 Fracc. VI - Establecer y difundir normas, politicas y lineamientos presupuestales",
            "Art. 27 Fracc. VIII - Coordinar la programacion y seguimiento del POA",
            "Art. 27 Fracc. IX - Emitir criterios normativos de programacion y presupuestacion",
            "Art. 27 Fracc. X - Proponer modificaciones al Decreto de Presupuesto de Egresos",
            "Art. 27 Fracc. XIII - Emitir opinion sobre estructuras organicas y plantillas",
            "Art. 27 Fracc. XIV - Expedir certificaciones de suficiencia presupuestal",
            "Art. 27 Fracc. XVII - Control de refrendos y saldos de ejercicios anteriores",
            "Art. 27 Fracc. XVIII - Brindar asesoria y capacitacion en materia presupuestal",
            "Art. 27 Fracc. XXI - Tramite y registro de documentos de ejecucion presupuestaria (DEPPs)",
            "Art. 27 Fracc. XXIV - Validar documentacion comprobatoria del gasto publico",
            "Art. 27 Fracc. XXVI - Certificar disponibilidad presupuestal para compromisos",
            "Art. 27 Fracc. XXVII - Participar en conciliaciones presupuestales con dependencias",
        ],
    },
    # ── 2. Manual operativo (norma del ejercicio del gasto, aplica a todas las UPPs) ──
    {
        "clave": "MANUAL_NORMAS_LINEAMIENTOS",
        "titulo": "Manual de Normas y Lineamientos para el Ejercicio y Control del Presupuesto de Egresos del Gobierno del Estado de Michoacan (PO 01-ago-2025)",
        "nivel": "Estatal - Manual operativo",
        "articulos_dpp": [
            "Art. 1 - Objeto: disposiciones para ministracion, ejercicio, control y evaluacion del gasto publico, obligatorio para todas las UPPs",
            "Art. 7 - Momentos contables del gasto: aprobado, modificado, comprometido, devengado, ejercido, pagado",
            "Art. 10 - El gasto publico solo podra ejercerse con suficiencia presupuestaria y apego al Clasificador por Objeto del Gasto",
            "Art. 13 - Adecuaciones presupuestarias via OMP Digital, con autorizacion de la Secretaria para traspasos de inversion a corriente",
            "Art. 14 - Seguimiento del ejercicio a traves de cumplimiento de metas (POA) y ejercicio de gasto calendarizado",
            "Art. 15 - Certificaciones de suficiencia presupuestaria: vigencia, partidas de uso generalizado, renovacion con evidencia",
            "Art. 18 - La Secretaria comunica a las UPPs el presupuesto autorizado por el Congreso",
            "Art. 26 - Transferencias compensadas entre partidas: solo con autorizacion de la Secretaria cuando cambien capitulos",
            "Art. 27 - Adecuaciones que afecten estructura programatica requieren ajuste al POA (ampliacion, reduccion, transferencia compensada)",
            "Art. 29 - Transferencias entre UPPs: requieren disponibilidad, afinidad funcional, solicitud formal de ambas UPPs",
            "Art. 36 - Comprobantes de erogaciones deben cumplir requisitos fiscales del CFDI conforme CFF y Resolucion Miscelanea",
            "Art. 39 - DEPP debe contener firmas electronicas del titular de la UPP y responsable del programa",
            "Art. 40 - DEPP: formato presupuestario para tramite de pago (comprobacion fondo revolvente, viaticos, pagos directos, anticipos)",
            "Art. 42 - Suspension de ministraciones a UPPs por incumplimiento en comprobacion de recursos",
            "Art. 45 - Fondo revolvente: monto maximo 10% del presupuesto mensual de gasto corriente",
            "Art. 48 - Transferencias federales etiquetadas: cuentas bancarias productivas especificas por fondo",
            "Art. 64 - Incumplimiento sancionado conforme LGCG, Ley de Fiscalizacion Superior y Ley de Responsabilidades Administrativas",
            "Art. 65 - Servicios personales: sujecion a plazas autorizadas, plantillas y tabuladores",
        ],
    },
    # ── 3. Ley estatal (planeacion y presupuesto de Michoacan) ──
    {
        "clave": "LEY_PLANEACION_HACENDARIA",
        "titulo": "Ley de Planeacion Hacendaria, Presupuesto, Gasto Publico y Contabilidad Gubernamental del Estado de Michoacan (Decreto 293, PO 20-mar-2014)",
        "nivel": "Estatal - Ley",
        "articulos_dpp": [
            "Art. 1 - Objeto: normar la planeacion hacendaria, programacion, presupuestacion, ejercicio, control y evaluacion del gasto publico estatal",
            "Art. 11 - Ley de Ingresos y Presupuesto de Egresos se sustentan en el Plan de Desarrollo Integral del Estado",
            "Art. 12 - Presupuesto basado en Resultados (PbR) y Sistema de Evaluacion del Desempeno (SED)",
            "Art. 18 - Servicios personales se sustentan en plazas autorizadas por la Comision Intersecretarial de Gasto-Financiamiento",
            "Art. 35 - Gasto publico se ajusta a la asignacion de cada UPP; no se ejercera gasto no contemplado en Presupuesto de Egresos",
            "Art. 36 - Adecuaciones presupuestales compensadas con autorizacion de la Secretaria (corriente a corriente, corriente a inversion)",
            "Art. 37 - Transferencias, ampliaciones, reducciones y modificaciones requieren autorizacion del Congreso cuando excedan techos",
            "Art. 42 - Afectaciones presupuestales y ministraciones se operan a traves de los sistemas electronicos de la Secretaria",
            "Art. 45 - Documentacion comprobatoria se conserva por periodo legal establecido",
        ],
    },
    # ── 4. Leyes generales/nacionales ──
    {
        "clave": "LEY_DISCIPLINA_FINANCIERA",
        "titulo": "Ley de Disciplina Financiera de las Entidades Federativas y los Municipios (DOF 27-abr-2016, ref. 10-may-2022)",
        "nivel": "Federal - Ley general",
        "articulos_dpp": [
            "Art. 1 - Objeto: criterios de responsabilidad hacendaria y financiera para Entidades Federativas y Municipios",
            "Art. 1 parr. 2 - Principios: legalidad, honestidad, eficacia, eficiencia, economia, racionalidad, austeridad, transparencia, control y rendicion de cuentas",
            "Art. 4 - Responsabilidad hacendaria: proyecciones de finanzas publicas a 5 anos, riesgos, estudio actuarial de pensiones",
            "Art. 5 - Obligacion de mantener finanzas publicas sostenibles; presupuestos congruentes con Criterios Generales de Politica Economica",
            "Art. 6 - Balance presupuestario sostenible (ingresos >= gastos, excepto amortizacion de deuda)",
            "Art. 10 - Servicios personales: limite de gasto, no crecimiento mayor al PIB, topes a remuneraciones",
            "Art. 12 - ADEFAS: hasta 2% de los ingresos totales de la Entidad Federativa",
            "Art. 13 - Ejercicio del gasto: suficiencia presupuestaria previa, erogaciones adicionales con ingresos excedentes, no crear plazas sin financiamiento",
            "Art. 13 Fracc. VI - Racionalizar gasto corriente; ahorros para corregir balance presupuestario negativo",
        ],
    },
    {
        "clave": "LGCG",
        "titulo": "Ley General de Contabilidad Gubernamental (DOF 31-dic-2008, ref. 01-abr-2024)",
        "nivel": "Federal - Ley general",
        "articulos_dpp": [
            "Art. 1 - Objeto: criterios generales de contabilidad gubernamental y emision de informacion financiera armonizada",
            "Art. 2 - Facilitar registro y fiscalizacion de activos, pasivos, ingresos y gastos; medir eficacia del gasto e ingresos publicos",
            "Art. 4 Fracc. XIV - Gasto comprometido: aprobacion de acto administrativo que formaliza relacion juridica con terceros",
            "Art. 4 Fracc. XV - Gasto devengado: reconocimiento de obligacion de pago por recepcion conforme de bienes/servicios/obras",
            "Art. 4 Fracc. XVI - Gasto ejercido: emision de cuenta por liquidar certificada (DEPP)",
            "Art. 4 Fracc. XVII - Gasto pagado: cancelacion total o parcial de obligaciones mediante desembolso",
            "Art. 36 - Clasificacion del gasto por objeto: capitulos, conceptos y partidas del Clasificador por Objeto del Gasto (CONAC)",
            "Art. 46 - Cuenta publica: informacion contable, presupuestaria y programatica del ejercicio fiscal",
            "Art. 56 - Informes trimestrales de estados financieros y presupuestarios a las legislaturas",
        ],
    },
    {
        "clave": "LEY_ADQUISICIONES",
        "titulo": "Ley de Adquisiciones, Arrendamientos y Prestacion de Servicios relacionados con Bienes Muebles del Estado de Michoacan",
        "nivel": "Estatal - Ley",
        "articulos_dpp": [
            "Objeto: regular adquisiciones, arrendamientos y servicios de bienes muebles con recursos publicos estatales",
            "Modalidades de adjudicacion: licitacion publica, invitacion restringida y adjudicacion directa",
            "Requisito presupuestal: toda adquisicion requiere certificacion de suficiencia presupuestal previa emitida por la DPP",
            "CADPE: Comite de Adquisiciones, opera con visto bueno presupuestal de la Secretaria de Finanzas",
        ],
    },
    # ── 5. Decreto de Presupuesto del ejercicio ──
    {
        "clave": "DECRETO_PRESUPUESTO",
        "titulo": "Decreto de Presupuesto de Egresos del Estado de Michoacan para el ejercicio fiscal vigente",
        "nivel": "Estatal - Decreto anual",
        "articulos_dpp": [
            "Art. 1 - Aprobacion del Presupuesto de Egresos para el ejercicio fiscal",
            "Art. 3 - Criterios de racionalidad, austeridad y disciplina presupuestal",
            "Art. 5 - Gasto se ejerce con base en calendarios financieros aprobados",
            "Art. 9 - Transferencias entre partidas requieren autorizacion de la SFA",
            "Disposiciones transitorias - Aplicabilidad del Manual de Normas y Lineamientos",
        ],
    },
]


class NormativaContextService:
    """Construye cadenas de contexto normativo para los prompts de IA."""

    async def build_context_for_oficio(
        self,
        db: AsyncSession,
        *,
        regla_turno_codigo: Optional[str] = None,
        area_codigo: Optional[str] = None,
        asunto: str = "",
    ) -> str:
        """
        Construye un string de contexto normativo optimizado para generacion
        de oficios con IA.

        Retorna un string formateado (~2000 tokens) conteniendo:
        1. Jerarquia normativa (RISFA > Ley Disciplina > LGCG > Decreto)
        2. Articulos especificos para la regla de turno aplicable
        3. Referencias clave de las normativas en BD
        """
        normativas_db = await self._get_db_normativas(db)
        turno_fundamento = self._get_turno_rule_fundamento(regla_turno_codigo)
        return self._format_context(normativas_db, turno_fundamento, area_codigo)

    async def _get_db_normativas(self, db: AsyncSession) -> list:
        """Obtiene normativas activas de la BD con sus referencias clave."""
        try:
            from app.models.normativa import Normativa
            stmt = (
                select(Normativa)
                .where(Normativa.activa.is_(True))
                .order_by(Normativa.orden)
            )
            result = await db.execute(stmt)
            return list(result.scalars().all())
        except Exception:
            return []

    def _get_turno_rule_fundamento(
        self, regla_codigo: Optional[str]
    ) -> Optional[str]:
        """Obtiene el fundamento legal especifico de la regla de turno."""
        if not regla_codigo:
            return None
        for regla in REGLAS_TURNO:
            if regla["codigo"] == regla_codigo:
                return regla["fundamento"]
        return None

    def _format_context(
        self,
        normativas_db: list,
        turno_fundamento: Optional[str],
        area_codigo: Optional[str],
    ) -> str:
        """Formatea toda la informacion normativa en un string para el prompt."""
        lines = [
            "=== MARCO NORMATIVO DE REFERENCIA ===",
            "",
            "Jerarquia normativa aplicable (de mayor a menor rango):",
        ]

        for i, norm in enumerate(JERARQUIA_NORMATIVA, 1):
            lines.append(f"\n{i}. {norm['titulo']}")
            for art in norm["articulos_dpp"]:
                lines.append(f"   - {art}")

        if turno_fundamento:
            lines.append("\n=== FUNDAMENTO ESPECIFICO DEL TURNO ===")
            lines.append(f"Fundamento aplicable: {turno_fundamento}")

        if area_codigo and area_codigo in AREAS_DPP:
            area = AREAS_DPP[area_codigo]
            lines.append(f"Area competente: {area['nombre']}")
            lines.append(f"Titular: {area['titular']}, {area['cargo']}")

        if normativas_db:
            lines.append("\n=== NORMATIVAS ADICIONALES EN BASE DE DATOS ===")
            for n in normativas_db:
                lines.append(f"- {n.titulo} ({n.tipo})")
                refs = getattr(n, "referencias_clave", None)
                if refs and isinstance(refs, list):
                    for ref in refs[:3]:
                        if isinstance(ref, dict):
                            lines.append(
                                f"  * {ref.get('art', '')}: {ref.get('desc', '')}"
                            )

        return "\n".join(lines)


normativa_context_service = NormativaContextService()
