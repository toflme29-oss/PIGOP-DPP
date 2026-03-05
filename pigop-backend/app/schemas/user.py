from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ── Cliente (UPP / Dependencia) ───────────────────────────────────────────────

class ClienteBase(BaseModel):
    codigo_upp: str = Field(..., max_length=10, description="Código UPP, ej: '001', 'A01'")
    nombre: str = Field(..., max_length=255)
    tipo: Optional[str] = Field(None, description="centralizada | paraestatal | autonoma | poder")
    activo: bool = True


class ClienteCreate(ClienteBase):
    pass


class ClienteUpdate(BaseModel):
    nombre: Optional[str] = None
    tipo: Optional[str] = None
    activo: Optional[bool] = None
    configuracion: Optional[dict] = None


class ClienteResponse(ClienteBase):
    id: UUID
    configuracion: dict
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Usuario ───────────────────────────────────────────────────────────────────

class UsuarioBase(BaseModel):
    email: EmailStr
    nombre_completo: Optional[str] = None
    rol: str = Field(
        default="analista",
        description="superadmin | admin_cliente | analista | consulta",
    )
    activo: bool = True


class UsuarioCreate(UsuarioBase):
    password: str = Field(..., min_length=8)
    cliente_id: Optional[UUID] = None


class UsuarioUpdate(BaseModel):
    nombre_completo: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[bool] = None
    cliente_id: Optional[UUID] = None


class UsuarioResponse(UsuarioBase):
    id: UUID
    cliente_id: Optional[UUID] = None
    ultimo_acceso: Optional[datetime] = None
    creado_en: datetime

    model_config = ConfigDict(from_attributes=True)


class UsuarioWithClienteResponse(UsuarioResponse):
    cliente: Optional[ClienteResponse] = None
