"""
Endpoints para gestión de certificados e.firma (FIEL) del SAT.

Flujo:
  1. POST /registrar          → Sube .cer + .key + password → cifra y guarda
  2. GET  /mi-certificado      → Retorna metadata (sin clave)
  3. POST /validar-vigencia    → Verifica que sigue vigente
  4. DELETE /revocar            → Desactiva certificado
  5. POST /renovar             → Reemplaza con nuevo par
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user
from app.core.database import get_db
from app.core.exceptions import BusinessError, ForbiddenError, NotFoundError
from app.models.user import Usuario
from app.services.boveda_certificados_service import boveda_certificados_service

router = APIRouter()


# ── Schemas de respuesta ─────────────────────────────────────────────────────

class CertificadoInfoResponse(BaseModel):
    """Metadata del certificado registrado (sin clave privada)."""
    tiene_certificado: bool
    vigente: bool = False
    rfc: Optional[str] = None
    nombre_titular: Optional[str] = None
    numero_serie: Optional[str] = None
    valido_desde: Optional[str] = None
    valido_hasta: Optional[str] = None
    emisor: Optional[str] = None
    activo: bool = False
    total_firmas: int = 0
    registrado_en: Optional[str] = None
    ultima_firma_en: Optional[str] = None


class CertificadoRegistroResponse(BaseModel):
    """Resultado del registro de certificado."""
    rfc: str
    nombre_titular: str
    numero_serie: str
    valido_desde: Optional[str] = None
    valido_hasta: Optional[str] = None
    emisor: Optional[str] = None
    message: str


class VigenciaResponse(BaseModel):
    """Resultado de validación de vigencia."""
    vigente: bool
    dias_restantes: Optional[int] = None
    valido_hasta: Optional[str] = None
    message: str


class MessageResponse(BaseModel):
    message: str
    success: bool = True


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    """Obtiene la IP del cliente."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post(
    "/registrar",
    response_model=CertificadoRegistroResponse,
    status_code=201,
    summary="Registrar certificado e.firma",
)
async def registrar_certificado(
    request: Request,
    cer_file: UploadFile = File(..., description="Archivo .cer del certificado"),
    key_file: UploadFile = File(..., description="Archivo .key de la clave privada"),
    password: str = Form(..., description="Contraseña de la clave privada"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Registra un certificado e.firma (FIEL) en la bóveda cifrada.

    - Valida que .cer y .key sean pareja
    - Valida vigencia del certificado
    - Cifra la clave privada con AES-256-GCM
    - Almacena de forma segura en la base de datos
    - La contraseña NO se almacena nunca
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden registrar certificados.")

    cer_bytes = await cer_file.read()
    key_bytes = await key_file.read()

    if not cer_bytes or not key_bytes or not password:
        raise BusinessError("Debe proporcionar certificado (.cer), clave (.key) y contraseña.")

    ip = _get_client_ip(request)

    try:
        cert_record = await boveda_certificados_service.registrar_certificado(
            db,
            usuario_id=str(current_user.id),
            cer_bytes=cer_bytes,
            key_bytes=key_bytes,
            password=password,
            ip_origen=ip,
        )
    except ValueError as e:
        raise BusinessError(str(e))

    return CertificadoRegistroResponse(
        rfc=cert_record.rfc,
        nombre_titular=cert_record.nombre_titular,
        numero_serie=cert_record.numero_serie,
        valido_desde=cert_record.valido_desde.isoformat() if cert_record.valido_desde else None,
        valido_hasta=cert_record.valido_hasta.isoformat() if cert_record.valido_hasta else None,
        emisor=cert_record.emisor,
        message="Certificado e.firma registrado exitosamente. Cifrado con AES-256-GCM.",
    )


@router.get(
    "/mi-certificado",
    response_model=CertificadoInfoResponse,
    summary="Obtener info del certificado registrado",
)
async def obtener_mi_certificado(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Retorna metadata del certificado registrado (sin clave privada)."""
    cert = await boveda_certificados_service.obtener_certificado(
        db, str(current_user.id)
    )

    if not cert:
        return CertificadoInfoResponse(tiene_certificado=False)

    # Calcular vigencia (SQLite devuelve datetimes naive, usamos naive para comparar)
    now = datetime.utcnow()
    vigente = (
        cert.activo
        and (cert.valido_desde is None or cert.valido_desde <= now)
        and (cert.valido_hasta is None or cert.valido_hasta >= now)
    )

    return CertificadoInfoResponse(
        tiene_certificado=True,
        vigente=vigente,
        rfc=cert.rfc,
        nombre_titular=cert.nombre_titular,
        numero_serie=cert.numero_serie,
        valido_desde=cert.valido_desde.isoformat() if cert.valido_desde else None,
        valido_hasta=cert.valido_hasta.isoformat() if cert.valido_hasta else None,
        emisor=cert.emisor,
        activo=cert.activo,
        total_firmas=cert.total_firmas,
        registrado_en=cert.registrado_en.isoformat() if cert.registrado_en else None,
        ultima_firma_en=cert.ultima_firma_en.isoformat() if cert.ultima_firma_en else None,
    )


@router.post(
    "/validar-vigencia",
    response_model=VigenciaResponse,
    summary="Validar vigencia del certificado",
)
async def validar_vigencia(
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Verifica que el certificado registrado sigue vigente."""
    result = await boveda_certificados_service.validar_vigencia(
        db, str(current_user.id)
    )

    return VigenciaResponse(
        vigente=result["vigente"],
        dias_restantes=result.get("dias_restantes"),
        valido_hasta=result.get("valido_hasta"),
        message=result["message"],
    )


@router.delete(
    "/revocar",
    response_model=MessageResponse,
    summary="Revocar certificado registrado",
)
async def revocar_certificado(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Desactiva el certificado e.firma. Se puede registrar uno nuevo después."""
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden revocar certificados.")

    ip = _get_client_ip(request)
    ok = await boveda_certificados_service.revocar_certificado(
        db, usuario_id=str(current_user.id), ip_origen=ip,
    )

    if not ok:
        raise NotFoundError("No tiene certificado registrado para revocar.")

    return MessageResponse(
        message="Certificado revocado exitosamente.",
        success=True,
    )


@router.post(
    "/renovar",
    response_model=CertificadoRegistroResponse,
    summary="Renovar certificado e.firma",
)
async def renovar_certificado(
    request: Request,
    cer_file: UploadFile = File(..., description="Nuevo archivo .cer"),
    key_file: UploadFile = File(..., description="Nuevo archivo .key"),
    password: str = Form(..., description="Contraseña de la nueva clave privada"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Renueva el certificado e.firma con un nuevo par .cer/.key.
    Reemplaza el certificado anterior si existe.
    """
    if current_user.rol not in ("admin_cliente", "superadmin"):
        raise ForbiddenError("Solo admin o superadmin pueden renovar certificados.")

    cer_bytes = await cer_file.read()
    key_bytes = await key_file.read()
    ip = _get_client_ip(request)

    try:
        cert_record = await boveda_certificados_service.registrar_certificado(
            db,
            usuario_id=str(current_user.id),
            cer_bytes=cer_bytes,
            key_bytes=key_bytes,
            password=password,
            ip_origen=ip,
        )
    except ValueError as e:
        raise BusinessError(str(e))

    return CertificadoRegistroResponse(
        rfc=cert_record.rfc,
        nombre_titular=cert_record.nombre_titular,
        numero_serie=cert_record.numero_serie,
        valido_desde=cert_record.valido_desde.isoformat() if cert_record.valido_desde else None,
        valido_hasta=cert_record.valido_hasta.isoformat() if cert_record.valido_hasta else None,
        emisor=cert_record.emisor,
        message="Certificado renovado exitosamente.",
    )
