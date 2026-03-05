"""Tests CRUD básico de DEPPs."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_crear_depp(client: AsyncClient, superadmin_token: str, cliente_upp):
    """Crear un DEPP básico debe retornar 201."""
    response = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={
            "folio": "DPP-001-2026",
            "upp": "TST",
            "ejercicio": 2026,
            "mes": 2,
            "capitulo": 3000,
            "monto_total": "15000.00",
            "beneficiario": "Proveedor de Prueba S.A.",
            "cliente_id": str(cliente_upp.id),
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["folio"] == "DPP-001-2026"
    assert data["estado"] == "borrador"
    assert data["puede_aprobar"] is False


@pytest.mark.asyncio
async def test_crear_depp_folio_duplicado(
    client: AsyncClient, superadmin_token: str, cliente_upp
):
    """No se puede crear dos DEPPs con el mismo folio en el mismo ejercicio."""
    payload = {
        "folio": "DPP-DUP-2026",
        "upp": "TST",
        "ejercicio": 2026,
        "cliente_id": str(cliente_upp.id),
    }
    r1 = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json=payload,
    )
    assert r1.status_code == 201

    r2 = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json=payload,
    )
    assert r2.status_code == 400


@pytest.mark.asyncio
async def test_listar_depps(client: AsyncClient, superadmin_token: str, cliente_upp):
    """Listar DEPPs debe retornar una lista."""
    response = await client.get(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        params={"cliente_id": str(cliente_upp.id)},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_obtener_depp_por_id(
    client: AsyncClient, superadmin_token: str, cliente_upp
):
    """Obtener DEPP por ID debe retornar el recurso completo."""
    create_resp = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={
            "folio": "DPP-GET-2026",
            "upp": "TST",
            "ejercicio": 2026,
            "cliente_id": str(cliente_upp.id),
        },
    )
    assert create_resp.status_code == 201
    depp_id = create_resp.json()["id"]

    get_resp = await client.get(
        f"/api/v1/depps/{depp_id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == depp_id
    assert "documentos" in get_resp.json()


@pytest.mark.asyncio
async def test_actualizar_depp(
    client: AsyncClient, superadmin_token: str, cliente_upp
):
    """Actualizar campos de un DEPP en borrador."""
    create_resp = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={
            "folio": "DPP-UPD-2026",
            "upp": "TST",
            "ejercicio": 2026,
            "cliente_id": str(cliente_upp.id),
        },
    )
    depp_id = create_resp.json()["id"]

    update_resp = await client.put(
        f"/api/v1/depps/{depp_id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={"beneficiario": "Nuevo Proveedor S.A.", "monto_total": "50000.00"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["beneficiario"] == "Nuevo Proveedor S.A."


@pytest.mark.asyncio
async def test_eliminar_depp_borrador(
    client: AsyncClient, superadmin_token: str, cliente_upp
):
    """Solo se puede eliminar un DEPP en estado borrador."""
    create_resp = await client.post(
        "/api/v1/depps/",
        headers={"Authorization": f"Bearer {superadmin_token}"},
        json={
            "folio": "DPP-DEL-2026",
            "upp": "TST",
            "ejercicio": 2026,
            "cliente_id": str(cliente_upp.id),
        },
    )
    depp_id = create_resp.json()["id"]

    del_resp = await client.delete(
        f"/api/v1/depps/{depp_id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True


@pytest.mark.asyncio
async def test_depp_no_encontrado(client: AsyncClient, superadmin_token: str):
    """Obtener DEPP con ID inexistente debe retornar 404."""
    import uuid
    fake_id = str(uuid.uuid4())
    response = await client.get(
        f"/api/v1/depps/{fake_id}",
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )
    assert response.status_code == 404
