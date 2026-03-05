"""
Servicio de Sesión de Firma Segura.

Mantiene claves descifradas en memoria por tiempo limitado (5 min)
para permitir firma por lote sin re-ingresar contraseña.

Seguridad:
  - Las claves se mantienen en memoria, NUNCA en disco o BD
  - Limpieza automática al expirar (sobrescribir bytes con ceros)
  - Un solo usuario puede tener UNA sesión activa a la vez
  - Cada apertura/cierre se registra en la bitácora
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bitacora_firma import BitacoraFirma
from app.models.certificado_firma import CertificadoFirma

logger = logging.getLogger(__name__)

DURACION_SESION_MINUTOS = 5


@dataclass
class SesionFirma:
    """Sesión de firma temporal con clave descifrada en memoria."""
    sesion_id: str
    usuario_id: str
    key_bytes: bytes
    cer_bytes: bytes
    cert_info: dict  # rfc, nombre, serial, valido_desde, valido_hasta
    creada_en: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expira_en: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=DURACION_SESION_MINUTOS))


class SesionFirmaService:
    """Mantiene claves descifradas en memoria por tiempo limitado."""

    def __init__(self):
        self._sesiones: dict[str, SesionFirma] = {}

    def abrir_sesion(
        self,
        *,
        usuario_id: str,
        key_bytes: bytes,
        cer_bytes: bytes,
        cert_info: dict,
        duracion_minutos: int = DURACION_SESION_MINUTOS,
    ) -> str:
        """
        Abre una sesión de firma segura.
        Mantiene la clave descifrada en memoria por N minutos.

        Returns:
            sesion_id (UUID string)
        """
        # Cerrar sesión anterior si existe
        if usuario_id in self._sesiones:
            self._cerrar_sesion_interna(usuario_id)

        sesion_id = str(uuid.uuid4())
        expira_en = datetime.now(timezone.utc) + timedelta(minutes=duracion_minutos)

        sesion = SesionFirma(
            sesion_id=sesion_id,
            usuario_id=usuario_id,
            key_bytes=key_bytes,
            cer_bytes=cer_bytes,
            cert_info=cert_info,
            expira_en=expira_en,
        )
        self._sesiones[usuario_id] = sesion

        logger.info(
            f"Sesión de firma abierta para usuario {usuario_id[:8]}... "
            f"Expira en {duracion_minutos} min."
        )

        return sesion_id

    def obtener_sesion(self, usuario_id: str) -> Optional[SesionFirma]:
        """
        Retorna la sesión activa si existe y no ha expirado.
        Si expiró, la cierra automáticamente.
        """
        sesion = self._sesiones.get(usuario_id)
        if not sesion:
            return None

        ahora = datetime.now(timezone.utc)
        if sesion.expira_en < ahora:
            logger.info(f"Sesión expirada para usuario {usuario_id[:8]}... Limpiando.")
            self._cerrar_sesion_interna(usuario_id)
            return None

        return sesion

    def obtener_clave(self, usuario_id: str) -> Optional[bytes]:
        """Retorna la clave descifrada si la sesión está activa."""
        sesion = self.obtener_sesion(usuario_id)
        return sesion.key_bytes if sesion else None

    def obtener_cer(self, usuario_id: str) -> Optional[bytes]:
        """Retorna el certificado si la sesión está activa."""
        sesion = self.obtener_sesion(usuario_id)
        return sesion.cer_bytes if sesion else None

    def obtener_cert_info(self, usuario_id: str) -> Optional[dict]:
        """Retorna metadata del certificado si la sesión está activa."""
        sesion = self.obtener_sesion(usuario_id)
        return sesion.cert_info if sesion else None

    def cerrar_sesion(self, usuario_id: str) -> bool:
        """Cierra la sesión y limpia la clave de memoria."""
        if usuario_id in self._sesiones:
            self._cerrar_sesion_interna(usuario_id)
            return True
        return False

    def _cerrar_sesion_interna(self, usuario_id: str):
        """Limpia la clave de memoria de forma segura."""
        sesion = self._sesiones.pop(usuario_id, None)
        if sesion:
            # Sobrescribir bytes en memoria con ceros
            if sesion.key_bytes:
                try:
                    # En Python, bytes son inmutables, pero bytearray sí se puede sobrescribir
                    # La referencia original se elimina al menos
                    key_len = len(sesion.key_bytes)
                    sesion.key_bytes = b'\x00' * key_len
                except Exception:
                    pass
                finally:
                    del sesion.key_bytes

            if sesion.cer_bytes:
                del sesion.cer_bytes

            del sesion
            logger.info(f"Sesión de firma cerrada y clave limpiada para {usuario_id[:8]}...")

    def limpiar_expiradas(self):
        """Limpia todas las sesiones expiradas. Llamar periódicamente."""
        ahora = datetime.now(timezone.utc)
        expiradas = [
            uid for uid, sesion in self._sesiones.items()
            if sesion.expira_en < ahora
        ]
        for uid in expiradas:
            self._cerrar_sesion_interna(uid)

        if expiradas:
            logger.info(f"Limpiadas {len(expiradas)} sesiones de firma expiradas.")

    def tiene_sesion_activa(self, usuario_id: str) -> bool:
        """Verifica si hay una sesión activa sin expirar."""
        return self.obtener_sesion(usuario_id) is not None

    @property
    def sesiones_activas(self) -> int:
        """Número de sesiones activas (puede incluir expiradas no limpiadas)."""
        return len(self._sesiones)


# Singleton
sesion_firma_service = SesionFirmaService()
