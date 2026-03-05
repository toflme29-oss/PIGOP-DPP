from fastapi import HTTPException, status


class PigopException(HTTPException):
    """Excepción base del sistema PIGOP."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)


class NotFoundError(PigopException):
    def __init__(self, resource: str = "Recurso"):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{resource} no encontrado.",
        )


class ForbiddenError(PigopException):
    def __init__(self, detail: str = "No tiene permisos para esta operación."):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class UnauthorizedError(PigopException):
    def __init__(self, detail: str = "No autenticado o token inválido."):
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


class ConflictError(PigopException):
    def __init__(self, detail: str = "Conflicto con un recurso existente."):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class ValidationError(PigopException):
    def __init__(self, detail: str = "Error de validación."):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail
        )


class BusinessError(PigopException):
    """Error de regla de negocio."""

    def __init__(self, detail: str):
        super().__init__(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
