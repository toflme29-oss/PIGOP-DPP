import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ShieldCheck, BrainCircuit, Upload, X, CheckCircle2,
  AlertTriangle, XCircle, Info, ChevronDown, ChevronUp, Sparkles,
  Printer, FileText, ChevronRight, Plus, BookOpen,
} from 'lucide-react'
import { clsx } from 'clsx'
import { deppsApi } from '../api/depps'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/Alert'
import { PageSpinner } from '../components/ui/Spinner'
import NormativaPanel from '../components/NormativaPanel'
import { UPPBadge } from '../components/UPPBadge'
import {
  formatCurrency, formatDate, formatDateTime,
  RESULTADO_CONFIG, GRAVEDAD_CONFIG,
  TIPO_DOC_LABELS, CLASIFICACION_LABELS, CAPITULO_LABELS,
  isIAValidation, getValidacionLabel,
} from '../utils'
import type { DEPP, DocumentoDEPP, ValidacionDEPP, TipoDocumento } from '../types'

// ── Constantes ────────────────────────────────────────────────────────────────
const GUINDA = '#911A3A'

const ALL_DOC_TYPES: TipoDocumento[] = ['DEPP', 'CFDI', 'MCL', 'AUR', 'CTT', 'PCH', 'FUC', 'OTR']

const REQUIRED_BY_CLASIF: Record<string, TipoDocumento[]> = {
  'I.1':  ['DEPP', 'CFDI', 'CTT', 'MCL'],
  'II.1': ['DEPP', 'AUR'],
  'II.2': ['DEPP', 'FUC'],
  'II.3': ['DEPP', 'PCH'],
  'II.4': ['DEPP', 'CFDI', 'MCL'],
}

const DESC_DOC: Record<TipoDocumento, string> = {
  DEPP: 'Documento de Ejecución Presupuestaria y Pago — documento rector que ampara el trámite de pago.',
  CFDI: 'Comprobante Fiscal Digital por Internet — factura electrónica emitida por el proveedor o beneficiario.',
  MCL:  'Manifiesto de Cumplimiento de Lineamientos — documento de conformidad del área solicitante.',
  CTT:  'Contrato o instrumento jurídico que sustenta la relación contractual con el proveedor.',
  PCH:  'Póliza de Cheque o Transferencia Electrónica — comprobante del movimiento bancario.',
  AUR:  'Acuerdo Único de Reasignación — instrumento presupuestal para reasignación de recursos.',
  FUC:  'Formato Único de Comisión — documento que ampara comisiones del personal.',
  OTR:  'Documento complementario o de soporte adjunto al expediente.',
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
type DocStatus = 'correcto' | 'incorrecto' | 'na' | 'pendiente'

// ── Helpers ───────────────────────────────────────────────────────────────────
function computeDocStatus(depp: DEPP): Record<TipoDocumento, DocStatus> {
  const required = depp.clasificador_tipo
    ? (REQUIRED_BY_CLASIF[depp.clasificador_tipo] ?? ['DEPP'])
    : ['DEPP']
  const errorMsgs = depp.validaciones
    .filter(v => v.resultado === 'error')
    .map(v => JSON.stringify({ m: v.mensaje, d: v.detalles }).toUpperCase())
  const result = {} as Record<TipoDocumento, DocStatus>
  for (const tipo of ALL_DOC_TYPES) {
    const doc    = depp.documentos.find(d => d.tipo === tipo)
    const isReq  = required.includes(tipo)
    if (!doc) {
      result[tipo] = isReq ? 'incorrecto' : 'na'
    } else if (!depp.validado_automaticamente) {
      result[tipo] = 'pendiente'
    } else {
      result[tipo] = errorMsgs.some(m => m.includes(tipo)) ? 'incorrecto' : 'correcto'
    }
  }
  return result
}

function getExtracted(depp: DEPP, ...keys: string[]): string {
  const deppDoc = depp.documentos.find(d => d.tipo === 'DEPP')
  const ex = deppDoc?.datos_extraidos
  if (!ex || (ex as Record<string, unknown>)._mock) return ''
  for (const k of keys) {
    const v = (ex as Record<string, unknown>)[k]
    if (v != null && v !== '') return String(v)
  }
  return ''
}

function getEstadoLabel(depp: DEPP): string {
  if (depp.estado === 'aprobado')      return 'APROBADO — LISTO PARA PAGO'
  if (depp.estado === 'rechazado')     return 'RECHAZADO — REQUIERE CORRECCIÓN'
  if (depp.estado === 'en_revision')   return 'EN REVISIÓN — DPP ANALIZANDO'
  if (depp.estado === 'en_tramite')    return 'EN TRÁMITE — PENDIENTE DE REVISIÓN'
  // Legacy
  if (depp.estado === 'observado')     return 'RECHAZADO — REQUIERE CORRECCIÓN'
  if (depp.estado === 'pagado')        return 'APROBADO — LISTO PARA PAGO'
  if (depp.estado === 'en_validacion') return 'EN REVISIÓN — DPP ANALIZANDO'
  return 'EN TRÁMITE — PENDIENTE DE REVISIÓN'
}
/** @deprecated use getEstadoLabel */
function getEstadoPago(depp: DEPP): string { return getEstadoLabel(depp) }

function getBannerColors(estado: string): { bg: string; text: string; accent: string } {
  switch (estado) {
    case 'aprobado':
    case 'pagado':        return { bg: '#14532d', text: '#dcfce7', accent: '#4ade80' }
    case 'rechazado':
    case 'observado':     return { bg: '#7f1d1d', text: '#fee2e2', accent: '#f87171' }
    case 'en_revision':
    case 'en_validacion': return { bg: '#78350f', text: '#fef3c7', accent: '#fbbf24' }
    case 'en_tramite':
    case 'borrador':
    default:              return { bg: GUINDA,    text: '#fff',    accent: '#fda4af' }
  }
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function DataField({ label, value, wide = false, mono = false, highlight = false }: {
  label: string; value: React.ReactNode
  wide?: boolean; mono?: boolean; highlight?: boolean
}) {
  return (
    <div className={clsx('min-w-0', wide && 'col-span-2')}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className={clsx(
        'leading-tight break-words',
        mono && 'font-mono text-xs',
        highlight ? 'font-black text-gray-900 text-base' : 'text-sm font-semibold text-gray-800',
      )}>
        {value || <span className="text-gray-300 font-normal text-xs">—</span>}
      </p>
    </div>
  )
}

function DocStatusIcon({ status }: { status: DocStatus }) {
  if (status === 'correcto')   return <CheckCircle2 size={26} className="text-green-500" />
  if (status === 'incorrecto') return <XCircle      size={26} className="text-red-500" />
  if (status === 'pendiente')  return <Info         size={26} className="text-amber-400" />
  return <div className="w-6 h-6 rounded-full border-2 border-dashed border-gray-200" />
}

function DocTypeCard({ tipo, status, doc, active, onClick }: {
  tipo: TipoDocumento; status: DocStatus
  doc: DocumentoDEPP | undefined; active: boolean; onClick: () => void
}) {
  const colors: Record<DocStatus, { bg: string; border: string }> = {
    correcto:   { bg: active ? '#dcfce7' : '#f0fdf4', border: active ? '#16a34a' : '#bbf7d0' },
    incorrecto: { bg: active ? '#fee2e2' : '#fff5f5', border: active ? '#dc2626' : '#fecaca' },
    pendiente:  { bg: active ? '#fef3c7' : '#fffbeb', border: active ? '#d97706' : '#fde68a' },
    na:         { bg: '#f9fafb', border: '#e5e7eb' },
  }
  const c = colors[status]
  return (
    <button
      onClick={status !== 'na' ? onClick : undefined}
      disabled={status === 'na'}
      className={clsx(
        'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center',
        status !== 'na' ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'cursor-default opacity-40',
        active && 'shadow-lg ring-2 ring-offset-1',
      )}
      style={{ backgroundColor: c.bg, borderColor: c.border }}
      title={doc?.nombre_archivo ?? tipo}
    >
      <DocStatusIcon status={status} />
      <span className="text-xs font-bold text-gray-700">{tipo}</span>
      {status !== 'na' ? (
        <span className={clsx(
          'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full tracking-wide',
          status === 'correcto'   && 'bg-green-100 text-green-700',
          status === 'incorrecto' && 'bg-red-100 text-red-700',
          status === 'pendiente'  && 'bg-amber-100 text-amber-700',
        )}>
          {status === 'correcto' ? 'Correcto' : status === 'incorrecto' ? 'Incorrecto' : 'Pendiente'}
        </span>
      ) : (
        <span className="text-[9px] text-gray-400 font-medium">N/A</span>
      )}
    </button>
  )
}

function DesglosePanel({ depp, docTipo, onClose }: {
  depp: DEPP; docTipo: TipoDocumento; onClose: () => void
}) {
  const doc = depp.documentos.find(d => d.tipo === docTipo)
  const ex  = (doc?.datos_extraidos && !(doc.datos_extraidos as Record<string,unknown>)._mock)
    ? doc.datos_extraidos as Record<string, unknown>
    : null

  const relevantVals = depp.validaciones.filter(v => {
    const txt = JSON.stringify({ m: v.mensaje, d: v.detalles }).toUpperCase()
    return txt.includes(docTipo)
  })
  const iaVals   = depp.validaciones.filter(v => isIAValidation(v.tipo_validacion) && v.tipo_validacion !== 'normativa_ia_resumen')
  const errorVals = relevantVals.filter(v => v.resultado === 'error')
  const okVals    = relevantVals.filter(v => v.resultado === 'exitosa')
  const articulo  = [...depp.validaciones].find(v => v.articulo_manual)?.articulo_manual

  const FIELD_MAP = [
    { label: 'RFC Emisor',          keys: ['rfc_emisor', 'rfc'] },
    { label: 'RFC Receptor',        keys: ['rfc_receptor'] },
    { label: 'Folio Fiscal (UUID)', keys: ['folio_fiscal', 'uuid'] },
    { label: 'Importe total',       keys: ['total', 'monto_total'] },
    { label: 'Subtotal',            keys: ['subtotal'] },
    { label: 'IVA',                 keys: ['iva'] },
    { label: 'Fecha',               keys: ['fecha_emision', 'fecha'] },
    { label: 'Concepto',            keys: ['descripcion', 'concepto'] },
    { label: 'Moneda',              keys: ['moneda'] },
    { label: 'Método de pago',      keys: ['metodo_pago'] },
  ]
  const rows = FIELD_MAP
    .map(({ label, keys }) => ({
      label,
      value: keys.map(k => ex?.[k] ? String(ex[k]) : '').find(v => v) ?? ''
    }))
    .filter(r => r.value && ex)

  return (
    <div className="rounded-2xl overflow-hidden shadow-xl" style={{ backgroundColor: '#111827', border: '1px solid #374151' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: '#374151' }}>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>
            Desglose Técnico y Normativo
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-semibold text-sm text-white">Análisis de:</span>
            <span className="text-amber-400 font-bold text-sm">{docTipo}</span>
            {doc && <span className="text-xs font-mono" style={{ color: '#6b7280' }}>· {doc.nombre_archivo}</span>}
          </div>
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: '#6b7280' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff'; (e.currentTarget as HTMLElement).style.backgroundColor = '#374151' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#6b7280'; (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* 4 columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: '#374151' }}>
        {/* 1. Tipo documento */}
        <div className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
            1. Tipo documento
          </p>
          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} style={{ color: '#fbbf24' }} />
            <span className="font-bold text-sm" style={{ color: '#fbbf24' }}>{docTipo}</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: '#9ca3af' }}>{DESC_DOC[docTipo]}</p>
          {doc ? (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid #374151' }}>
              <p className="text-[10px] mb-1" style={{ color: '#6b7280' }}>Archivo:</p>
              <p className="text-xs font-mono break-all" style={{ color: '#9ca3af' }}>{doc.nombre_archivo}</p>
              {doc.tamanio_bytes && (
                <p className="text-[10px] mt-0.5" style={{ color: '#4b5563' }}>
                  {(doc.tamanio_bytes / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 p-2 rounded-lg" style={{ backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p className="text-xs" style={{ color: '#f87171' }}>⚠ Documento no adjunto al expediente</p>
            </div>
          )}
        </div>

        {/* 2. Revisión de datos */}
        <div className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
            2. Revisión de datos
          </p>
          {rows.length > 0 ? (
            <dl className="space-y-2.5">
              {rows.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-[9px] uppercase tracking-wide" style={{ color: '#4b5563' }}>{label}</dt>
                  <dd className="text-xs font-semibold break-all" style={{ color: '#e5e7eb' }}>{value}</dd>
                </div>
              ))}
            </dl>
          ) : okVals.length > 0 ? (
            <div className="space-y-2">
              {okVals.map(v => (
                <div key={v.id} className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs leading-relaxed" style={{ color: '#9ca3af' }}>{v.mensaje}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs" style={{ color: '#4b5563' }}>
              {doc
                ? 'Ejecuta "Validar con IA" para extraer y revisar los datos del documento.'
                : 'Sin documento adjunto. No es posible revisar datos.'}
            </p>
          )}
        </div>

        {/* 3. Motivo de devolución */}
        <div className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
            3. Motivo de devolución
          </p>
          {errorVals.length > 0 ? (
            <div className="space-y-2">
              {errorVals.map(v => (
                <div key={v.id} className="flex items-start gap-2">
                  <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs leading-relaxed" style={{ color: '#fca5a5' }}>{v.mensaje}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs font-medium text-green-400">Documentación validada.</p>
            </div>
          )}
        </div>

        {/* 4. Fundamento legal */}
        <div className="p-5">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7280' }}>
            4. Fundamento legal
          </p>
          <div className="space-y-2">
            {articulo ? (
              <>
                <p className="text-[9px] uppercase tracking-wide font-bold" style={{ color: '#6b7280' }}>Fundamento legal:</p>
                <p className="text-xs italic leading-relaxed" style={{ color: '#e5e7eb' }}>{articulo}</p>
              </>
            ) : (
              <div className="text-xs leading-relaxed space-y-2" style={{ color: '#6b7280' }}>
                <p>· Art. 134 Constitucional — Principios de eficiencia, eficacia y honradez.</p>
                <p>· Ley de Presupuesto de Egresos del Estado de Michoacán.</p>
                <p>· Reglamento Interior de la SFA.</p>
                <p>· Lineamientos de Control Interno de la DPP.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer IA */}
      {iaVals.length > 0 && (
        <div className="px-6 py-4 border-t flex flex-wrap gap-2 items-center" style={{ borderColor: '#374151', backgroundColor: 'rgba(124,58,237,0.1)' }}>
          <Sparkles size={12} className="text-purple-400 flex-shrink-0" />
          <span className="text-[9px] font-bold uppercase tracking-wide text-purple-400 mr-2">Gemini IA:</span>
          {iaVals.map(v => (
            <span key={v.id} className={clsx(
              'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full',
              v.resultado === 'exitosa'    && 'bg-green-900/60 text-green-300',
              v.resultado === 'advertencia'&& 'bg-amber-900/60 text-amber-300',
              v.resultado === 'error'      && 'bg-red-900/60 text-red-300',
              v.resultado === 'no_aplica'  && 'bg-gray-800 text-gray-400',
            )}>
              {v.resultado === 'exitosa' ? <CheckCircle2 size={9}/> : v.resultado === 'error' ? <XCircle size={9}/> : <AlertTriangle size={9}/>}
              {getValidacionLabel(v.tipo_validacion)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadZone({ deppId, onUploaded }: { deppId: string; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (files: File[]) => deppsApi.uploadDocumentos(deppId, files),
    onSuccess: () => { onUploaded(); setError('') },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Error al subir el archivo.')
    },
  })
  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    mutation.mutate(Array.from(files))
  }
  return (
    <div>
      {error && <Alert variant="error" className="mb-3 text-xs">{error}</Alert>}
      <div
        className={clsx(
          'border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors',
          isDragging ? 'bg-red-50' : 'border-gray-200 hover:bg-red-50/40',
          mutation.isPending && 'opacity-50 pointer-events-none',
        )}
        style={{ borderColor: isDragging ? GUINDA : undefined }}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files) }}
      >
        <input ref={fileRef} type="file" multiple accept=".pdf,.xml,.jpg,.jpeg,.png,.tiff"
          className="hidden" onChange={e => handleFiles(e.target.files)} />
        {mutation.isPending ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: GUINDA }} />
            <p className="text-sm" style={{ color: GUINDA }}>Cargando documentos...</p>
          </div>
        ) : (
          <>
            <Upload size={20} className="mx-auto text-gray-300 mb-1.5" />
            <p className="text-sm text-gray-600">
              <span className="font-semibold" style={{ color: GUINDA }}>Haz clic</span> o arrastra archivos aquí
            </p>
            <p className="text-xs text-gray-400 mt-0.5">PDF · XML · JPEG · PNG · TIFF — máx. 20 MB</p>
          </>
        )}
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────
export default function DEPPDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const [selectedDocTipo, setSelectedDocTipo] = useState<TipoDocumento | null>(null)
  const [showDocs, setShowDocs]         = useState(false)
  const [showAllVals, setShowAllVals]   = useState(false)
  const [showNormativa, setShowNormativa] = useState(false)

  const { data: depp, isLoading, isError } = useQuery({
    queryKey: ['depp', id],
    queryFn: () => deppsApi.get(id!),
    enabled: !!id,
  })

  const validarMutation = useMutation({
    mutationFn: () => deppsApi.validar(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['depp', id] }),
  })
  const validarIAMutation = useMutation({
    mutationFn: () => deppsApi.validarIA(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['depp', id] }),
  })
  const deleteDocMutation = useMutation({
    mutationFn: (docId: string) => deppsApi.eliminarDocumento(id!, docId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['depp', id] }),
  })

  if (isLoading) return <PageSpinner label="Cargando expediente..." />
  if (isError || !depp) return (
    <div className="p-8 text-center text-gray-500">Expediente no encontrado.</div>
  )

  const docStatus    = computeDocStatus(depp)
  const bannerColors = getBannerColors(depp.estado)
  const estadoPago   = getEstadoPago(depp)
  // Solo en_tramite permite editar (DEPP recién recibido, documentos aún no cerrados)
  const canEdit    = depp.estado === 'en_tramite' || depp.estado === 'borrador'
  // Puede validarse mientras no esté en estado terminal (aprobado)
  const canValidar = depp.estado !== 'aprobado' && depp.estado !== 'pagado'
  const resumenIA    = depp.validaciones.find(v => v.tipo_validacion === 'normativa_ia_resumen')

  // Extraer campos — primero del modelo DEPP (más confiable), luego del doc extraído
  const partida    = getExtracted(depp, 'partida') || (depp.partida ? String(depp.partida) : '')
  const fondo      = depp.fuente_nombre
    ? `${depp.fuente_financiamiento ? depp.fuente_financiamiento + ' · ' : ''}${depp.fuente_nombre}`
    : getExtracted(depp, 'fondo', 'fondo_financiamiento', 'fuente_financiamiento')
  const periodo    = getExtracted(depp, 'periodo', 'periodo_presupuestal', 'mes')
  const notas      = depp.notas_aclaraciones || getExtracted(depp, 'notas', 'descripcion', 'concepto', 'observaciones')
  const ur         = depp.ur || getExtracted(depp, 'ur', 'unidad_responsable')
  const ue         = depp.ue || getExtracted(depp, 'ue', 'unidad_ejecutora')
  const clave_pres = depp.clave_presupuestaria || getExtracted(depp, 'clave_presupuestaria', 'clave_programatica')
  const deduccs    = getExtracted(depp, 'deducciones', 'retenciones')

  const montoTotal  = Number(depp.monto_total ?? 0)
  const montoDeducc = Number(deduccs) || 0
  const liquido     = montoTotal - montoDeducc

  const clasificLabel = depp.clasificador_tipo
    ? `${depp.clasificador_tipo} — ${CLASIFICACION_LABELS[depp.clasificador_tipo] ?? ''}`
    : ''

  const estadoProgress =
      depp.estado === 'aprobado' || depp.estado === 'pagado'       ? 100
    : depp.estado === 'rechazado' || depp.estado === 'observado'   ? 20
    : depp.estado === 'en_revision' || depp.estado === 'en_validacion' ? 60
    : 30  // en_tramite / borrador

  return (
    <div className="min-h-full bg-gray-100">

      {/* ── Barra de acciones (sticky) ──────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-10 shadow-sm print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0">
            <ArrowLeft size={15} />
            <span className="hidden sm:inline text-xs">Volver</span>
          </button>
          <div className="h-4 w-px bg-gray-200 flex-shrink-0" />
          <span className="font-mono font-bold text-gray-900 text-sm truncate">{depp.folio}</span>
          <span className={clsx(
            'text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0',
            (depp.estado === 'aprobado' || depp.estado === 'pagado')         && 'bg-green-100 text-green-800',
            (depp.estado === 'rechazado' || depp.estado === 'observado')     && 'bg-red-100 text-red-800',
            (depp.estado === 'en_revision' || depp.estado === 'en_validacion') && 'bg-amber-100 text-amber-800',
            (depp.estado === 'en_tramite' || depp.estado === 'borrador')     && 'bg-sky-100 text-sky-800',
          )}>
            {(depp.estado === 'aprobado' || depp.estado === 'pagado')       ? 'APROBADO'
              : (depp.estado === 'rechazado' || depp.estado === 'observado')  ? 'RECHAZADO'
              : (depp.estado === 'en_revision' || depp.estado === 'en_validacion') ? 'EN REVISIÓN'
              : 'EN TRÁMITE'}
          </span>
          {/* Badge PAGO / NO PAGO */}
          {depp.tipo_depp && (
            <span className={clsx(
              'text-[10px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0',
              depp.tipo_depp === 'PAGO'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-orange-50 text-orange-700 border-orange-200',
            )}>
              {depp.tipo_depp === 'PAGO' ? '⬆ PAGO' : '↺ NO PAGO'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Botón Normativa — abre el panel de base de conocimiento */}
          <button
            onClick={() => setShowNormativa(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all"
            style={{ borderColor: '#911A3A', color: '#911A3A', background: 'white' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#fff1f2' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white' }}
            title="Abrir base normativa y checklist de revisión"
          >
            <BookOpen size={13} />
            <span className="hidden sm:inline">Normativa</span>
          </button>

          <div className="h-4 w-px bg-gray-200" />

          <Button variant="secondary" size="sm" icon={<Printer size={13} />} onClick={() => window.print()}>
            Imprimir
          </Button>
          {canValidar && (
            <Button variant="secondary" size="sm" icon={<ShieldCheck size={13} />}
              loading={validarMutation.isPending} onClick={() => validarMutation.mutate()}>
              Validar
            </Button>
          )}
          {canValidar && (
            <button
              disabled={validarIAMutation.isPending}
              onClick={() => validarIAMutation.mutate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-bold rounded-lg transition-all disabled:opacity-60 shadow-sm"
              style={{ backgroundColor: '#7c3aed' }}
            >
              {validarIAMutation.isPending ? (
                <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analizando...</>
              ) : (
                <><BrainCircuit size={13} /> Validar con IA</>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="p-6 space-y-4 max-w-7xl mx-auto">
        {/* Alertas */}
        {validarMutation.isError && <Alert variant="error">Error al ejecutar la validación estructural.</Alert>}
        {validarIAMutation.isError && <Alert variant="error">Error al ejecutar la validación IA. Intenta de nuevo.</Alert>}
        {validarIAMutation.isPending && (
          <Alert variant="info">
            <strong>Gemini IA analizando el expediente…</strong> Esto puede tomar hasta 60 segundos. No cierre esta ventana.
          </Alert>
        )}

        {/* ── BANNER DICTAMEN ───────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden shadow-lg print:shadow-none" style={{ backgroundColor: bannerColors.bg }}>
          <div className="flex items-center justify-between px-7 py-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                   style={{ backgroundColor: 'rgba(255,255,255,0.13)' }}>
                <CheckCircle2 size={26} style={{ color: bannerColors.accent }} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest"
                   style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Secretaría de Finanzas y Administración · DPP
                </p>
                <h2 className="text-xl font-black uppercase tracking-wide mt-0.5"
                    style={{ color: bannerColors.text }}>
                  Dictamen de Validación
                </h2>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono font-bold text-base" style={{ color: bannerColors.text }}>{depp.folio}</p>
              <p className="text-xs font-bold uppercase tracking-wide mt-1"
                 style={{ color: bannerColors.accent }}>{estadoPago}</p>
              {depp.fecha_validacion && (
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Validado: {formatDate(depp.fecha_validacion)}
                </p>
              )}
            </div>
          </div>
          <div style={{ height: 4, backgroundColor: 'rgba(0,0,0,0.2)' }}>
            <div style={{ height: '100%', width: `${estadoProgress}%`, backgroundColor: bannerColors.accent, transition: 'width 1s ease' }} />
          </div>
        </div>

        {/* ── RESUMEN DE DATOS EXTRAÍDOS ────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
            <Info size={12} className="text-gray-400" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Resumen de Datos Extraídos — Fuente: DEPP
            </p>
          </div>

          <div className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-5">
            {/* ── Fila 1: Identificación ── */}
            <DataField label="DEPP (Solicitud)"
              value={<span className="font-mono text-sm font-bold">{depp.folio}</span>}
            />
            <DataField label="Beneficiario / Proveedor"
              value={depp.beneficiario || '—'} wide={!(ue || ur)}
            />
            {/* UPP con nombre completo desde catálogo */}
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">UPP</p>
              <UPPBadge codigo={depp.upp} showNombre showClasificacion />
            </div>
            {(ue || ur) && (
              <DataField
                label={ue ? 'UE (Unidad Ejecutora)' : 'UR (Unidad Responsable)'}
                value={ue || ur || '—'}
              />
            )}
            <DataField label="Clave Presupuestaria"
              value={clave_pres || (depp.partida ? String(depp.partida) : '—')} mono
            />

            {/* ── Fila 2: Clasificación presupuestal ── */}
            <DataField label="Fondo / Financiamiento" value={fondo || '—'} />
            <DataField label="Partida (Clave)"
              value={partida || (depp.partida ? String(depp.partida) : '—')} mono
            />
            <DataField label="Capítulo"
              value={depp.capitulo ? `${depp.capitulo} · ${CAPITULO_LABELS[depp.capitulo] ?? ''}` : '—'}
            />
            <DataField label="Periodo Presupuestal"
              value={periodo || (depp.mes ? `Mes ${depp.mes}` : `Ejercicio ${depp.ejercicio}`)}
            />
            <DataField
              label={depp.clasificador_sap ? `Clasificación (SAP: ${depp.clasificador_sap})` : 'Clasificación'}
              value={clasificLabel || '—'}
            />
          </div>

          {/* ── Fila de datos de pago / regularización (condicional) ── */}
          {(depp.clave_acreedor || depp.cuenta_abono || depp.provisional_vale) && (
            <div className={clsx(
              'mx-6 mb-4 px-4 py-3 rounded-xl border flex flex-wrap gap-x-8 gap-y-3',
              depp.tipo_depp === 'PAGO'
                ? 'bg-blue-50 border-blue-100'
                : 'bg-orange-50 border-orange-100',
            )}>
              <p className={clsx(
                'w-full text-[9px] font-bold uppercase tracking-widest mb-0.5',
                depp.tipo_depp === 'PAGO' ? 'text-blue-500' : 'text-orange-500',
              )}>
                {depp.tipo_depp === 'PAGO' ? '⬆ Datos de Pago Financiero' : '↺ Datos de Regularización (NO PAGO)'}
              </p>
              {depp.clave_acreedor && (
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Clave Acreedor (SAP)</p>
                  <p className="font-mono text-sm font-bold text-gray-800">{depp.clave_acreedor}</p>
                </div>
              )}
              {depp.cuenta_abono && (
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Cuenta ABONO (CLABE)</p>
                  <p className="font-mono text-sm font-bold text-gray-800">{depp.cuenta_abono}</p>
                </div>
              )}
              {depp.provisional_vale && (
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1">Vale / Provisional</p>
                  <p className="font-mono text-sm font-bold text-gray-800">{depp.provisional_vale}</p>
                </div>
              )}
            </div>
          )}

          {/* Fila: Notas + Cálculo de Finanzas */}
          <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-3 gap-6 border-t border-gray-50 pt-5">
            <div className="lg:col-span-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                Notas y/o Aclaraciones
                {depp.tipo_depp === 'NO_PAGO' && (
                  <span className="ml-2 text-orange-500 normal-case font-semibold">
                    · Incluye referencia al vale que regulariza
                  </span>
                )}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">
                {notas || <span className="text-gray-300 italic">Sin notas registradas.</span>}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-3">
                Cálculo de Finanzas
              </p>
              <dl className="space-y-2.5">
                {[
                  { label: 'Importe del cargo:',  val: formatCurrency(montoTotal) },
                  { label: 'Deducciones:',         val: montoDeducc > 0 ? formatCurrency(montoDeducc) : '$0.00' },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between text-sm">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-semibold text-gray-800">{val}</dd>
                  </div>
                ))}
                <div className="border-t border-gray-200 pt-2 flex justify-between items-baseline">
                  <dt className="font-bold text-gray-800 text-sm">Líquido:</dt>
                  <dd className="font-black text-gray-900 text-lg">{formatCurrency(liquido)}</dd>
                </div>
              </dl>
              {depp.puede_aprobar && (
                <p className="mt-3 text-xs font-bold text-green-700 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Apto para aprobación
                </p>
              )}
            </div>
          </div>

          {/* Resumen IA */}
          {resumenIA?.mensaje && (
            <div className="mx-6 mb-6 p-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={13} className="text-purple-600" />
                <p className="text-[10px] font-bold text-purple-800 uppercase tracking-wide">
                  Análisis Gemini IA · {formatDateTime(resumenIA.ejecutada_en)}
                </p>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{resumenIA.mensaje}</p>
            </div>
          )}
        </div>

        {/* ── ESTATUS DE COMPROBACIÓN ───────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={12} className="text-gray-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Estatus de Comprobación — Auditoría Técnica
              </p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-semibold text-gray-400">
              <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-green-500" /> Correcto</span>
              <span className="flex items-center gap-1"><XCircle size={11} className="text-red-500" /> Incorrecto</span>
              <span className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full border-2 border-dashed border-gray-300" /> N/A
              </span>
            </div>
          </div>

          <div className="p-6">
            <p className="text-xs text-gray-400 mb-4">
              Haz clic en un documento para ver el <strong>desglose técnico y normativo</strong> detallado.
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
              {ALL_DOC_TYPES.map(tipo => (
                <DocTypeCard
                  key={tipo} tipo={tipo}
                  status={docStatus[tipo]}
                  doc={depp.documentos.find(d => d.tipo === tipo)}
                  active={selectedDocTipo === tipo}
                  onClick={() => setSelectedDocTipo(prev => prev === tipo ? null : tipo)}
                />
              ))}
            </div>

            {depp.validado_automaticamente && !depp.puede_aprobar && (
              <div className="mt-4 flex items-start gap-2.5 p-3 bg-amber-50 rounded-xl border border-amber-200">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  El expediente tiene observaciones que requieren atención. Haz clic en los documentos
                  marcados como <strong>Incorrecto</strong> para revisar el motivo de devolución y el fundamento legal.
                </p>
              </div>
            )}
            {!depp.validado_automaticamente && depp.documentos.length > 0 && (
              <div className="mt-4 flex items-start gap-2.5 p-3 bg-blue-50 rounded-xl border border-blue-200">
                <Info size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-800">
                  El expediente aún no ha sido validado. Usa <strong>Validar</strong> para la verificación
                  estructural o <strong>Validar con IA</strong> para el análisis normativo completo con Gemini.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── DESGLOSE TÉCNICO Y NORMATIVO ─────────────────────────────────── */}
        {selectedDocTipo && (
          <DesglosePanel
            depp={depp}
            docTipo={selectedDocTipo}
            onClose={() => setSelectedDocTipo(null)}
          />
        )}

        {/* ── VALIDACIONES DETALLADAS (collapsible) ────────────────────────── */}
        {depp.validaciones.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              className="w-full px-6 py-3 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
              onClick={() => setShowAllVals(!showAllVals)}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={12} className="text-gray-400" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Detalle de Validaciones ({depp.validaciones.filter(v => v.tipo_validacion !== 'normativa_ia_resumen').length} reglas)
                </p>
              </div>
              {showAllVals ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </button>
            {showAllVals && (
              <div className="p-4 grid grid-cols-1 gap-2">
                {depp.validaciones
                  .filter(v => v.tipo_validacion !== 'normativa_ia_resumen')
                  .map(v => {
                    const cfg = RESULTADO_CONFIG[v.resultado] ?? RESULTADO_CONFIG.advertencia
                    return (
                      <div key={v.id}
                        className={clsx('border rounded-lg px-4 py-2.5 flex items-start gap-3', cfg.bg)}>
                        {v.resultado === 'exitosa'    && <CheckCircle2 size={14} className="text-green-600 mt-0.5 flex-shrink-0" />}
                        {v.resultado === 'error'      && <XCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />}
                        {v.resultado === 'advertencia'&& <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />}
                        {v.resultado === 'no_aplica'  && <Info size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={clsx('text-xs font-bold', cfg.color)}>
                              {getValidacionLabel(v.tipo_validacion)}
                            </span>
                            {isIAValidation(v.tipo_validacion) && (
                              <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">Gemini IA</span>
                            )}
                            {v.gravedad && (
                              <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full font-semibold', GRAVEDAD_CONFIG[v.gravedad]?.color)}>
                                {GRAVEDAD_CONFIG[v.gravedad]?.label}
                              </span>
                            )}
                            {v.articulo_manual && (
                              <span className="text-[9px] text-gray-400 italic">{v.articulo_manual}</span>
                            )}
                          </div>
                          {v.mensaje && <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{v.mensaje}</p>}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}

        {/* ── GESTIÓN DE DOCUMENTOS (collapsible) ──────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden print:hidden">
          <button
            className="w-full px-6 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
            onClick={() => setShowDocs(!showDocs)}
          >
            <div className="flex items-center gap-2">
              <FileText size={12} className="text-gray-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                Gestión de Documentos Adjuntos
              </p>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold">
                {depp.documentos.length} archivo{depp.documentos.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <span className="text-[10px] text-green-600 font-bold flex items-center gap-1 mr-1">
                  <Plus size={10} /> Agregar documentos
                </span>
              )}
              {showDocs ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </div>
          </button>

          {showDocs && (
            <div className="px-6 pb-6 border-t border-gray-100 pt-4 space-y-3">
              {depp.documentos.length > 0 && (
                <div className="divide-y divide-gray-50 mb-4">
                  {depp.documentos.map(doc => {
                    const ext = doc.nombre_archivo.split('.').pop()?.toUpperCase() ?? ''
                    return (
                      <div key={doc.id} className="flex items-center gap-3 py-2.5">
                        <div className={clsx(
                          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black',
                          ext === 'XML' && 'bg-orange-100 text-orange-700',
                          ext === 'PDF' && 'bg-red-100 text-red-700',
                          !['XML','PDF'].includes(ext) && 'bg-gray-100 text-gray-600',
                        )}>{ext || '?'}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{doc.nombre_archivo}</p>
                          <p className="text-xs text-gray-500">
                            <span className="font-bold" style={{ color: GUINDA }}>{doc.tipo}</span>
                            {' — '}{TIPO_DOC_LABELS[doc.tipo] ?? doc.tipo}
                            {doc.datos_extraidos && !(doc.datos_extraidos as Record<string,unknown>)._mock && (
                              <span className="ml-2 text-green-600 font-medium">✓ datos extraídos</span>
                            )}
                          </p>
                        </div>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDate(doc.subido_en)}</span>
                        {canEdit && (
                          <button
                            onClick={() => confirm(`¿Eliminar ${doc.nombre_archivo}?`) && deleteDocMutation.mutate(doc.id)}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {canEdit && (
                <UploadZone
                  deppId={depp.id}
                  onUploaded={() => qc.invalidateQueries({ queryKey: ['depp', id] })}
                />
              )}
              {!canEdit && depp.documentos.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">Sin documentos adjuntos.</p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Panel de Normativa (slide-over) ────────────────────────────────── */}
      <NormativaPanel
        open={showNormativa}
        onClose={() => setShowNormativa(false)}
        tipoTramite="beneficiarios_directos"
        clasificacion={depp.clasificador_tipo ?? undefined}
        folio={depp.folio}
      />
    </div>
  )
}
