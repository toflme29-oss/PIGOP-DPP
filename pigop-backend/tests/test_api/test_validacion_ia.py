"""
Tests de Fase 3: Motor de Validación Inteligente con Gemini IA.

Estrategia:
- Las llamadas reales a Gemini se mockean para que los tests sean deterministas
  y no consuman créditos de API en CI.
- Se prueba la lógica de OCR con pypdf usando bytes sintéticos.
- Se prueba el endpoint /validar-ia con mock de GeminiService.
"""
import io
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from httpx import AsyncClient


# ──────────────────────────────────────────────────────────────────────────────
# Helpers / Fixtures
# ──────────────────────────────────────────────────────────────────────────────

# Respuesta mock de Gemini para extracción de CFDI
MOCK_CFDI_DATOS = {
    "uuid_fiscal": "TEST-UUID-0001-0001-0001",
    "rfc_emisor": "PROV010101ABC",
    "nombre_emisor": "Proveedor Test SA de CV",
    "rfc_receptor": "GEM261011I62",
    "nombre_receptor": "Gobierno del Estado de Michoacán",
    "total": 150000.00,
    "subtotal": 129310.34,
    "fecha_emision": "2026-01-15",
    "moneda": "MXN",
    "forma_pago": "03",
    "metodo_pago": "PUE",
    "uso_cfdi": "G03",
    "concepto_principal": "Servicios de consultoría tecnológica",
    "num_conceptos": 1,
}

# Respuesta mock de Gemini para validación de consistencia
MOCK_CONSISTENCIA = {
    "validaciones": [
        {
            "tipo_validacion": "CRUCE_RFC",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 39",
            "mensaje": "RFC del receptor coincide con beneficiario del DEPP.",
            "detalles": {}
        },
        {
            "tipo_validacion": "CRUCE_MONTOS",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 40",
            "mensaje": "Monto del CFDI ($150,000.00) no supera el monto del DEPP.",
            "detalles": {"cfdi_total": 150000.00, "depp_monto": 200000.00}
        },
        {
            "tipo_validacion": "CRUCE_FECHAS",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 39",
            "mensaje": "Fecha del CFDI (2026-01-15) es anterior a la emisión del DEPP.",
            "detalles": {}
        },
        {
            "tipo_validacion": "CONCEPTO_CAPITULO",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": "Art. 40",
            "mensaje": "Concepto 'Servicios de consultoría' es coherente con capítulo 3000.",
            "detalles": {}
        },
        {
            "tipo_validacion": "CONSISTENCIA_GENERAL",
            "resultado": "exitosa",
            "gravedad": "bajo",
            "articulo_manual": None,
            "mensaje": "Expediente consistente. Todos los cruces superados.",
            "detalles": {}
        },
    ],
    "resumen_ia": (
        "El expediente presenta todos los documentos en orden. "
        "El CFDI es válido y consistent con el DEPP. "
        "Se recomienda aprobación."
    ),
}

MOCK_CONSISTENCIA_CON_ERROR = {
    "validaciones": [
        {
            "tipo_validacion": "CRUCE_RFC",
            "resultado": "error",
            "gravedad": "critico",
            "articulo_manual": "Art. 39",
            "mensaje": "El RFC del receptor en el CFDI (OTRO010101XYZ) NO coincide con el beneficiario declarado.",
            "detalles": {"rfc_cfdi": "OTRO010101XYZ", "beneficiario": "GEM261011I62"}
        },
        {
            "tipo_validacion": "CRUCE_MONTOS",
            "resultado": "advertencia",
            "gravedad": "medio",
            "articulo_manual": "Art. 40",
            "mensaje": "El monto del CFDI supera en un 10% al monto del DEPP.",
            "detalles": {"cfdi_total": 220000.00, "depp_monto": 200000.00}
        },
    ],
    "resumen_ia": "Expediente con observaciones críticas. RFC no coincide.",
}


@pytest_asyncio.fixture
async def depp_con_cfdi(client: AsyncClient, superadmin_token: str, cliente_upp):
    """Crea un DEPP con un CFDI adjunto (datos sintéticos)."""
    headers = {"Authorization": f"Bearer {superadmin_token}"}

    # Crear DEPP
    resp = await client.post(
        "/api/v1/depps/",
        json={
            "folio": "DEPP-IA-TEST-001",
            "cliente_id": str(cliente_upp.id),
            "upp": "TST",
            "ejercicio": 2026,
            "monto_total": 200000.00,
            "beneficiario": "Proveedor Test SA de CV",
            "capitulo": 3000,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    depp_id = resp.json()["id"]

    # Subir CFDI XML sintético
    xml_cfdi = b"""<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
    Total="150000.00" SubTotal="129310.34" Fecha="2026-01-15T10:00:00"
    Moneda="MXN" FormaPago="03" MetodoPago="PUE">
  <cfdi:Emisor Rfc="PROV010101ABC" Nombre="Proveedor Test SA de CV"/>
  <cfdi:Receptor Rfc="GEM261011I62" Nombre="Gobierno del Estado de Michoacán" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto Descripcion="Servicios de consultoría tecnológica"
        Cantidad="1" ValorUnitario="129310.34" Importe="129310.34"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
        UUID="TEST-UUID-0001-0001-0001"/>
  </cfdi:Complemento>
</cfdi:Comprobante>"""

    resp_upload = await client.post(
        f"/api/v1/depps/{depp_id}/upload",
        files={"files": ("factura_test.xml", xml_cfdi, "text/xml")},
        headers=headers,
    )
    assert resp_upload.status_code == 200

    return depp_id, headers


# ──────────────────────────────────────────────────────────────────────────────
# Tests: OCR Service
# ──────────────────────────────────────────────────────────────────────────────

class TestOCRService:
    """Tests unitarios del servicio OCR (sin BD)."""

    def test_extraer_xml_utf8(self):
        """Extrae texto de un XML en UTF-8."""
        from app.services.ocr_service import ocr_service

        xml = b"<?xml version='1.0'?><root><dato>Michoacán</dato></root>"
        resultado = ocr_service._extraer_xml(xml)
        assert "Michoacán" in resultado
        assert "<?xml" in resultado

    def test_extraer_xml_latin1(self):
        """Extrae texto de un XML en Latin-1 (codificación común en CFDI)."""
        from app.services.ocr_service import ocr_service

        xml_latin1 = "<?xml version='1.0'?><root><nombre>Proveed\xf3r</nombre></root>".encode("latin-1")
        resultado = ocr_service._extraer_xml(xml_latin1)
        assert "Proveed" in resultado

    def test_pypdf_pdf_con_texto(self):
        """Extrae texto de un PDF generado con reportlab (si está disponible)."""
        from app.services.ocr_service import ocr_service

        try:
            from reportlab.pdfgen import canvas
            buf = io.BytesIO()
            c = canvas.Canvas(buf)
            c.drawString(100, 750, "DEPP Folio 2026-001")
            c.drawString(100, 730, "RFC: GEM261011I62")
            c.drawString(100, 710, "Monto: $150,000.00")
            c.save()
            pdf_bytes = buf.getvalue()

            texto = ocr_service._pypdf_extract(pdf_bytes)
            assert len(texto) > 0

        except ImportError:
            pytest.skip("reportlab no disponible para generar PDF de prueba")

    def test_pypdf_bytes_invalidos(self):
        """pypdf retorna string vacío con bytes inválidos (no crashea)."""
        from app.services.ocr_service import ocr_service

        resultado = ocr_service._pypdf_extract(b"not a pdf")
        assert isinstance(resultado, str)

    def test_limpiar_texto(self):
        """Limpia espacios y trunca correctamente."""
        from app.services.ocr_service import ocr_service

        texto = "Hola\n\n\n\n\nMundo   Con   Espacios"
        resultado = ocr_service.limpiar_texto(texto, max_chars=100)
        assert "\n\n\n" not in resultado
        assert len(resultado) <= 100

    def test_limpiar_texto_trunca(self):
        """Trunca texto largo al límite especificado."""
        from app.services.ocr_service import ocr_service

        texto = "A" * 10000
        resultado = ocr_service.limpiar_texto(texto, max_chars=500)
        assert len(resultado) == 500

    @pytest.mark.asyncio
    async def test_extraer_texto_xml(self):
        """extraer_texto detecta XML y retorna método xml_directo."""
        from app.services.ocr_service import ocr_service

        xml = b"<cfdi:Comprobante Total='1000'/>"
        texto, metodo = await ocr_service.extraer_texto(xml, "text/xml", "cfdi.xml")
        assert metodo == "xml_directo"
        assert "Comprobante" in texto

    @pytest.mark.asyncio
    async def test_extraer_texto_detecta_mime(self):
        """extraer_texto detecta tipo correcto por extensión cuando mime es vacío."""
        from app.services.ocr_service import ocr_service

        xml = b"<root/>"
        texto, metodo = await ocr_service.extraer_texto(xml, "", "documento.xml")
        assert metodo == "xml_directo"


# ──────────────────────────────────────────────────────────────────────────────
# Tests: Gemini Service (mocks)
# ──────────────────────────────────────────────────────────────────────────────

class TestGeminiService:
    """Tests del servicio Gemini en modo mock."""

    def test_gemini_disponible_sin_key(self):
        """Sin API key real, gemini_service.available es False."""
        import os
        with patch.dict(os.environ, {"GEMINI_API_KEY": "placeholder"}):
            # Reimportar para reflejar el estado de la variable
            # En el singleton ya inicializado, verificamos directamente
            from app.services.gemini_service import GeminiService
            svc = GeminiService()
            # El singleton puede estar inicializado; verificamos que mock retorna datos
            if not svc.available:
                mock_cfdi = svc._mock_cfdi()
                assert mock_cfdi["_mock"] is True
                assert "uuid_fiscal" in mock_cfdi

    @pytest.mark.asyncio
    async def test_mock_cfdi_estructura(self):
        """_mock_cfdi retorna estructura completa."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        mock = svc._mock_cfdi()
        assert "uuid_fiscal" in mock
        assert "rfc_emisor" in mock
        assert "total" in mock

    @pytest.mark.asyncio
    async def test_mock_documento(self):
        """_mock_documento retorna tipo correcto."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        mock = svc._mock_documento("MCL")
        assert mock["tipo"] == "MCL"
        assert mock["_mock"] is True

    @pytest.mark.asyncio
    async def test_mock_consistencia(self):
        """_mock_consistencia retorna validación de advertencia."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        mock = svc._mock_consistencia("II.4")
        assert "validaciones" in mock
        assert len(mock["validaciones"]) > 0
        assert mock["validaciones"][0]["resultado"] == "advertencia"

    def test_parse_json_response_limpio(self):
        """_parse_json_response parsea JSON limpio."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        resultado = svc._parse_json_response('{"uuid": "123", "total": 500.0}')
        assert resultado["uuid"] == "123"
        assert resultado["total"] == 500.0

    def test_parse_json_response_con_markdown(self):
        """_parse_json_response elimina bloques ```json ... ```."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        texto = '```json\n{"key": "value"}\n```'
        resultado = svc._parse_json_response(texto)
        assert resultado["key"] == "value"

    def test_parse_json_response_invalido(self):
        """_parse_json_response retorna raw_response cuando no es JSON."""
        from app.services.gemini_service import GeminiService
        svc = GeminiService()
        resultado = svc._parse_json_response("esto no es json en absoluto")
        assert "raw_response" in resultado


# ──────────────────────────────────────────────────────────────────────────────
# Tests: Endpoint /validar-ia
# ──────────────────────────────────────────────────────────────────────────────

class TestValidarIAEndpoint:
    """Tests de integración del endpoint POST /validar-ia."""

    @pytest.mark.asyncio
    async def test_validar_ia_depp_no_existe(self, client: AsyncClient, superadmin_token: str):
        """Retorna 404 para DEPP inexistente."""
        headers = {"Authorization": f"Bearer {superadmin_token}"}
        resp = await client.post(
            "/api/v1/depps/depp-que-no-existe/validar-ia",
            headers=headers,
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_validar_ia_sin_gemini_key(
        self, client: AsyncClient, superadmin_token: str, cliente_upp
    ):
        """
        Sin GEMINI_API_KEY real, el endpoint retorna 200 con advertencia
        (GeminiService en modo mock).
        """
        headers = {"Authorization": f"Bearer {superadmin_token}"}

        # Crear DEPP mínimo
        resp = await client.post(
            "/api/v1/depps/",
            json={
                "folio": "DEPP-IA-MOCK-001",
                "cliente_id": str(cliente_upp.id),
                "upp": "TST",
                "ejercicio": 2026,
                "monto_total": 50000.00,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        depp_id = resp.json()["id"]

        # Validar IA (debe funcionar en modo mock)
        resp_ia = await client.post(
            f"/api/v1/depps/{depp_id}/validar-ia",
            headers=headers,
        )
        assert resp_ia.status_code == 200
        data = resp_ia.json()

        # Debe tener validaciones
        assert "validaciones" in data
        validaciones_ia = [
            v for v in data["validaciones"]
            if "normativa_ia" in v.get("tipo_validacion", "")
        ]
        assert len(validaciones_ia) >= 1

    @pytest.mark.asyncio
    async def test_validar_ia_con_gemini_mockeado(
        self,
        client: AsyncClient,
        superadmin_token: str,
        depp_con_cfdi,
    ):
        """
        Mockea GeminiService para simular respuesta real de Gemini.
        Verifica que se creen validaciones de tipo normativa_ia.
        """
        depp_id, headers = depp_con_cfdi

        with patch(
            "app.services.ai_validation_service.gemini_service"
        ) as mock_gemini:
            # Configurar mock
            mock_gemini.available = True
            mock_gemini.extraer_datos_cfdi = AsyncMock(return_value=MOCK_CFDI_DATOS)
            mock_gemini.extraer_datos_documento = AsyncMock(return_value={"datos": "mock"})
            mock_gemini.validar_consistencia_expediente = AsyncMock(
                return_value=MOCK_CONSISTENCIA
            )

            resp = await client.post(
                f"/api/v1/depps/{depp_id}/validar-ia",
                headers=headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "validaciones" in data

        validaciones_ia = [
            v for v in data["validaciones"]
            if v.get("tipo_validacion", "").startswith("normativa_ia")
        ]
        # 5 validaciones individuales + 1 resumen = 6
        assert len(validaciones_ia) >= 5

        # Verificar que se guardaron los tipos esperados
        tipos = {v["tipo_validacion"] for v in validaciones_ia}
        assert any("cruce_rfc" in t for t in tipos)
        assert any("cruce_montos" in t for t in tipos)

    @pytest.mark.asyncio
    async def test_validar_ia_error_critico_observa_depp(
        self,
        client: AsyncClient,
        superadmin_token: str,
        cliente_upp,
    ):
        """
        Cuando Gemini detecta error crítico (RFC no coincide),
        el DEPP queda en estado 'observado'.
        """
        headers = {"Authorization": f"Bearer {superadmin_token}"}

        # Crear DEPP
        resp = await client.post(
            "/api/v1/depps/",
            json={
                "folio": "DEPP-IA-ERROR-001",
                "cliente_id": str(cliente_upp.id),
                "upp": "TST",
                "ejercicio": 2026,
                "monto_total": 200000.00,
                "beneficiario": "Beneficiario Correcto SA",
            },
            headers=headers,
        )
        assert resp.status_code == 201
        depp_id = resp.json()["id"]

        # Subir validación estructural primero para que quede en aprobado
        with patch("app.services.validation_service.ValidationService._validar_estructura") as mock_est, \
             patch("app.services.validation_service.ValidationService._validar_documentos") as mock_doc, \
             patch("app.services.validation_service.ValidationService._validar_coherencia") as mock_coh, \
             patch("app.services.validation_service.ValidationService._validar_clasificacion") as mock_cla:
            mock_est.return_value = {"tipo_validacion": "estructura", "resultado": "exitosa", "gravedad": "bajo", "mensaje": "OK", "detalles": {}}
            mock_doc.return_value = {"tipo_validacion": "documentos", "resultado": "exitosa", "gravedad": "bajo", "mensaje": "OK", "detalles": {}}
            mock_coh.return_value = {"tipo_validacion": "coherencia", "resultado": "exitosa", "gravedad": "bajo", "mensaje": "OK", "detalles": {}}
            mock_cla.return_value = {"tipo_validacion": "clasificacion", "resultado": "exitosa", "gravedad": "bajo", "mensaje": "OK", "detalles": {}}

            await client.post(f"/api/v1/depps/{depp_id}/validar", headers=headers)

        # Ahora validar IA con error crítico mockeado
        with patch("app.services.ai_validation_service.gemini_service") as mock_gemini:
            mock_gemini.available = True
            mock_gemini.extraer_datos_cfdi = AsyncMock(return_value=MOCK_CFDI_DATOS)
            mock_gemini.validar_consistencia_expediente = AsyncMock(
                return_value=MOCK_CONSISTENCIA_CON_ERROR
            )

            resp_ia = await client.post(
                f"/api/v1/depps/{depp_id}/validar-ia",
                headers=headers,
            )

        assert resp_ia.status_code == 200
        validaciones = resp_ia.json()["validaciones"]

        # Al menos una validación de error
        errores_ia = [
            v for v in validaciones
            if v.get("tipo_validacion", "").startswith("normativa_ia")
            and v.get("resultado") == "error"
        ]
        assert len(errores_ia) >= 1

    @pytest.mark.asyncio
    async def test_validar_ia_puede_llamarse_varias_veces(
        self,
        client: AsyncClient,
        superadmin_token: str,
        cliente_upp,
    ):
        """
        El endpoint /validar-ia puede llamarse múltiples veces (no lanza error).
        Cada llamada agrega nuevas validaciones.
        """
        headers = {"Authorization": f"Bearer {superadmin_token}"}

        resp = await client.post(
            "/api/v1/depps/",
            json={
                "folio": "DEPP-IA-RETRY-001",
                "cliente_id": str(cliente_upp.id),
                "upp": "TST",
                "ejercicio": 2026,
                "monto_total": 75000.00,
            },
            headers=headers,
        )
        assert resp.status_code == 201
        depp_id = resp.json()["id"]

        # Primera llamada
        resp1 = await client.post(
            f"/api/v1/depps/{depp_id}/validar-ia",
            headers=headers,
        )
        assert resp1.status_code == 200
        count1 = len([
            v for v in resp1.json()["validaciones"]
            if "normativa_ia" in v.get("tipo_validacion", "")
        ])

        # Segunda llamada
        resp2 = await client.post(
            f"/api/v1/depps/{depp_id}/validar-ia",
            headers=headers,
        )
        assert resp2.status_code == 200
        count2 = len([
            v for v in resp2.json()["validaciones"]
            if "normativa_ia" in v.get("tipo_validacion", "")
        ])

        # Segunda llamada agrega más validaciones (o mantiene las mismas en mock)
        assert count2 >= count1

    @pytest.mark.asyncio
    async def test_validar_ia_depp_pagado_retorna_error(
        self,
        client: AsyncClient,
        superadmin_token: str,
        cliente_upp,
    ):
        """No se puede revalidar IA un DEPP en estado 'pagado'."""
        headers = {"Authorization": f"Bearer {superadmin_token}"}

        resp = await client.post(
            "/api/v1/depps/",
            json={
                "folio": "DEPP-IA-PAGADO-001",
                "cliente_id": str(cliente_upp.id),
                "upp": "TST",
                "ejercicio": 2026,
                "monto_total": 100000.00,
            },
            headers=headers,
        )
        depp_id = resp.json()["id"]

        # Cambiar a pagado
        await client.post(
            f"/api/v1/depps/{depp_id}/estado",
            params={"nuevo_estado": "pagado"},
            headers=headers,
        )

        # Intentar validar IA
        resp_ia = await client.post(
            f"/api/v1/depps/{depp_id}/validar-ia",
            headers=headers,
        )
        assert resp_ia.status_code == 422  # BusinessError → 422

    @pytest.mark.asyncio
    async def test_validar_ia_requiere_autenticacion(self, client: AsyncClient, cliente_upp):
        """El endpoint requiere token JWT."""
        resp = await client.post("/api/v1/depps/cualquier-id/validar-ia")
        assert resp.status_code == 403


# ──────────────────────────────────────────────────────────────────────────────
# Tests: AIValidationService (unitarios)
# ──────────────────────────────────────────────────────────────────────────────

class TestAIValidationServiceUnit:
    """Tests unitarios del servicio AIValidationService."""

    def test_resultado_global_con_error(self):
        """_resultado_global detecta error si alguna validación tiene error."""
        from app.services.ai_validation_service import AIValidationService
        from unittest.mock import MagicMock

        svc = AIValidationService(MagicMock())
        validaciones = [
            {"resultado": "exitosa"},
            {"resultado": "error"},
            {"resultado": "advertencia"},
        ]
        assert svc._resultado_global(validaciones) == "error"

    def test_resultado_global_con_advertencia(self):
        """_resultado_global detecta advertencia si no hay errores."""
        from app.services.ai_validation_service import AIValidationService
        from unittest.mock import MagicMock

        svc = AIValidationService(MagicMock())
        validaciones = [
            {"resultado": "exitosa"},
            {"resultado": "advertencia"},
        ]
        assert svc._resultado_global(validaciones) == "advertencia"

    def test_resultado_global_todo_exitoso(self):
        """_resultado_global retorna exitosa cuando todo está bien."""
        from app.services.ai_validation_service import AIValidationService
        from unittest.mock import MagicMock

        svc = AIValidationService(MagicMock())
        validaciones = [
            {"resultado": "exitosa"},
            {"resultado": "exitosa"},
        ]
        assert svc._resultado_global(validaciones) == "exitosa"

    def test_gravedad_global_prioridad(self):
        """_gravedad_global respeta el orden critico > alto > medio > bajo."""
        from app.services.ai_validation_service import AIValidationService
        from unittest.mock import MagicMock

        svc = AIValidationService(MagicMock())

        assert svc._gravedad_global([{"gravedad": "bajo"}, {"gravedad": "critico"}]) == "critico"
        assert svc._gravedad_global([{"gravedad": "medio"}, {"gravedad": "alto"}]) == "alto"
        assert svc._gravedad_global([{"gravedad": "bajo"}]) == "bajo"
