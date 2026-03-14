"""Schemas Pydantic — Oficios Recibidos."""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class OficioBase(BaseModel):
    numero_oficio: str = Field(..., min_length=1, max_length=100, description="Número del oficio")
    remitente: str = Field(..., min_length=1, max_length=255)
    dependencia: str = Field(..., min_length=1, max_length=255)
    asunto: str = Field(..., min_length=1, max_length=500)
    fecha_oficio: date = Field(..., description="Fecha impresa en el oficio")
    descripcion: Optional[str] = None
    observaciones: Optional[str] = None


class OficioCreate(OficioBase):
    pass


class OficioUpdate(BaseModel):
    numero_oficio: Optional[str] = Field(None, min_length=1, max_length=100)
    remitente: Optional[str] = Field(None, min_length=1, max_length=255)
    dependencia: Optional[str] = Field(None, min_length=1, max_length=255)
    asunto: Optional[str] = Field(None, min_length=1, max_length=500)
    fecha_oficio: Optional[date] = None
    descripcion: Optional[str] = None
    observaciones: Optional[str] = None


class OficioResponse(OficioBase):
    id: str
    folio: int
    fecha_registro: datetime
    cliente_id: str
    registrado_por: str
    registrador_nombre: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
