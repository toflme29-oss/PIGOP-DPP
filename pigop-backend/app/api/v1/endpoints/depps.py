import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_active_user, get_current_admin
from app.core.database import get_db
from app.core.exceptions import BusinessError, ForbiddenError, NotFoundError
from app.crud.depp import crud_depp, crud_documento_depp
from app.models.user import Usuario
from app.schemas.common import MessageResponse
from app.schemas.depp import (
    DEPPCreate,
    DEPPListResponse,
    DEPPResponse,
    DEPPUpdate,
    DocumentoDEPPResponse,
    UploadResponse,
)
from app.services.clasificacion_service import clasificacion_service
from app.services.storage_service import get_storage_service, StorageService
from app.services.validation_service import get_validation_service
from app.services.ai_validation_service import get_ai_validation_service

router = APIRouter()

MIME_PERMITIDOS = {
    "application/pdf",
    "text/xml",
    "application/xml",
    "image/jpeg",
    "image/png",
    "image/tiff",
}
MAX_FILE_SIZE_MB = 20


def _assert_cliente_access(current_user: Usuario, cliente_id: str) -> None:
    if current_user.rol == "superadmin":
        return
    if str(current_user.cliente_id) != cliente_id:
        raise ForbiddenError("No tienes acceso a recursos de este cliente.")


# ── CRUD base ──────────────────────────────────────────────────────────────────

@router.post("/", response_model=DEPPResponse, status_code=201, summary="Crear DEPP")
async def crear_depp(
    data: DEPPCreate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Crea un nuevo DEPP (sin archivos). Adjunta documentos con /upload."""
    _assert_cliente_access(current_user, data.cliente_id)

    existente = await crud_depp.get_by_folio(
        db, data.folio, data.cliente_id, data.ejercicio
    )
    if existente:
        raise BusinessError(
            f"Ya existe un DEPP con folio '{data.folio}' para el ejercicio {data.ejercicio}."
        )

    depp = await crud_depp.create_depp(db, obj_in=data, creado_por_id=str(current_user.id))
    return await crud_depp.get_with_documents(db, depp.id)


@router.get("/", response_model=List[DEPPListResponse], summary="Listar DEPPs")
async def listar_depps(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    upp: Optional[str] = Query(None),
    ejercicio: Optional[int] = Query(None, ge=2020, le=2050),
    estado: Optional[str] = Query(None),
    cliente_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Lista DEPPs con filtros. Respeta aislamiento por cliente."""
    if current_user.rol == "superadmin":
        effective_cliente_id = cliente_id
    else:
        effective_cliente_id = str(current_user.cliente_id)

    if effective_cliente_id:
        return await crud_depp.get_multi_by_cliente(
            db, effective_cliente_id,
            skip=skip, limit=limit, upp=upp, ejercicio=ejercicio, estado=estado,
        )
    # superadmin sin filtro → ver todos
    from app.models.depp import DEPP
    filters = []
    if upp:
        filters.append(DEPP.upp == upp)
    if ejercicio:
        filters.append(DEPP.ejercicio == ejercicio)
    if estado:
        filters.append(DEPP.estado == estado)
    return await crud_depp.get_multi(db, skip=skip, limit=limit, filters=filters)


@router.get("/{depp_id}", response_model=DEPPResponse, summary="Obtener DEPP")
async def obtener_depp(
    depp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    depp = await crud_depp.get_with_documents(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    return depp


@router.put("/{depp_id}", response_model=DEPPResponse, summary="Actualizar DEPP")
async def actualizar_depp(
    depp_id: str,
    data: DEPPUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    depp = await crud_depp.get(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    if depp.estado not in ("en_tramite",):
        raise BusinessError(
            f"Solo se pueden editar DEPPs en estado 'En Trámite'. "
            f"Estado actual: '{depp.estado}'."
        )
    depp = await crud_depp.update_depp(db, db_obj=depp, obj_in=data)
    return await crud_depp.get_with_documents(db, depp.id)


@router.delete("/{depp_id}", response_model=MessageResponse, summary="Eliminar DEPP")
async def eliminar_depp(
    depp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Solo se pueden eliminar DEPPs en estado 'En Trámite' (recién ingresados)."""
    depp = await crud_depp.get(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    if depp.estado != "en_tramite":
        raise BusinessError(
            "Solo se pueden eliminar DEPPs en estado 'En Trámite'. "
            "Un DEPP en revisión, aprobado o rechazado no puede eliminarse."
        )
    await crud_depp.delete(db, id=depp_id)
    return MessageResponse(message="DEPP eliminado correctamente.")


@router.post("/{depp_id}/estado", response_model=DEPPResponse, summary="Cambiar estado")
async def cambiar_estado_depp(
    depp_id: str,
    nuevo_estado: str = Query(..., description="en_tramite|en_revision|aprobado|rechazado"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_admin),
):
    estados_validos = {"en_tramite", "en_revision", "aprobado", "rechazado"}
    if nuevo_estado not in estados_validos:
        raise BusinessError(f"Estado inválido. Opciones: {estados_validos}")
    depp = await crud_depp.get(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    depp = await crud_depp.cambiar_estado(db, db_obj=depp, nuevo_estado=nuevo_estado)
    return await crud_depp.get_with_documents(db, depp.id)


# ── Upload de documentos ───────────────────────────────────────────────────────

@router.post(
    "/{depp_id}/upload",
    response_model=UploadResponse,
    summary="Subir documentos al DEPP",
)
async def upload_documentos(
    depp_id: str,
    files: List[UploadFile] = File(..., description="Uno o más archivos (PDF, XML, imágenes)"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    storage: StorageService = Depends(get_storage_service),
):
    """
    Sube archivos al DEPP:
    - Valida tipo y tamaño de archivo
    - Clasifica automáticamente cada documento (CFDI, MCL, CTT, etc.)
    - Almacena en disco local (dev) o GCS (prod)
    - Detecta la clasificación normativa del expediente
    """
    depp = await crud_depp.get_with_documents(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)

    if depp.estado not in ("en_tramite", "en_revision"):
        raise BusinessError(
            f"No se pueden subir archivos a un DEPP en estado '{depp.estado}'. "
            "Solo se permite en estados 'En Trámite' o 'En Revisión'."
        )

    documentos_creados = []

    for file in files:
        # Validar MIME type
        if file.content_type not in MIME_PERMITIDOS:
            raise BusinessError(
                f"Tipo de archivo no permitido: {file.content_type}. "
                f"Permitidos: PDF, XML, JPEG, PNG, TIFF."
            )

        # Clasificar tipo de documento
        tipo_detectado = clasificacion_service.clasificar_tipo_documento(
            file.filename or "", file.content_type or ""
        )

        # Subir al storage
        blob_name = await storage.upload_file(
            file,
            folder="depps",
            subfolder=depp_id,
        )

        # Obtener URL de descarga
        url = await storage.get_file_url(blob_name)

        # Crear registro en BD
        doc = await crud_documento_depp.create(
            db,
            obj_in={
                "id": str(uuid.uuid4()),
                "depp_id": depp_id,
                "tipo": tipo_detectado,
                "nombre_archivo": file.filename or "sin_nombre",
                "url_storage": blob_name,
                "mime_type": file.content_type,
                "tamanio_bytes": None,   # se llena en Fase 3 con OCR
                "subido_por_id": str(current_user.id),
            },
        )
        documentos_creados.append(doc)

    # Refrescar DEPP con todos los documentos
    depp_actualizado = await crud_depp.get_with_documents(db, depp_id)

    # Detectar clasificación automática
    tipos_todos = [d.tipo for d in depp_actualizado.documentos]
    clasificacion, _ = clasificacion_service.determinar_clasificacion(
        tipos_todos, depp_actualizado.capitulo
    )

    # Actualizar clasificación en DEPP si se detectó y no tenía
    if clasificacion and not depp_actualizado.clasificador_tipo:
        depp_actualizado.clasificador_tipo = clasificacion
        db.add(depp_actualizado)
        await db.flush()

    return UploadResponse(
        depp_id=depp_id,
        documentos_subidos=len(documentos_creados),
        documentos=[DocumentoDEPPResponse.model_validate(d) for d in documentos_creados],
        clasificacion_detectada=clasificacion,
        mensaje=(
            f"Se subieron {len(documentos_creados)} archivo(s). "
            + (f"Clasificación detectada: {clasificacion}." if clasificacion else
               "No se pudo detectar clasificación aún.")
        ),
    )


@router.get(
    "/{depp_id}/documentos",
    response_model=List[DocumentoDEPPResponse],
    summary="Listar documentos del DEPP",
)
async def listar_documentos(
    depp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """Lista todos los documentos adjuntos al DEPP."""
    depp = await crud_depp.get(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    docs = await crud_documento_depp.get_by_depp(db, depp_id)
    return docs


@router.delete(
    "/{depp_id}/documentos/{doc_id}",
    response_model=MessageResponse,
    summary="Eliminar documento del DEPP",
)
async def eliminar_documento(
    depp_id: str,
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
    storage: StorageService = Depends(get_storage_service),
):
    """Elimina un documento del DEPP (solo si está en trámite o revisión)."""
    depp = await crud_depp.get(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)
    if depp.estado not in ("en_tramite", "en_revision"):
        raise BusinessError(
            f"No se pueden eliminar documentos de un DEPP en estado '{depp.estado}'."
        )

    doc = await crud_documento_depp.get(db, doc_id)
    if not doc or doc.depp_id != depp_id:
        raise NotFoundError("Documento")

    # Eliminar del storage
    if doc.url_storage:
        await storage.delete_file(doc.url_storage)

    await crud_documento_depp.delete(db, id=doc_id)
    return MessageResponse(message="Documento eliminado correctamente.")


# ── Validación ─────────────────────────────────────────────────────────────────

@router.post(
    "/{depp_id}/validar",
    response_model=DEPPResponse,
    summary="Ejecutar validación estructural del DEPP",
)
async def validar_depp(
    depp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Ejecuta el pipeline de validación estructural (Fase 2):
    1. Valida campos obligatorios
    2. Valida documentos según clasificación normativa
    3. Valida coherencia de datos
    4. Confirma o detecta clasificación automática

    Actualiza el estado del DEPP a 'aprobado' o 'observado'
    según los resultados. Los errores críticos bloquean la aprobación.
    """
    depp = await crud_depp.get_with_documents(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)

    if depp.estado == "aprobado":
        raise BusinessError("El DEPP ya está aprobado. No requiere revalidación.")
    if depp.estado == "rechazado":
        # Permitir revalidar rechazados (el área ejecutora corrigió el expediente)
        pass

    # Transicionar a En Revisión mientras se ejecuta el pipeline
    depp.estado = "en_revision"
    db.add(depp)
    await db.flush()

    # Ejecutar pipeline de validación
    validation_svc = get_validation_service(db)
    await validation_svc.validar_depp_completo(depp)

    # Expirar el DEPP del identity map para forzar re-carga con las nuevas validaciones
    await db.flush()
    db.expire(depp)

    # Retornar DEPP actualizado con validaciones
    return await crud_depp.get_with_documents(db, depp_id)


# ── Validación IA (Fase 3) ─────────────────────────────────────────────────────

@router.post(
    "/{depp_id}/validar-ia",
    response_model=DEPPResponse,
    summary="Validación inteligente con Gemini IA",
    tags=["depps"],
)
async def validar_depp_ia(
    depp_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_active_user),
):
    """
    Ejecuta el motor de validación inteligente (Fase 3) sobre el expediente DEPP.

    Pipeline IA:
    1. Descarga cada documento adjunto desde storage
    2. Extrae texto (pypdf para PDFs nativos, Gemini Vision para escaneados, directo para XML)
    3. Extrae datos estructurados de cada documento con Gemini
    4. Analiza la consistencia entre todos los documentos (RFC, montos, fechas, contrato)
    5. Genera hallazgos individuales y un resumen del expediente

    Requiere que **GEMINI_API_KEY** esté configurada en `.env`.
    Sin clave, retorna advertencia indicando que la validación IA no está disponible.

    > **Nota**: La validación IA se *suma* a las validaciones estructurales de `/validar`.
    > Se recomienda ejecutar primero `/validar` y luego `/validar-ia`.
    """
    depp = await crud_depp.get_with_documents(db, depp_id)
    if not depp:
        raise NotFoundError("DEPP")
    _assert_cliente_access(current_user, depp.cliente_id)

    if depp.estado == "aprobado":
        raise BusinessError("El DEPP ya está aprobado. No requiere revalidación IA.")

    # Ejecutar pipeline IA
    ai_svc = get_ai_validation_service(db)
    await ai_svc.validar_con_ia(depp, usuario_id=str(current_user.id))

    # Flush + expire el DEPP del identity map para forzar re-carga desde BD.
    # Es necesario porque las nuevas ValidacionDEPP se flushearon durante el
    # pipeline IA pero el objeto cacheado en la sesión aún tiene la lista vacía.
    await db.flush()
    db.expire(depp)

    # Retornar DEPP con todas las validaciones (estructurales + IA)
    return await crud_depp.get_with_documents(db, depp_id)
