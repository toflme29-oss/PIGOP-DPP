"""
Servicio de Bóveda de Certificados e.firma.

Gestiona el almacenamiento cifrado de certificados (.cer) y claves privadas (.key)
usando AES-256-GCM con una clave maestra del sistema.

Seguridad:
  - La clave privada se cifra con AES-256-GCM antes de almacenarse
  - La clave maestra se lee de la variable de entorno PIGOP_MASTER_KEY
  - La contraseña del usuario NUNCA se almacena
  - Cada operación se registra en la bitácora de firma

Dependencias:
  - cryptography>=42.0
"""
import base64
import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.x509 import load_der_x509_certificate
from cryptography import x509

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.certificado_firma import CertificadoFirma
from app.models.bitacora_firma import BitacoraFirma

logger = logging.getLogger(__name__)


def _get_master_key() -> bytes:
    """
    Obtiene la clave maestra del sistema (32 bytes para AES-256).
    Se lee de PIGOP_MASTER_KEY como hex string (64 chars).
    Si no existe, genera una determinista desde SECRET_KEY (dev only).
    """
    master_hex = os.environ.get("PIGOP_MASTER_KEY")
    if master_hex:
        key = bytes.fromhex(master_hex)
        if len(key) != 32:
            raise ValueError("PIGOP_MASTER_KEY debe ser 32 bytes (64 hex chars)")
        return key

    # Fallback para desarrollo: derivar de SECRET_KEY
    secret = os.environ.get("SECRET_KEY", "dev-secret-key-pigop-2026")
    return hashlib.sha256(secret.encode()).digest()


def _encrypt_aes256gcm(plaintext: bytes) -> tuple[bytes, bytes, bytes]:
    """
    Cifra datos con AES-256-GCM.

    Returns:
        (ciphertext, iv, tag) — todos como bytes
    """
    key = _get_master_key()
    aesgcm = AESGCM(key)
    iv = os.urandom(12)  # 96-bit nonce recomendado para GCM
    ciphertext = aesgcm.encrypt(iv, plaintext, None)
    # En AESGCM de cryptography, el tag se concatena al final del ciphertext
    # Los últimos 16 bytes son el tag
    ct = ciphertext[:-16]
    tag = ciphertext[-16:]
    return ct, iv, tag


def _decrypt_aes256gcm(ciphertext: bytes, iv: bytes, tag: bytes) -> bytes:
    """
    Descifra datos con AES-256-GCM.

    Returns:
        plaintext bytes
    """
    key = _get_master_key()
    aesgcm = AESGCM(key)
    # Reconstituir ciphertext + tag
    ct_with_tag = ciphertext + tag
    return aesgcm.decrypt(iv, ct_with_tag, None)


def _parse_cer(cer_bytes: bytes) -> dict:
    """
    Parsea un certificado X.509 del SAT (.cer en formato DER).

    Returns:
        dict con: rfc, nombre, serial, valido_desde, valido_hasta, emisor
    """
    try:
        cert = load_der_x509_certificate(cer_bytes)
    except Exception:
        # Intentar como PEM
        try:
            cert = x509.load_pem_x509_certificate(cer_bytes)
        except Exception as e:
            raise ValueError(f"No se pudo parsear el certificado: {e}")

    # Extraer datos del Subject
    subject = cert.subject
    nombre_parts = []
    rfc = ""

    for attr in subject:
        oid_name = attr.oid.dotted_string
        value = attr.value

        # RFC: OID 2.5.4.45 (uniqueIdentifier) o en serialNumber
        if oid_name == "2.5.4.45" or attr.oid == x509.oid.NameOID.SERIAL_NUMBER:
            # El RFC del SAT viene en uniqueIdentifier o serialNumber
            # Formato: "FOMM850101ABC / HEGT7610034S2"
            rfc_candidate = value.strip().split("/")[0].strip()
            if len(rfc_candidate) >= 12:
                rfc = rfc_candidate

        # Nombre: CN (Common Name)
        if attr.oid == x509.oid.NameOID.COMMON_NAME:
            nombre_parts.append(value)

        # Nombre alternativo en organizationName
        if attr.oid == x509.oid.NameOID.ORGANIZATION_NAME:
            nombre_parts.append(value)

    # Si no se encontró RFC en los OIDs típicos, buscar en todos los atributos
    if not rfc:
        for attr in subject:
            val = str(attr.value).strip()
            # Patrón RFC: 4 letras + 6 dígitos + 3 alfanum
            if len(val) >= 12 and len(val) <= 13:
                rfc = val
                break

    # Si aún no hay RFC, usar serialNumber del subject
    if not rfc:
        try:
            sn = subject.get_attributes_for_oid(x509.oid.NameOID.SERIAL_NUMBER)
            if sn:
                rfc = sn[0].value.strip().split("/")[0].strip()
        except Exception:
            pass

    # Emisor
    issuer_parts = []
    for attr in cert.issuer:
        if attr.oid == x509.oid.NameOID.ORGANIZATION_NAME:
            issuer_parts.append(attr.value)
        elif attr.oid == x509.oid.NameOID.COMMON_NAME:
            issuer_parts.append(attr.value)

    nombre = " | ".join(nombre_parts) if nombre_parts else "TITULAR NO IDENTIFICADO"

    return {
        "rfc": rfc or "RFC_NO_ENCONTRADO",
        "nombre": nombre,
        "serial": str(cert.serial_number),
        "valido_desde": cert.not_valid_before_utc,
        "valido_hasta": cert.not_valid_after_utc,
        "emisor": " | ".join(issuer_parts) if issuer_parts else "EMISOR NO IDENTIFICADO",
    }


def _validate_key_password(key_bytes: bytes, password: str) -> bytes:
    """
    Valida la contraseña contra la clave privada (.key en formato DER PKCS#8).

    Returns:
        private_key_bytes descifrados (DER sin contraseña) si es válida.

    Raises:
        ValueError si la contraseña es incorrecta o el formato no es válido.
    """
    pwd_bytes = password.encode("utf-8")

    try:
        # Intentar como DER (formato .key del SAT)
        from cryptography.hazmat.primitives.serialization import load_der_private_key
        private_key = load_der_private_key(key_bytes, password=pwd_bytes)
    except Exception:
        try:
            # Intentar como PEM
            from cryptography.hazmat.primitives.serialization import load_pem_private_key
            private_key = load_pem_private_key(key_bytes, password=pwd_bytes)
        except Exception as e:
            raise ValueError(
                "Contraseña incorrecta o formato de clave privada no válido. "
                f"Detalle: {str(e)[:100]}"
            )

    # Verificar que la clave cargó correctamente retornando los bytes originales
    return key_bytes


def _verify_cer_key_match(cer_bytes: bytes, key_bytes: bytes, password: str) -> bool:
    """Verifica que .cer y .key sean pareja (misma clave pública)."""
    from cryptography.hazmat.primitives.serialization import (
        load_der_private_key,
        load_pem_private_key,
    )

    # Cargar certificado
    try:
        cert = load_der_x509_certificate(cer_bytes)
    except Exception:
        cert = x509.load_pem_x509_certificate(cer_bytes)

    pub_from_cer = cert.public_key()

    # Cargar clave privada
    pwd_bytes = password.encode("utf-8")
    try:
        priv_key = load_der_private_key(key_bytes, password=pwd_bytes)
    except Exception:
        priv_key = load_pem_private_key(key_bytes, password=pwd_bytes)

    pub_from_key = priv_key.public_key()

    # Comparar claves públicas serializadas
    from cryptography.hazmat.primitives.serialization import (
        Encoding as Enc,
        PublicFormat,
    )

    cer_pub_bytes = pub_from_cer.public_bytes(Enc.DER, PublicFormat.SubjectPublicKeyInfo)
    key_pub_bytes = pub_from_key.public_bytes(Enc.DER, PublicFormat.SubjectPublicKeyInfo)

    return cer_pub_bytes == key_pub_bytes


class BovedaCertificadosService:
    """Servicio de bóveda cifrada para certificados e.firma."""

    # ── Registrar certificado ────────────────────────────────────────────────

    async def registrar_certificado(
        self,
        db: AsyncSession,
        *,
        usuario_id: str,
        cer_bytes: bytes,
        key_bytes: bytes,
        password: str,
        ip_origen: str = "",
    ) -> CertificadoFirma:
        """
        Registra un certificado e.firma en la bóveda.

        1. Valida que .cer y .key sean pareja
        2. Valida vigencia del certificado
        3. Extrae metadata (RFC, nombre, serial, vigencia, emisor)
        4. Cifra key_bytes con AES-256-GCM
        5. Guarda en DB
        6. Registra en bitácora
        """
        # 1. Validar contraseña contra clave privada
        try:
            _validate_key_password(key_bytes, password)
        except ValueError as e:
            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="registro_certificado",
                exitoso=False, detalle=str(e), ip_origen=ip_origen,
            )
            raise

        # 2. Parsear certificado
        cert_info = _parse_cer(cer_bytes)

        # 3. Verificar que .cer y .key sean pareja
        if not _verify_cer_key_match(cer_bytes, key_bytes, password):
            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="registro_certificado",
                exitoso=False,
                detalle="El certificado (.cer) y la clave privada (.key) no son pareja.",
                rfc=cert_info["rfc"], serial=cert_info["serial"], ip_origen=ip_origen,
            )
            raise ValueError(
                "El certificado (.cer) y la clave privada (.key) no corresponden entre sí."
            )

        # 4. Validar vigencia
        ahora = datetime.now(timezone.utc)
        if cert_info["valido_hasta"] and cert_info["valido_hasta"] < ahora:
            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="registro_certificado",
                exitoso=False,
                detalle=f"Certificado expirado: {cert_info['valido_hasta']}",
                rfc=cert_info["rfc"], serial=cert_info["serial"], ip_origen=ip_origen,
            )
            raise ValueError(
                f"El certificado expiró el {cert_info['valido_hasta'].strftime('%d/%m/%Y')}. "
                "Renueve su e.firma en el portal del SAT."
            )

        # 5. Cifrar clave privada con AES-256-GCM
        ct, iv, tag = _encrypt_aes256gcm(key_bytes)

        # 6. Verificar si ya existe un certificado para este usuario → reemplazar
        existing = await db.execute(
            select(CertificadoFirma).where(
                CertificadoFirma.usuario_id == usuario_id
            )
        )
        old_cert = existing.scalar_one_or_none()
        if old_cert:
            # Actualizar en lugar de crear nuevo
            old_cert.cer_data = base64.b64encode(cer_bytes).decode("ascii")
            old_cert.key_data_cifrada = base64.b64encode(ct).decode("ascii")
            old_cert.key_iv = iv.hex()
            old_cert.key_tag = tag.hex()
            old_cert.rfc = cert_info["rfc"]
            old_cert.nombre_titular = cert_info["nombre"]
            old_cert.numero_serie = cert_info["serial"]
            old_cert.valido_desde = cert_info["valido_desde"]
            old_cert.valido_hasta = cert_info["valido_hasta"]
            old_cert.emisor = cert_info["emisor"]
            old_cert.activo = True
            old_cert.registrado_en = ahora
            old_cert.total_firmas = 0

            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="certificado_renovado",
                exitoso=True,
                detalle=f"Certificado renovado: {cert_info['rfc']} serial {cert_info['serial']}",
                rfc=cert_info["rfc"], serial=cert_info["serial"], ip_origen=ip_origen,
            )
            await db.commit()
            return old_cert

        # 7. Crear nuevo registro
        cert_record = CertificadoFirma(
            id=str(uuid.uuid4()),
            usuario_id=usuario_id,
            cer_data=base64.b64encode(cer_bytes).decode("ascii"),
            key_data_cifrada=base64.b64encode(ct).decode("ascii"),
            key_iv=iv.hex(),
            key_tag=tag.hex(),
            rfc=cert_info["rfc"],
            nombre_titular=cert_info["nombre"],
            numero_serie=cert_info["serial"],
            valido_desde=cert_info["valido_desde"],
            valido_hasta=cert_info["valido_hasta"],
            emisor=cert_info["emisor"],
            activo=True,
        )
        db.add(cert_record)

        await self._registrar_bitacora(
            db, usuario_id=usuario_id, accion="registro_certificado",
            exitoso=True,
            detalle=f"Certificado registrado: {cert_info['rfc']} serial {cert_info['serial']}",
            rfc=cert_info["rfc"], serial=cert_info["serial"], ip_origen=ip_origen,
        )

        await db.commit()
        return cert_record

    # ── Obtener metadata del certificado ─────────────────────────────────────

    async def obtener_certificado(
        self, db: AsyncSession, usuario_id: str
    ) -> Optional[CertificadoFirma]:
        """Retorna metadata del certificado (sin clave privada)."""
        result = await db.execute(
            select(CertificadoFirma).where(
                CertificadoFirma.usuario_id == usuario_id,
                CertificadoFirma.activo == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    # ── Descifrar clave privada ──────────────────────────────────────────────

    async def descifrar_clave_privada(
        self,
        db: AsyncSession,
        *,
        usuario_id: str,
        password: str,
        ip_origen: str = "",
    ) -> tuple[bytes, bytes, CertificadoFirma]:
        """
        Descifra la clave privada almacenada y valida la contraseña.

        Returns:
            (key_bytes, cer_bytes, cert_record)
            El caller es responsable de limpiar key_bytes después de usarlos.

        Raises:
            ValueError si no hay certificado o la contraseña es incorrecta.
        """
        cert = await self.obtener_certificado(db, usuario_id)
        if not cert:
            raise ValueError("No tiene certificado e.firma registrado.")

        # Descifrar con AES-256-GCM
        try:
            ct = base64.b64decode(cert.key_data_cifrada)
            iv = bytes.fromhex(cert.key_iv)
            tag = bytes.fromhex(cert.key_tag)
            key_bytes = _decrypt_aes256gcm(ct, iv, tag)
        except Exception as e:
            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="error_password",
                exitoso=False, detalle=f"Error al descifrar clave: {str(e)[:100]}",
                rfc=cert.rfc, serial=cert.numero_serie, ip_origen=ip_origen,
            )
            await db.commit()
            raise ValueError("Error al descifrar la clave privada del sistema.")

        # Validar contraseña contra la clave descifrada
        try:
            _validate_key_password(key_bytes, password)
        except ValueError as e:
            await self._registrar_bitacora(
                db, usuario_id=usuario_id, accion="error_password",
                exitoso=False, detalle="Contraseña incorrecta",
                rfc=cert.rfc, serial=cert.numero_serie, ip_origen=ip_origen,
            )
            await db.commit()
            raise ValueError("Contraseña de la clave privada incorrecta.")

        cer_bytes = base64.b64decode(cert.cer_data)

        return key_bytes, cer_bytes, cert

    # ── Validar vigencia ─────────────────────────────────────────────────────

    async def validar_vigencia(
        self, db: AsyncSession, usuario_id: str
    ) -> dict:
        """Verifica que el certificado sigue vigente."""
        cert = await self.obtener_certificado(db, usuario_id)
        if not cert:
            return {"vigente": False, "message": "No hay certificado registrado."}

        ahora = datetime.now(timezone.utc)
        if cert.valido_hasta and cert.valido_hasta < ahora:
            return {
                "vigente": False,
                "message": f"Certificado expirado el {cert.valido_hasta.strftime('%d/%m/%Y')}.",
                "valido_hasta": cert.valido_hasta.isoformat(),
            }

        dias_restantes = (cert.valido_hasta - ahora).days if cert.valido_hasta else 999
        return {
            "vigente": True,
            "dias_restantes": dias_restantes,
            "valido_hasta": cert.valido_hasta.isoformat() if cert.valido_hasta else None,
            "message": f"Certificado vigente. {dias_restantes} días restantes.",
        }

    # ── Revocar certificado ──────────────────────────────────────────────────

    async def revocar_certificado(
        self,
        db: AsyncSession,
        *,
        usuario_id: str,
        ip_origen: str = "",
    ) -> bool:
        """Desactiva el certificado del usuario."""
        cert = await self.obtener_certificado(db, usuario_id)
        if not cert:
            return False

        cert.activo = False
        await self._registrar_bitacora(
            db, usuario_id=usuario_id, accion="certificado_revocado",
            exitoso=True,
            detalle=f"Certificado revocado: {cert.rfc} serial {cert.numero_serie}",
            rfc=cert.rfc, serial=cert.numero_serie, ip_origen=ip_origen,
        )
        await db.commit()
        return True

    # ── Actualizar contador de firmas ────────────────────────────────────────

    async def incrementar_firmas(
        self, db: AsyncSession, usuario_id: str
    ):
        """Incrementa el contador de firmas y actualiza última firma."""
        await db.execute(
            update(CertificadoFirma)
            .where(CertificadoFirma.usuario_id == usuario_id)
            .values(
                total_firmas=CertificadoFirma.total_firmas + 1,
                ultima_firma_en=datetime.now(timezone.utc),
            )
        )

    # ── Bitácora interna ─────────────────────────────────────────────────────

    async def _registrar_bitacora(
        self,
        db: AsyncSession,
        *,
        usuario_id: str,
        accion: str,
        exitoso: bool = True,
        detalle: str = "",
        documento_id: str = None,
        lote_firma_id: str = None,
        rfc: str = None,
        serial: str = None,
        hash_doc: str = None,
        ip_origen: str = "",
    ):
        """Registra una entrada en la bitácora de firma."""
        entry = BitacoraFirma(
            id=str(uuid.uuid4()),
            usuario_id=usuario_id,
            accion=accion,
            documento_id=documento_id,
            lote_firma_id=lote_firma_id,
            rfc_certificado=rfc,
            numero_serie=serial,
            hash_documento=hash_doc,
            ip_origen=ip_origen,
            exitoso=exitoso,
            detalle=detalle,
        )
        db.add(entry)


# Singleton
boveda_certificados_service = BovedaCertificadosService()
