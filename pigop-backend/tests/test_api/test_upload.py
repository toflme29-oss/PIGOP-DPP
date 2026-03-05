"""
Tests de upload de documentos (Fase 2).

Cubre:
 - POST /depps/{id}/upload   → upload de 1 o varios archivos
 - GET  /depps/{id}/documentos → listado de documentos
 - DELETE /depps/{id}/documentos/{doc_id} → eliminación
"""
import io
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Cliente, Usuario
from app.models.depp import DEPP
from app.core.security import get_password_hash


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def analista_token(client: AsyncClient, db_session: AsyncSession) -> str:
    """Crea un cliente + analista y retorna su JWT."""
    cliente = Cliente(
        codigo_upp="UPL",
        nombre="UPP Upload Test",
        tipo="centralizada",
        activo=True,
        configuracion={},
    )
    db_session.add(cliente)
    await db_session.flush()

    user = Usuario(
        cliente_id=cliente.id,
        email="analista-upload@pigop.gob.mx",
        password_hash=get_password_hash("Analista.1!"),
        nombre_completo="Analista Upload",
        rol="analista",
        activo=True,
    )
    db_session.add(user)
    await db_session.commit()

    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "analista-upload@pigop.gob.mx", "password": "Analista.1!"},
    )
    assert r.status_code == 200
    return r.json()["access_token"]


@pytest_asyncio.fixture
async def depp_borrador(
    client: AsyncClient,
    analista_token: str,
    db_session: AsyncSession,
) -> dict:
    """Crea un DEPP en estado borrador y lo retorna como dict."""
    cliente = await db_session.execute(
        __import__("sqlalchemy", fromlist=["select"]).select(Cliente).where(
            Cliente.codigo_upp == "UPL"
        )
    )
    c = cliente.scalars().first()

    r = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {analista_token}"},
        json={
            "folio": "DEPP-UPL-001",
            "upp": "UPL",
            "ejercicio": 2026,
            "mes": 2,
            "capitulo": 3000,
            "monto_total": "15000.00",
            "beneficiario": "Proveedor Test SA de CV",
            "cliente_id": c.id,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


# ── Tests de upload ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_xml_cfdi(
    client: AsyncClient,
    analista_token: str,
    depp_borrador: dict,
):
    """Subir un XML se clasifica automáticamente como CFDI."""
    depp_id = depp_borrador["id"]
    xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  Version="4.0" Total="15000.00" Moneda="MXN"/>"""

    files = [
        ("files", ("factura_proveedor.xml", io.BytesIO(xml_content), "text/xml")),
    ]
    r = await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        headers={"Authorization": f"Bearer {analista_token}"},
        files=files,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["documentos_subidos"] == 1
    assert data["documentos"][0]["tipo"] == "CFDI"


@pytest.mark.asyncio
async def test_upload_multiples_archivos(
    client: AsyncClient,
    analista_token: str,
    depp_borrador: dict,
):
    """Subir varios archivos en una sola petición."""
    depp_id = depp_borrador["id"]
    files = [
        ("files", ("manifiesto_mcl.pdf", io.BytesIO(b"%PDF-manifiesto"), "application/pdf")),
        ("files", ("poliza_cheque_pch.pdf", io.BytesIO(b"%PDF-poliza"), "application/pdf")),
    ]
    r = await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        headers={"Authorization": f"Bearer {analista_token}"},
        files=files,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["documentos_subidos"] == 2
    tipos = {d["tipo"] for d in data["documentos"]}
    assert "MCL" in tipos or "PCH" in tipos  # al menos uno clasificado


@pytest.mark.asyncio
async def test_listar_documentos(
    client: AsyncClient,
    analista_token: str,
    depp_borrador: dict,
):
    """GET /depps/{id}/documentos devuelve los documentos adjuntos."""
    depp_id = depp_borrador["id"]
    # Subir un archivo primero
    await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        headers={"Authorization": f"Bearer {analista_token}"},
        files=[("files", ("contrato_ctt.pdf", io.BytesIO(b"%PDF-contrato"), "application/pdf"))],
    )

    r = await client.get(
        f"/api/v1/depps/{depp_id}/documentos",
        headers={"Authorization": f"Bearer {analista_token}"},
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


@pytest.mark.asyncio
async def test_eliminar_documento(
    client: AsyncClient,
    analista_token: str,
    depp_borrador: dict,
):
    """DELETE /depps/{id}/documentos/{doc_id} elimina el documento."""
    depp_id = depp_borrador["id"]

    # Subir
    upload_r = await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        headers={"Authorization": f"Bearer {analista_token}"},
        files=[("files", ("acuerdo_aur.pdf", io.BytesIO(b"%PDF-aur"), "application/pdf"))],
    )
    assert upload_r.status_code == 200
    doc_id = upload_r.json()["documentos"][0]["id"]

    # Eliminar
    del_r = await client.delete(
        f"/api/v1/depps/{depp_id}/documentos/{doc_id}",
        headers={"Authorization": f"Bearer {analista_token}"},
    )
    assert del_r.status_code == 200

    # Verificar que ya no aparece
    list_r = await client.get(
        f"/api/v1/depps/{depp_id}/documentos",
        headers={"Authorization": f"Bearer {analista_token}"},
    )
    ids_restantes = [d["id"] for d in list_r.json()]
    assert doc_id not in ids_restantes


@pytest.mark.asyncio
async def test_upload_depp_inexistente_retorna_404(
    client: AsyncClient,
    analista_token: str,
):
    """Subir archivos a un DEPP que no existe debe retornar 404."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = await client.post(
        f"/api/v1/depps/{fake_id}/upload",
        headers={"Authorization": f"Bearer {analista_token}"},
        files=[("files", ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf"))],
    )
    assert r.status_code == 404
