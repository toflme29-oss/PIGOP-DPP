"""
Servicio de almacenamiento de archivos.

Modo LOCAL (desarrollo): guarda en ./uploads/<folder>/<uuid>.<ext>
Modo GCS   (producción): sube a Google Cloud Storage.

Cambiar entre modos con la variable de entorno:
  STORAGE_BACKEND=local   (default)
  STORAGE_BACKEND=gcs     (requiere GOOGLE_APPLICATION_CREDENTIALS)
"""
import os
import uuid
import shutil
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from app.core.config import settings

# Directorio raíz de uploads locales (relativo al backend)
UPLOADS_ROOT = Path(__file__).parent.parent.parent / "uploads"
UPLOADS_ROOT.mkdir(exist_ok=True)

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")


class StorageService:
    """
    Servicio de almacenamiento unificado.
    En desarrollo usa disco local; en producción GCS.
    """

    # ── API pública ────────────────────────────────────────────────────────────

    async def upload_file(
        self,
        file: UploadFile,
        folder: str,                   # "depps", "oficios", "certificaciones"
        subfolder: Optional[str] = None,
    ) -> str:
        """
        Sube un archivo y retorna su path/blob_name.
        El path sirve tanto para almacenamiento local como para GCS.
        """
        if STORAGE_BACKEND == "gcs":
            return await self._upload_gcs(file, folder, subfolder)
        return await self._upload_local(file, folder, subfolder)

    async def get_file_url(self, blob_name: str, expiry_hours: int = 24) -> str:
        """Retorna URL de descarga (local o firmada en GCS)."""
        if STORAGE_BACKEND == "gcs":
            return await self._signed_url_gcs(blob_name, expiry_hours)
        return self._local_url(blob_name)

    async def get_file_bytes(self, blob_name: str) -> bytes:
        """Descarga el archivo y retorna sus bytes (para OCR/procesamiento)."""
        if STORAGE_BACKEND == "gcs":
            return await self._download_gcs(blob_name)
        return self._read_local(blob_name)

    async def delete_file(self, blob_name: str) -> bool:
        """Elimina el archivo."""
        if STORAGE_BACKEND == "gcs":
            return await self._delete_gcs(blob_name)
        return self._delete_local(blob_name)

    # ── Implementación LOCAL ───────────────────────────────────────────────────

    async def _upload_local(
        self, file: UploadFile, folder: str, subfolder: Optional[str]
    ) -> str:
        file_id = str(uuid.uuid4())
        ext = ""
        if file.filename and "." in file.filename:
            ext = "." + file.filename.rsplit(".", 1)[-1].lower()

        if subfolder:
            dest_dir = UPLOADS_ROOT / folder / subfolder
        else:
            dest_dir = UPLOADS_ROOT / folder

        dest_dir.mkdir(parents=True, exist_ok=True)

        blob_name = f"{folder}/{subfolder}/{file_id}{ext}" if subfolder else f"{folder}/{file_id}{ext}"
        dest_path = UPLOADS_ROOT / blob_name

        content = await file.read()
        dest_path.write_bytes(content)

        return blob_name

    def _local_url(self, blob_name: str) -> str:
        """URL de descarga local — el endpoint /files/<path> la sirve."""
        return f"http://localhost:8000/files/{blob_name}"

    def _read_local(self, blob_name: str) -> bytes:
        path = UPLOADS_ROOT / blob_name
        if not path.exists():
            raise FileNotFoundError(f"Archivo no encontrado: {blob_name}")
        return path.read_bytes()

    def _delete_local(self, blob_name: str) -> bool:
        path = UPLOADS_ROOT / blob_name
        if path.exists():
            path.unlink()
            return True
        return False

    # ── Implementación GCS ─────────────────────────────────────────────────────

    async def _upload_gcs(
        self, file: UploadFile, folder: str, subfolder: Optional[str]
    ) -> str:
        """Upload real a Google Cloud Storage."""
        try:
            from google.cloud import storage as gcs
            client = gcs.Client(project=settings.GCS_PROJECT_ID)
            bucket = client.bucket(settings.GCS_BUCKET)

            file_id = str(uuid.uuid4())
            ext = ""
            if file.filename and "." in file.filename:
                ext = "." + file.filename.rsplit(".", 1)[-1].lower()

            blob_name = (
                f"{folder}/{subfolder}/{file_id}{ext}"
                if subfolder
                else f"{folder}/{file_id}{ext}"
            )

            blob = bucket.blob(blob_name)
            content = await file.read()
            blob.upload_from_string(
                content,
                content_type=file.content_type or "application/octet-stream",
            )
            blob.metadata = {"original_filename": file.filename}
            blob.patch()
            return blob_name
        except ImportError:
            raise RuntimeError(
                "google-cloud-storage no instalado. "
                "Ejecuta: pip install google-cloud-storage"
            )

    async def _signed_url_gcs(self, blob_name: str, expiry_hours: int) -> str:
        from datetime import timedelta
        from google.cloud import storage as gcs
        client = gcs.Client(project=settings.GCS_PROJECT_ID)
        blob = client.bucket(settings.GCS_BUCKET).blob(blob_name)
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(hours=expiry_hours),
            method="GET",
        )

    async def _download_gcs(self, blob_name: str) -> bytes:
        from google.cloud import storage as gcs
        client = gcs.Client(project=settings.GCS_PROJECT_ID)
        return client.bucket(settings.GCS_BUCKET).blob(blob_name).download_as_bytes()

    async def _delete_gcs(self, blob_name: str) -> bool:
        try:
            from google.cloud import storage as gcs
            client = gcs.Client(project=settings.GCS_PROJECT_ID)
            client.bucket(settings.GCS_BUCKET).blob(blob_name).delete()
            return True
        except Exception:
            return False


# Instancia singleton
storage_service = StorageService()


def get_storage_service() -> StorageService:
    return storage_service
