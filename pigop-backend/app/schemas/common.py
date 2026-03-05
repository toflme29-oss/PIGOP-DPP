from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Respuesta paginada genérica."""

    items: List[T]
    total: int
    skip: int
    limit: int


class MessageResponse(BaseModel):
    """Respuesta simple con mensaje."""

    message: str
    success: bool = True


class ErrorDetail(BaseModel):
    detail: str
