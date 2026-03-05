"""
Endpoint para la base de conocimiento normativa de PIGOP.
Sirve:
  - Listado de documentos normativos (con URL de descarga)
  - Checklist de revisión por tipo de trámite
  - Seed automático en primer arranque
"""
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.models.normativa import Normativa, ChecklistItem
from app.models.user import Usuario

router = APIRouter()

UPLOADS_ROOT = Path(__file__).parent.parent.parent.parent.parent / "uploads"


# ─── Schemas de respuesta ─────────────────────────────────────────────────────

class NormativaOut(BaseModel):
    id: str
    clave: str
    titulo: str
    descripcion: Optional[str]
    tipo: str
    filename: Optional[str]
    tamano_bytes: Optional[int]
    aplica_tramite: Optional[list]
    referencias_clave: Optional[list]
    orden: int
    url_descarga: Optional[str] = None

    class Config:
        from_attributes = True


class ChecklistItemOut(BaseModel):
    id: str
    tipo_tramite: str
    seccion: Optional[str]
    pregunta: str
    detalle: Optional[str]
    is_header: bool
    is_subitem: bool
    tipo_verificacion: str
    normativa_clave: Optional[str]
    articulo_referencia: Optional[str]
    orden: int

    class Config:
        from_attributes = True


class ChecklistResponse(BaseModel):
    tipo_tramite: str
    titulo: str
    total_items: int
    secciones: List[dict]


# ─── Datos semilla ────────────────────────────────────────────────────────────

NORMATIVAS_SEED = [
    {
        "clave": "MANUAL_NORMAS_LINEAMIENTOS",
        "titulo": "Manual de Normas y Lineamientos para el Ejercicio y Control del Presupuesto de Egresos del Gobierno del Estado de Michoacán de Ocampo",
        "descripcion": "Norma el ejercicio, control, seguimiento y evaluación del presupuesto de egresos. Rige los documentos DEPP, CFDI, MCL y los demás comprobantes.",
        "tipo": "manual",
        "filename": "normativas/MANUAL_NORMAS_LINEAMIENTOS_PRESUPUESTO.pdf",
        "aplica_tramite": ["fondo_revolvente", "beneficiarios_directos", "viaticos", "reasignacion_paraestales"],
        "referencias_clave": [
            {"art": "Art. 39", "desc": "Requisitos de CFDI y comprobantes fiscales"},
            {"art": "Art. 46", "desc": "Servicios básicos permitidos en Fondo Revolvente"},
            {"art": "Anexo 7", "desc": "Pasajes locales y traslados"},
        ],
        "orden": 1,
    },
    {
        "clave": "MANUAL_VIATICOS",
        "titulo": "Manual de Viáticos del Gobierno del Estado de Michoacán",
        "descripcion": "Regula las comisiones oficiales, viáticos y gastos de traslado del personal gubernamental.",
        "tipo": "manual",
        "filename": "normativas/MANUAL_VIATICOS.pdf",
        "aplica_tramite": ["viaticos"],
        "referencias_clave": [
            {"art": "Cap. III", "desc": "Formato único de comisión oficial (FUC)"},
            {"art": "Cap. IV", "desc": "Montos y conceptos autorizados"},
        ],
        "orden": 2,
    },
    {
        "clave": "BASES_LINEAMIENTOS_ADQUISICIONES",
        "titulo": "Bases y Lineamientos en Materia de Adquisiciones",
        "descripcion": "Establece los procedimientos y bases para la adquisición de bienes y contratación de servicios del Gobierno del Estado.",
        "tipo": "lineamiento",
        "filename": "normativas/BASES_LINEAMIENTOS_ADQUISICIONES.pdf",
        "aplica_tramite": ["beneficiarios_directos", "fondo_revolvente", "reasignacion_paraestales"],
        "referencias_clave": [
            {"art": "Art. 15", "desc": "Adjudicación directa de menor cuantía (hasta $429,299.99)"},
            {"art": "Art. 18", "desc": "Invitación restringida ($430,000 a $1,249,999.99)"},
            {"art": "Art. 22", "desc": "Licitación pública (desde $1,250,000)"},
        ],
        "orden": 3,
    },
    {
        "clave": "LEY_ADQUISICIONES",
        "titulo": "Ley de Adquisiciones, Arrendamientos y Prestación de Servicios del Estado de Michoacán",
        "descripcion": "Ley que regula las adquisiciones de bienes muebles, arrendamientos y contratación de servicios con recursos públicos estatales.",
        "tipo": "ley",
        "filename": "normativas/LEY_ADQUISICIONES_ARRENDAMIENTOS.pdf",
        "aplica_tramite": ["beneficiarios_directos", "reasignacion_paraestales"],
        "referencias_clave": [
            {"art": "Art. 41", "desc": "Contratos de adquisición y servicios"},
            {"art": "Art. 55", "desc": "Requisitos de contratos de servicios profesionales"},
        ],
        "orden": 4,
    },
    {
        "clave": "REGLAMENTO_LEY_ADQUISICIONES",
        "titulo": "Reglamento de la Ley de Adquisiciones, Arrendamientos y Prestación de Servicios",
        "descripcion": "Reglamento que detalla los procedimientos establecidos en la Ley de Adquisiciones del Estado.",
        "tipo": "reglamento",
        "filename": "normativas/REGLAMENTO_LEY_ADQUISICIONES.pdf",
        "aplica_tramite": ["beneficiarios_directos", "reasignacion_paraestales"],
        "referencias_clave": [],
        "orden": 5,
    },
    {
        "clave": "LEY_DISCIPLINA_FINANCIERA",
        "titulo": "Ley de Disciplina Financiera de las Entidades Federativas y los Municipios",
        "descripcion": "Ley federal que establece criterios de responsabilidad hacendaria y disciplina financiera para estados y municipios.",
        "tipo": "ley",
        "filename": "normativas/LEY_DISCIPLINA_FINANCIERA.pdf",
        "aplica_tramite": ["fondo_revolvente", "beneficiarios_directos", "viaticos", "reasignacion_paraestales"],
        "referencias_clave": [],
        "orden": 6,
    },
    {
        "clave": "CLASIFICADOR_OBJETO_GASTO",
        "titulo": "Clasificador por Objeto del Gasto del Gobierno del Estado de Michoacán",
        "descripcion": "Define los capítulos, conceptos y partidas presupuestales para la clasificación de los egresos gubernamentales.",
        "tipo": "clasificador",
        "filename": "normativas/CLASIFICADOR_OBJETO_GASTO.pdf",
        "aplica_tramite": ["fondo_revolvente", "beneficiarios_directos", "viaticos", "reasignacion_paraestales"],
        "referencias_clave": [
            {"art": "Cap. 1000", "desc": "Servicios personales"},
            {"art": "Cap. 2000", "desc": "Materiales y suministros"},
            {"art": "Cap. 3000", "desc": "Servicios generales"},
            {"art": "Cap. 4000", "desc": "Transferencias, asignaciones, subsidios y otras ayudas"},
        ],
        "orden": 7,
    },
    {
        "clave": "ACUERDO_AUSTERIDAD",
        "titulo": "Acuerdo de Austeridad Republicana del Gobierno del Estado de Michoacán",
        "descripcion": "Establece medidas de austeridad y racionalidad en el ejercicio del gasto público estatal.",
        "tipo": "acuerdo",
        "filename": "normativas/ACUERDO_AUSTERIDAD.pdf",
        "aplica_tramite": ["fondo_revolvente", "beneficiarios_directos", "viaticos", "reasignacion_paraestales"],
        "referencias_clave": [],
        "orden": 8,
    },
]

# Checklist extraído del Excel — organizado por tipo de trámite
CHECKLIST_SEED = {
    "fondo_revolvente": [
        # === SECCIÓN: Requisitos de Montos y Conceptos ===
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "REQUISITOS DE MONTOS Y CONCEPTOS", "is_header": True, "is_subitem": False, "tipo_verificacion": "presupuestal", "orden": 10},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Beneficiario del DEPP: ¿Se verificó que el DEPP esté a nombre de la Unidad Ejecutora del Gasto (UPP)?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 20},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Límite de Gasto: ¿Cada factura o concepto es igual o menor a $25,000.00?", "is_header": False, "is_subitem": False, "tipo_verificacion": "presupuestal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 30},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Gastos Permitidos: ¿El gasto es para pagos inmediatos de poca cuantía o urgentes de operación?", "is_header": False, "is_subitem": False, "tipo_verificacion": "presupuestal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 40},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Exclusiones: Confirma que NO se incluyeron pagos de servicios personales (nómina), anticipos a contratistas, subsidios o donativos, inversión pública o resoluciones judiciales.", "is_header": False, "is_subitem": False, "tipo_verificacion": "presupuestal", "detalle": "◦ Servicios personales (nómina)\n◦ Anticipos a contratistas\n◦ Subsidios o donativos\n◦ Inversión pública o resoluciones judiciales", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 50},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Servicios Básicos: Si pagaste servicios básicos (luz, agua, teléfono, rentas, vigilancia), ¿corresponden exactamente a las partidas autorizadas?", "is_header": False, "is_subitem": False, "tipo_verificacion": "presupuestal", "detalle": "◦ 31101 Servicio de energía eléctrica\n◦ 31301 Servicio de agua\n◦ 31401 Servicio telefónico convencional\n◦ 31501 Servicio de telefonía celular\n◦ 31701 Servicio de conducción de señales analógicas y digitales\n◦ 32201 Arrendamiento de edificios y locales\n◦ 32301 Arrendamiento de equipo de bienes informáticos\n◦ 33401 Servicio de capacitación para funcionarios públicos\n◦ 33801 Servicio de vigilancia\n◦ 34501 Seguros de bienes patrimoniales\n◦ 36101 Difusión de mensajes sobre programas y actividades gubernamentales\n◦ 39202 Valores de tránsito placas, tarjetas y calcomanías", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Art. 46", "orden": 60},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Leyendas Obligatorias: ¿Cada documento de la reposición incluye la leyenda 'FONDO REVOLVENTE' y especifica la fuente de financiamiento?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 70},
        {"seccion": "Requisitos de Montos y Conceptos", "pregunta": "Vigencia del Trámite: ¿Se está presentando en un plazo no mayor a 60 días hábiles desde que se realizó el gasto?", "is_header": False, "is_subitem": False, "tipo_verificacion": "plazo", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 80},
        # === SECCIÓN: Documentación Comprobatoria ===
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "DOCUMENTACIÓN COMPROBATORIA", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 100},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "CFDI Válidos: ¿Cuentas con los archivos XML y PDF de cada factura?", "is_header": False, "is_subitem": False, "tipo_verificacion": "fiscal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Art. 39", "orden": 110},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Validación SAT: ¿Los comprobantes cumplen con los artículos 29 y 29-A del Código Fiscal de la Federación?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "articulo_referencia": "CFF Art. 29 y 29-A", "orden": 120},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "No Duplicidad: ¿Se verificó que el CFDI no haya sido registrado previamente en otro trámite?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 130},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Prueba de Pago: ¿Se anexó la póliza de cheque o el comprobante de la transferencia bancaria con que se pagó originalmente el gasto?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 140},
        # === SECCIÓN: Documentos Generales ===
        {"seccion": "2. Documentos Generales", "pregunta": "DOCUMENTOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 200},
        {"seccion": "2. Documentos Generales", "pregunta": "Pasajes Locales: Si hay traslados locales, ¿la comprobación se ajusta a lo establecido en el Anexo 7?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Anexo 7", "orden": 210},
        # === SECCIÓN: Documentos Justificativos ===
        {"seccion": "3. Documentos Justificativos", "pregunta": "DOCUMENTOS JUSTIFICATIVOS", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 300},
        {"seccion": "3. Documentos Justificativos", "pregunta": "Manifiesto: ¿Se requisitó en el sistema el Manifiesto de Cumplimiento Legal Digital (MCL)?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 310},
    ],

    "beneficiarios_directos": [
        {"seccion": "Requisitos Generales", "pregunta": "REQUISITOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 10},
        {"seccion": "Requisitos Generales", "pregunta": "Beneficiario del DEPP: ¿El DEPP está realizado invariablemente a favor del beneficiario final del recurso?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 20},
        {"seccion": "Requisitos Generales", "pregunta": "Leyendas Obligatorias: ¿La documentación comprobatoria incluye la fuente de financiamiento?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 30},
        {"seccion": "Requisitos Generales", "pregunta": "Vigencia del Trámite: ¿Es un gasto realizado en ejercicio fiscal corriente?", "is_header": False, "is_subitem": False, "tipo_verificacion": "plazo", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 40},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "DOCUMENTACIÓN COMPROBATORIA", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 100},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "CFDI Válidos: ¿Cuentas con los archivos XML y PDF de cada factura?", "is_header": False, "is_subitem": False, "tipo_verificacion": "fiscal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Art. 39", "orden": 110},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Validación SAT: ¿Los comprobantes cumplen con los artículos 29 y 29-A del Código Fiscal de la Federación?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "articulo_referencia": "CFF Art. 29 y 29-A", "orden": 120},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "No Duplicidad: ¿Se verificó que el CFDI no haya sido registrado previamente en otro trámite?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 130},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "RFC Correcto: ¿El CFDI está emitido a nombre del Gobierno del Estado de Michoacán (RFC: GEM850101C99) con el domicilio y régimen fiscal correcto?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 140},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "No Fraccionamiento: ¿Se verificó que no se esté fraccionando el importe de una operación en varios CFDI para evitar trámites ante el CADPE?", "is_header": False, "is_subitem": True, "tipo_verificacion": "presupuestal", "normativa_clave": "BASES_LINEAMIENTOS_ADQUISICIONES", "orden": 150},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Servicios Profesionales y Arrendamientos: ¿Los CFDI desglosan el ISR y cuentan con contrato suscrito?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "normativa_clave": "LEY_ADQUISICIONES", "orden": 160},
        {"seccion": "2. Documentos Generales", "pregunta": "DOCUMENTOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 200},
        {"seccion": "2. Documentos Generales", "pregunta": "Documento Provisional: Si el documento DEPP no generó pago, ¿el provisional coincide con el DEPP de acuerdo a la partida, fondo y beneficiario?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 210},
        {"seccion": "2. Documentos Generales", "pregunta": "Sentencia o laudo: Si el documento DEPP corresponde a una sentencia o laudo, ¿está emitido a nombre del beneficiario, cuenta con firmas autógrafas y las fechas coinciden con el DEPP?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 220},
        {"seccion": "3. Documentos Justificativos", "pregunta": "DOCUMENTOS JUSTIFICATIVOS", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 300},
        {"seccion": "3. Documentos Justificativos", "pregunta": "Manifiesto: ¿Se requisitó en el sistema el Manifiesto de Cumplimiento Legal Digital (MCL)?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 310},
        {
            "seccion": "3. Documentos Justificativos",
            "pregunta": "Contrato: Si el gasto requiere un contrato de adquisición de bienes o servicios, ¿está emitido a nombre del beneficiario, cuenta con firmas autógrafas y las fechas coinciden con el DEPP?",
            "is_header": False, "is_subitem": False, "tipo_verificacion": "documental",
            "detalle": "Límites para contratación:\n• $65,000 a $429,299.99 → Adjudicación Directa de Menor Cuantía\n• Desde $430,000 → Adjudicación Directa Acuerdo Expreso del Comité\n• $430,000 a $1,249,999.99 → Invitación Restringida\n• A partir de $1,250,000 → Licitación Pública",
            "normativa_clave": "BASES_LINEAMIENTOS_ADQUISICIONES", "orden": 320,
        },
        {"seccion": "3. Documentos Justificativos", "pregunta": "Servicios Profesionales y Arrendamientos: Si el documento DEPP corresponde a estos conceptos, ¿cuenta con el contrato correspondiente debidamente suscrito por ambas partes?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "LEY_ADQUISICIONES", "articulo_referencia": "Art. 55", "orden": 330},
    ],

    "viaticos": [
        {"seccion": "Requisitos Generales", "pregunta": "REQUISITOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 10},
        {"seccion": "Requisitos Generales", "pregunta": "Beneficiario del DEPP: ¿Se verificó que el DEPP esté a nombre de la Unidad Ejecutora del Gasto (si es con cargo a Fondo Revolvente) o, en caso contrario, a favor del beneficiario final del recurso?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_VIATICOS", "orden": 20},
        {"seccion": "Requisitos Generales", "pregunta": "Leyendas Obligatorias: ¿La documentación comprobatoria incluye la fuente de financiamiento?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 30},
        {"seccion": "Requisitos Generales", "pregunta": "Vigencia del Trámite: ¿Es un gasto realizado en ejercicio fiscal corriente?", "is_header": False, "is_subitem": False, "tipo_verificacion": "plazo", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 40},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "DOCUMENTACIÓN COMPROBATORIA", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 100},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "CFDI Válidos: ¿Cuentas con los archivos XML y PDF de cada factura?", "is_header": False, "is_subitem": False, "tipo_verificacion": "fiscal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Art. 39", "orden": 110},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Validación SAT: ¿Los comprobantes cumplen con los artículos 29 y 29-A del Código Fiscal de la Federación?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "articulo_referencia": "CFF Art. 29 y 29-A", "orden": 120},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "No Duplicidad: ¿Se verificó que el CFDI no haya sido registrado previamente en otro trámite?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 130},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "RFC Correcto: ¿El CFDI está emitido a nombre del Gobierno del Estado de Michoacán (RFC: GEM850101C99) con el domicilio y régimen fiscal correcto?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 140},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Prueba de Pago: ¿Se anexó la póliza de cheque o el comprobante de la transferencia bancaria con que se pagó originalmente el gasto?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_VIATICOS", "orden": 150},
        {"seccion": "2. Documentos Generales", "pregunta": "DOCUMENTOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 200},
        {"seccion": "2. Documentos Generales", "pregunta": "Relación de comisionados (Listado tramitado en el DEPP): ¿La relación de comisionados fue requisitada cumpliendo con los criterios especiales establecidos?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_VIATICOS", "orden": 210},
        {"seccion": "3. Documentos Justificativos", "pregunta": "DOCUMENTOS JUSTIFICATIVOS", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 300},
        {"seccion": "3. Documentos Justificativos", "pregunta": "Manifiesto: ¿Se requisitó en el sistema el Manifiesto de Cumplimiento Legal Digital (MCL)?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 310},
        {"seccion": "3. Documentos Justificativos", "pregunta": "Formato único de comisión oficial (FUC): ¿Se requisitó en el sistema el Formato único de comisión oficial?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_VIATICOS", "articulo_referencia": "Cap. III", "orden": 320},
    ],

    "reasignacion_paraestales": [
        {"seccion": "Requisitos Generales", "pregunta": "REQUISITOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 10},
        {"seccion": "Requisitos Generales", "pregunta": "Beneficiario del DEPP: ¿Se verificó que el DEPP esté a nombre de la Unidad Ejecutora del Gasto (UPP)?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 20},
        {"seccion": "Requisitos Generales", "pregunta": "Leyendas Obligatorias: ¿La documentación comprobatoria incluye la fuente de financiamiento?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 30},
        {"seccion": "Requisitos Generales", "pregunta": "Vigencia del Trámite: ¿La comprobación de reasignación de recursos corresponde al ejercicio fiscal corriente?", "is_header": False, "is_subitem": False, "tipo_verificacion": "plazo", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 40},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "DOCUMENTACIÓN COMPROBATORIA", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 100},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "CFDI Válidos: ¿Cuentas con los archivos XML y PDF de cada factura?", "is_header": False, "is_subitem": False, "tipo_verificacion": "fiscal", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "articulo_referencia": "Art. 39", "orden": 110},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "Validación SAT: ¿Los comprobantes cumplen con los artículos 29 y 29-A del Código Fiscal de la Federación?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "articulo_referencia": "CFF Art. 29 y 29-A", "orden": 120},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "No Duplicidad: ¿Se verificó que el CFDI no haya sido registrado previamente en otro trámite?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 130},
        {"seccion": "1. Documentación Comprobatoria", "pregunta": "RFC Correcto: ¿El CFDI está emitido a nombre del Gobierno del Estado de Michoacán (RFC: GEM850101C99) con el domicilio y régimen fiscal correcto?", "is_header": False, "is_subitem": True, "tipo_verificacion": "fiscal", "orden": 140},
        {"seccion": "2. Documentos Generales", "pregunta": "DOCUMENTOS GENERALES", "is_header": True, "is_subitem": False, "tipo_verificacion": "documental", "orden": 200},
        {"seccion": "2. Documentos Generales", "pregunta": "Documento Provisional: Si el documento DEPP no generó pago, ¿el provisional coincide con el DEPP de acuerdo a la partida, fondo y beneficiario?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 210},
        {"seccion": "2. Documentos Generales", "pregunta": "Sentencia o laudo: Si el documento DEPP corresponde a una sentencia o laudo, ¿está emitido a nombre del beneficiario, cuenta con firmas autógrafas y las fechas coinciden con el DEPP?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 220},
        {"seccion": "2. Documentos Generales", "pregunta": "Acuerdo Único de Reasignación de Recursos (AUR): ¿Se requisitó en el sistema el Acuerdo Único de Reasignación de Recursos?", "is_header": False, "is_subitem": False, "tipo_verificacion": "documental", "normativa_clave": "MANUAL_NORMAS_LINEAMIENTOS", "orden": 230},
    ],
}

TRAMITE_LABELS = {
    "fondo_revolvente": "Fondo Revolvente",
    "beneficiarios_directos": "Beneficiarios Directos",
    "viaticos": "Viáticos",
    "reasignacion_paraestales": "Reasignación Paraestales",
}

# ─── Seed helper ──────────────────────────────────────────────────────────────

async def _seed_normativas(db: AsyncSession) -> None:
    """Inserta normativas y checklist si la tabla está vacía."""
    count = await db.scalar(select(func.count()).select_from(Normativa))
    if count and count > 0:
        return  # Ya sembrado

    # Tamaños de archivos
    file_sizes = {}
    for n in NORMATIVAS_SEED:
        if n.get("filename"):
            path = UPLOADS_ROOT / n["filename"]
            if path.exists():
                file_sizes[n["clave"]] = os.path.getsize(path)

    for data in NORMATIVAS_SEED:
        obj = Normativa(
            id=str(__import__("uuid").uuid4()),
            clave=data["clave"],
            titulo=data["titulo"],
            descripcion=data.get("descripcion"),
            tipo=data["tipo"],
            filename=data.get("filename"),
            tamano_bytes=file_sizes.get(data["clave"]),
            aplica_tramite=data.get("aplica_tramite"),
            referencias_clave=data.get("referencias_clave", []),
            orden=data.get("orden", 100),
            activa=True,
        )
        db.add(obj)

    # Checklist items
    count_cl = await db.scalar(select(func.count()).select_from(ChecklistItem))
    if not count_cl:
        for tipo_tramite, items in CHECKLIST_SEED.items():
            for item in items:
                obj = ChecklistItem(
                    id=str(__import__("uuid").uuid4()),
                    tipo_tramite=tipo_tramite,
                    seccion=item.get("seccion"),
                    pregunta=item["pregunta"],
                    detalle=item.get("detalle"),
                    is_header=item.get("is_header", False),
                    is_subitem=item.get("is_subitem", False),
                    tipo_verificacion=item.get("tipo_verificacion", "documental"),
                    normativa_clave=item.get("normativa_clave"),
                    articulo_referencia=item.get("articulo_referencia"),
                    aplica_clasificacion=item.get("aplica_clasificacion"),
                    orden=item.get("orden", 100),
                    activa=True,
                )
                db.add(obj)

    await db.commit()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[NormativaOut], summary="Listar normativas")
async def listar_normativas(
    tipo: Optional[str] = Query(None, description="Filtrar por tipo: ley|manual|lineamiento|reglamento|acuerdo|clasificador"),
    tramite: Optional[str] = Query(None, description="Filtrar por tipo de trámite"),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Lista todos los documentos normativos con metadatos y URL de descarga."""
    await _seed_normativas(db)

    stmt = select(Normativa).where(Normativa.activa.is_(True)).order_by(Normativa.orden)
    if tipo:
        stmt = stmt.where(Normativa.tipo == tipo)

    result = await db.execute(stmt)
    normativas = result.scalars().all()

    # Filtrar por tramite en Python (JSON array filter)
    if tramite:
        normativas = [
            n for n in normativas
            if n.aplica_tramite is None or tramite in (n.aplica_tramite or [])
        ]

    out = []
    for n in normativas:
        item = NormativaOut(
            id=n.id,
            clave=n.clave,
            titulo=n.titulo,
            descripcion=n.descripcion,
            tipo=n.tipo,
            filename=n.filename,
            tamano_bytes=n.tamano_bytes,
            aplica_tramite=n.aplica_tramite,
            referencias_clave=n.referencias_clave,
            orden=n.orden,
            url_descarga=f"/api/v1/normativas/{n.clave}/pdf" if n.filename else None,
        )
        out.append(item)
    return out


@router.get("/{clave}/pdf", summary="Descargar PDF de normativa")
async def descargar_normativa_pdf(
    clave: str,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Devuelve el PDF de la normativa indicada."""
    await _seed_normativas(db)

    result = await db.execute(select(Normativa).where(Normativa.clave == clave))
    normativa = result.scalar_one_or_none()
    if not normativa:
        raise HTTPException(status_code=404, detail="Normativa no encontrada.")

    if not normativa.filename:
        raise HTTPException(status_code=404, detail="Esta normativa no tiene PDF asociado.")

    pdf_path = UPLOADS_ROOT / normativa.filename
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Archivo PDF no encontrado en el servidor.")

    filename_out = pdf_path.name
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=filename_out,
        headers={"Content-Disposition": f"inline; filename=\"{filename_out}\""},
    )


@router.get("/checklist/all", response_model=List[ChecklistItemOut], summary="Todos los ítems del checklist")
async def listar_checklist_completo(
    tipo_tramite: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Devuelve ítems del checklist, opcionalmente filtrados por tipo de trámite."""
    await _seed_normativas(db)

    stmt = select(ChecklistItem).where(ChecklistItem.activa.is_(True)).order_by(
        ChecklistItem.tipo_tramite, ChecklistItem.orden
    )
    if tipo_tramite:
        stmt = stmt.where(ChecklistItem.tipo_tramite == tipo_tramite)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/checklist/{tipo_tramite}", response_model=ChecklistResponse, summary="Checklist por tipo de trámite")
async def obtener_checklist_tramite(
    tipo_tramite: str,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """
    Devuelve el checklist completo organizado por secciones para un tipo de trámite.
    tipo_tramite: fondo_revolvente | beneficiarios_directos | viaticos | reasignacion_paraestales
    """
    await _seed_normativas(db)

    tipos_validos = list(TRAMITE_LABELS.keys())
    if tipo_tramite not in tipos_validos:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de trámite inválido. Opciones: {', '.join(tipos_validos)}"
        )

    result = await db.execute(
        select(ChecklistItem)
        .where(ChecklistItem.tipo_tramite == tipo_tramite, ChecklistItem.activa.is_(True))
        .order_by(ChecklistItem.orden)
    )
    items = result.scalars().all()

    # Agrupar por sección
    secciones: dict[str, list] = {}
    for item in items:
        if item.is_header:
            continue
        sec = item.seccion or "General"
        if sec not in secciones:
            secciones[sec] = []
        secciones[sec].append({
            "id": item.id,
            "pregunta": item.pregunta,
            "detalle": item.detalle,
            "is_subitem": item.is_subitem,
            "tipo_verificacion": item.tipo_verificacion,
            "normativa_clave": item.normativa_clave,
            "articulo_referencia": item.articulo_referencia,
        })

    return ChecklistResponse(
        tipo_tramite=tipo_tramite,
        titulo=TRAMITE_LABELS[tipo_tramite],
        total_items=len([i for i in items if not i.is_header]),
        secciones=[
            {"nombre": sec, "items": its}
            for sec, its in secciones.items()
        ],
    )
