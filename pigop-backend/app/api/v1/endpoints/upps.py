"""
Endpoint para Unidades Programáticas Presupuestales (UPPs).
Fuente oficial: Listado UPPs 2026 — Secretaría de Finanzas y Administración,
Gobierno del Estado de Michoacán de Ocampo.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.models.upp import UnidadProgramatica
from app.models.user import Usuario

router = APIRouter()

# ─── Schemas ──────────────────────────────────────────────────────────────────

class UPPOut(BaseModel):
    id: str
    codigo: str
    nombre: str
    clasificacion_admin: str
    organismo_code: Optional[str]
    sigla: Optional[str]
    ejercicio: int
    activa: bool

    class Config:
        from_attributes = True


# ─── Datos semilla — Listado UPPs 2026 ────────────────────────────────────────

UPP_SEED: list[dict] = [
    # ── PODERES ────────────────────────────────────────────────────────────────
    {"codigo": "001", "nombre": "Congreso del Estado de Michoacán de Ocampo",                                   "clasificacion_admin": "PODER",       "organismo_code": "21112"},
    {"codigo": "002", "nombre": "Poder Judicial del Estado de Michoacán",                                        "clasificacion_admin": "PODER",       "organismo_code": "21113"},

    # ── CENTRALIZADAS ──────────────────────────────────────────────────────────
    {"codigo": "003", "nombre": "Ejecutivo del Estado",                                                          "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "006", "nombre": "Secretaría de Gobierno",                                                        "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SEGOB"},
    {"codigo": "007", "nombre": "Secretaría de Finanzas y Administración",                                       "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SFA"},
    {"codigo": "008", "nombre": "Secretaría de Comunicaciones y Obras Públicas",                                 "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SCOP"},
    {"codigo": "009", "nombre": "Secretaría de Agricultura y Desarrollo Rural",                                  "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SADER"},
    {"codigo": "010", "nombre": "Secretaría de Desarrollo Económico",                                            "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SEDECO"},
    {"codigo": "011", "nombre": "Secretaría de Turismo",                                                         "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SECTUR"},
    {"codigo": "012", "nombre": "Secretaría de Educación",                                                       "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SE"},
    {"codigo": "014", "nombre": "Secretaría del Migrante",                                                       "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "016", "nombre": "Secretaría de Seguridad Pública",                                               "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SSP"},
    {"codigo": "019", "nombre": "Secretaría de Contraloría",                                                     "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SECO"},
    {"codigo": "020", "nombre": "Secretaría del Bienestar",                                                      "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "021", "nombre": "Secretaría de Cultura",                                                         "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "022", "nombre": "Inversión Municipal",                                                           "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "023", "nombre": "Participaciones y Aportaciones a Municipios",                                   "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "024", "nombre": "Erogaciones Adicionales y Provisiones",                                         "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "025", "nombre": "Deuda Pública y Obligaciones Financieras",                                      "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "032", "nombre": "Secretariado Ejecutivo del Sistema Estatal de Seguridad Pública",               "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SESESP"},
    {"codigo": "046", "nombre": "Procuraduría de Protección al Ambiente del Estado de Michoacán de Ocampo",      "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "PROAM"},
    {"codigo": "069", "nombre": "Tribunal de Conciliación y Arbitraje",                                          "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "TCA"},
    {"codigo": "071", "nombre": "Junta Local de Conciliación y Arbitraje",                                       "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "JLCA"},
    {"codigo": "095", "nombre": "Secretaría de Igualdad Sustantiva y Desarrollo de las Mujeres Michoacanas",     "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SEIMUJER"},
    {"codigo": "098", "nombre": "Secretaría Ejecutiva del Sistema Estatal de Protección Integral de Niñas, Niños y Adolescentes del Estado de Michoacán", "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SIPINNA"},
    {"codigo": "100", "nombre": "Coordinación del Sistema Penitenciario del Estado de Michoacán de Ocampo",      "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "104", "nombre": "Instituto Registral y Catastral del Estado de Michoacán de Ocampo",             "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "IRCE"},
    {"codigo": "105", "nombre": "Secretaría de Desarrollo Urbano y Movilidad",                                   "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SEDUM"},
    {"codigo": "106", "nombre": "Secretaría de Medio Ambiente",                                                  "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},
    {"codigo": "107", "nombre": "Centro Estatal para el Desarrollo Municipal",                                   "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "CEDEMUN"},
    {"codigo": "111", "nombre": "Servicio de Administración Tributaria del Estado de Michoacán de Ocampo",       "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "SATMICH"},
    {"codigo": "112", "nombre": "Instituto del Transporte del Estado de Michoacán de Ocampo",                   "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111", "sigla": "ITREMI"},
    {"codigo": "114", "nombre": "Coordinación de Comunicación",                                                  "clasificacion_admin": "CENTRALIZADA","organismo_code": "21111"},

    # ── PARAESTATALES ──────────────────────────────────────────────────────────
    {"codigo": "017", "nombre": "Servicios de Salud de Michoacán",                                               "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "SSM"},
    {"codigo": "031", "nombre": "Casa de las Artesanías de Michoacán de Ocampo",                                 "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CASART"},
    {"codigo": "033", "nombre": "Comisión Estatal de Cultura Física y Deporte",                                  "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CECUFID"},
    {"codigo": "035", "nombre": "Sistema Michoacano de Radio y Televisión",                                      "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "SMRTV"},
    {"codigo": "036", "nombre": "Centro de Convenciones de Morelia",                                             "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "037", "nombre": "Parque Zoológico Benito Juárez",                                               "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "040", "nombre": "Sistema para el Desarrollo Integral de la Familia Michoacana",                  "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "DIF Michoacán"},
    {"codigo": "045", "nombre": "Universidad Virtual del Estado de Michoacán",                                   "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UVEM"},
    {"codigo": "047", "nombre": "Telebachillerato Michoacán",                                                    "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "048", "nombre": "Instituto de Vivienda del Estado de Michoacán de Ocampo",                       "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "IVEM"},
    {"codigo": "049", "nombre": "Comisión Forestal del Estado",                                                  "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "COFOM"},
    {"codigo": "050", "nombre": "Comisión de Pesca del Estado de Michoacán",                                     "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "051", "nombre": "Colegio de Bachilleres del Estado de Michoacán",                                "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "COBEM"},
    {"codigo": "052", "nombre": "Colegio de Educación Profesional Técnica del Estado de Michoacán",             "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CONALEP Michoacán"},
    {"codigo": "053", "nombre": "Universidad Tecnológica de Morelia",                                           "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UTM"},
    {"codigo": "054", "nombre": "Colegio de Estudios Científicos y Tecnológicos del Estado de Michoacán",        "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CECyTEM"},
    {"codigo": "055", "nombre": "Instituto de Capacitación para el Trabajo del Estado de Michoacán",             "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "ICATEM"},
    {"codigo": "060", "nombre": "Universidad de la Ciénega del Estado de Michoacán de Ocampo",                  "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UCEM"},
    {"codigo": "063", "nombre": "Centro Estatal de Certificación, Acreditación y Control de Confianza",          "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CECCAM"},
    {"codigo": "068", "nombre": "Universidad Intercultural Indígena de Michoacán",                               "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UIIM"},
    {"codigo": "070", "nombre": "Comisión Estatal de Arbitraje Médico de Michoacán",                             "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "COESAMED"},
    {"codigo": "074", "nombre": "Junta de Asistencia Privada del Estado de Michoacán de Ocampo",                "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "JAP"},
    {"codigo": "078", "nombre": "Comisión Estatal para el Desarrollo de Pueblos Indígenas",                     "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CEDPI"},
    {"codigo": "080", "nombre": "Coordinación de Planeación para el Desarrollo del Estado de Michoacán de Ocampo","clasificacion_admin":"PARAESTATAL","organismo_code": "21120", "sigla": "COPLADEMUN"},
    {"codigo": "081", "nombre": "Comisión Estatal del Agua y Gestión de Cuencas",                               "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CEAGC"},
    {"codigo": "082", "nombre": "Comité de Adquisiciones del Poder Ejecutivo",                                   "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CADPE"},
    {"codigo": "083", "nombre": "Universidad Politécnica de Uruapan, Michoacán",                                 "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UPUruapan"},
    {"codigo": "084", "nombre": "Universidad Politécnica de Lázaro Cárdenas, Michoacán",                         "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UPLC"},
    {"codigo": "085", "nombre": "Instituto de Defensoría Pública del Estado de Michoacán",                       "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "IDEPEM"},
    {"codigo": "087", "nombre": "Instituto Estatal de Estudios Superiores en Seguridad y Profesionalización Policial del Estado de Michoacán", "clasificacion_admin": "PARAESTATAL","organismo_code": "21120", "sigla": "IESSPP"},
    {"codigo": "088", "nombre": "Comisión Ejecutiva Estatal de Atención a Víctimas",                             "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "CEEAV"},
    {"codigo": "089", "nombre": "Centro Estatal de Fomento Ganadero del Estado de Michoacán de Ocampo",          "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "093", "nombre": "Sistema Integral de Financiamiento para el Desarrollo de Michoacán",            "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "SIFIDE"},
    {"codigo": "094", "nombre": "Instituto de la Juventud Michoacana",                                           "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "INJUMICH"},
    {"codigo": "096", "nombre": "Instituto de Ciencia, Tecnología e Innovación del Estado de Michoacán de Ocampo","clasificacion_admin":"PARAESTATAL","organismo_code": "21120", "sigla": "ICTI"},
    {"codigo": "099", "nombre": "Consejo Estatal para Prevenir y Eliminar la Discriminación y la Violencia",     "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "COPREDV"},
    {"codigo": "101", "nombre": "Universidad Tecnológica del Oriente",                                           "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "UTOM"},
    {"codigo": "102", "nombre": "Secretaría Ejecutiva del Sistema Estatal Anticorrupción",                       "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "SEA"},
    {"codigo": "103", "nombre": "Casa del Adulto Mayor",                                                         "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "108", "nombre": "Instituto de Educación Media Superior y Superior del Estado de Michoacán",      "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120", "sigla": "IEMS"},
    {"codigo": "109", "nombre": "Centro de Conciliación Laboral del Estado de Michoacán de Ocampo",              "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},
    {"codigo": "115", "nombre": "Cuarta República Editorial de Michoacán",                                       "clasificacion_admin": "PARAESTATAL",  "organismo_code": "21120"},

    # ── AUTÓNOMAS ──────────────────────────────────────────────────────────────
    {"codigo": "038", "nombre": "Universidad Michoacana de San Nicolás de Hidalgo",                              "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "UMSNH"},
    {"codigo": "041", "nombre": "Instituto Electoral de Michoacán",                                              "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "IEM"},
    {"codigo": "042", "nombre": "Tribunal Electoral del Estado",                                                 "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "TEEM"},
    {"codigo": "044", "nombre": "Tribunal en Materia Anticorrupción y Administrativa del Estado de Michoacán de Ocampo", "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "TJAM"},
    {"codigo": "075", "nombre": "Comisión Estatal de los Derechos Humanos",                                     "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "CEDH"},
    {"codigo": "079", "nombre": "Instituto Michoacano de Transparencia, Acceso a la Información y Protección de Datos Personales", "clasificacion_admin": "AUTÓNOMA","organismo_code": "21114", "sigla": "IMTAIP"},
    {"codigo": "110", "nombre": "Consejo Económico y Social del Estado de Michoacán",                            "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "CEESM"},
    {"codigo": "A13", "nombre": "Fiscalía General del Estado de Michoacán",                                      "clasificacion_admin": "AUTÓNOMA",     "organismo_code": "21114", "sigla": "FGE"},
]


# ─── Seed helper ──────────────────────────────────────────────────────────────

async def _seed_upps(db: AsyncSession) -> None:
    """Inserta o sincroniza las UPPs contra el catálogo oficial 2026.

    En deployments existentes actualiza los nombres/siglas si cambian en el
    catálogo (p.ej. cuando SFA renombra una dependencia). No elimina
    registros — marca como inactiva cualquier UPP que desaparezca del
    catálogo oficial para que siga siendo auditable.
    """
    # Cargar las existentes en un solo query
    result = await db.execute(
        select(UnidadProgramatica).where(UnidadProgramatica.ejercicio == 2026)
    )
    existentes = {u.codigo: u for u in result.scalars().all()}

    codigos_semilla = {d["codigo"] for d in UPP_SEED}
    cambios = 0

    for data in UPP_SEED:
        u = existentes.get(data["codigo"])
        if u is None:
            db.add(UnidadProgramatica(
                id=str(uuid.uuid4()),
                codigo=data["codigo"],
                nombre=data["nombre"],
                clasificacion_admin=data["clasificacion_admin"],
                organismo_code=data.get("organismo_code"),
                sigla=data.get("sigla"),
                ejercicio=2026,
                activa=True,
            ))
            cambios += 1
        else:
            # Upsert: actualizar solo si cambió el nombre/sigla o si estaba inactiva.
            dirty = False
            if u.nombre != data["nombre"]:
                u.nombre = data["nombre"]; dirty = True
            nueva_sigla = data.get("sigla")
            if (u.sigla or None) != (nueva_sigla or None):
                u.sigla = nueva_sigla; dirty = True
            nueva_clasif = data["clasificacion_admin"]
            if u.clasificacion_admin != nueva_clasif:
                u.clasificacion_admin = nueva_clasif; dirty = True
            if not u.activa:
                u.activa = True; dirty = True
            if dirty:
                cambios += 1

    # Marcar como inactivas las que no estén ya en el catálogo (soft delete)
    for codigo, u in existentes.items():
        if codigo not in codigos_semilla and u.activa:
            u.activa = False
            cambios += 1

    if cambios:
        await db.commit()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[UPPOut], summary="Listar UPPs")
async def listar_upps(
    clasificacion: Optional[str] = Query(None, description="CENTRALIZADA|PARAESTATAL|AUTÓNOMA|PODER"),
    q: Optional[str] = Query(None, description="Búsqueda por nombre o código"),
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Lista todas las Unidades Programáticas Presupuestales activas (Ejercicio 2026)."""
    await _seed_upps(db)

    stmt = select(UnidadProgramatica).where(
        UnidadProgramatica.activa.is_(True),
        UnidadProgramatica.ejercicio == 2026,
    ).order_by(UnidadProgramatica.codigo)

    if clasificacion:
        stmt = stmt.where(UnidadProgramatica.clasificacion_admin == clasificacion.upper())

    result = await db.execute(stmt)
    upps = result.scalars().all()

    if q:
        q_lower = q.lower()
        upps = [
            u for u in upps
            if q_lower in u.nombre.lower()
            or q_lower in u.codigo.lower()
            or (u.sigla and q_lower in u.sigla.lower())
        ]

    return upps


@router.get("/lookup/{codigo}", response_model=UPPOut, summary="Buscar UPP por código")
async def buscar_upp_codigo(
    codigo: str,
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Devuelve los datos de una UPP por su código (p.ej. '007', 'A13')."""
    await _seed_upps(db)

    result = await db.execute(
        select(UnidadProgramatica).where(
            UnidadProgramatica.codigo == codigo.upper(),
            UnidadProgramatica.activa.is_(True),
        )
    )
    upp = result.scalar_one_or_none()
    if not upp:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"UPP '{codigo}' no encontrada.")
    return upp


@router.get("/stats", summary="Estadísticas de UPPs por clasificación")
async def stats_upps(
    db: AsyncSession = Depends(get_db),
    _: Usuario = Depends(get_current_active_user),
):
    """Devuelve el conteo de UPPs por tipo de clasificación administrativa."""
    await _seed_upps(db)

    result = await db.execute(
        select(UnidadProgramatica.clasificacion_admin, func.count().label("total"))
        .where(UnidadProgramatica.activa.is_(True))
        .group_by(UnidadProgramatica.clasificacion_admin)
        .order_by(func.count().desc())
    )
    rows = result.all()
    return {
        "total": sum(r.total for r in rows),
        "por_clasificacion": [
            {"clasificacion": r.clasificacion_admin, "total": r.total}
            for r in rows
        ],
    }
