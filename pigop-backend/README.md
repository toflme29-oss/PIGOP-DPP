# PIGOP Backend — Fase 1

**Plataforma Integral de Gestión y Optimización Presupuestaria**
Gobierno del Estado de Michoacán — Dirección de Programación y Presupuesto

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | FastAPI 0.104 |
| ORM | SQLAlchemy 2.0 (async) |
| Base de datos | PostgreSQL 15 |
| Cache | Redis 7 |
| Auth | JWT (python-jose) |
| Contenedores | Docker Compose |

---

## Inicio rápido

### 1. Copiar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus credenciales reales
```

### 2. Levantar con Docker Compose

```bash
docker-compose up --build
```

El primer arranque ejecuta automáticamente:
- Migraciones Alembic (`alembic upgrade head`)
- Script de inicialización (`scripts/init_db.py`) que crea el superadmin

### 3. Verificar

- API: http://localhost:8000
- Docs (Swagger): http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- Health: http://localhost:8000/health

### Credenciales iniciales

```
Email:    admin@pigop.gob.mx
Password: Admin.2026!
```

> Cambiar en `.env` las variables `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` antes de producción.

---

## Estructura del proyecto

```
pigop-backend/
├── app/
│   ├── api/v1/
│   │   ├── endpoints/
│   │   │   ├── auth.py        # Login, refresh, /me
│   │   │   ├── depps.py       # CRUD DEPPs
│   │   │   └── usuarios.py    # Usuarios + Clientes (UPPs)
│   │   └── router.py
│   ├── core/
│   │   ├── config.py          # Settings (Pydantic)
│   │   ├── database.py        # Engine async SQLAlchemy
│   │   ├── security.py        # JWT + bcrypt
│   │   └── exceptions.py      # Excepciones personalizadas
│   ├── crud/                  # Operaciones de base de datos
│   ├── models/                # Modelos SQLAlchemy
│   ├── schemas/               # Schemas Pydantic v2
│   └── main.py                # FastAPI app
├── alembic/                   # Migraciones
├── tests/                     # Tests pytest-asyncio
├── scripts/
│   └── init_db.py             # Crear superadmin inicial
├── docker/
│   └── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Endpoints Fase 1

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Login con email/password |
| POST | `/api/v1/auth/refresh` | Renovar access token |
| GET | `/api/v1/auth/me` | Usuario actual |

### DEPPs
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/depps/` | Crear DEPP |
| GET | `/api/v1/depps/` | Listar DEPPs (con filtros) |
| GET | `/api/v1/depps/{id}` | Obtener DEPP + documentos |
| PUT | `/api/v1/depps/{id}` | Actualizar DEPP |
| DELETE | `/api/v1/depps/{id}` | Eliminar DEPP (solo borrador) |
| POST | `/api/v1/depps/{id}/estado` | Cambiar estado |

### Usuarios
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/usuarios/` | Crear usuario |
| GET | `/api/v1/usuarios/` | Listar usuarios |
| GET | `/api/v1/usuarios/{id}` | Obtener usuario |
| PUT | `/api/v1/usuarios/{id}` | Actualizar usuario |
| DELETE | `/api/v1/usuarios/{id}` | Desactivar usuario |
| POST | `/api/v1/usuarios/clientes` | Crear cliente (UPP) |
| GET | `/api/v1/usuarios/clientes` | Listar clientes |

---

## Roles

| Rol | Permisos |
|-----|---------|
| `superadmin` | Acceso total, puede crear clientes y superadmins |
| `admin_cliente` | Gestiona usuarios de su propio cliente |
| `analista` | CRUD de DEPPs de su cliente |
| `consulta` | Solo lectura |

---

## Tests

```bash
# Instalar dependencias de test
pip install -r requirements.txt

# Ejecutar tests (usa SQLite en memoria, no requiere Postgres)
pytest tests/ -v

# Con cobertura
pytest tests/ --cov=app --cov-report=html
```

---

## Siguientes pasos — Fase 2

- Upload de archivos a Google Cloud Storage
- OCR de documentos PDF con Document AI
- Extracción de metadata con Gemini
- Validación estructural de DEPPs
- Motor de reglas normativas configurable
