"""
Script de arranque para PRODUCCIÓN en Railway.
- Lee PORT de Railway (variable de entorno)
- Usa SQLite local (con volumen persistente en Railway)
- CORS acepta el frontend desplegado en Hostinger
"""
import sys, os, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Cargar .env si existe (Railway inyecta variables directamente) ────────────
_env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_env_file):
    with open(_env_file) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

# ── Variables de entorno ─────────────────────────────────────────────────────
# DATABASE_URL: Railway la puede proveer, o usar SQLite
if "DATABASE_URL" not in os.environ:
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./pigop_prod.db"

os.environ.setdefault("SECRET_KEY", "prod-secret-key-change-me")
os.environ.setdefault("DEBUG", "False")
os.environ.setdefault("GCS_BUCKET", "pigop-documents-prod")
os.environ.setdefault("GCS_PROJECT_ID", "demo-project")
os.environ.setdefault("GEMINI_API_KEY", "placeholder")
os.environ.setdefault("SAP_MOCK_MODE", "True")
os.environ.setdefault("STORAGE_BACKEND", "local")
os.environ.setdefault("SUPERADMIN_EMAIL", "admin@pigop.gob.mx")
os.environ.setdefault("SUPERADMIN_PASSWORD", "Admin.2026!")

# ── CORS: Frontend en Hostinger + localhost para pruebas ─────────────────────
# Railway inyecta RAILWAY_PUBLIC_DOMAIN con el dominio público del servicio
frontend_url = os.environ.get("FRONTEND_URL", "https://magenta-mallard-924557.hostingersite.com")
railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")

cors_origins = [
    frontend_url,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
]
# Agregar el propio dominio de Railway si existe
if railway_domain:
    cors_origins.append(f"https://{railway_domain}")

import json as _json_cors
os.environ["ALLOWED_ORIGINS"] = _json_cors.dumps(cors_origins)

# ── Imports post-config ───────────────────────────────────────────────────────
from sqlalchemy import create_engine, text
import app.models          # noqa — registra todos los modelos con Base.metadata
from app.core.database import Base
from app.core.security import get_password_hash

# URL sincrónica para migraciones
_db_url = os.environ["DATABASE_URL"]
if _db_url.startswith("sqlite+aiosqlite"):
    DB_SYNC = _db_url.replace("sqlite+aiosqlite", "sqlite")
elif _db_url.startswith("postgresql+asyncpg"):
    DB_SYNC = _db_url.replace("postgresql+asyncpg", "postgresql")
else:
    DB_SYNC = _db_url

sync_engine = create_engine(DB_SYNC, echo=False)

# ── Crear / actualizar tablas ─────────────────────────────────────────────────
print("🔧 Creando/actualizando tablas...")
Base.metadata.create_all(sync_engine)
print("✅ Tablas listas")

# ── Migración de documentos_oficiales (agrega columnas nuevas si no existen) ──
_NUEVAS_COLUMNAS_DOC = [
    "ALTER TABLE documentos_oficiales ADD COLUMN flujo VARCHAR(20) DEFAULT 'emitido'",
    "ALTER TABLE documentos_oficiales ADD COLUMN numero_oficio_origen VARCHAR(150)",
    "ALTER TABLE documentos_oficiales ADD COLUMN remitente_nombre VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN remitente_cargo VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN remitente_dependencia VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN fecha_recibido VARCHAR(10)",
    "ALTER TABLE documentos_oficiales ADD COLUMN fecha_limite VARCHAR(10)",
    "ALTER TABLE documentos_oficiales ADD COLUMN prioridad VARCHAR(20) DEFAULT 'normal'",
    "ALTER TABLE documentos_oficiales ADD COLUMN ocr_procesado INTEGER DEFAULT 0",
    "ALTER TABLE documentos_oficiales ADD COLUMN texto_extraido_ocr TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN datos_extraidos_ia TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN sugerencia_area_codigo VARCHAR(10)",
    "ALTER TABLE documentos_oficiales ADD COLUMN sugerencia_area_nombre VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN sugerencia_fundamento TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN sugerencia_plazo_dias INTEGER",
    "ALTER TABLE documentos_oficiales ADD COLUMN confianza_clasificacion REAL",
    "ALTER TABLE documentos_oficiales ADD COLUMN regla_turno_codigo VARCHAR(30)",
    "ALTER TABLE documentos_oficiales ADD COLUMN genera_tramite VARCHAR(50)",
    "ALTER TABLE documentos_oficiales ADD COLUMN area_turno VARCHAR(10)",
    "ALTER TABLE documentos_oficiales ADD COLUMN area_turno_nombre VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN area_turno_confirmada INTEGER DEFAULT 0",
    "ALTER TABLE documentos_oficiales ADD COLUMN turnado_por_id VARCHAR(36)",
    "ALTER TABLE documentos_oficiales ADD COLUMN turnado_en DATETIME",
    "ALTER TABLE documentos_oficiales ADD COLUMN borrador_respuesta TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN folio_respuesta VARCHAR(100)",
    "ALTER TABLE documentos_oficiales ADD COLUMN referencia_elaboro VARCHAR(50)",
    "ALTER TABLE documentos_oficiales ADD COLUMN referencia_reviso VARCHAR(50)",
    "ALTER TABLE documentos_oficiales ADD COLUMN certificacion_id VARCHAR(36)",
    "ALTER TABLE documentos_oficiales ADD COLUMN upp_solicitante VARCHAR(20)",
    "ALTER TABLE documentos_oficiales ADD COLUMN termino_contestacion VARCHAR(150)",
    "ALTER TABLE documentos_oficiales ADD COLUMN subdirector_nombre VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN jefe_departamento_nombre VARCHAR(200)",
    "ALTER TABLE documentos_oficiales ADD COLUMN firmado_digitalmente INTEGER DEFAULT 0",
    "ALTER TABLE documentos_oficiales ADD COLUMN firma_metadata TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN instrucciones_turno TEXT",
    "ALTER TABLE documentos_oficiales ADD COLUMN requiere_respuesta INTEGER DEFAULT 1",
    "ALTER TABLE documentos_oficiales ADD COLUMN version INTEGER DEFAULT 1",
    "ALTER TABLE documentos_oficiales ADD COLUMN devuelto_por_id VARCHAR(36)",
    "ALTER TABLE documentos_oficiales ADD COLUMN devuelto_en DATETIME",
    "ALTER TABLE documentos_oficiales ADD COLUMN motivo_devolucion TEXT",
]

is_sqlite = "sqlite" in DB_SYNC
with sync_engine.connect() as _mc:
    for _stmt in _NUEVAS_COLUMNAS_DOC:
        try:
            _mc.execute(text(_stmt))
        except Exception:
            pass  # la columna ya existe
    _mc.commit()
print("✅ Columnas documentos_oficiales actualizadas")

# ── Migración de usuarios (columnas nuevas) ─────────────────────────────────
_NUEVAS_COLUMNAS_USR = [
    "ALTER TABLE usuarios ADD COLUMN modulos_acceso TEXT DEFAULT '[]'",
]
with sync_engine.connect() as _uc:
    for _stmt in _NUEVAS_COLUMNAS_USR:
        try:
            _uc.execute(text(_stmt))
        except Exception:
            pass
    _uc.commit()
print("✅ Columnas usuarios actualizadas")

# ── Crear tablas de bóveda de certificados y bitácora de firma ──────────────
_TABLAS_BOVEDA = [
    """CREATE TABLE IF NOT EXISTS certificados_firma (
        id VARCHAR(36) PRIMARY KEY,
        usuario_id VARCHAR(36) NOT NULL UNIQUE,
        cer_data TEXT NOT NULL,
        key_data_cifrada TEXT NOT NULL,
        key_iv VARCHAR(64) NOT NULL,
        key_tag VARCHAR(64) NOT NULL,
        rfc VARCHAR(20) NOT NULL,
        nombre_titular VARCHAR(300) NOT NULL,
        numero_serie VARCHAR(100) NOT NULL,
        valido_desde DATETIME,
        valido_hasta DATETIME,
        emisor VARCHAR(300),
        activo INTEGER DEFAULT 1,
        registrado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        ultima_firma_en DATETIME,
        total_firmas INTEGER DEFAULT 0,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )""",
    """CREATE TABLE IF NOT EXISTS bitacora_firma (
        id VARCHAR(36) PRIMARY KEY,
        usuario_id VARCHAR(36) NOT NULL,
        accion VARCHAR(50) NOT NULL,
        documento_id VARCHAR(36),
        lote_firma_id VARCHAR(36),
        rfc_certificado VARCHAR(20),
        numero_serie VARCHAR(100),
        hash_documento VARCHAR(128),
        ip_origen VARCHAR(45),
        exitoso INTEGER DEFAULT 1,
        detalle TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )""",
]
with sync_engine.connect() as _bc:
    for _sql in _TABLAS_BOVEDA:
        try:
            _bc.execute(text(_sql))
        except Exception:
            pass
    _bc.commit()
print("✅ Tablas bóveda certificados y bitácora firma listas")

EMAIL = os.environ["SUPERADMIN_EMAIL"]
PWD   = os.environ["SUPERADMIN_PASSWORD"]

# ── Datos semilla ─────────────────────────────────────────────────────────────
import json as _json

with sync_engine.connect() as conn:

    # ── Cliente DPP ───────────────────────────────────────────────────────────
    if not conn.execute(
        text("SELECT 1 FROM clientes WHERE codigo_upp='DPP'")
    ).fetchone():
        conn.execute(text(
            "INSERT INTO clientes "
            "(id, codigo_upp, nombre, tipo, activo, configuracion) "
            "VALUES (:id, 'DPP', 'Dirección de Programación y Presupuesto', "
            "        'centralizada', 1, '{}')"
        ), {"id": str(uuid.uuid4())})
        conn.commit()
        print("✅ Cliente DPP creado")

    # ── Superadmin ────────────────────────────────────────────────────────────
    if not conn.execute(
        text("SELECT 1 FROM usuarios WHERE email=:e"), {"e": EMAIL}
    ).fetchone():
        conn.execute(text(
            "INSERT INTO usuarios "
            "(id, email, password_hash, nombre_completo, rol, activo) "
            "VALUES (:id, :email, :pwd, 'Administrador PIGOP', 'superadmin', 1)"
        ), {"id": str(uuid.uuid4()), "email": EMAIL, "pwd": get_password_hash(PWD)})
        conn.commit()
        print(f"✅ Superadmin: {EMAIL}")

    # ── Reglas normativas iniciales ───────────────────────────────────────────
    REGLAS = [
        {
            "codigo": "EST-001", "articulo": "Art. 25",
            "titulo": "Campos obligatorios del DEPP",
            "descripcion": "El DEPP debe contener folio, UPP, ejercicio y monto total.",
            "tipo_validacion": "estructura", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "EST-002", "articulo": "Art. 25",
            "titulo": "Monto total válido",
            "descripcion": "El monto total del DEPP debe ser mayor a cero.",
            "tipo_validacion": "estructura", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "DOC-I1", "articulo": "Art. 39 fracc. I",
            "titulo": "Documentos requeridos clasificación I.1",
            "descripcion": "Clasificación I.1: requiere DEPP + CFDI + Contrato (CTT) + Manifiesto (MCL).",
            "tipo_validacion": "documental",
            "aplica_clasificacion": _json.dumps(["I.1"]),
            "aplica_capitulo": _json.dumps([2000, 3000, 5000, 6000]),
            "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "DOC-II1", "articulo": "Art. 39 fracc. II.1",
            "titulo": "Documentos requeridos clasificación II.1",
            "descripcion": "Clasificación II.1: requiere DEPP + Acuerdo Único de Reasignación (AUR).",
            "tipo_validacion": "documental",
            "aplica_clasificacion": _json.dumps(["II.1"]),
            "aplica_capitulo": None, "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "DOC-II2", "articulo": "Art. 39 fracc. II.2",
            "titulo": "Documentos requeridos clasificación II.2",
            "descripcion": "Clasificación II.2: requiere DEPP + Formato Único de Comisión (FUC). Solo cap. 3000.",
            "tipo_validacion": "documental",
            "aplica_clasificacion": _json.dumps(["II.2"]),
            "aplica_capitulo": _json.dumps([3000]),
            "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "DOC-II3", "articulo": "Art. 39 fracc. II.3",
            "titulo": "Documentos requeridos clasificación II.3",
            "descripcion": "Clasificación II.3: requiere DEPP + Póliza Cheque/Transferencia (PCH).",
            "tipo_validacion": "documental",
            "aplica_clasificacion": _json.dumps(["II.3"]),
            "aplica_capitulo": None, "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "DOC-II4", "articulo": "Art. 39 fracc. II.4",
            "titulo": "Documentos requeridos clasificación II.4",
            "descripcion": "Clasificación II.4: requiere DEPP + CFDI + Manifiesto (MCL), sin contrato.",
            "tipo_validacion": "documental",
            "aplica_clasificacion": _json.dumps(["II.4"]),
            "aplica_capitulo": _json.dumps([2000, 3000, 5000]),
            "gravedad": "critico", "bloquea_aprobacion": 1,
        },
        {
            "codigo": "COH-001", "articulo": "Art. 40",
            "titulo": "Compatibilidad capítulo-clasificación",
            "descripcion": "El capítulo presupuestal debe ser compatible con la clasificación del DEPP.",
            "tipo_validacion": "presupuestal", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "alto", "bloquea_aprobacion": 0,
        },
        {
            "codigo": "COH-002", "articulo": "Art. 40",
            "titulo": "Monto mayor a $500,000 — verificar licitación",
            "descripcion": "Montos superiores a $500,000 deben contar con proceso de licitación o justificación.",
            "tipo_validacion": "presupuestal", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "medio", "bloquea_aprobacion": 0,
        },
        {
            "codigo": "COH-003", "articulo": "Art. 40",
            "titulo": "CFDI en capítulo 1000 sin contrato",
            "descripcion": "Capítulo 1000 con CFDI externo sin contrato requiere verificación adicional.",
            "tipo_validacion": "presupuestal", "aplica_clasificacion": None,
            "aplica_capitulo": _json.dumps([1000]), "gravedad": "medio", "bloquea_aprobacion": 0,
        },
        {
            "codigo": "CLA-001", "articulo": "Art. 39",
            "titulo": "Clasificación normativa determinable",
            "descripcion": "El sistema debe poder determinar la clasificación normativa del DEPP.",
            "tipo_validacion": "documental", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "alto", "bloquea_aprobacion": 0,
        },
        {
            "codigo": "CLA-002", "articulo": "Art. 39",
            "titulo": "Coincidencia de clasificación capturada",
            "descripcion": "La clasificación capturada debe coincidir con la detectada automáticamente.",
            "tipo_validacion": "documental", "aplica_clasificacion": None,
            "aplica_capitulo": None, "gravedad": "medio", "bloquea_aprobacion": 0,
        },
    ]

    for regla in REGLAS:
        existe = conn.execute(
            text("SELECT 1 FROM reglas_normativas WHERE codigo=:c"),
            {"c": regla["codigo"]},
        ).fetchone()
        if not existe:
            conn.execute(
                text(
                    "INSERT INTO reglas_normativas "
                    "(id, codigo, articulo, titulo, descripcion, tipo_validacion, "
                    " aplica_clasificacion, aplica_capitulo, gravedad, "
                    " bloquea_aprobacion, activa, version) "
                    "VALUES (:id, :codigo, :articulo, :titulo, :descripcion, :tipo_validacion, "
                    "        :aplica_clasificacion, :aplica_capitulo, :gravedad, "
                    "        :bloquea_aprobacion, 1, 2)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "codigo": regla["codigo"],
                    "articulo": regla["articulo"],
                    "titulo": regla["titulo"],
                    "descripcion": regla["descripcion"],
                    "tipo_validacion": regla["tipo_validacion"],
                    "aplica_clasificacion": regla["aplica_clasificacion"],
                    "aplica_capitulo": regla["aplica_capitulo"],
                    "gravedad": regla["gravedad"],
                    "bloquea_aprobacion": regla["bloquea_aprobacion"],
                },
            )
    conn.commit()
    total_reglas = conn.execute(
        text("SELECT COUNT(*) FROM reglas_normativas")
    ).fetchone()[0]
    print(f"✅ Reglas normativas: {total_reglas} registros")

sync_engine.dispose()

# ── Usuarios de prueba ──────────────────────────────────────────────────────
# Se crean al iniciar para que puedas probar todos los roles
_USUARIOS_PRUEBA = [
    ("director@pigop.gob.mx", "Director.2026!", "Mtro. Marco Antonio Flores Mejía", "admin_cliente"),
    ("secretaria@pigop.gob.mx", "Secretaria.2026!", "Secretaria DPP", "analista"),
    ("area@pigop.gob.mx", "Area.2026!", "Analista Área", "analista"),
]
_sync2 = create_engine(DB_SYNC, echo=False)
with _sync2.connect() as c2:
    for _em, _pw, _nm, _rl in _USUARIOS_PRUEBA:
        if not c2.execute(text("SELECT 1 FROM usuarios WHERE email=:e"), {"e": _em}).fetchone():
            c2.execute(text(
                "INSERT INTO usuarios (id,email,password_hash,nombre_completo,rol,activo) "
                "VALUES (:id,:email,:pwd,:nombre,:rol,1)"
            ), {"id": str(uuid.uuid4()), "email": _em, "pwd": get_password_hash(_pw),
                "nombre": _nm, "rol": _rl})
    c2.commit()
_sync2.dispose()
print("✅ Usuarios de prueba creados")

# ── Banner de inicio ──────────────────────────────────────────────────────────
PORT = int(os.environ.get("PORT", 8000))

print()
print("=" * 60)
print("🚀  PIGOP Backend — Producción (Railway)")
print("=" * 60)
print(f"   Puerto:     {PORT}")
print(f"   Frontend:   {frontend_url}")
print(f"   CORS:       {cors_origins}")
print(f"   DB:         {os.environ['DATABASE_URL'][:50]}...")
print(f"   Email:      {EMAIL}")
print("=" * 60)
print()

import uvicorn
uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)
