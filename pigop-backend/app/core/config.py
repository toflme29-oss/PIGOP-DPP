from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List, Optional


class Settings(BaseSettings):
    # App
    APP_NAME: str = "PIGOP API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Security
    SECRET_KEY: str = "change-me-generate-with-openssl-rand-hex-32"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://pigop:pigop_pass@postgres:5432/pigop_db"
    DB_ECHO: bool = False

    # Redis
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: Optional[str] = None

    # Google Cloud Storage
    GCS_BUCKET: str = "pigop-documents-dev"
    GCS_PROJECT_ID: str = "your-gcp-project-id"
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None

    # Google AI Studio (Development)
    GEMINI_API_KEY: str = "your-gemini-api-key"
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Google Document AI (Opcional)
    DOCUMENT_AI_PROCESSOR: Optional[str] = None
    DOCUMENT_AI_LOCATION: str = "us"

    # SAP GRP Integration (Placeholder)
    SAP_HOST: Optional[str] = None
    SAP_SYSNR: Optional[str] = None
    SAP_CLIENT: Optional[str] = None
    SAP_USER: Optional[str] = None
    SAP_PASSWORD: Optional[str] = None
    SAP_MOCK_MODE: bool = True

    # Email (opcional)
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: Optional[int] = None
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: str = "noreply@pigop.gob.mx"

    # CORS
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "https://pigop.michoacan.gob.mx",
    ]

    # Celery
    CELERY_BROKER_URL: str = "redis://redis:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/0"

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True

    # Superadmin inicial
    SUPERADMIN_EMAIL: str = "admin@pigop.gob.mx"
    SUPERADMIN_PASSWORD: str = "Admin.2026!"

    model_config = {"env_file": ".env", "case_sensitive": True}


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
