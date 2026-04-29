import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.getcwd())
from app.core.database import AsyncSessionLocal
from app.models.user import Usuario
from app.models.documento import DocumentoOficial, HistorialDocumento
from app.crud.documento import crud_documento

async def simulate_vobo():
    user_id = "b4af9d5a-2fb5-49ed-9421-9d4ce0df49ac"
    doc_id = "606e004a-5e8d-4214-886b-4c0ad7875ca4"
    
    async with AsyncSessionLocal() as db:
        user = await db.get(Usuario, user_id)
        doc = await db.get(DocumentoOficial, doc_id)
        
        if not user or not doc:
            print(f"Error: User({user_id}) or Doc({doc_id}) not found")
            return

        print(f"User: {user.email}, Role: {user.rol}")
        print(f"Doc Status: {doc.estado}")
        
        # Logic from registrar_visto_bueno
        if user.rol not in ("subdirector", "admin_cliente", "superadmin"):
            print("ERROR: Unauthorized role")
            return

        try:
            to_upd = {"visto_bueno_subdirector": True}
            if hasattr(doc, 'visto_bueno_subdirector_id'):
                to_upd["visto_bueno_subdirector_id"] = str(user.id)
            if hasattr(doc, 'visto_bueno_subdirector_en'):
                to_upd["visto_bueno_subdirector_en"] = datetime.now(timezone.utc)
                
            print(f"Updating with: {to_upd}")
            await crud_documento.update(db, db_obj=doc, obj_in=to_upd)

            historial = HistorialDocumento(
                documento_id=doc.id,
                usuario_id=str(user.id),
                tipo_accion="visto_bueno",
                estado_anterior=doc.estado,
                estado_nuevo=doc.estado,
                observaciones=f"Visto Bueno registrado por {user.nombre_completo or user.email}",
                version=doc.version or 1,
            )
            db.add(historial)
            await db.commit()
            print("SUCCESS: Visto Bueno registered")
        except Exception as e:
            await db.rollback()
            print(f"FAILED: {str(e)}")

if __name__ == "__main__":
    asyncio.run(simulate_vobo())
