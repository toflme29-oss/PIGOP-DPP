"""
Tests del motor de validación estructural (Fase 2).

Cubre:
 - POST /depps/{id}/validar → pipeline 4 pasos
 - Clasificaciones I.1, II.1, II.2, II.3, II.4
 - DEPP con errores vs DEPP aprobable
 - Unitarios de ClasificacionService y ValidationService
"""
import io
import uuid
import pytest
import pytest_asyncio
from decimal import Decimal
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Cliente, Usuario
from app.models.depp import DEPP, DocumentoDEPP
from app.core.security import get_password_hash
from app.services.clasificacion_service import ClasificacionService, clasificacion_service
from app.services.validation_service import ValidationService


# ══════════════════════════════════════════════════════════════════════════════
# Tests unitarios de ClasificacionService (sin DB)
# ══════════════════════════════════════════════════════════════════════════════

class TestClasificacionService:

    def test_clasificacion_i1(self):
        svc = ClasificacionService()
        cls, razon = svc.determinar_clasificacion(["DEPP", "CFDI", "CTT", "MCL"])
        assert cls == "I.1"

    def test_clasificacion_ii1_aur(self):
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "AUR"])
        assert cls == "II.1"

    def test_clasificacion_ii2_fuc(self):
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "FUC"])
        assert cls == "II.2"

    def test_clasificacion_ii3_solo_pch(self):
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "PCH"])
        assert cls == "II.3"

    def test_clasificacion_ii4_cfdi_mcl_sin_ctt(self):
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "CFDI", "MCL"])
        assert cls == "II.4"

    def test_clasificacion_indeterminada(self):
        svc = ClasificacionService()
        cls, razon = svc.determinar_clasificacion(["DEPP"])
        assert cls is None
        assert "No se pudo" in razon

    def test_aur_tiene_prioridad_sobre_cfdi(self):
        """Si hay AUR, siempre es II.1 aunque también haya CFDI."""
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "CFDI", "MCL", "AUR"])
        assert cls == "II.1"

    def test_fuc_tiene_prioridad_sobre_pch(self):
        """Si hay FUC, es II.2 aunque también haya PCH."""
        svc = ClasificacionService()
        cls, _ = svc.determinar_clasificacion(["DEPP", "FUC", "PCH"])
        assert cls == "II.2"

    def test_validar_documentos_faltantes_i1(self):
        svc = ClasificacionService()
        faltantes = svc.validar_documentos_requeridos("I.1", ["DEPP", "CFDI"])
        assert "CTT" in faltantes
        assert "MCL" in faltantes

    def test_validar_documentos_completos_ii4(self):
        svc = ClasificacionService()
        faltantes = svc.validar_documentos_requeridos("II.4", ["DEPP", "CFDI", "MCL"])
        assert faltantes == []

    def test_validar_capitulo_i1_valido(self):
        svc = ClasificacionService()
        ok, _ = svc.validar_capitulo("I.1", 2000)
        assert ok is True

    def test_validar_capitulo_i1_invalido(self):
        svc = ClasificacionService()
        ok, msg = svc.validar_capitulo("I.1", 1000)
        assert ok is False
        assert "1000" in msg

    def test_capitulo_none_en_clasificacion_sin_restriccion(self):
        svc = ClasificacionService()
        ok, _ = svc.validar_capitulo("II.1", None)
        assert ok is True  # II.1 aplica a todos

    def test_clasificar_tipo_documento_xml(self):
        svc = ClasificacionService()
        assert svc.clasificar_tipo_documento("factura.xml", "text/xml") == "CFDI"

    def test_clasificar_tipo_documento_por_nombre(self):
        svc = ClasificacionService()
        assert svc.clasificar_tipo_documento("manifiesto_mcl_2026.pdf", "application/pdf") == "MCL"
        assert svc.clasificar_tipo_documento("contrato_servicios.pdf", "application/pdf") == "CTT"
        assert svc.clasificar_tipo_documento("poliza_cheque.pdf", "application/pdf") == "PCH"
        assert svc.clasificar_tipo_documento("acuerdo_aur_enero.pdf", "application/pdf") == "AUR"
        assert svc.clasificar_tipo_documento("comision_fuc.pdf", "application/pdf") == "FUC"

    def test_clasificar_tipo_documento_desconocido(self):
        svc = ClasificacionService()
        assert svc.clasificar_tipo_documento("documento_raro.docx", "application/msword") == "OTR"

    def test_get_descripcion_clasificacion(self):
        svc = ClasificacionService()
        desc = svc.get_descripcion_clasificacion("I.1")
        assert "contrato" in desc.lower()

    def test_get_descripcion_clasificacion_invalida(self):
        svc = ClasificacionService()
        desc = svc.get_descripcion_clasificacion("X.9")
        assert "desconocida" in desc.lower()


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures para tests de integración con DB
# ══════════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def analista_val(client: AsyncClient, db_session: AsyncSession) -> dict:
    """Crea cliente + analista, retorna dict con token y cliente_id."""
    cliente = Cliente(
        codigo_upp="VAL",
        nombre="UPP Validacion Test",
        tipo="centralizada",
        activo=True,
        configuracion={},
    )
    db_session.add(cliente)
    await db_session.flush()

    user = Usuario(
        cliente_id=cliente.id,
        email="analista-val@pigop.gob.mx",
        password_hash=get_password_hash("Analista.1!"),
        nombre_completo="Analista Validacion",
        rol="analista",
        activo=True,
    )
    db_session.add(user)
    await db_session.commit()

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "analista-val@pigop.gob.mx", "password": "Analista.1!"},
    )
    assert r.status_code == 200
    return {"token": r.json()["access_token"], "cliente_id": cliente.id}


async def _crear_depp(client, token, cliente_id, extra: dict = None) -> dict:
    """Helper: crea un DEPP borrador y retorna el JSON."""
    payload = {
        "folio": f"VAL-{uuid.uuid4().hex[:8].upper()}",
        "upp": "VAL",
        "ejercicio": 2026,
        "mes": 2,
        "capitulo": 3000,
        "monto_total": "12500.00",
        "beneficiario": "Proveedor Ejemplo SA",
        "cliente_id": str(cliente_id),
    }
    if extra:
        payload.update(extra)
    r = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _subir_doc(client, token, depp_id, nombre, contenido=b"%PDF"):
    """Helper: sube un archivo al DEPP."""
    r = await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=[("files", (nombre, io.BytesIO(contenido), "application/pdf"))],
    )
    assert r.status_code == 200, r.text
    return r.json()


# ══════════════════════════════════════════════════════════════════════════════
# Tests de integración del endpoint /validar
# ══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_validar_depp_sin_documentos_retorna_error(
    client: AsyncClient, analista_val: dict
):
    """DEPP sin documentos adjuntos → validación falla con error de documentos."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id)
    depp_id = depp["id"]

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()

    assert "validaciones" in data
    # Sin documentos no se puede determinar clasificación → advertencia/error
    tipos_resultado = {v["tipo_validacion"]: v["resultado"] for v in data["validaciones"]}
    assert tipos_resultado.get("documentos") in ("advertencia", "error")


@pytest.mark.asyncio
async def test_validar_depp_ii4_completo(
    client: AsyncClient, analista_val: dict
):
    """DEPP con CFDI + MCL (clasificación II.4) debe aprobar."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id)
    depp_id = depp["id"]

    # Subir CFDI (XML) y MCL
    xml_cfdi = b"""<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="12500.00"/>"""
    await _subir_doc(client, token, depp_id, "cfdi_factura.xml", xml_cfdi)
    await _subir_doc(client, token, depp_id, "manifiesto_mcl.pdf")

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()

    tipos_resultado = {v["tipo_validacion"]: v["resultado"] for v in data["validaciones"]}
    assert tipos_resultado.get("estructura") == "exitosa"
    assert tipos_resultado.get("documentos") == "exitosa"
    assert data["puede_aprobar"] is True
    assert data["estado"] == "aprobado"


@pytest.mark.asyncio
async def test_validar_depp_i1_completo(
    client: AsyncClient, analista_val: dict
):
    """DEPP con CFDI + CTT + MCL (clasificación I.1) debe aprobar."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id, {"capitulo": 2000})
    depp_id = depp["id"]

    xml_cfdi = b"""<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"/>"""
    await _subir_doc(client, token, depp_id, "cfdi.xml", xml_cfdi)
    await _subir_doc(client, token, depp_id, "contrato_ctt.pdf")
    await _subir_doc(client, token, depp_id, "manifiesto_mcl.pdf")

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["puede_aprobar"] is True
    assert data["estado"] == "aprobado"

    cls_val = next(
        (v for v in data["validaciones"] if v["tipo_validacion"] == "clasificacion"), None
    )
    assert cls_val is not None
    assert "I.1" in cls_val["mensaje"]


@pytest.mark.asyncio
async def test_validar_depp_ii1_aur(
    client: AsyncClient, analista_val: dict
):
    """DEPP con AUR (clasificación II.1) debe aprobar en cualquier capítulo."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id, {"capitulo": 4000})
    depp_id = depp["id"]

    await _subir_doc(client, token, depp_id, "acuerdo_aur.pdf")

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["puede_aprobar"] is True


@pytest.mark.asyncio
async def test_validar_depp_ii3_pch(
    client: AsyncClient, analista_val: dict
):
    """DEPP con solo PCH (clasificación II.3) debe aprobar."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id)
    depp_id = depp["id"]

    await _subir_doc(client, token, depp_id, "poliza_cheque_pch.pdf")

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["puede_aprobar"] is True
    assert data["estado"] == "aprobado"


@pytest.mark.asyncio
async def test_validar_depp_monto_alto_genera_advertencia(
    client: AsyncClient, analista_val: dict
):
    """Monto > 500,000 genera advertencia de coherencia pero no bloquea."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(
        client, token, cliente_id, {"monto_total": "750000.00"}
    )
    depp_id = depp["id"]

    # Documentos II.4 completos
    xml_cfdi = b"""<?xml version="1.0"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0"/>"""
    await _subir_doc(client, token, depp_id, "cfdi.xml", xml_cfdi)
    await _subir_doc(client, token, depp_id, "manifiesto_mcl.pdf")

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()

    # Debe haber advertencia de coherencia por monto alto
    coh_val = next(
        (v for v in data["validaciones"] if v["tipo_validacion"] == "coherencia"), None
    )
    assert coh_val is not None
    assert coh_val["resultado"] == "advertencia"
    assert "500,000" in coh_val["mensaje"] or "500000" in coh_val["mensaje"]

    # Pero aún puede aprobar (advertencia no bloquea)
    assert data["puede_aprobar"] is True


@pytest.mark.asyncio
async def test_validar_devuelve_4_validaciones(
    client: AsyncClient, analista_val: dict
):
    """El pipeline siempre genera exactamente 4 objetos de validación."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id)
    depp_id = depp["id"]

    r = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["validaciones"]) == 4


@pytest.mark.asyncio
async def test_validar_depp_inexistente_retorna_404(
    client: AsyncClient, analista_val: dict
):
    """Validar un DEPP inexistente debe retornar 404."""
    token = analista_val["token"]
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = await client.post(
        f"/api/v1/depps/{fake_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_segunda_validacion_reemplaza_resultados(
    client: AsyncClient, analista_val: dict
):
    """Ejecutar /validar dos veces no duplica resultados — siempre 4 validaciones."""
    token = analista_val["token"]
    cliente_id = analista_val["cliente_id"]

    depp = await _crear_depp(client, token, cliente_id)
    depp_id = depp["id"]

    await _subir_doc(client, token, depp_id, "poliza_cheque_pch.pdf")

    # Primera validación
    r1 = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r1.status_code == 200

    # Segunda validación
    r2 = await client.post(
        f"/api/v1/depps/{depp_id}/validar",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r2.status_code == 200
    assert len(r2.json()["validaciones"]) == 4
