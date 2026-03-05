"""
Servicio de clasificación de DEPPs.

Determina la clasificación normativa (I.1, II.1, II.2, II.3, II.4)
a partir de los documentos adjuntos, el capítulo presupuestal
y el tipo de UPP.

Referencia: Manual de Normas y Lineamientos para el Ejercicio
y Control del Presupuesto de Egresos — Gobierno de Michoacán.
"""
from typing import List, Optional, Dict, Tuple


# ── Definición de clasificaciones ──────────────────────────────────────────────

CLASIFICACIONES: Dict[str, dict] = {
    "I.1": {
        "descripcion": "Adquisición de bienes/servicios CON contrato",
        "documentos_requeridos": ["DEPP", "CFDI", "CTT", "MCL"],
        "documentos_opcionales": ["PCH"],
        "capitulos_aplicables": [2000, 3000, 5000, 6000],
        "requiere_contrato": True,
    },
    "II.1": {
        "descripcion": "Reasignación presupuestal (Acuerdo Único de Reasignación)",
        "documentos_requeridos": ["DEPP", "AUR"],
        "documentos_opcionales": [],
        "capitulos_aplicables": None,   # Aplica a todos
        "requiere_contrato": False,
    },
    "II.2": {
        "descripcion": "Comisión oficial (Formato Único de Comisión)",
        "documentos_requeridos": ["DEPP", "FUC"],
        "documentos_opcionales": ["PCH"],
        "capitulos_aplicables": [3000],
        "requiere_contrato": False,
    },
    "II.3": {
        "descripcion": "Solo Póliza Cheque/Transferencia (sin CFDI)",
        "documentos_requeridos": ["DEPP", "PCH"],
        "documentos_opcionales": [],
        "capitulos_aplicables": None,
        "requiere_contrato": False,
    },
    "II.4": {
        "descripcion": "CFDI con Manifiesto (sin contrato)",
        "documentos_requeridos": ["DEPP", "CFDI", "MCL"],
        "documentos_opcionales": ["PCH"],
        "capitulos_aplicables": [2000, 3000, 5000],
        "requiere_contrato": False,
    },
}

# Tipos de documentos válidos reconocidos por el sistema
TIPOS_DOCUMENTO_VALIDOS = {"DEPP", "CFDI", "MCL", "CTT", "PCH", "AUR", "FUC", "OTR"}

# Tipos que representan documentos de soporte (NO clasificar como DEPP)
TIPOS_SOPORTE = {"OTR"}


class ClasificacionService:
    """Determina y valida la clasificación normativa de un DEPP."""

    def determinar_clasificacion(
        self,
        tipos_documentos: List[str],
        capitulo: Optional[int] = None,
        upp_tipo: Optional[str] = None,
    ) -> Tuple[Optional[str], str]:
        """
        Determina la clasificación del DEPP según documentos adjuntos.

        Args:
            tipos_documentos: Lista de tipos de documentos presentes
                              (ej: ["DEPP", "CFDI", "MCL", "CTT"])
            capitulo:         Capítulo presupuestal (1000, 2000, 3000...)
            upp_tipo:         Tipo de UPP (centralizada, paraestatal, etc.)

        Returns:
            Tuple (clasificacion: str | None, razon: str)
            - clasificacion: "I.1", "II.1"... o None si no se puede determinar
            - razon: explicación de por qué se eligió esa clasificación
        """
        tipos = set(tipos_documentos)

        # Lógica de clasificación por prioridad

        # II.1 — AUR presente → reasignación
        if "AUR" in tipos:
            return "II.1", "Acuerdo Único de Reasignación (AUR) presente."

        # II.2 — FUC presente → comisión oficial
        if "FUC" in tipos:
            return "II.2", "Formato Único de Comisión (FUC) presente."

        # I.1 — CFDI + Contrato + MCL
        if "CFDI" in tipos and "CTT" in tipos and "MCL" in tipos:
            return "I.1", "CFDI + Contrato (CTT) + Manifiesto de Cumplimiento Legal (MCL) presentes."

        # II.4 — CFDI + MCL (sin contrato)
        if "CFDI" in tipos and "MCL" in tipos and "CTT" not in tipos:
            return "II.4", "CFDI + Manifiesto (MCL) sin contrato."

        # II.3 — Solo Póliza Cheque (sin CFDI)
        if "PCH" in tipos and "CFDI" not in tipos and "AUR" not in tipos:
            return "II.3", "Solo Póliza Cheque/Transferencia sin CFDI."

        return (
            None,
            "No se pudo determinar la clasificación. Verifica los documentos adjuntos.",
        )

    def validar_documentos_requeridos(
        self,
        clasificacion: str,
        tipos_presentes: List[str],
    ) -> List[str]:
        """
        Retorna lista de documentos FALTANTES según la clasificación.

        Args:
            clasificacion:   Código de clasificación (ej: "I.1")
            tipos_presentes: Documentos actualmente adjuntos

        Returns:
            Lista de tipos de documentos que faltan (vacía = completo)
        """
        if clasificacion not in CLASIFICACIONES:
            return [f"Clasificación '{clasificacion}' no reconocida."]

        requeridos = set(CLASIFICACIONES[clasificacion]["documentos_requeridos"])
        presentes = set(tipos_presentes)
        faltantes = requeridos - presentes
        return sorted(list(faltantes))

    def validar_capitulo(
        self, clasificacion: str, capitulo: Optional[int]
    ) -> Tuple[bool, str]:
        """
        Verifica si el capítulo presupuestal es válido para la clasificación.

        Returns:
            (es_valido: bool, mensaje: str)
        """
        if clasificacion not in CLASIFICACIONES:
            return False, f"Clasificación '{clasificacion}' no reconocida."

        capitulos_permitidos = CLASIFICACIONES[clasificacion]["capitulos_aplicables"]

        if capitulos_permitidos is None:
            return True, "Aplica a todos los capítulos."

        if capitulo is None:
            return True, "Capítulo no especificado, no se puede validar."

        if capitulo in capitulos_permitidos:
            return True, f"Capítulo {capitulo} válido para clasificación {clasificacion}."

        caps_str = ", ".join(str(c) for c in capitulos_permitidos)
        return (
            False,
            f"Capítulo {capitulo} no válido para clasificación {clasificacion}. "
            f"Capítulos permitidos: {caps_str}.",
        )

    def clasificar_tipo_documento(self, nombre_archivo: str, mime_type: str) -> str:
        """
        Intenta clasificar el tipo de documento por su nombre y MIME type.
        Retorna el tipo detectado ("CFDI", "MCL", etc.) o "OTR".

        Esta clasificación se refina con OCR/IA en Fase 3.
        """
        nombre = nombre_archivo.lower()

        # CFDI — XML del SAT
        if mime_type == "text/xml" or nombre.endswith(".xml"):
            return "CFDI"

        if "cfdi" in nombre:
            return "CFDI"
        if "contrat" in nombre or "convenio" in nombre:
            return "CTT"
        if "manifiesto" in nombre or "mcl" in nombre:
            return "MCL"
        if "poliza" in nombre or "pch" in nombre or "cheque" in nombre:
            return "PCH"
        if "acuerdo" in nombre or "aur" in nombre or "reasignacion" in nombre:
            return "AUR"
        if "comision" in nombre or "fuc" in nombre:
            return "FUC"
        if "depp" in nombre or "solicitud" in nombre:
            return "DEPP"

        return "OTR"

    def get_descripcion_clasificacion(self, clasificacion: str) -> str:
        """Retorna descripción legible de la clasificación."""
        data = CLASIFICACIONES.get(clasificacion)
        if not data:
            return f"Clasificación desconocida: {clasificacion}"
        return data["descripcion"]

    def get_documentos_requeridos(self, clasificacion: str) -> List[str]:
        """Retorna lista de documentos requeridos para una clasificación."""
        data = CLASIFICACIONES.get(clasificacion)
        if not data:
            return []
        return data["documentos_requeridos"]


# Instancia singleton
clasificacion_service = ClasificacionService()
