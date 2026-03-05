"""
Motor de validación estructural de DEPPs — Fase 2.

Ejecuta un pipeline de 4 validaciones SIN IA (determinístico):
  1. Estructura básica del DEPP (campos obligatorios)
  2. Documentos obligatorios según clasificación
  3. Coherencia de datos (montos, capítulo, UPP)
  4. Clasificación automática

La Fase 3 agrega encima de esto: validación IA con Gemini y
consulta al motor de reglas normativas de la BD.
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.depp import DEPP, DocumentoDEPP
from app.models.validacion import ValidacionDEPP
from app.services.clasificacion_service import clasificacion_service
from app.schemas.depp import ValidacionResultSchema


class ValidationService:
    """Orquesta el pipeline de validación estructural de DEPPs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Pipeline principal ─────────────────────────────────────────────────────

    async def validar_depp_completo(self, depp: DEPP) -> List[ValidacionDEPP]:
        """
        Ejecuta todas las validaciones estructurales sobre el DEPP.
        Guarda cada resultado en la tabla validaciones_depp.
        Retorna lista de ValidacionDEPP creados.
        """
        resultados: List[ValidacionDEPP] = []

        # 1. Estructura básica
        r = self._validar_estructura(depp)
        resultados.append(await self._guardar(depp.id, r))

        # 2. Documentos obligatorios según clasificación
        r = self._validar_documentos(depp)
        resultados.append(await self._guardar(depp.id, r))

        # 3. Coherencia de datos
        r = self._validar_coherencia(depp)
        resultados.append(await self._guardar(depp.id, r))

        # 4. Regla presupuestal: no mezcla de fondos ni capítulos
        r = self._validar_regla_presupuestal(depp)
        resultados.append(await self._guardar(depp.id, r))

        # 5. Tipo DEPP: validaciones específicas PAGO / NO_PAGO
        r = self._validar_tipo_depp(depp)
        resultados.append(await self._guardar(depp.id, r))

        # 6. Clasificación automática (si no está definida)
        r = self._validar_clasificacion(depp)
        resultados.append(await self._guardar(depp.id, r))

        # Determinar resultado: APROBADO (con posibles alertas) o RECHAZADO
        puede_aprobar = self._puede_aprobar(resultados)
        nuevo_estado = "aprobado" if puede_aprobar else "rechazado"

        # Actualizar estado del DEPP
        depp.validado_automaticamente = True
        depp.puede_aprobar = puede_aprobar
        depp.estado = nuevo_estado
        depp.fecha_validacion = datetime.now(timezone.utc)
        self.db.add(depp)
        await self.db.flush()

        return resultados

    # ── Validaciones individuales ──────────────────────────────────────────────

    def _validar_estructura(self, depp: DEPP) -> dict:
        """Valida que los campos obligatorios estén presentes."""
        errores = []

        if not depp.folio:
            errores.append("Folio del DEPP ausente.")
        if not depp.upp:
            errores.append("Clave UPP ausente.")
        if not depp.ejercicio:
            errores.append("Ejercicio fiscal ausente.")
        if depp.monto_total is None:
            errores.append("Monto total ausente.")
        elif depp.monto_total <= 0:
            errores.append(f"Monto total inválido: {depp.monto_total}.")

        if errores:
            return {
                "tipo_validacion": "estructura",
                "resultado": "error",
                "gravedad": "critico",
                "articulo_manual": None,
                "descripcion_regla": "Campos obligatorios del DEPP",
                "mensaje": "El DEPP tiene campos obligatorios incompletos: "
                           + "; ".join(errores),
                "detalles": {"errores": errores},
            }

        return {
            "tipo_validacion": "estructura",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": None,
            "descripcion_regla": "Campos obligatorios del DEPP",
            "mensaje": "Estructura del DEPP correcta.",
            "detalles": {},
        }

    def _validar_documentos(self, depp: DEPP) -> dict:
        """Valida que los documentos adjuntos correspondan a la clasificación."""
        tipos_presentes = [doc.tipo for doc in depp.documentos]

        # Si no hay clasificación, intentar determinarla
        clasificacion = depp.clasificador_tipo
        if not clasificacion:
            clasificacion, _ = clasificacion_service.determinar_clasificacion(
                tipos_presentes, depp.capitulo
            )

        if not clasificacion:
            return {
                "tipo_validacion": "documentos",
                "resultado": "advertencia",
                "gravedad": "alto",
                "articulo_manual": "Art. 39",
                "descripcion_regla": "Clasificación de DEPPs",
                "mensaje": "No se pudo determinar la clasificación del DEPP. "
                           "Verifica que los documentos correctos estén adjuntos.",
                "detalles": {
                    "documentos_presentes": tipos_presentes,
                    "clasificaciones_validas": ["I.1", "II.1", "II.2", "II.3", "II.4"],
                },
            }

        faltantes = clasificacion_service.validar_documentos_requeridos(
            clasificacion, tipos_presentes
        )

        if faltantes:
            requeridos = clasificacion_service.get_documentos_requeridos(clasificacion)
            return {
                "tipo_validacion": "documentos",
                "resultado": "error",
                "gravedad": "critico",
                "articulo_manual": "Art. 39",
                "descripcion_regla": f"Documentos requeridos clasificación {clasificacion}",
                "mensaje": f"Clasificación {clasificacion} requiere: {', '.join(requeridos)}. "
                           f"Faltan: {', '.join(faltantes)}.",
                "detalles": {
                    "clasificacion": clasificacion,
                    "documentos_presentes": tipos_presentes,
                    "documentos_requeridos": requeridos,
                    "documentos_faltantes": faltantes,
                },
            }

        return {
            "tipo_validacion": "documentos",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 39",
            "descripcion_regla": f"Documentos requeridos clasificación {clasificacion}",
            "mensaje": f"Documentos completos para clasificación {clasificacion}.",
            "detalles": {
                "clasificacion": clasificacion,
                "documentos_presentes": tipos_presentes,
            },
        }

    def _validar_regla_presupuestal(self, depp: DEPP) -> dict:
        """
        Valida las reglas presupuestales fundamentales del DEPP:

        REGLA 1 — No mezcla de fuentes/fondos:
          Un DEPP debe usar UNA SOLA fuente de financiamiento.
          (Ej: no puede mezclar FONDO GRAL. DE PARTICIPACIONES con INGRESOS PROPIOS)

        REGLA 2 — No mezcla de capítulos de gasto:
          Un DEPP debe pertenecer a UN SOLO capítulo presupuestal.
          (Ej: no puede tener Cap. 1000 Serv. Personales + Cap. 3000 Serv. Generales)
          PERMITIDO: múltiples partidas del mismo capítulo
                     (Ej: 3111 + 3181 son ambas Cap. 3000 → OK)

        REGLA 3 — Consistencia UPP en clave presupuestaria:
          El código UPP del encabezado debe aparecer en la clave presupuestaria.
        """
        alertas = []
        errores = []

        # REGLA 1: No mezcla de fuentes de financiamiento
        # Si la fuente está en la clave presupuestaria, extractarla y comparar
        if depp.clave_presupuestaria and depp.fuente_financiamiento:
            clave = depp.clave_presupuestaria.strip()
            fuente = depp.fuente_financiamiento.strip()
            # La clave contiene la fuente: ej "...-261528091-..."
            if fuente and fuente not in clave:
                errores.append(
                    f"La fuente de financiamiento '{fuente}' no corresponde a la "
                    f"clave presupuestaria. Verifica que no se estén mezclando fondos."
                )

        # REGLA 2: No mezcla de capítulos (detectamos si capitulo y partida son inconsistentes)
        if depp.capitulo and depp.partida:
            # El primer dígito de la partida debe coincidir con el primer dígito del capítulo
            # Ej: capítulo 3000, partida debe ser 3xxx
            cap_str = str(depp.capitulo)
            part_str = str(depp.partida)
            cap_primer = cap_str[0] if cap_str else ""
            part_primer = part_str[0] if part_str else ""
            if cap_primer and part_primer and cap_primer != part_primer:
                errores.append(
                    f"Inconsistencia capítulo/partida: capítulo {depp.capitulo} "
                    f"no corresponde con partida {depp.partida}. "
                    f"Los DEPPs no pueden mezclar capítulos de gasto."
                )

        # REGLA 3: Consistencia UPP en clave presupuestaria
        if depp.clave_presupuestaria and depp.upp:
            clave = depp.clave_presupuestaria.strip()
            upp = depp.upp.strip().zfill(3)  # asegurar 3 dígitos
            # La UPP debe aparecer en el segmento de la clave
            # Formato: CLASIF-PROYECTOUPPUUR-... → buscamos UPP en el 2do segmento
            segmentos = clave.split("-")
            if len(segmentos) >= 2:
                seg_proyecto = segmentos[1]  # ej: "1600999999046004"
                if len(seg_proyecto) >= 13 and upp not in seg_proyecto:
                    alertas.append(
                        f"La UPP '{upp}' no se detecta en la clave presupuestaria. "
                        f"Verifica que la clave corresponda a la UPP del documento."
                    )

        if errores:
            return {
                "tipo_validacion": "coherencia_presupuestal",
                "resultado": "error",
                "gravedad": "critico",
                "articulo_manual": "Lineamientos DPP",
                "descripcion_regla": "Regla: No mezcla de fondos ni capítulos",
                "mensaje": "Violación de reglas presupuestales: " + "; ".join(errores),
                "detalles": {"errores": errores, "alertas": alertas},
            }
        if alertas:
            return {
                "tipo_validacion": "coherencia_presupuestal",
                "resultado": "advertencia",
                "gravedad": "medio",
                "articulo_manual": "Lineamientos DPP",
                "descripcion_regla": "Regla: No mezcla de fondos ni capítulos",
                "mensaje": "Advertencias presupuestales: " + "; ".join(alertas),
                "detalles": {"alertas": alertas},
            }
        return {
            "tipo_validacion": "coherencia_presupuestal",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Lineamientos DPP",
            "descripcion_regla": "Regla: No mezcla de fondos ni capítulos",
            "mensaje": "Consistencia presupuestal verificada: un solo fondo y capítulo.",
            "detalles": {
                "fuente": depp.fuente_financiamiento,
                "fuente_nombre": depp.fuente_nombre,
                "capitulo": depp.capitulo,
                "partida": depp.partida,
            },
        }

    def _validar_tipo_depp(self, depp: DEPP) -> dict:
        """
        Validaciones específicas según el tipo del DEPP:

        DEPP DE PAGO:
          - Debe tener beneficiario con nombre completo
          - Debe tener cuenta ABONO (CLABE/cuenta bancaria destino)
          - Clave de acreedor SAP recomendada

        DEPP NO PAGO:
          - Debe indicar el vale/provisional que regulariza
          - Las notas deben mencionar el motivo de regularización
          - No requiere cuenta abono (ya se realizó el egreso)
          - Común para ADEFAS (gastos de ejercicios anteriores)
        """
        alertas = []
        errores = []
        tipo = (depp.tipo_depp or "").upper()

        if tipo == "PAGO":
            # Verificar cuenta abono
            if not depp.cuenta_abono:
                alertas.append(
                    "DEPP DE PAGO sin cuenta ABONO registrada. "
                    "La cuenta bancaria destino es necesaria para el pago."
                )
            # Verificar beneficiario
            if not depp.beneficiario:
                errores.append("DEPP DE PAGO requiere beneficiario identificado.")
            # Verificar clave acreedor
            if not depp.clave_acreedor:
                alertas.append(
                    "Sin clave de acreedor SAP. Verifica que el proveedor "
                    "esté dado de alta en el catálogo de acreedores."
                )

        elif tipo == "NO_PAGO":
            # Debe referenciar un vale o provisional
            tiene_vale = bool(depp.provisional_vale)
            tiene_referencia_notas = False
            if depp.notas_aclaraciones:
                notas_upper = depp.notas_aclaraciones.upper()
                tiene_referencia_notas = any(
                    kw in notas_upper
                    for kw in ["VALE", "PROVISIONAL", "REGULARIZ", "ADEFAS",
                               "COMPROBACIÓN", "COMPROBACION", "RELACIÓN", "RELACION"]
                )
            if not tiene_vale and not tiene_referencia_notas:
                errores.append(
                    "DEPP NO PAGO debe indicar el vale/provisional que regulariza "
                    "o incluir notas que justifiquen la regularización presupuestal."
                )
            elif tiene_vale:
                alertas.append(
                    f"DEPP NO PAGO regulariza vale/provisional: {depp.provisional_vale}. "
                    "Verifica que la comprobación original esté adjunta."
                )

        # Si no hay tipo definido, solo advertir
        if not tipo:
            alertas.append(
                "Tipo de DEPP no identificado (PAGO/NO_PAGO). "
                "Verifica en el encabezado del documento."
            )

        if errores:
            return {
                "tipo_validacion": "tipo_depp",
                "resultado": "error",
                "gravedad": "alto",
                "articulo_manual": "Art. 20 RISFA",
                "descripcion_regla": f"Requisitos DEPP {tipo or 'tipo no identificado'}",
                "mensaje": "; ".join(errores),
                "detalles": {"tipo_depp": tipo, "errores": errores, "alertas": alertas},
            }
        if alertas:
            return {
                "tipo_validacion": "tipo_depp",
                "resultado": "advertencia",
                "gravedad": "medio",
                "articulo_manual": "Art. 20 RISFA",
                "descripcion_regla": f"Requisitos DEPP {tipo or 'tipo no identificado'}",
                "mensaje": "; ".join(alertas),
                "detalles": {"tipo_depp": tipo, "alertas": alertas},
            }
        return {
            "tipo_validacion": "tipo_depp",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 20 RISFA",
            "descripcion_regla": f"Requisitos DEPP {tipo}",
            "mensaje": f"DEPP {tipo} cumple los requisitos del tipo.",
            "detalles": {"tipo_depp": tipo},
        }

    def _validar_coherencia(self, depp: DEPP) -> dict:
        """Valida coherencia entre capítulo presupuestal y clasificación."""
        advertencias = []

        # Validar capítulo vs clasificación
        if depp.clasificador_tipo and depp.capitulo:
            valido, msg = clasificacion_service.validar_capitulo(
                depp.clasificador_tipo, depp.capitulo
            )
            if not valido:
                advertencias.append(msg)

        # Capítulo 1000 (Servicios Personales) no debería tener CFDI de proveedor
        if depp.capitulo == 1000:
            tipos = [d.tipo for d in depp.documentos]
            if "CFDI" in tipos and "CTT" not in tipos:
                advertencias.append(
                    "Capítulo 1000 (Servicios Personales) con CFDI externo es inusual. "
                    "Verifica que corresponda a un proveedor de servicios de personal."
                )

        # Monto mayor a $500,000 → advertencia (puede requerir licitación)
        if depp.monto_total and depp.monto_total > Decimal("500000"):
            advertencias.append(
                f"Monto ${depp.monto_total:,.2f} supera $500,000. "
                "Verifica que cuente con proceso de licitación si aplica."
            )

        if advertencias:
            return {
                "tipo_validacion": "coherencia",
                "resultado": "advertencia",
                "gravedad": "medio",
                "articulo_manual": "Art. 40",
                "descripcion_regla": "Coherencia de datos presupuestales",
                "mensaje": "Se detectaron advertencias de coherencia: "
                           + "; ".join(advertencias),
                "detalles": {"advertencias": advertencias},
            }

        return {
            "tipo_validacion": "coherencia",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 40",
            "descripcion_regla": "Coherencia de datos presupuestales",
            "mensaje": "Datos del DEPP son coherentes.",
            "detalles": {},
        }

    def _validar_clasificacion(self, depp: DEPP) -> dict:
        """Determina o confirma la clasificación del DEPP."""
        tipos = [doc.tipo for doc in depp.documentos]
        clasificacion_detectada, razon = clasificacion_service.determinar_clasificacion(
            tipos, depp.capitulo
        )

        if not clasificacion_detectada:
            return {
                "tipo_validacion": "clasificacion",
                "resultado": "advertencia",
                "gravedad": "alto",
                "articulo_manual": "Art. 39",
                "descripcion_regla": "Clasificación normativa del DEPP",
                "mensaje": f"No se pudo determinar clasificación automáticamente. {razon}",
                "detalles": {"documentos": tipos},
            }

        # Si ya tenía clasificación, verificar que coincida
        if depp.clasificador_tipo and depp.clasificador_tipo != clasificacion_detectada:
            return {
                "tipo_validacion": "clasificacion",
                "resultado": "advertencia",
                "gravedad": "medio",
                "articulo_manual": "Art. 39",
                "descripcion_regla": "Clasificación normativa del DEPP",
                "mensaje": (
                    f"La clasificación capturada ({depp.clasificador_tipo}) no coincide "
                    f"con la detectada automáticamente ({clasificacion_detectada}). "
                    f"Razón detección: {razon}"
                ),
                "detalles": {
                    "clasificacion_capturada": depp.clasificador_tipo,
                    "clasificacion_detectada": clasificacion_detectada,
                },
            }

        return {
            "tipo_validacion": "clasificacion",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 39",
            "descripcion_regla": "Clasificación normativa del DEPP",
            "mensaje": f"Clasificación {clasificacion_detectada} confirmada. {razon}",
            "detalles": {
                "clasificacion": clasificacion_detectada,
                "descripcion": clasificacion_service.get_descripcion_clasificacion(
                    clasificacion_detectada
                ),
            },
        }

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _puede_aprobar(self, validaciones: List[ValidacionDEPP]) -> bool:
        """El DEPP puede aprobarse si no hay ningún resultado de tipo 'error'."""
        for v in validaciones:
            if v.resultado == "error":
                return False
        return True

    async def _guardar(self, depp_id: str, data: dict) -> ValidacionDEPP:
        """Persiste un resultado de validación en la base de datos."""
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
            ejecutada_por="sistema",
        )
        self.db.add(obj)
        await self.db.flush()
        return obj


def get_validation_service(db: AsyncSession) -> ValidationService:
    return ValidationService(db)
