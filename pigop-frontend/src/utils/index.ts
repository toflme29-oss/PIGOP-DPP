import type { EstadoDEPP, ResultadoValidacion, GravedadValidacion } from '../types'

// ── Formato ────────────────────────────────────────────────────────────────────

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount == null) return '—'
  const n = Number(amount)
  if (isNaN(n)) return '—'
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(n)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Estado DEPP ────────────────────────────────────────────────────────────────

type EstadoConfig = {
  label: string
  color: string  // Tailwind classes
  dot: string
}

export const ESTADO_CONFIG: Record<EstadoDEPP, EstadoConfig> = {
  // ── Estados activos ──────────────────────────────────────────────────────────
  en_revision:    { label: 'En Revisión',    color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  aprobado:       { label: 'Aprobado',       color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  rechazado:      { label: 'Rechazado',      color: 'bg-red-100 text-red-700',     dot: 'bg-red-500' },
  // ── Legacy (compatibilidad con datos históricos) ─────────────────────────────
  en_tramite:     { label: 'En Revisión',    color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  borrador:       { label: 'En Revisión',    color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  en_validacion:  { label: 'En Revisión',    color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  observado:      { label: 'Rechazado',      color: 'bg-red-100 text-red-700',     dot: 'bg-red-400' },
  pagado:         { label: 'Aprobado',       color: 'bg-green-100 text-green-700', dot: 'bg-green-400' },
}

// ── Validaciones ──────────────────────────────────────────────────────────────

export const RESULTADO_CONFIG: Record<ResultadoValidacion, { label: string; color: string; bg: string }> = {
  exitosa:    { label: 'Exitosa',    color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  advertencia:{ label: 'Advertencia',color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  error:      { label: 'Error',      color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
  no_aplica:  { label: 'No aplica',  color: 'text-gray-600',   bg: 'bg-gray-50 border-gray-200' },
}

export const GRAVEDAD_CONFIG: Record<GravedadValidacion, { label: string; color: string }> = {
  critico: { label: 'Crítico', color: 'text-red-700 bg-red-100' },
  alto:    { label: 'Alto',    color: 'text-orange-700 bg-orange-100' },
  medio:   { label: 'Medio',   color: 'text-amber-700 bg-amber-100' },
  bajo:    { label: 'Bajo',    color: 'text-blue-700 bg-blue-100' },
}

// ── Tipos de documento ─────────────────────────────────────────────────────────

export const TIPO_DOC_LABELS: Record<string, string> = {
  DEPP: 'DEPP (Documento principal)',
  CFDI: 'CFDI (Factura electrónica)',
  MCL:  'MCL (Manifiesto de Cumplimiento)',
  CTT:  'CTT (Contrato)',
  PCH:  'PCH (Póliza de Cheque/Transferencia)',
  AUR:  'AUR (Acuerdo Único de Reasignación)',
  FUC:  'FUC (Formato Único de Comisión)',
  OTR:  'Otro documento',
}

// ── Clasificaciones ────────────────────────────────────────────────────────────

export const CLASIFICACION_LABELS: Record<string, string> = {
  'I.1':  'I.1 — Contrato (CFDI + CTT + MCL)',
  'II.1': 'II.1 — Reasignación (AUR)',
  'II.2': 'II.2 — Comisión (FUC)',
  'II.3': 'II.3 — Transferencia (PCH)',
  'II.4': 'II.4 — Sin contrato (CFDI + MCL)',
}

// ── Capítulos ─────────────────────────────────────────────────────────────────

export const CAPITULO_LABELS: Record<number, string> = {
  1000: '1000 — Servicios Personales',
  2000: '2000 — Materiales y Suministros',
  3000: '3000 — Servicios Generales',
  4000: '4000 — Transferencias',
  5000: '5000 — Bienes Muebles e Inmuebles',
  6000: '6000 — Inversión Pública',
  7000: '7000 — Inversiones Financieras',
  8000: '8000 — Participaciones y Aportaciones',
  9000: '9000 — Deuda Pública',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function isIAValidation(tipo: string): boolean {
  return tipo.startsWith('normativa_ia')
}

export function getValidacionLabel(tipo: string): string {
  const map: Record<string, string> = {
    estructura:    'Estructura',
    documentos:    'Documentos',
    coherencia:    'Coherencia',
    clasificacion: 'Clasificación',
    normativa_ia_cruce_rfc:      'IA — Cruce RFC',
    normativa_ia_cruce_montos:   'IA — Cruce Montos',
    normativa_ia_cruce_fechas:   'IA — Cruce Fechas',
    normativa_ia_cruce_contrato: 'IA — Cruce Contrato',
    normativa_ia_concepto_capitulo: 'IA — Concepto/Capítulo',
    normativa_ia_consistencia_general: 'IA — Consistencia General',
    normativa_ia_resumen: 'IA — Resumen',
    normativa_ia: 'IA — Validación',
  }
  return map[tipo] ?? tipo.replace(/_/g, ' ').replace('normativa ia', 'IA —')
}
