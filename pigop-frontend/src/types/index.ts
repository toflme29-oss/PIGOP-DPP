// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface Usuario {
  id: string
  email: string
  nombre_completo: string
  rol: 'superadmin' | 'admin_cliente' | 'revisor' | 'capturista'
  activo: boolean
  cliente_id: string | null
}

// ── Validaciones ──────────────────────────────────────────────────────────────

export type ResultadoValidacion = 'exitosa' | 'advertencia' | 'error' | 'no_aplica'
export type GravedadValidacion = 'critico' | 'alto' | 'medio' | 'bajo'

export interface ValidacionDEPP {
  id: string
  depp_id: string
  tipo_validacion: string
  resultado: ResultadoValidacion
  articulo_manual: string | null
  descripcion_regla: string | null
  mensaje: string | null
  detalles: Record<string, unknown> | null
  gravedad: GravedadValidacion | null
  ejecutada_en: string
  ejecutada_por: string | null
}

// ── Documentos ────────────────────────────────────────────────────────────────

export type TipoDocumento = 'DEPP' | 'CFDI' | 'MCL' | 'CTT' | 'PCH' | 'AUR' | 'FUC' | 'OTR'

export interface DocumentoDEPP {
  id: string
  depp_id: string
  tipo: TipoDocumento
  nombre_archivo: string
  url_storage: string | null
  mime_type: string | null
  tamanio_bytes: number | null
  datos_extraidos: Record<string, unknown> | null
  texto_extraido: string | null
  validado: boolean
  subido_en: string
}

// ── DEPP ──────────────────────────────────────────────────────────────────────

/** Flujo: en_revision → aprobado | rechazado */
export type EstadoDEPP = 'en_revision' | 'aprobado' | 'rechazado'
  | 'en_tramite' | 'borrador' | 'en_validacion' | 'observado' | 'pagado'  // legacy

export interface DEPP {
  id: string
  cliente_id: string
  folio: string
  expediente_id: string | null
  upp: string
  ejercicio: number
  mes: number | null

  // Tipo DEPP — PAGO genera movimiento financiero+presupuestal; NO_PAGO solo presupuestal
  tipo_depp: 'PAGO' | 'NO_PAGO' | null

  // Clasificación presupuestal
  clasificador_tipo: string | null    // Normativa: "I.1", "II.1"…
  clasificador_sap: string | null     // Clasif. SAP: "21111"
  capitulo: number | null
  concepto: number | null
  partida: number | null
  partida_nombre: string | null

  // Fuente de financiamiento
  fuente_financiamiento: string | null  // código: "261528091"
  fuente_nombre: string | null          // "FONDO GENERAL DE PARTICIPACIONES"
  programa: string | null

  // Unidades
  ue: string | null   // Unidad Ejecutora: "25-04 DELEGACIÓN ADMINISTRATIVA"
  ur: string | null   // Unidad Responsable: "04"

  // Montos
  monto_total: number | null
  monto_comprobado: number | null

  // Estado
  estado: EstadoDEPP
  fecha_estado: string

  // Metadata extraída por IA/OCR
  beneficiario: string | null
  clave_acreedor: string | null          // clave SAP del proveedor
  cuenta_abono: string | null            // cuenta bancaria destino (PAGO)
  solicitud_numero: string | null
  tipo_pago: string | null               // legacy → usar tipo_depp
  clave_presupuestaria: string | null    // clave completa
  provisional_vale: string | null        // vale que regulariza (NO_PAGO)
  notas_aclaraciones: string | null      // texto de notas del DEPP

  // Validación
  validado_automaticamente: boolean
  puede_aprobar: boolean
  fecha_validacion: string | null

  // Auditoría
  creado_en: string
  documentos: DocumentoDEPP[]
  validaciones: ValidacionDEPP[]
}

export interface DEPPListItem {
  id: string
  folio: string
  upp: string
  ejercicio: number
  estado: EstadoDEPP
  tipo_depp: 'PAGO' | 'NO_PAGO' | null
  clasificador_tipo: string | null
  monto_total: number | null
  beneficiario: string | null
  capitulo: number | null
  creado_en: string
  puede_aprobar: boolean
  validado_automaticamente: boolean
}

export interface DEPPCreate {
  folio: string
  cliente_id: string
  upp: string
  ejercicio: number
  monto_total?: number
  beneficiario?: string
  capitulo?: number
  clasificador_tipo?: string
  mes?: number
}

// ── Upload ────────────────────────────────────────────────────────────────────

export interface UploadResponse {
  depp_id: string
  documentos_subidos: number
  documentos: DocumentoDEPP[]
  clasificacion_detectada: string | null
  mensaje: string
}

// ── Cliente ───────────────────────────────────────────────────────────────────

export interface Cliente {
  id: string
  codigo_upp: string
  nombre: string
  tipo: string
  activo: boolean
}
