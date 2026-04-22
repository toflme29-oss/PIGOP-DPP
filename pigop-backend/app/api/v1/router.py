from fastapi import APIRouter

from app.api.v1.endpoints import auth, depps, usuarios, normativas, upps, sap, lotes, documentos, firma_lote, certificados, oficios, catalogo, permisos

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(depps.router, prefix="/depps", tags=["DEPPs"])
api_router.include_router(usuarios.router, prefix="/usuarios", tags=["Usuarios"])
api_router.include_router(normativas.router, prefix="/normativas", tags=["Normativas"])
api_router.include_router(upps.router, prefix="/upps", tags=["UPPs"])
api_router.include_router(sap.router, prefix="/sap", tags=["SAP Import"])
api_router.include_router(lotes.router, prefix="/lotes", tags=["Lotes de Revisión"])
api_router.include_router(documentos.router, prefix="/documentos", tags=["Gestión Documental"])
api_router.include_router(firma_lote.router, prefix="/firma-lote", tags=["Firma por Lote"])
api_router.include_router(certificados.router, prefix="/certificados", tags=["Certificados e.firma"])
api_router.include_router(oficios.router, prefix="/oficios", tags=["Control de Oficios"])
api_router.include_router(catalogo.router, tags=["Catálogo UPPs/Funcionarios"])
api_router.include_router(permisos.router, prefix="/permisos", tags=["Permisos RBAC"])
