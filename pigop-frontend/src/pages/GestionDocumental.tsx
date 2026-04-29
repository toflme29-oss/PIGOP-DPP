import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { makePermissionChecker } from '../utils/rolePermissions'
import { usePermissionsVersion } from '../hooks/usePermissionsVersion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FolderOpen, Plus, Search, FileText, Trash2, Upload,
  X, CheckCircle2, Clock, SlidersHorizontal,
  Wand2, Send, AlertTriangle, Eye, Edit3, RotateCcw,
  ArrowRight, InboxIcon, SendIcon, Building2,
  Download, Shield, BookOpen, FileSignature,
  History, CornerUpLeft, RefreshCw, Lock, Hash, Mail, ChevronLeft, ChevronRight,
  ClipboardCheck, ArrowLeftRight, FileSearch,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  documentosApi,
  certificadosApi,
  TIPO_LABELS, TIPO_ICONS,
  PRIORIDAD_CONFIG,
  ESTADO_RECIBIDO_CONFIG, ESTADO_EMITIDO_CONFIG,
  type DocumentoListItem, type Documento,
  type DocumentoRecibidoCreate, type DocumentoEmitidoCreate,
  type DocumentoUpdate, type PreviewOCRResult,
  type HistorialItem,
  type TipoDocumento, type Prioridad, type EstadoRecibido,
  type AreaDPP,
  type PlantillaOficio,
  type CertificadoInfo,
} from '../api/documentos'
import { catalogoApi, type FuncionarioItem } from '../api/documentos'
import { clientesApi, type Cliente } from '../api/depps'
import { uppsApi, type UPP } from '../api/upps'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Spinner'
import { formatDate, formatDateTime, localToday } from '../utils'
import FirmaLoteWizard from './FirmaLoteWizard'
import RegistroCertificado from './RegistroCertificado'
import ControlOficios from './ControlOficios'

const GUINDA = '#911A3A'
const TIPOS: TipoDocumento[] = [
  'oficio','circular','memorandum','acuerdo','convenio','resolucion','informe','otro',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function diasHasta(fechaStr: string | null): number | null {
  if (!fechaStr) return null
  const diff = new Date(fechaStr).getTime() - Date.now()
  return Math.ceil(diff / 86400000)
}

// ── Autocompletado de destinatario desde catálogo ─────────────────────────────
function DestinatarioAutocomplete({ form, set }: {
  form: { destinatario_nombre?: string; destinatario_cargo?: string; dependencia_destino?: string }
  set: (k: keyof DocumentoEmitidoCreate, v: unknown) => void
}) {
  const [results, setResults] = useState<FuncionarioItem[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setShowDropdown(false); return }
    setSearching(true)
    try {
      const r = await catalogoApi.buscarFuncionarios(q)
      setResults(r)
      setShowDropdown(r.length > 0)
    } catch { setResults([]) }
    setSearching(false)
  }, [])

  const handleInputChange = (value: string) => {
    set('destinatario_nombre', value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(value), 300)
  }

  const selectFuncionario = (f: FuncionarioItem) => {
    set('destinatario_nombre', f.nombre_titular || '')
    set('destinatario_cargo', f.nombre_ur || '')
    set('dependencia_destino', f.nombre_upp || '')
    setShowDropdown(false)
  }

  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-medium text-gray-600 mb-1">Destinatario</p>
      <div className="relative">
        <label className="block text-[10px] text-gray-500 mb-1">Nombre completo <span className="text-blue-500">(escriba para buscar en catálogo)</span></label>
        <div className="relative">
          <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm pr-8"
            placeholder="Escriba nombre, dependencia o cargo..."
            value={form.destinatario_nombre ?? ''}
            onChange={e => handleInputChange(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowDropdown(true) }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)} />
          {searching && <RotateCcw size={12} className="absolute right-2.5 top-2 text-blue-400 animate-spin" />}
          {!searching && <Search size={12} className="absolute right-2.5 top-2 text-gray-400" />}
        </div>
        {showDropdown && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
            {results.map(f => (
              <button key={f.id} type="button"
                className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 transition-colors"
                onMouseDown={() => selectFuncionario(f)}>
                <p className="text-xs font-medium text-gray-800">{f.nombre_titular}</p>
                <p className="text-[10px] text-gray-500">{f.nombre_ur} · <span className="text-blue-600">{f.nombre_upp}</span></p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">Cargo / Área</label>
        <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          placeholder="Delegada Administrativa"
          value={form.destinatario_cargo ?? ''} onChange={e => set('destinatario_cargo', e.target.value)} />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-1">Dependencia / Entidad</label>
        <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          placeholder="Secretaría de Finanzas y Administración"
          value={form.dependencia_destino ?? ''} onChange={e => set('dependencia_destino', e.target.value)} />
      </div>
      <p className="text-[9px] text-gray-400">En el oficio aparecerá: Nombre → Cargo → Dependencia → PRESENTE.</p>
    </div>
  )
}

function SemaforoAtencion({ fecha, estado }: { fecha: string | null; estado: string }) {
  // Solo mostrar semáforo para estados activos (turnado, en_atencion)
  const estadosActivos = ['turnado', 'en_atencion', 'devuelto']
  if (!estadosActivos.includes(estado)) return null
  if (!fecha) return <span className="text-[9px] text-gray-400">Sin plazo</span>
  const dias = diasHasta(fecha)
  if (dias === null) return null
  // 🟢 Verde: en tiempo (>2 días)  🟡 Amarillo: próximo a vencer (≤2 días)  🔴 Rojo: vencido
  if (dias < 0) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />Vencido ({Math.abs(dias)}d)
    </span>
  )
  if (dias <= 2) return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700">
      <span className="w-2 h-2 rounded-full bg-yellow-500" />{dias === 0 ? 'Vence hoy' : `${dias}d restante${dias > 1 ? 's' : ''}`}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
      <span className="w-2 h-2 rounded-full bg-green-500" />{dias}d hábiles
    </span>
  )
}

export function EstadoRecibidoBadge({ estado }: { estado: string }) {
  const cfg = ESTADO_RECIBIDO_CONFIG[estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
  if (!cfg) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

function PrioridadBadge({ prioridad }: { prioridad: Prioridad }) {
  const cfg = PRIORIDAD_CONFIG[prioridad] ?? PRIORIDAD_CONFIG.normal
  if (prioridad === 'normal') return null
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {prioridad === 'muy_urgente' && '🚨'} {cfg.label}
    </span>
  )
}

// ── Visor flotante de documentos (Punto 7) ────────────────────────────────────
function VisorFlotante({ url, titulo, onClose, onDownload, firmado }: {
  url: string; titulo: string; onClose: () => void; onDownload?: () => void; firmado?: boolean | null
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} style={{ color: '#911A3A' }} />
            <h2 className="text-sm font-bold text-gray-900 truncate">{titulo}</h2>
            {firmado && (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-medium rounded-full border border-emerald-200">
                <Shield size={9} /> Firmado
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onDownload && (
              <button onClick={onDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">
                <Download size={12} /> Descargar
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 overflow-hidden" style={{ minHeight: 500 }}>
          <iframe src={url} title={titulo} className="w-full h-full" style={{ border: 'none', height: 'calc(95vh - 60px)' }} />
        </div>
      </div>
    </div>
  )
}

// ── Pipeline de progreso ───────────────────────────────────────────────────────
const PASOS_RECIBIDO = ['Recibido', 'Turnado', 'En atención', 'Respondido', 'Firmado']
function PipelineRecibido({ estado }: { estado: string }) {
  const cfg = ESTADO_RECIBIDO_CONFIG[estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
  const step = cfg?.step ?? 0
  return (
    <div className="flex items-start w-full">
      {PASOS_RECIBIDO.map((label, i) => {
        const n = i + 1
        const done   = n < step
        const active = n === step
        return (
          <div key={label} className="flex-1 flex flex-col items-center min-w-0">
            {/* Línea + punto */}
            <div className="w-full flex items-center">
              <div className={clsx('flex-1 h-px', i === 0 ? 'opacity-0' : n <= step ? 'bg-green-400' : 'bg-gray-200')} />
              <div className={clsx(
                'w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all',
                done   ? 'bg-green-500' :
                active ? 'bg-blue-500 ring-2 ring-blue-200' :
                         'bg-gray-200',
              )} />
              <div className={clsx('flex-1 h-px', i === PASOS_RECIBIDO.length - 1 ? 'opacity-0' : done ? 'bg-green-400' : 'bg-gray-200')} />
            </div>
            {/* Etiqueta */}
            <span className={clsx(
              'text-[9px] mt-1 text-center leading-tight font-medium px-0.5',
              active ? 'text-blue-700' : done ? 'text-green-600' : 'text-gray-400',
            )}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Modal Registrar Oficio Recibido (Wizard: Upload → OCR → Form) ────────────
function ModalRegistrarRecibido({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (doc: DocumentoListItem) => void }) {
  const { user } = useAuth()
  const { data: clientes } = useQuery({
    queryKey: ['clientes'], queryFn: clientesApi.list,
    enabled: user?.rol === 'superadmin',
  })
  // Catálogo de dependencias para el autocompletado de remitente_dependencia
  const { data: catalogoDepend = [] } = useQuery({
    queryKey: ['clientes-catalogo'], queryFn: clientesApi.list,
    staleTime: 5 * 60_000,
  })
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: documentosApi.crearRecibido,
    onSuccess: (doc) => { qc.invalidateQueries({ queryKey: ['documentos'] }); onCreated(doc) },
  })
  const clienteId = user?.rol === 'superadmin' ? (clientes?.[0]?.id ?? '') : (user?.cliente_id ?? '')

  // Wizard state
  const [step, setStep] = useState<'upload' | 'crop' | 'processing' | 'review' | 'manual'>('upload')
  const [ocrResult, setOcrResult] = useState<PreviewOCRResult | null>(null)
  const [ocrFalló, setOcrFalló] = useState(false)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  // Blob URL para vista previa local del documento (no depende del URL de storage)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null)
  useEffect(() => {
    return () => { if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl) }
  }, [previewBlobUrl])

  const [form, setForm] = useState<DocumentoRecibidoCreate>({
    cliente_id: clienteId,
    tipo: 'oficio',
    asunto: '',
    numero_oficio_origen: '',
    remitente_nombre: '',
    remitente_cargo: '',
    remitente_dependencia: '',
    fecha_documento: localToday(),
    fecha_recibido: localToday(),
    prioridad: 'normal',
    descripcion: '',
  })
  const [err, setErr] = useState('')
  const set = (k: keyof DocumentoRecibidoCreate, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  // Handle file selection → check if image → crop or OCR directly
  const handleFileSelectOrCrop = useCallback((file: File) => {
    setFileName(file.name)
    setErr('')
    const isImage = /^image\/(jpeg|jpg|png|tiff|webp)$/.test(file.type)
    if (isImage) {
      // Show crop option for images
      setCropFile(file)
      const img = new Image()
      img.onload = () => { setCropImage(img); setStep('crop') }
      img.src = URL.createObjectURL(file)
    } else {
      // PDF/Word → process directly
      handleFileSelect(file)
    }
  }, [])

  // Handle file selection → OCR processing
  const handleFileSelect = useCallback(async (file: File) => {
    setFileName(file.name)
    setErr('')
    setStep('processing')
    try {
      const result = await documentosApi.previewOCR(file)
      setOcrResult(result)

      // ── Extracción robusta: prueba múltiples nombres de campo que la IA puede devolver ──
      let raw: Record<string, unknown> = result.datos_extraidos ?? {}

      // Si el backend no pudo parsear el JSON (devuelve raw_response), intentar re-parsear aquí
      if (raw['raw_response'] && typeof raw['raw_response'] === 'string') {
        try {
          const txt = (raw['raw_response'] as string).trim()
          const start = txt.indexOf('{')
          const end   = txt.lastIndexOf('}')
          if (start !== -1 && end > start) {
            const parsed = JSON.parse(txt.slice(start, end + 1))
            if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>
          }
        } catch { /* mantener raw original */ }
      }

      const d: Record<string, unknown> = raw
      const str = (...keys: string[]): string => {
        for (const k of keys) {
          const v = d[k]
          if (v && typeof v === 'string' && v.trim()) return v.trim()
          if (v && typeof v === 'object' && v !== null && 'value' in (v as object)) {
            const inner = (v as { value: unknown }).value
            if (inner && typeof inner === 'string' && inner.trim()) return inner.trim()
          }
          // Manejar arrays: tomar primer elemento si es string
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string' && v[0].trim()) {
            return v[0].trim()
          }
        }
        return ''
      }

      const asunto        = str('asunto', 'subject', 'tema', 'asunto_principal', 'titulo')
      const numeroOficio  = str('numero_memorandum', 'numero_oficio', 'num_oficio', 'numero', 'folio', 'oficio', 'no_oficio', 'n_oficio')
      const remitenteNom  = str('remitente_nombre', 'firmante', 'remitente', 'nombre_firmante', 'nombre_remitente', 'suscribe')
      const remitenteCar  = str('remitente_cargo', 'cargo', 'puesto', 'cargo_firmante')
      const remitenteDep  = str('remitente_dependencia', 'dependencia', 'institucion', 'organizacion', 'entidad', 'origen')
      const fechaDoc      = str('fecha_documento', 'fecha', 'fecha_oficio', 'fecha_emision', 'date')
      const descripcion   = str('cuerpo_resumen', 'cuerpo', 'resumen', 'descripcion', 'contenido', 'body')

      const esMemorandum =
        (d.tipo_documento as string)?.toLowerCase() === 'memorandum' ||
        (d.tipo_documento as string)?.toLowerCase() === 'memorándum' ||
        (result.clasificacion.tipo_documento as string)?.toLowerCase() === 'memorandum' ||
        !!str('numero_memorandum')

      setForm(prev => ({
        ...prev,
        tipo: esMemorandum ? 'memorandum' : prev.tipo,
        asunto:               asunto       || prev.asunto,
        numero_oficio_origen: numeroOficio || prev.numero_oficio_origen,
        remitente_nombre:     remitenteNom || prev.remitente_nombre,
        remitente_cargo:      remitenteCar || prev.remitente_cargo,
        remitente_dependencia: remitenteDep || prev.remitente_dependencia,
        fecha_documento:      fechaDoc     || prev.fecha_documento,
        descripcion:          descripcion  || prev.descripcion,
        // File info
        nombre_archivo: result.archivo.nombre_archivo,
        url_storage:    result.archivo.url_storage,
        mime_type:      result.archivo.mime_type,
        // OCR data
        datos_extraidos_ia: result.datos_extraidos,
        ocr_procesado: true,
        // Classification
        sugerencia_area_codigo: (result.clasificacion.area_codigo as string) || undefined,
        sugerencia_area_nombre: (result.clasificacion.area_nombre as string) || undefined,
        sugerencia_fundamento:  (result.clasificacion.fundamento  as string) || undefined,
        sugerencia_plazo_dias:  (result.clasificacion.plazo_dias  as number) || undefined,
        confianza_clasificacion:(result.clasificacion.confianza   as number) || undefined,
        regla_turno_codigo:     (result.clasificacion.regla_codigo as string) || undefined,
        genera_tramite:         (result.clasificacion.genera_tramite as string) || undefined,
        fecha_limite:           result.fecha_limite || undefined,
        prioridad: (result.prioridad_sugerida as 'normal' | 'urgente' | 'muy_urgente') || prev.prioridad,
      }))
      // Detectar si la IA no devolvió ningún campo útil
      const camposExtraídos = [asunto, numeroOficio, remitenteNom, remitenteCar, remitenteDep, fechaDoc].filter(Boolean)
      setOcrFalló(camposExtraídos.length === 0)

      setStep('review')
      // Crear blob URL local para vista previa (no depende del URL de storage)
      setPreviewBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    } catch (e: unknown) {
      const resp = (e as { response?: { data?: { detail?: string }; status?: number } })?.response
      const msg = resp?.data?.detail
      const status = resp?.status
      let errorMsg: string
      if (status === 413) {
        errorMsg = 'El archivo excede el tamaño máximo permitido (20 MB).'
      } else if (status === 415 || (msg && msg.toLowerCase().includes('tipo'))) {
        errorMsg = 'Formato de archivo no soportado. Use PDF, Word, JPG, PNG, TIFF o WEBP.'
      } else if (msg && msg.toLowerCase().includes('gemini')) {
        errorMsg = 'Error en el servicio de OCR (IA). Puedes intentar de nuevo o usar captura manual.'
      } else {
        errorMsg = msg || 'Error al procesar el documento. Intenta de nuevo o usa captura manual.'
      }
      setErr(errorMsg)
      setStep('upload')
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!form.asunto.trim()) { setErr('El asunto es obligatorio.'); return }
    try { await mutation.mutateAsync({ ...form, cliente_id: form.cliente_id || clienteId }) }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al registrar.') }
  }

  const clasificacion = ocrResult?.clasificacion
  const confianza = clasificacion?.confianza as number | undefined

  const hasPdfPreview = step === 'review' && !!previewBlobUrl

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      {/* Catálogo de dependencias para autocompletado */}
      <datalist id="depend-catalog">
        {catalogoDepend.filter(c => c.activo).map(c => (
          <option key={c.id} value={c.nombre} />
        ))}
      </datalist>

      <div className={clsx(
        'bg-white rounded-2xl shadow-2xl w-full flex flex-col',
        hasPdfPreview ? 'max-w-[92vw] w-[92vw] h-[92vh]' : 'max-w-lg max-h-[92vh] overflow-y-auto',
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
              <InboxIcon size={14} style={{ color: GUINDA }} />
            </div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {step === 'upload' ? 'Registrar oficio recibido' :
               step === 'processing' ? 'Procesando documento...' :
               step === 'review' ? 'Revisar datos extraídos' :
               'Captura manual'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Cuerpo: formulario (izquierda) + PDF previa (derecha cuando aplique) */}
        <div className="flex flex-1 overflow-hidden rounded-b-2xl">
          {/* Formulario — siempre visible; se angosta cuando hay PDF */}
          <div className={clsx(
            'overflow-y-auto px-6 py-5 flex-shrink-0',
            hasPdfPreview ? 'w-[42%] border-r border-gray-100 rounded-bl-2xl' : 'w-full rounded-b-2xl',
          )}>

          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-4 flex items-start gap-2">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p>{err}</p>
                {step === 'upload' && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => fileRef.current?.click()}
                      className="text-[10px] font-medium text-red-700 underline hover:text-red-900">
                      Reintentar con archivo
                    </button>
                    <span className="text-red-300">|</span>
                    <button onClick={() => { setErr(''); setStep('manual') }}
                      className="text-[10px] font-medium text-red-700 underline hover:text-red-900">
                      Captura manual
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP: UPLOAD ─────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <input ref={fileRef} type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelectOrCrop(f) }}
              />

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault(); setDragOver(false)
                  const f = e.dataTransfer.files[0]
                  if (f) handleFileSelectOrCrop(f)
                }}
                onClick={() => fileRef.current?.click()}
                className={clsx(
                  'border-2 border-dashed rounded-2xl py-10 px-6 text-center cursor-pointer transition-all',
                  dragOver
                    ? 'border-[#911A3A] bg-[#FDF2F4] scale-[1.01]'
                    : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50',
                )}
              >
                <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: '#FDF2F4' }}>
                  <Upload size={24} style={{ color: GUINDA }} />
                </div>
                <p className="text-sm font-semibold text-gray-800 mb-1">
                  Sube el escaneo o foto del oficio
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Arrastra el archivo aqui o haz clic para seleccionar
                </p>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-lg"
                  style={{ backgroundColor: GUINDA }}>
                  <Upload size={13} /> Seleccionar archivo
                </span>
                <p className="text-[10px] text-gray-400 mt-3">
                  PDF, Word, JPG, PNG, TIFF, WEBP &mdash; Max. 20 MB
                </p>
              </div>

              {/* IA explanation */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <Wand2 size={14} className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-blue-800">
                      La IA extraera automaticamente:
                    </p>
                    <p className="text-[10px] text-blue-600 mt-0.5 leading-relaxed">
                      Remitente, cargo, dependencia, numero de oficio, asunto, fecha, clasificacion y area de turno sugerida
                    </p>
                  </div>
                </div>
              </div>

              {/* Manual capture fallback */}
              <div className="text-center pt-1">
                <button type="button"
                  onClick={() => setStep('manual')}
                  className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors">
                  No tengo el documento escaneado &rarr; captura manual
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: CROP (recorte de imagen) ─────────────────── */}
          {step === 'crop' && cropImage && cropFile && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-amber-800">Recorte de imagen (opcional)</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    Si la foto contiene elementos fuera del oficio (fondo, sombras, objetos), puede recortar la imagen para mejorar la extracción de datos.
                  </p>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center" style={{ maxHeight: 350 }}>
                <img
                  src={cropImage.src}
                  alt="Vista previa"
                  className="max-w-full max-h-[340px] object-contain"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Skip crop, use original
                    if (cropFile) handleFileSelect(cropFile)
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-medium text-white"
                  style={{ backgroundColor: GUINDA }}
                >
                  <CheckCircle2 size={13} /> Usar imagen completa
                </button>
                <button
                  onClick={() => {
                    // Crop using canvas
                    if (!cropImage || !cropFile) return
                    const canvas = document.createElement('canvas')
                    const ctx = canvas.getContext('2d')
                    if (!ctx) { handleFileSelect(cropFile); return }
                    // Auto-crop: trim 5% margins to remove common photo artifacts
                    const margin = 0.05
                    const sx = Math.floor(cropImage.width * margin)
                    const sy = Math.floor(cropImage.height * margin)
                    const sw = Math.floor(cropImage.width * (1 - 2 * margin))
                    const sh = Math.floor(cropImage.height * (1 - 2 * margin))
                    canvas.width = sw
                    canvas.height = sh
                    ctx.drawImage(cropImage, sx, sy, sw, sh, 0, 0, sw, sh)
                    canvas.toBlob(blob => {
                      if (blob) {
                        const cropped = new File([blob], cropFile.name, { type: cropFile.type })
                        handleFileSelect(cropped)
                      } else {
                        handleFileSelect(cropFile)
                      }
                    }, cropFile.type)
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  ✂️ Recortar márgenes
                </button>
              </div>
              <button
                onClick={() => { setStep('upload'); setCropImage(null); setCropFile(null) }}
                className="w-full text-center text-[10px] text-gray-500 hover:text-gray-700 underline"
              >
                ← Seleccionar otro archivo
              </button>
            </div>
          )}

          {/* ── STEP: PROCESSING ─────────────────────────────────── */}
          {step === 'processing' && (
            <div className="py-8 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#FDF2F4' }}>
                <RotateCcw size={28} className="animate-spin" style={{ color: GUINDA }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1">Procesando con IA...</p>
                <p className="text-xs text-gray-500">Esto puede tomar unos segundos</p>
              </div>
              <div className="max-w-xs mx-auto space-y-1.5 text-left">
                {[
                  'Leyendo texto del documento',
                  'Identificando remitente y destinatario',
                  'Extrayendo asunto y datos clave',
                  'Clasificando area de turno',
                ].map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse"
                      style={{ animationDelay: `${i * 0.3}s` }} />
                    {t}
                  </div>
                ))}
              </div>
              {fileName && (
                <p className="text-[10px] text-gray-400 mt-2 truncate max-w-[200px] mx-auto">
                  {fileName}
                </p>
              )}
            </div>
          )}

          {/* ── STEP: REVIEW (datos extraidos + formulario editable) ── */}
          {step === 'review' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Classification banner */}
              {clasificacion && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-green-700 flex items-center gap-1">
                      <Wand2 size={10} /> Clasificacion IA
                      {confianza && (
                        <span className="bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full text-[10px]">
                          {Math.round(confianza * 100)}%
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-green-900">
                    {clasificacion.area_nombre as string}
                  </p>
                  {clasificacion.fundamento ? (
                    <p className="text-[10px] text-green-600 mt-0.5 leading-tight">
                      {String(clasificacion.fundamento)}
                    </p>
                  ) : null}
                  {ocrResult?.fecha_limite && (
                    <p className="text-[10px] text-green-600 mt-1">
                      Plazo: {clasificacion.plazo_dias as number} dias habiles &rarr; {ocrResult.fecha_limite}
                    </p>
                  )}
                </div>
              )}

              {/* Alerta de duplicado */}
              {ocrResult?.duplicado && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                    <AlertTriangle size={12} /> ⚠️ Posible duplicado detectado
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1">
                    Ya existe un oficio <span className="font-mono font-bold">{ocrResult.duplicado.numero_oficio}</span> registrado
                    {ocrResult.duplicado.fecha && <> con fecha {ocrResult.duplicado.fecha}</>}.
                  </p>
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    Asunto: {ocrResult.duplicado.asunto}
                  </p>
                  <p className="text-[10px] text-amber-500 mt-1 italic">
                    Verifique antes de registrar. Si es un documento diferente, puede continuar.
                  </p>
                </div>
              )}

              {/* Aviso cuando la IA no pudo extraer campos */}
              {ocrFalló && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
                    ⚠️ La IA no pudo leer los datos del documento
                  </p>
                  <p className="text-[10px] text-orange-600 mt-0.5">
                    El servicio de inteligencia artificial procesó el archivo pero no extrajo los campos (puede ser un error temporal o un problema con el API de Gemini).
                    Por favor capture los datos manualmente en los campos de abajo.
                  </p>
                </div>
              )}

              {/* Alerta de prioridad urgente auto-detectada */}
              {ocrResult?.prioridad_sugerida === 'urgente' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    🚨 Prioridad URGENTE detectada por IA
                  </p>
                  <p className="text-[10px] text-red-600 mt-0.5">
                    Se detectó plazo de respuesta o remitente que requiere atención prioritaria.
                    La prioridad se estableció como "Urgente" automáticamente.
                  </p>
                </div>
              )}

              {/* Attached file indicator */}
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <FileText size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-600 truncate flex-1">{fileName}</span>
                <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
              </div>

              {/* Banner: Memorándum detectado */}
              {form.tipo === 'memorandum' && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📝</span>
                    <p className="text-xs font-semibold text-amber-800">Memorándum detectado por IA</p>
                    <span className="ml-auto text-[10px] text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Editable</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-amber-700 mb-1">Nº Memorándum <span className="text-green-600">(IA)</span></label>
                      <input
                        className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="Ej: MEM/DPP/001/2026"
                        value={form.numero_oficio_origen ?? ''}
                        onChange={e => set('numero_oficio_origen', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-amber-700 mb-1">Fecha <span className="text-green-600">(IA)</span></label>
                      <input
                        type="date"
                        className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        value={form.fecha_documento ?? ''}
                        onChange={e => set('fecha_documento', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-amber-700 mb-1">Remitente (nombre) <span className="text-green-600">(IA)</span></label>
                      <input
                        className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="Nombre completo"
                        value={form.remitente_nombre ?? ''}
                        onChange={e => set('remitente_nombre', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-amber-700 mb-1">Remitente (cargo) <span className="text-green-600">(IA)</span></label>
                      <input
                        className="w-full border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="Cargo o puesto"
                        value={form.remitente_cargo ?? ''}
                        onChange={e => set('remitente_cargo', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Editable form - pre-filled from OCR */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.tipo} onChange={e => set('tipo', e.target.value as TipoDocumento)}>
                    {TIPOS.map(t => <option key={t} value={t}>{TIPO_ICONS[t]} {TIPO_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Prioridad</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.prioridad} onChange={e => set('prioridad', e.target.value as Prioridad)}>
                    <option value="normal">Normal</option>
                    <option value="urgente">Urgente</option>
                    <option value="muy_urgente">Muy urgente</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  No. de oficio <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                </label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ej: SCOP/DA/E0167/2026"
                  value={form.numero_oficio_origen ?? ''} onChange={e => set('numero_oficio_origen', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Asunto <span className="text-red-500">*</span> <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                </label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Asunto del oficio recibido"
                  value={form.asunto} onChange={e => set('asunto', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Firmante <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                </label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nombre completo"
                  value={form.remitente_nombre ?? ''} onChange={e => set('remitente_nombre', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Cargo <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                  </label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Delegado Administrativo"
                    value={form.remitente_cargo ?? ''} onChange={e => set('remitente_cargo', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Dependencia <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                  </label>
                  <input
                    list="depend-catalog"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Buscar o escribir dependencia…"
                    value={form.remitente_dependencia ?? ''}
                    onChange={e => set('remitente_dependencia', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Fecha del oficio <span className="text-green-600 text-[10px] font-normal">(IA)</span>
                  </label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_documento ?? ''} onChange={e => set('fecha_documento', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Fecha recepcion DPP</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_recibido ?? ''} onChange={e => set('fecha_recibido', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">📝 Notas adicionales</label>
                <textarea rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y min-h-[80px]"
                  placeholder="Observaciones, contexto, instrucciones especiales..."
                  value={form.descripcion ?? ''} onChange={e => set('descripcion', e.target.value)} />
              </div>

              {/* Checkbox: requiere respuesta */}
              <label className="flex items-center gap-2 cursor-pointer group bg-gray-50 rounded-lg px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={form.requiere_respuesta !== false}
                  onChange={e => set('requiere_respuesta', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 accent-[#911A3A]"
                />
                <div>
                  <p className="text-xs font-medium text-gray-700 group-hover:text-gray-900">
                    Este documento requiere respuesta
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Desmarcar para oficios de conocimiento, circulares o notificaciones
                  </p>
                </div>
              </label>

              <div className="flex justify-between items-center gap-2 pt-2 border-t border-gray-100">
                <button type="button"
                  onClick={() => { setStep('upload'); setOcrResult(null); setFileName(''); setPreviewBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null }) }}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  <ArrowRight size={12} className="rotate-180" /> Cambiar archivo
                </button>
                <Button type="submit" size="sm" loading={mutation.isPending}>
                  <CheckCircle2 size={14} /> Registrar oficio
                </Button>
              </div>
            </form>
          )}

          {/* ── STEP: MANUAL (captura sin scan) ─────────────────────── */}
          {step === 'manual' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Captura manual &mdash; puedes subir el documento despues desde el detalle
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Tipo <span className="text-red-500">*</span></label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.tipo} onChange={e => set('tipo', e.target.value as TipoDocumento)}>
                    {TIPOS.map(t => <option key={t} value={t}>{TIPO_ICONS[t]} {TIPO_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Prioridad</label>
                  <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.prioridad} onChange={e => set('prioridad', e.target.value as Prioridad)}>
                    <option value="normal">Normal</option>
                    <option value="urgente">Urgente</option>
                    <option value="muy_urgente">Muy urgente</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">No. de oficio del remitente</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Ej: SCOP/DA/E0167/2026"
                  value={form.numero_oficio_origen ?? ''} onChange={e => set('numero_oficio_origen', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Asunto <span className="text-red-500">*</span></label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Asunto del oficio recibido"
                  value={form.asunto} onChange={e => set('asunto', e.target.value)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del firmante</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Nombre completo"
                  value={form.remitente_nombre ?? ''} onChange={e => set('remitente_nombre', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Cargo</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Delegado Administrativo"
                    value={form.remitente_cargo ?? ''} onChange={e => set('remitente_cargo', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Dependencia</label>
                  <input
                    list="depend-catalog"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Buscar o escribir dependencia…"
                    value={form.remitente_dependencia ?? ''}
                    onChange={e => set('remitente_dependencia', e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Fecha del oficio</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_documento ?? ''} onChange={e => set('fecha_documento', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Fecha recepcion DPP</label>
                  <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={form.fecha_recibido ?? ''} onChange={e => set('fecha_recibido', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">📝 Notas adicionales</label>
                <textarea rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y min-h-[80px]"
                  placeholder="Observaciones, contexto, instrucciones especiales..."
                  value={form.descripcion ?? ''} onChange={e => set('descripcion', e.target.value)} />
              </div>

              {/* Checkbox: requiere respuesta */}
              <label className="flex items-center gap-2 cursor-pointer group bg-gray-50 rounded-lg px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={form.requiere_respuesta !== false}
                  onChange={e => set('requiere_respuesta', e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 accent-[#911A3A]"
                />
                <div>
                  <p className="text-xs font-medium text-gray-700 group-hover:text-gray-900">
                    Este documento requiere respuesta
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Desmarcar para oficios de conocimiento, circulares o notificaciones
                  </p>
                </div>
              </label>

              <div className="flex justify-between items-center gap-2 pt-2 border-t border-gray-100">
                <button type="button"
                  onClick={() => setStep('upload')}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                  <ArrowRight size={12} className="rotate-180" /> Subir documento
                </button>
                <Button type="submit" size="sm" loading={mutation.isPending}>
                  <Plus size={14} /> Registrar
                </Button>
              </div>
            </form>
          )}
          </div>
          {/* Derecha: vista previa del documento (solo en step review) */}
          {hasPdfPreview && (
            <div className="flex-1 flex flex-col bg-gray-50 rounded-br-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 bg-white flex items-center gap-2 flex-shrink-0">
                <FileText size={13} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-600 truncate">{fileName}</span>
              </div>
              <div className="flex-1 overflow-hidden">
                <iframe
                  src={previewBlobUrl ?? undefined}
                  title="Vista previa del documento"
                  className="w-full h-full"
                  style={{ border: 'none' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal Nuevo Documento Emitido ─────────────────────────────────────────────
function ModalNuevoEmitido({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (doc: DocumentoListItem) => void }) {
  const { user } = useAuth()
  const { data: clientes } = useQuery({ queryKey: ['clientes'], queryFn: clientesApi.list, enabled: user?.rol === 'superadmin' })
  const { data: areasDisponibles } = useQuery({ queryKey: ['areas-dpp'], queryFn: documentosApi.areas })
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: documentosApi.crearEmitido,
    onSuccess: (doc) => { qc.invalidateQueries({ queryKey: ['documentos'] }); onCreated(doc) },
  })
  const clienteId = user?.rol === 'superadmin' ? (clientes?.[0]?.id ?? '') : (user?.cliente_id ?? '')
  const [modo, setModo] = useState<'elegir' | 'subir' | 'generar'>('elegir')
  const [areaOrigen, setAreaOrigen] = useState('')
  const [folioGenerado, setFolioGenerado] = useState('')
  const [folioEditado, setFolioEditado] = useState(false)
  const [plantillas, setPlantillas] = useState<PlantillaOficio[]>([])
  const [plantillaSel, setPlantillaSel] = useState('')
  const [cargandoFolio, setCargandoFolio] = useState(false)
  // OCR para documentos emitidos
  const [extrayendoOCR, setExtrayendoOCR] = useState(false)
  const [ocrOk, setOcrOk] = useState(false)
  const [ocrFalló, setOcrFalló] = useState(false)
  const [ocrErrorMsg, setOcrErrorMsg] = useState('')
  // Validación de folio
  const [folioDuplicado, setFolioDuplicado] = useState(false)
  const [verificandoFolio, setVerificandoFolio] = useState(false)
  const folioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [form, setForm] = useState<DocumentoEmitidoCreate>({
    cliente_id: clienteId,
    tipo: 'oficio',
    asunto: '',
    numero_control: '',
    dependencia_origen: 'Dirección de Programación y Presupuesto',
    dependencia_destino: '',
    destinatario_nombre: '',
    destinatario_cargo: '',
    fecha_documento: localToday(),
    estado: 'borrador',
    referencia_elaboro: '',
    referencia_reviso: '',
  })
  const [err, setErr] = useState('')
  const [archivoSubir, setArchivoSubir] = useState<File | null>(null)
  const fileRefModal = useRef<HTMLInputElement>(null)
  const [directoDirector, setDirectoDirector] = useState(false)
  const [yaFirmadoAutografa, setYaFirmadoAutografa] = useState(false)
  const set = (k: keyof DocumentoEmitidoCreate, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  // ── OCR manual: se dispara al hacer clic en el botón "Analizar con IA" ──────
  const ejecutarOCR = async () => {
    if (!archivoSubir) return
    setExtrayendoOCR(true); setOcrOk(false); setOcrFalló(false); setOcrErrorMsg('')
    try {
      const result = await documentosApi.previewOCR(archivoSubir)
      let raw: Record<string, unknown> = result.datos_extraidos ?? {}

      // Si el backend devolvió error de Gemini, reportarlo
      if (raw['error'] && typeof raw['error'] === 'string') {
        setOcrFalló(true)
        setOcrErrorMsg(`Error del servicio IA: ${raw['error']}`)
        return
      }

      // Re-parsear si el backend devolvió raw_response
      if (raw['raw_response'] && typeof raw['raw_response'] === 'string') {
        try {
          const txt = (raw['raw_response'] as string).trim()
          const s = txt.indexOf('{'); const e2 = txt.lastIndexOf('}')
          if (s !== -1 && e2 > s) {
            const p = JSON.parse(txt.slice(s, e2 + 1))
            if (p && typeof p === 'object') raw = p as Record<string, unknown>
          }
        } catch { /* mantener raw */ }
      }

      const str = (...keys: string[]): string => {
        for (const k of keys) {
          const v = raw[k]
          if (v && typeof v === 'string' && v.trim()) return v.trim()
          if (v && typeof v === 'object' && v !== null && 'value' in (v as object)) {
            const inner = (v as { value: unknown }).value
            if (inner && typeof inner === 'string' && inner.trim()) return inner.trim()
          }
        }
        return ''
      }

      const asunto      = str('asunto', 'subject', 'tema', 'titulo')
      const fecha       = str('fecha_documento', 'fecha', 'fecha_oficio', 'date')
      const destNombre  = str('destinatario_nombre', 'destinatario', 'para', 'dirigido_a')
      const destCargo   = str('destinatario_cargo', 'cargo_destinatario')
      const destDep     = str('destinatario_dependencia', 'dependencia_destino', 'remitente_dependencia', 'dependencia', 'institucion')
      const descripcion = str('cuerpo_resumen', 'resumen', 'cuerpo', 'descripcion', 'contenido')
      const firmantesAd = raw['firmantes_adicionales']
      let elaboro = ''; let reviso = ''
      if (Array.isArray(firmantesAd)) {
        for (const f of firmantesAd as Array<Record<string, string>>) {
          if (f.rol === 'elaboró' || f.rol === 'elaboro') elaboro = f.nombre || ''
          if (f.rol === 'revisó' || f.rol === 'reviso') reviso = f.nombre || ''
        }
      }
      const camposExtraídos = [asunto, fecha, destNombre, destCargo, destDep].filter(Boolean)
      setForm(prev => ({
        ...prev,
        asunto:              asunto     || prev.asunto,
        fecha_documento:     fecha      || prev.fecha_documento,
        destinatario_nombre: destNombre || prev.destinatario_nombre,
        destinatario_cargo:  destCargo  || prev.destinatario_cargo,
        dependencia_destino: destDep    || prev.dependencia_destino,
        referencia_elaboro:  elaboro    || prev.referencia_elaboro,
        referencia_reviso:   reviso     || prev.referencia_reviso,
        ...(descripcion ? { descripcion } : {}),
      }))
      setOcrOk(camposExtraídos.length > 0)
      if (camposExtraídos.length === 0) {
        setOcrFalló(true)
        setOcrErrorMsg('La IA procesó el documento pero no encontró campos reconocibles. Verifique que el PDF tenga texto legible.')
      }
    } catch (e: unknown) {
      const resp = (e as { response?: { data?: { detail?: string }; status?: number } })?.response
      const msg  = resp?.data?.detail ?? (e instanceof Error ? e.message : 'Error de conexión con el servidor')
      const status = resp?.status
      setOcrFalló(true)
      setOcrErrorMsg(`Error ${status ? `HTTP ${status}: ` : ''}${msg}`)
    } finally {
      setExtrayendoOCR(false)
    }
  }

  // ── Verificación de folio (debounced 600ms) ────────────────────────────────
  const verificarFolioDebounced = (folio: string) => {
    setFolioDuplicado(false)
    if (folioTimerRef.current) clearTimeout(folioTimerRef.current)
    if (!folio.trim()) return
    folioTimerRef.current = setTimeout(async () => {
      setVerificandoFolio(true)
      try {
        const r = await documentosApi.verificarFolio(folio.trim())
        setFolioDuplicado(!r.disponible)
      } catch { /* ignorar */ }
      setVerificandoFolio(false)
    }, 600)
  }

  // ── Auto-seleccionar área del usuario al montar el modal ──────────────────
  useEffect(() => {
    if (!areasDisponibles || areasDisponibles.length === 0) return
    const userArea = (user as any)?.area_codigo as string | undefined
    const rolArea: Record<string, string> = { admin_cliente: 'DIR', secretaria: 'SEC' }
    const defaultArea = userArea ?? rolArea[user?.rol ?? ''] ?? ''
    if (defaultArea && areasDisponibles.find(a => a.codigo === defaultArea)) {
      handleAreaChange(defaultArea)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areasDisponibles])

  // ── Auto-generar folio al seleccionar área ─────────────────────────────────
  const handleAreaChange = async (codigo: string) => {
    setAreaOrigen(codigo)
    setFolioEditado(false)
    setFolioDuplicado(false)
    if (!codigo) { setFolioGenerado(''); setPlantillas([]); setPlantillaSel(''); return }
    setCargandoFolio(true)
    try {
      const r = await documentosApi.siguienteFolio('OFICIO', codigo)
      setFolioGenerado(r.folio)
      set('numero_control', r.folio)
      // El folio auto-generado es por definición el siguiente disponible → no hay duplicado
      setFolioDuplicado(false)
    } catch { /* keep empty */ }
    setCargandoFolio(false)
    try {
      const p = await documentosApi.plantillas(codigo)
      setPlantillas(p)
    } catch { setPlantillas([]) }
    setPlantillaSel('')
  }

  // Al seleccionar plantilla, prellenar asunto
  const handlePlantillaChange = (cat: string) => {
    setPlantillaSel(cat)
    if (!cat) return
    const p = plantillas.find(x => x.categoria === cat)
    if (p && !form.asunto.trim()) {
      set('asunto', p.nombre)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (!form.asunto.trim()) { setErr('El asunto es obligatorio.'); return }
    if (!areaOrigen) { setErr('Seleccione el área de origen.'); return }
    if (folioDuplicado) { setErr('El número de oficio ya está registrado. Use el folio recomendado o elija uno diferente.'); return }
    const areaInfo = areasDisponibles?.find(a => a.codigo === areaOrigen)
    const folioFinal = folioEditado ? (form.numero_control ?? '') : folioGenerado
    // Si ya tiene firma autógrafa, se registra como firmado directamente
    const estadoInicial: import('../api/documentos').EstadoEmitido = yaFirmadoAutografa ? 'vigente' : 'borrador'
    try {
      const doc = await mutation.mutateAsync({
        ...form,
        cliente_id: form.cliente_id || clienteId,
        area_turno: areaOrigen,
        area_turno_nombre: areaInfo?.nombre || '',
        folio_respuesta: folioFinal,
        numero_control: folioFinal,
        estado: estadoInicial,
      })
      // Si hay archivo para subir, subirlo después de crear
      if (archivoSubir && doc.id) {
        try { await documentosApi.uploadArchivo(doc.id, archivoSubir) } catch { /* error de upload no bloquea */ }
        qc.invalidateQueries({ queryKey: ['documentos'] })
      }
    }
    catch (e: unknown) { setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al crear.') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
              <SendIcon size={14} style={{ color: GUINDA }} />
            </div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {modo === 'elegir' ? 'Nuevo documento emitido' : modo === 'subir' ? 'Subir documento existente' : 'Generar documento con IA'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* ── Pantalla de elección ── */}
        {modo === 'elegir' && (
          <div className="px-6 py-6 space-y-4">
            <p className="text-xs text-gray-500 text-center">Seleccione cómo desea crear el documento</p>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={() => setModo('subir')}
                className="group flex items-start gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all text-left">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-50 group-hover:bg-blue-100 transition-colors">
                  <Upload size={20} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-0.5">Subir documento existente</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Suba un PDF, Word o imagen de un documento ya elaborado para registrarlo y firmarlo digitalmente.
                  </p>
                </div>
              </button>
              <button onClick={() => setModo('generar')}
                className="group flex items-start gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-purple-300 hover:bg-purple-50/30 transition-all text-left">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-purple-50 group-hover:bg-purple-100 transition-colors">
                  <Wand2 size={20} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-0.5">Generar nuevo con IA</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Cree un documento desde cero con asistencia de inteligencia artificial. Podrá editar y firmar después.
                  </p>
                </div>
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-300 hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        )}

        {/* ── Formulario (subir o generar) ── */}
        {(modo === 'subir' || modo === 'generar') && (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <button type="button" onClick={() => { setModo('elegir'); setErr(''); setArchivoSubir(null) }}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-700 -mt-1 mb-1">
              <CornerUpLeft size={12} /> Cambiar opción
            </button>

            {err && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{err}</div>}

            {/* Zona de subida de archivo (solo en modo subir) */}
            {modo === 'subir' && (
              <div className="space-y-2">
                <input ref={fileRefModal} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setArchivoSubir(f); setOcrOk(false); setOcrFalló(false) } }} />
                {archivoSubir ? (
                  <div className="space-y-2">
                    {/* Fila del archivo */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl border ${ocrOk ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                      <FileText size={18} className={`flex-shrink-0 ${ocrOk ? 'text-green-600' : 'text-blue-600'}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-medium truncate ${ocrOk ? 'text-green-800' : 'text-blue-800'}`}>{archivoSubir.name}</p>
                        <p className={`text-[10px] ${ocrOk ? 'text-green-600' : 'text-blue-500'}`}>
                          {ocrOk ? '✓ Datos extraídos — revise los campos abajo' : `${(archivoSubir.size / 1024 / 1024).toFixed(2)} MB`}
                        </p>
                      </div>
                      {ocrOk
                        ? <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                        : <button type="button" onClick={() => { setArchivoSubir(null); setOcrOk(false); setOcrFalló(false); setOcrErrorMsg('') }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      }
                    </div>
                    {/* Botón analizar / estado OCR */}
                    {!ocrOk && (
                      <button type="button" onClick={ejecutarOCR} disabled={extrayendoOCR}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-purple-300 text-xs font-medium text-purple-700 hover:bg-purple-50 hover:border-purple-400 transition-all disabled:opacity-60">
                        {extrayendoOCR
                          ? <><RotateCcw size={13} className="animate-spin" /> Analizando con IA…</>
                          : <><Wand2 size={13} /> ✨ Analizar con IA y llenar campos automáticamente</>}
                      </button>
                    )}
                    {/* Error detallado */}
                    {ocrFalló && ocrErrorMsg && (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-orange-700 font-semibold mb-0.5">⚠️ No se pudieron extraer los datos:</p>
                        <p className="text-[10px] text-orange-600">{ocrErrorMsg}</p>
                        <p className="text-[10px] text-gray-500 mt-1">Puede capturar los datos manualmente en los campos de abajo.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div onClick={() => fileRefModal.current?.click()}
                    className="border-2 border-dashed border-blue-200 rounded-xl py-5 px-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                    <Upload size={22} className="mx-auto mb-2 text-blue-500" />
                    <p className="text-xs font-medium text-gray-700 mb-0.5">Seleccionar archivo</p>
                    <p className="text-[10px] text-gray-400">PDF, Word (.docx), JPG, PNG — Max. 20 MB</p>
                    <p className="text-[9px] text-blue-500 mt-1">✨ La IA leerá el documento y llenará los campos automáticamente</p>
                  </div>
                )}
              </div>
            )}

            {/* Indicador de modo IA */}
            {modo === 'generar' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-100 rounded-lg">
                <Wand2 size={13} className="text-purple-600" />
                <p className="text-[11px] text-purple-700 font-medium">
                  El contenido se generará con IA después de registrar. Podrá editarlo en el panel.
                </p>
              </div>
            )}

            {/* ── Directo al Director ── */}
            <label className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg cursor-pointer hover:bg-purple-100 transition-colors">
              <input type="checkbox" checked={directoDirector} onChange={e => {
                setDirectoDirector(e.target.checked)
                if (e.target.checked) { setAreaOrigen('DIR'); handleAreaChange('DIR') }
                else { setAreaOrigen(''); setFolioGenerado('') }
              }} className="rounded border-purple-300 text-purple-600 focus:ring-purple-500" />
              <span className="text-[11px] font-medium text-purple-800">Directo al Director (sin área intermedia)</span>
              <span className="text-[9px] text-purple-500 ml-auto">Fondo revolvente, solicitudes internas, etc.</span>
            </label>

            {/* ── Documento ya firmado autógrafa (solo modo subir) ── */}
            {modo === 'subir' && (
              <label className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer hover:bg-emerald-100 transition-colors">
                <input type="checkbox" checked={yaFirmadoAutografa} onChange={e => setYaFirmadoAutografa(e.target.checked)}
                  className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500" />
                <span className="text-[11px] font-medium text-emerald-800">Documento ya tiene firma autógrafa</span>
                <span className="text-[9px] text-emerald-500 ml-auto">Solo se registra, no requiere firma digital</span>
              </label>
            )}

            {/* ── Área de origen + folio automático ── */}
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 space-y-3">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <Building2 size={13} /> Área de origen y folio
              </p>
              <div>
                <label className="block text-[10px] text-gray-600 mb-1">Área de origen <span className="text-red-500">*</span></label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  value={areaOrigen} onChange={e => handleAreaChange(e.target.value)} disabled={directoDirector}>
                  <option value="">— Seleccionar área —</option>
                  {areasDisponibles?.map(a => (
                    <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>
                  ))}
                </select>
                {directoDirector && <p className="text-[9px] text-purple-500 mt-1">Área fijada a Dirección (DIR)</p>}
              </div>
              {areaOrigen && (
                <div>
                  <label className="block text-[10px] text-gray-600 mb-1 flex items-center gap-1">
                    No. de oficio (minutario)
                    {cargandoFolio && <span className="text-amber-600 ml-1">(generando...)</span>}
                    {verificandoFolio && <span className="text-blue-500 ml-1">(verificando...)</span>}
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono ${folioDuplicado ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                      placeholder="SFA/SF/DPP-SCEG/0001/2026"
                      value={folioEditado ? (form.numero_control ?? '') : folioGenerado}
                      onChange={e => {
                        setFolioEditado(true)
                        set('numero_control', e.target.value)
                        verificarFolioDebounced(e.target.value)
                      }} />
                    {folioEditado && (
                      <button type="button"
                        onClick={() => { setFolioEditado(false); set('numero_control', folioGenerado); setFolioDuplicado(false) }}
                        title="Restaurar folio recomendado"
                        className="text-amber-600 hover:text-amber-800">
                        <RefreshCw size={13} />
                      </button>
                    )}
                  </div>
                  {folioDuplicado && (
                    <p className="text-[10px] text-red-600 mt-1 flex items-center gap-1">
                      ⚠️ Este número de oficio ya está registrado. Use el siguiente disponible o presione <RefreshCw size={10} className="inline" /> para auto-generar.
                    </p>
                  )}
                  {!folioEditado && folioGenerado && !folioDuplicado && (
                    <p className="text-[10px] text-green-600 mt-1">
                      ✓ Siguiente folio disponible. Puede editarlo si necesita un número diferente.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Plantilla / categoría (opcional) ── */}
            {plantillas.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Plantilla de oficio <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={plantillaSel} onChange={e => handlePlantillaChange(e.target.value)}>
                  <option value="">— Sin plantilla —</option>
                  {plantillas.map(p => (
                    <option key={p.categoria} value={p.categoria}>{p.nombre}</option>
                  ))}
                </select>
                {plantillaSel && (() => {
                  const p = plantillas.find(x => x.categoria === plantillaSel)
                  return p ? (
                    <p className="text-[10px] text-gray-500 mt-1 italic">{p.fundamento_legal}</p>
                  ) : null
                })()}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tipo</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.tipo} onChange={e => set('tipo', e.target.value as TipoDocumento)}>
                  {TIPOS.map(t => <option key={t} value={t}>{TIPO_ICONS[t]} {TIPO_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fecha</label>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  value={form.fecha_documento ?? ''} onChange={e => set('fecha_documento', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Asunto <span className="text-red-500">*</span></label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Asunto del oficio"
                value={form.asunto} onChange={e => set('asunto', e.target.value)} />
            </div>
            {/* ── Destinatario con autocompletado del catálogo ── */}
            <DestinatarioAutocomplete form={form} set={set} />

            {/* Referencia interna MAFM/elaboro/reviso */}
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Referencia interna <span className="font-normal text-gray-400">(MAFM / elaboró / revisó)</span></p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Elaboró (iniciales)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm uppercase"
                    placeholder="maca"
                    maxLength={10}
                    value={form.referencia_elaboro ?? ''} onChange={e => set('referencia_elaboro', e.target.value.toLowerCase())} />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Revisó (iniciales)</label>
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm uppercase"
                    placeholder="beos"
                    maxLength={10}
                    value={form.referencia_reviso ?? ''} onChange={e => set('referencia_reviso', e.target.value.toLowerCase())} />
                </div>
              </div>
              {(form.referencia_elaboro || form.referencia_reviso) && (
                <p className="text-xs text-gray-500 mt-1.5">
                  Referencia: <span className="font-mono font-medium text-gray-700">
                    MAFM/{form.referencia_elaboro || '???'}/{form.referencia_reviso || '???'}
                  </span>
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-300 hover:bg-gray-50">Cancelar</button>
              <Button type="submit" size="sm" loading={mutation.isPending}>
                {modo === 'subir'
                  ? yaFirmadoAutografa
                    ? <><CheckCircle2 size={14} /> Registrar como firmado</>
                    : <><Upload size={14} /> Registrar y enviar para firma</>
                  : <><Wand2 size={14} /> Crear borrador</>}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Panel detalle — Recibido ───────────────────────────────────────────────────
function PanelRecibido({
  doc, areas, onClose, onRefetch, onDelete, initialTab = 'info', hideDocumentVisor = false, onTabChange,
}: { doc: Documento; areas: AreaDPP[]; onClose: () => void; onRefetch: () => void; onDelete?: () => void; initialTab?: 'info' | 'ocr' | 'documento' | 'historial'; hideDocumentVisor?: boolean; onTabChange?: (tab: string) => void }) {
  const { user } = useAuth()
  const permissionsVersion = usePermissionsVersion()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'info' | 'ocr' | 'documento' | 'historial'>(initialTab)
  useEffect(() => { setTab(initialTab); onTabChange?.(initialTab) }, [initialTab])
  const changeTab = (t: 'info' | 'ocr' | 'documento' | 'historial') => { setTab(t); onTabChange?.(t) }
  const [editBorrador, setEditBorrador] = useState(false)
  const [borradorText, setBorradorText] = useState(doc.borrador_respuesta ?? '')
  const [procesando, setProcesando] = useState(false)
  const [generando, setGenerando] = useState(false)
  // seccionesIA y generandoEstructurado eliminados — ahora se usa un solo botón unificado
  const [descargando, setDescargando] = useState(false)
  const [firmando, setFirmando] = useState(false)
  const [firmaPassword, setFirmaPassword] = useState('')
  const [firmaError, setFirmaError] = useState('')
  const [firmaSuccess, setFirmaSuccess] = useState(false)
  const [showFirmaModal, setShowFirmaModal] = useState(false)
  const [enviandoFirma, setEnviandoFirma] = useState(false)
  const [enviadoFirmaOk, setEnviadoFirmaOk] = useState(false)
  const [subiendoAcuse, setSubiendoAcuse] = useState(false)
  const [acuseLocal, setAcuseLocal] = useState<{url: string|null, nombre: string|null, fecha: string|null}>({
    url: doc.acuse_recibido_url, nombre: doc.acuse_recibido_nombre, fecha: doc.acuse_recibido_fecha
  })
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [loadingOriginal, setLoadingOriginal] = useState(false)
  const [visorFlotante, setVisorFlotante] = useState<'original' | 'pdf' | null>(null)
  const [showDevolucionForm, setShowDevolucionForm] = useState(false)
  const [showDevolucionModal, setShowDevolucionModal] = useState(false)
  const [observacionesDevolucion, setObservacionesDevolucion] = useState('')
  const [devolviendo, setDevolviendo] = useState(false)
  const [reenviando, setReenviando] = useState(false)
  const [folioLocal, setFolioLocal] = useState(doc.folio_respuesta ?? '')
  const [fechaRespLocal, setFechaRespLocal] = useState(doc.fecha_respuesta ?? '')
  const [elaboroLocal, setElaboro] = useState(doc.referencia_elaboro ?? '')
  const [revisoLocal, setReviso] = useState(doc.referencia_reviso ?? '')
  const [instruccionesIA, setInstruccionesIA] = useState('')
  const [cargandoReferencia, setCargandoReferencia] = useState(false)
  const refFileRef = useRef<HTMLInputElement>(null)
  // ── Roles reales de la DPP ──
  // Director = admin_cliente (firma, revisa, devuelve)
  // Roles del módulo de Gestión Documental (v4)
  // N1 Administrador (superadmin) — acceso total
  // N4 Director (admin_cliente) — firma, consulta total, reasigna, descarga DOCX
  // N2 Secretaria — carga, turna, elimina, consulta total
  // N3 Asesor — carga evidencia, redacta, consulta total
  // N5 Subdirector — redacta, reasigna su área, consulta total
  // N6 Jefe Depto — redacta, reasigna su área, consulta total
  // SGC Auditor — solo lectura
  const isDirector = user?.rol === 'admin_cliente'
  const isSuperadmin = user?.rol === 'superadmin'
  const isSecretaria = user?.rol === 'secretaria'
  const isAsesor = user?.rol === 'asesor'
  const isArea = ['analista', 'subdirector', 'jefe_depto'].includes(user?.rol || '')
  const isSubdirector = user?.rol === 'subdirector'
  const isJefeDepto = user?.rol === 'jefe_depto'
  // Permisos leídos desde rolePermissions (editables en Panel Admin → Roles y Permisos)
  const can = useMemo(() => makePermissionChecker(user?.rol ?? ''), [user?.rol, permissionsVersion])
  const canTurnar           = can('turnar')
  const canReasignar        = can('reasignar') || can('turnar')
  const canGenerarRespuesta = can('generar_resp')
  // Secretaria puede responder cuando el oficio está turnado directamente a la Dirección
  const canGenerarRespuestaEfectivo = canGenerarRespuesta || (isSecretaria && doc.area_turno === 'DIR')
  const canFirmar           = can('firmar')
  const canEnviarParaFirma  = can('enviar_firma')
  const canDescargarDocx    = can('descargar_docx')
  const canEliminar         = can('eliminar')
  const canSubirArchivo     = can('subir_archivo')
  const canCambiarEstado    = can('cambiar_estado')

  // Estado de error del archivo original (si url_storage existe pero la
  // descarga falla — archivo perdido en el servidor, permisos, etc.)
  const [originalError, setOriginalError] = useState<string | null>(null)
  // Subida de archivo desde la vista detalle
  const [subiendoArchivo, setSubiendoArchivo] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['documentos'] })
    qc.invalidateQueries({ queryKey: ['documento', doc.id] })
    onRefetch()
  }

  const cargarOriginal = useCallback(() => {
    if (!doc.url_storage) return
    setLoadingOriginal(true)
    setOriginalError(null)
    documentosApi.obtenerArchivoOriginalUrl(doc.id)
      .then(url => setOriginalUrl(url))
      .catch((e: any) => {
        setOriginalUrl(null)
        setOriginalError(e?.response?.data?.detail || 'No se pudo cargar el archivo.')
      })
      .finally(() => setLoadingOriginal(false))
  }, [doc.id, doc.url_storage])

  // Auto-cargar original al montar
  useEffect(() => {
    if (doc.url_storage && !originalUrl && !loadingOriginal) {
      cargarOriginal()
    }
  }, [doc.id, doc.url_storage, cargarOriginal, originalUrl, loadingOriginal])

  const handleSubirArchivoOriginal = async (file: File) => {
    setSubiendoArchivo(true)
    try {
      await documentosApi.uploadArchivo(doc.id, file)
      setOriginalUrl(null)
      setOriginalError(null)
      invalidate()
    } catch (e) {
      window.alert('Error al subir archivo: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo'))
    } finally {
      setSubiendoArchivo(false)
    }
  }

  const [instruccionesTurno, setInstruccionesTurno] = useState('')
  const [cambiarTurnoOpen, setCambiarTurnoOpen] = useState(false)
  const [instruccionesCambioTurno, setInstruccionesCambioTurno] = useState('')
  const [areaSelectValue, setAreaSelectValue] = useState(doc.sugerencia_area_codigo ?? '')
  const [cambioAreaSelectValue, setCambioAreaSelectValue] = useState('')
  const turnarMutation = useMutation({
    mutationFn: ({ cod, nom }: { cod: string; nom: string }) =>
      documentosApi.confirmarTurno(doc.id, cod, nom, instruccionesTurno || undefined),
    onSuccess: invalidate,
    onError: (e: any) => {
      window.alert(e?.response?.data?.detail || 'No se pudo turnar. Intenta de nuevo.')
    },
  })
  const cambiarTurnoMutation = useMutation({
    mutationFn: ({ cod, nom }: { cod: string; nom: string }) =>
      documentosApi.cambiarTurno(doc.id, cod, nom, instruccionesCambioTurno || undefined),
    onSuccess: (updatedDoc) => {
      // Actualizar cache directamente con datos frescos del POST (evita 403 en GET posterior
      // cuando el usuario redirige fuera de su área y ya no tiene visibilidad del doc)
      qc.setQueryData(['documento', doc.id], updatedDoc)
      qc.invalidateQueries({ queryKey: ['documentos'] })
      setCambiarTurnoOpen(false)
      setInstruccionesCambioTurno('')
      onRefetch()
      // Cerrar el panel: el documento ya no pertenece al área de este usuario
      setTimeout(() => onClose(), 1200)
    },
    onError: (e: any) => {
      window.alert(e?.response?.data?.detail || 'No se pudo cambiar el turno. Intenta de nuevo.')
    },
  })

  const estadoMutation = useMutation({
    mutationFn: (estado: string) => documentosApi.cambiarEstado(doc.id, estado as never),
    onSuccess: invalidate,
  })

  const acusarConocimientoMut = useMutation({
    mutationFn: () => documentosApi.acusarConocimiento(doc.id),
    onSuccess: invalidate,
  })

  const guardarBorradorMutation = useMutation({
    mutationFn: () => documentosApi.update(doc.id, { borrador_respuesta: borradorText }),
    onSuccess: () => { invalidate(); setEditBorrador(false) },
  })

  const handleOCR = async (file: File) => {
    setProcesando(true)
    try { await documentosApi.procesarOCR(doc.id, file); invalidate() }
    catch (e) { window.alert('Error al procesar OCR: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setProcesando(false) }
  }

  const handleBorrador = async (instrucciones?: string) => {
    setGenerando(true)
    try { await documentosApi.generarBorrador(doc.id, instrucciones || instruccionesIA || undefined); invalidate() }
    catch (e) { window.alert('Error al generar borrador: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setGenerando(false) }
  }

  const handleCargarReferencia = async (file: File) => {
    setCargandoReferencia(true)
    try { await documentosApi.cargarReferencia(doc.id, file); invalidate() }
    catch (e) { window.alert('Error al cargar referencia: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setCargandoReferencia(false) }
  }

  const handleEliminarReferencia = async () => {
    try { await documentosApi.eliminarReferencia(doc.id); invalidate() }
    catch (e) { window.alert('Error al eliminar referencia: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
  }

  // handleOficioEstructurado eliminado — unificado en handleBorrador

  const handleDescargarOficio = async () => {
    setDescargando(true)
    try { await documentosApi.descargarOficio(doc.id) }
    catch (e) { window.alert('Error al descargar oficio: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setDescargando(false) }
  }

  // handleDescargarConstancia — reserved for future constancia PDF download
  // const handleDescargarConstancia = async () => {
  //   try {
  //     const res = await (await import('../api/client')).default.get(`/documentos/${doc.id}/constancia-firma`, { responseType: 'blob' })
  //     const blob = new Blob([res.data], { type: 'application/pdf' })
  //     const url = window.URL.createObjectURL(blob)
  //     const a = document.createElement('a')
  //     a.href = url
  //     a.download = `constancia_firma_${doc.folio_respuesta || doc.id}.pdf`
  //     document.body.appendChild(a)
  //     a.click()
  //     window.URL.revokeObjectURL(url)
  //     a.remove()
  //   } catch { /* PDF endpoint may not be ready yet */ }
  // }

  const handleFirmar = async () => {
    if (!firmaPassword.trim()) return
    setFirmando(true)
    setFirmaError('')
    try {
      await documentosApi.firmarDocumento(doc.id, firmaPassword.trim())
      invalidate()
      setShowFirmaModal(false)
      setFirmaPassword('')
      setFirmaSuccess(true)
      setTab('info')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFirmaError(detail || 'Error al firmar el documento. Verifique su contraseña.')
    } finally { setFirmando(false) }
  }

  const handleDevolver = async () => {
    // Validación definitiva (Backend ya lo valida, pero aquí evitamos el envío)
    if (!can('devolver')) {
      window.alert('No tiene permiso para devolver documentos. Solo Director, Subdirector o Superadministrador.')
      return
    }
    if (observacionesDevolucion.trim().length < 10) return
    setDevolviendo(true)
    try {
      await documentosApi.devolverDocumento(doc.id, observacionesDevolucion.trim())
      invalidate()
      setShowFirmaModal(false)
      setShowDevolucionForm(false)
      setShowDevolucionModal(false)
      setObservacionesDevolucion('')
    } catch (e) { window.alert('Error al devolver documento: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setDevolviendo(false) }
  }

  const handleReenviar = async () => {
    setReenviando(true)
    try {
      await documentosApi.reenviarDocumento(doc.id, 'Documento corregido y reenviado para revisión.')
      invalidate()
    } catch (e) { window.alert('Error al reenviar documento: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setReenviando(false) }
  }

  // Historial query
  const { data: historial = [] } = useQuery({
    queryKey: ['historial', doc.id],
    queryFn: () => documentosApi.getHistorial(doc.id),
    enabled: tab === 'historial',
  })

  const guardarFolioRef = async (field: string, value: string) => {
    const data: DocumentoUpdate = {}
    if (field === 'folio') data.folio_respuesta = value
    if (field === 'fecha') data.fecha_respuesta = value
    if (field === 'elaboro') data.referencia_elaboro = value
    if (field === 'reviso') data.referencia_reviso = value
    try { await documentosApi.update(doc.id, data); invalidate() } catch (e) { window.alert('Error al guardar: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
  }

  // const areaActual = doc.area_turno || doc.sugerencia_area_codigo || ''  // reserved for future use
  const fundamento = doc.sugerencia_fundamento || ''
  const confianza  = doc.confianza_clasificacion
  const datosIA    = doc.datos_extraidos_ia as Record<string, unknown> | null

  return (
    <div className="flex flex-col h-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0"
          >
            <ChevronLeft size={14} />
            <span className="hidden sm:inline">Volver</span>
          </button>
          <div className="h-5 w-px bg-gray-300 flex-shrink-0" />
          <span className="text-xl flex-shrink-0">{TIPO_ICONS[doc.tipo]}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{doc.asunto}</p>
              {doc.firmado_digitalmente && (
                <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap">
                  <Shield size={8} /> Firmado
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400">{doc.numero_oficio_origen || 'Sin número'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {canEliminar && onDelete && !doc.firmado_digitalmente && (
            <button onClick={onDelete}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
              title="Eliminar documento">
              <Trash2 size={10} /> Eliminar
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
        </div>
      </div>

      {/* Banner de éxito post-firma */}
      {firmaSuccess && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <span className="text-xs font-medium text-emerald-700">Documento firmado exitosamente</span>
          <button onClick={() => setFirmaSuccess(false)} className="ml-auto text-emerald-400 hover:text-emerald-600">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Badge "Para conocimiento" + Acuse */}
      {!doc.requiere_respuesta && doc.estado === 'de_conocimiento' && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <BookOpen size={12} className="text-blue-600 flex-shrink-0" />
          <span className="text-[10px] font-medium text-blue-700 flex-1">Documento para conocimiento — no requiere respuesta</span>
          <button
            onClick={() => acusarConocimientoMut.mutate()}
            disabled={acusarConocimientoMut.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-white rounded-md transition-colors"
            style={{ backgroundColor: '#065f46' }}
          >
            {acusarConocimientoMut.isPending
              ? <><RotateCcw size={10} className="animate-spin" /> Registrando…</>
              : <><CheckCircle2 size={10} /> Tomar conocimiento</>}
          </button>
        </div>
      )}
      {!doc.requiere_respuesta && doc.estado === 'de_conocimiento' && doc.atendido_en && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-[10px] font-semibold text-emerald-700">Acuse de conocimiento registrado</span>
            {(doc.atendido_area || doc.atendido_en) && (
              <p className="text-[9px] text-emerald-600">
                {doc.atendido_area && <>Área: {doc.atendido_area}</>}
                {doc.atendido_area && doc.atendido_en && <> · </>}
                {doc.atendido_en && <>{formatDateTime(doc.atendido_en)}</>}
              </p>
            )}
          </div>
        </div>
      )}
      {!doc.requiere_respuesta && doc.estado !== 'de_conocimiento' && doc.estado !== 'firmado' && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
          <BookOpen size={12} className="text-blue-600 flex-shrink-0" />
          <span className="text-[10px] font-medium text-blue-700 flex-1">Documento para conocimiento — no requiere respuesta</span>
          {['turnado', 'en_atencion'].includes(doc.estado) && (
            <button
              onClick={() => estadoMutation.mutate('de_conocimiento')}
              disabled={estadoMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold text-white rounded-md transition-colors bg-cyan-700 hover:bg-cyan-800"
            >
              {estadoMutation.isPending
                ? <><RotateCcw size={10} className="animate-spin" /> Cambiando…</>
                : <><BookOpen size={10} /> Pasar a conocimiento</>}
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {([
          'info',
          'ocr',
          ...(doc.borrador_respuesta || hideDocumentVisor ? ['documento'] : []),
          'historial',
        ] as const).map(t => (
          <button key={t} onClick={() => {
            changeTab(t as typeof tab)
            if (t === 'documento' && !pdfUrl && !loadingPdf) {
              setLoadingPdf(true)
              documentosApi.obtenerOficioPdfUrl(doc.id)
                .then(url => setPdfUrl(url))
                .catch(() => {})
                .finally(() => setLoadingPdf(false))
            }
          }}
            className={clsx('flex-1 py-2 text-xs font-medium transition-colors',
              tab === t ? 'border-b-2 text-gray-900' : 'text-gray-500 hover:text-gray-700')}
            style={tab === t ? { borderColor: GUINDA, color: GUINDA } : {}}>
            {t === 'info'
              ? (hideDocumentVisor
                  ? <span className="flex items-center justify-center gap-1"><ArrowLeftRight size={12} />Turnar</span>
                  : <span className="flex items-center justify-center gap-1"><FileText size={12} />Datos</span>)
              : t === 'ocr'
              ? (hideDocumentVisor
                  ? <span className="flex items-center justify-center gap-1"><Wand2 size={12} />Respuesta</span>
                  : '🤖 IA')
              : t === 'documento'
              ? <span className="flex items-center justify-center gap-1"><FileSearch size={12} />Visualizar Docs.</span>
              : '📋 Historial'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ── Tab: Info ─────────────────────────────────────────────────────── */}
        {tab === 'info' && (
          <>
            {/* ── Estado del trámite — parte superior ── */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Estado del trámite</p>
                {canCambiarEstado && <div className="flex gap-1 flex-wrap justify-end">
                  {(['en_atencion', 'respondido', ...(!doc.requiere_respuesta ? ['de_conocimiento'] : [])] as string[]).map(e => {
                    const sinTurno          = e === 'en_atencion' && !doc.area_turno_confirmada
                    const sinRespuesta      = e === 'respondido'  && doc.requiere_respuesta && !doc.borrador_respuesta
                    const secretariaSinDir  = e === 'en_atencion' && isSecretaria && doc.area_turno !== 'DIR'
                    const bloqueado         = sinTurno || sinRespuesta || secretariaSinDir
                    return (
                      <button key={e}
                        onClick={() => estadoMutation.mutate(e)}
                        disabled={doc.estado === e || bloqueado}
                        title={
                          secretariaSinDir ? 'Solo puedes poner en atención oficios turnados directamente a Dirección' :
                          sinTurno         ? 'Confirma primero el área de turno' :
                          sinRespuesta     ? 'Genera primero la respuesta en el tab Respuesta' :
                          undefined
                        }
                        className={clsx(
                          'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
                          doc.estado === e
                            ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-default'
                            : bloqueado
                            ? 'border-gray-200 bg-gray-100 text-gray-300 cursor-not-allowed opacity-50'
                            : e === 'de_conocimiento'
                            ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                            : 'border-gray-200 text-gray-600 hover:bg-white',
                        )}>
                        {ESTADO_RECIBIDO_CONFIG[e as EstadoRecibido]?.label ?? e}
                      </button>
                    )
                  })}
                </div>}
              </div>
              <PipelineRecibido estado={doc.estado} />
            </div>

            {/* Banner memorándum */}
            {doc.tipo === 'memorandum' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-amber-600" />
                  <p className="text-xs font-bold text-amber-800">MEMORÁNDUM INSTITUCIONAL</p>
                  <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', doc.tipo_memorandum === 'requiere_atencion' ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600')}>
                    {doc.tipo_memorandum === 'requiere_atencion' ? 'Requiere atención' : 'Solo conocimiento'}
                  </span>
                </div>
                {doc.dependencia_solicitante && (
                  <p className="text-[10px] text-amber-700">
                    <strong>Responder a:</strong> {doc.dependencia_solicitante}
                    {doc.upp_solicitante_codigo && <span className="text-amber-500 ml-1">(UPP: {doc.upp_solicitante_codigo})</span>}
                  </p>
                )}
                {doc.memorandum_orden_direccion && doc.memorandum_orden_direccion > 1 && (
                  <p className="text-[10px] text-gray-500">Esta Dirección aparece en posición {doc.memorandum_orden_direccion} — registrado como conocimiento.</p>
                )}
              </div>
            )}

            {/* Banner devuelto */}
            {doc.estado === 'devuelto' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-red-600 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-800">Documento devuelto</p>
                    {doc.devuelto_en && (
                      <p className="text-[10px] text-red-600">{formatDateTime(doc.devuelto_en)}</p>
                    )}
                  </div>
                </div>
                {doc.motivo_devolucion && (
                  <div className="bg-red-100/50 rounded-lg px-3 py-2">
                    <p className="text-[10px] font-medium text-red-700 mb-0.5">Motivo:</p>
                    <p className="text-xs text-red-900 leading-relaxed">{doc.motivo_devolucion}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => { setTab('ocr'); setEditBorrador(true); setBorradorText(doc.borrador_respuesta ?? '') }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg font-medium border border-red-300 text-red-700 hover:bg-red-100 transition-colors">
                    <Edit3 size={11} /> Corregir borrador
                  </button>
                  <button onClick={handleReenviar} disabled={reenviando}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg font-medium text-white transition-colors"
                    style={{ backgroundColor: GUINDA }}>
                    {reenviando
                      ? <><RotateCcw size={11} className="animate-spin" /> Reenviando...</>
                      : <><RefreshCw size={11} /> Reenviar para revisión</>}
                  </button>
                </div>
              </div>
            )}

            {/* Version badge */}
            {doc.version > 1 && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <History size={12} className="text-amber-600" />
                <span className="text-[10px] font-medium text-amber-700">Versión {doc.version}</span>
                <span className="text-[10px] text-amber-500">— {doc.version - 1} corrección{doc.version > 2 ? 'es' : ''}</span>
              </div>
            )}

            {/* ── Visor del oficio original — oculto cuando ya hay panel PDF externo ── */}
            {!hideDocumentVisor && <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Eye size={10} /> Documento original
                </p>
                {canSubirArchivo && doc.url_storage && (
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={subiendoArchivo}
                    className="text-[10px] text-blue-600 hover:text-blue-800 underline disabled:opacity-50">
                    Reemplazar archivo
                  </button>
                )}
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleSubirArchivoOriginal(f); if (e.target) e.target.value = '' }}
              />
              {loadingOriginal ? (
                <div className="flex items-center justify-center py-6 text-gray-400 bg-gray-50 rounded-lg">
                  <RotateCcw size={14} className="animate-spin mr-2" />
                  <span className="text-xs">Cargando…</span>
                </div>
              ) : originalUrl ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 450 }}>
                  <iframe src={originalUrl} title="Oficio original" className="w-full h-full" style={{ border: 'none' }} />
                </div>
              ) : originalError ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
                  <AlertTriangle size={20} className="text-red-500" />
                  <p className="text-xs text-red-700 text-center">{originalError}</p>
                  <div className="flex gap-2">
                    <button onClick={cargarOriginal}
                      className="text-[10px] px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-100">
                      Reintentar
                    </button>
                    {canSubirArchivo && (
                      <button onClick={() => uploadInputRef.current?.click()}
                        disabled={subiendoArchivo}
                        className="text-[10px] px-2 py-1 rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                        {subiendoArchivo ? 'Subiendo…' : 'Subir de nuevo'}
                      </button>
                    )}
                  </div>
                </div>
              ) : !doc.url_storage ? (
                /* No hay archivo: ofrecer subirlo a quien tenga permiso */
                <div className="flex flex-col items-center justify-center py-6 px-4 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                  <FileText size={20} className="text-amber-600" />
                  <p className="text-xs text-amber-800 text-center font-medium">
                    Este oficio se registró sin archivo adjunto.
                  </p>
                  {canSubirArchivo ? (
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={subiendoArchivo}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {subiendoArchivo
                        ? <><RotateCcw size={12} className="animate-spin" /> Subiendo…</>
                        : <><Upload size={12} /> Subir escaneo (PDF/JPG/PNG)</>}
                    </button>
                  ) : (
                    <p className="text-[10px] text-amber-600 text-center">
                      Solicita a Secretaría o Dirección adjuntar el escaneo.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 bg-gray-50 rounded-lg">
                  <button onClick={cargarOriginal}
                    className="text-xs text-gray-500 underline hover:text-gray-700">Cargar documento</button>
                </div>
              )}
              {doc.nombre_archivo && (
                <p className="text-[10px] text-gray-400 text-center truncate">{doc.nombre_archivo}</p>
              )}
            </div>}

            {/* Remitente */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-1">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Remitente</p>
              {doc.remitente_nombre && <p className="text-xs font-medium text-gray-800">{doc.remitente_nombre}</p>}
              {(doc as any).remitente_cargo && <p className="text-xs text-gray-600">{(doc as any).remitente_cargo}</p>}
              {doc.remitente_dependencia && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Building2 size={11} /> {doc.remitente_dependencia}
                </p>
              )}
            </div>

            {/* Fechas y plazo */}
            <div className={clsx('grid gap-2', doc.fecha_limite ? 'grid-cols-3' : 'grid-cols-2')}>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500">Fecha oficio</p>
                <p className="text-xs font-medium text-gray-800">{doc.fecha_documento ? formatDate(doc.fecha_documento) : '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500">Recibido en DPP</p>
                <p className="text-xs font-medium text-gray-800">{doc.fecha_recibido ? formatDate(doc.fecha_recibido) : '—'}</p>
              </div>
              {doc.fecha_limite && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                  <p className="text-[10px] text-amber-700 flex items-center gap-1"><Clock size={9} /> Fecha límite</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="text-xs font-semibold text-amber-800">{formatDate(doc.fecha_limite)}</p>
                    <SemaforoAtencion fecha={doc.fecha_limite} estado={doc.estado} />
                  </div>
                </div>
              )}
            </div>

            {/* Guía del Director — banner con los 3 escenarios de atención */}
            {isDirector && !doc.area_turno_confirmada && doc.estado !== 'firmado' && doc.estado !== 'archivado' && (
              <div className="bg-gradient-to-r from-rose-50 to-amber-50 border border-rose-200 rounded-lg p-3">
                <p className="text-[11px] font-semibold text-[#911A3A] mb-2 flex items-center gap-1.5">
                  <Wand2 size={12} /> Como Director tienes 3 opciones para atender este oficio:
                </p>
                <ol className="text-[10px] text-gray-700 space-y-1 list-decimal pl-4 leading-relaxed">
                  <li><span className="font-semibold">Atenderlo tú mismo:</span> turna a <em>Dirección</em> y genera el borrador con IA o referencia.</li>
                  <li><span className="font-semibold">Turnar a un área operativa:</span> selecciona la subdirección o departamento responsable.</li>
                  <li><span className="font-semibold">Instruir a tu Secretaría:</span> turna a <em>Secretaría de la Dirección</em> para que conteste en tu nombre.</li>
                </ol>
              </div>
            )}

            {/* Área de turno */}
            <div className="w-full">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Área de turno</p>

              {/* Sugerencia IA */}
              {doc.sugerencia_area_codigo && !doc.area_turno_confirmada && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-medium text-blue-700 flex items-center gap-1">
                      <Wand2 size={10} /> Sugerido por IA
                      {confianza && (
                        <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">
                          {Math.round(confianza * 100)}% confianza
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-blue-900">{doc.sugerencia_area_nombre}</p>
                  {fundamento && <p className="text-[10px] text-blue-600 mt-0.5 leading-tight">{fundamento}</p>}
                </div>
              )}

              {/* Banner especial: asignado por el Director a su Secretaría */}
              {doc.area_turno === 'SEC' && doc.area_turno_confirmada && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 mb-2">
                  <p className="text-[10px] font-semibold text-purple-800 flex items-center gap-1.5">
                    ✉️ Asignado por el Director a la Secretaría
                  </p>
                  <p className="text-[10px] text-purple-700 mt-1 leading-snug">
                    El Director instruyó que la Secretaría redacte y tramite la respuesta en su nombre.
                  </p>
                </div>
              )}

              {/* Turno confirmado */}
              {doc.area_turno_confirmada && doc.area_turno_nombre && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 mb-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-medium text-green-700 flex items-center gap-1">
                      <CheckCircle2 size={10} /> Turno confirmado
                    </p>
                    {canReasignar && (
                      <button
                        onClick={() => setCambiarTurnoOpen(prev => !prev)}
                        className="text-[10px] text-amber-600 hover:text-amber-800 font-medium flex items-center gap-0.5"
                      >
                        <ArrowLeftRight size={9} /> Redirigir a otra área
                      </button>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-green-900">{doc.area_turno_nombre}</p>
                  {doc.instrucciones_turno && (
                    <div className="mt-1.5 bg-white/60 rounded px-2 py-1.5">
                      <p className="text-[10px] font-medium text-green-700 mb-0.5">Instrucciones:</p>
                      <p className="text-[11px] text-green-900 leading-snug">{doc.instrucciones_turno}</p>
                    </div>
                  )}
                  {/* Formulario cambio de turno */}
                  {cambiarTurnoOpen && canReasignar && (
                    <div className="mt-2 pt-2 border-t border-green-200 space-y-2">
                      <p className="text-[10px] font-medium text-amber-700">Reasignar a otra área:</p>
                      <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs"
                        value={cambioAreaSelectValue}
                        onChange={e => setCambioAreaSelectValue(e.target.value)}
                      >
                        <option value="">— Seleccionar nueva área —</option>
                        {areas
                          .slice()
                          .sort((a, b) => {
                            const ord = (c: string) => c === 'DIR' ? 0 : c === 'SEC' ? 1 : 2
                            return ord(a.codigo) - ord(b.codigo)
                          })
                          .map(a => (
                            <option key={a.codigo} value={a.codigo}>
                              {a.codigo === 'DIR' ? '⚡ Dirección (atender directamente)'
                                : a.codigo === 'SEC' ? '✉️ Secretaría (contestar en nombre del Director)'
                                : a.nombre}
                            </option>
                          ))}
                      </select>
                      <textarea
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs resize-none focus:ring-1 focus:ring-[#911A3A]/40 focus:border-[#911A3A] focus:outline-none"
                        rows={2}
                        placeholder="Motivo del cambio de turno (opcional)…"
                        value={instruccionesCambioTurno}
                        onChange={e => setInstruccionesCambioTurno(e.target.value)}
                      />
                      <button
                        onClick={() => {
                          const cod = cambioAreaSelectValue
                          const area = areas.find(a => a.codigo === cod)
                          if (cod && area) cambiarTurnoMutation.mutate({ cod, nom: area.nombre })
                        }}
                        disabled={cambiarTurnoMutation.isPending}
                        className="w-full py-1.5 text-xs rounded-lg font-medium text-white transition-colors bg-amber-600 hover:bg-amber-700"
                      >
                        {cambiarTurnoMutation.isPending ? 'Cambiando...' : '↻ Confirmar cambio de turno'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Selector de área — solo Director y Secretaría pueden turnar */}
              {!doc.area_turno_confirmada && canTurnar && (
                <div className="space-y-2">
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs"
                    value={areaSelectValue}
                    onChange={e => setAreaSelectValue(e.target.value)}
                  >
                    <option value="">— Seleccionar área —</option>
                    {/* Opciones en orden útil: 1) Dirección (atender yo), 2) Secretaría, 3) áreas operativas */}
                    {areas
                      .slice()
                      .sort((a, b) => {
                        const ord = (c: string) => c === 'DIR' ? 0 : c === 'SEC' ? 1 : 2
                        return ord(a.codigo) - ord(b.codigo)
                      })
                      .map(a => (
                        <option key={a.codigo} value={a.codigo}>
                          {a.codigo === 'DIR' ? '⚡ Dirección (atender directamente)'
                            : a.codigo === 'SEC' ? '✉️ Secretaría (contestar en mi nombre)'
                            : a.nombre}
                        </option>
                      ))}
                  </select>
                  {/* Instrucciones del Director al turnar */}
                  {isDirector && (
                    <textarea
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs resize-none focus:ring-1 focus:ring-[#911A3A]/40 focus:border-[#911A3A] focus:outline-none"
                      rows={2}
                      placeholder="Instrucciones para el área (opcional)…"
                      value={instruccionesTurno}
                      onChange={e => setInstruccionesTurno(e.target.value)}
                    />
                  )}
                  <button
                    onClick={() => {
                      const cod = areaSelectValue
                      const area = areas.find(a => a.codigo === cod)
                      if (cod && area) turnarMutation.mutate({ cod, nom: area.nombre })
                    }}
                    disabled={turnarMutation.isPending}
                    className="w-full py-1.5 text-xs rounded-lg font-medium text-white transition-colors"
                    style={{ backgroundColor: GUINDA }}
                  >
                    {turnarMutation.isPending ? 'Confirmando...' : '✓ Confirmar turno'}
                  </button>
                </div>
              )}
              {!doc.area_turno_confirmada && !canTurnar && (
                <p className="text-[10px] text-gray-400 italic">Pendiente de turno por Director o Secretaría.</p>
              )}
            </div>

            {/* Control de tipo: Requiere respuesta vs Solo conocimiento */}
            {(isSecretaria || isDirector || isSuperadmin) && !doc.firmado_digitalmente && !['firmado', 'archivado'].includes(doc.estado) && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between gap-3 w-full">
                <div>
                  <p className="text-[10px] font-semibold text-gray-700 uppercase tracking-wide">Tipo de oficio</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {doc.requiere_respuesta ? 'Requiere respuesta formal' : 'Solo conocimiento (sin respuesta)'}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const nuevoValor = !doc.requiere_respuesta
                    const confirmMsg = nuevoValor
                      ? '¿Cambiar a "Requiere respuesta"? El oficio volverá al flujo de atención normal.'
                      : '¿Cambiar a "Solo conocimiento"? El oficio NO generará respuesta. Esta acción se registra en el historial.'
                    if (!window.confirm(confirmMsg)) return
                    try {
                      await documentosApi.cambiarTipoRespuesta(doc.id, nuevoValor)
                      invalidate()
                    } catch (e) {
                      window.alert('Error: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo'))
                    }
                  }}
                  className={clsx(
                    'flex-shrink-0 px-3 py-1.5 text-[10px] rounded-md font-medium border transition-colors',
                    doc.requiere_respuesta
                      ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  )}
                >
                  {doc.requiere_respuesta ? '→ Cambiar a Conocimiento' : '→ Cambiar a Requiere respuesta'}
                </button>
              </div>
            )}

          </>
        )}

        {/* ── Tab: IA (Oficio original + Generación con instrucciones) ──── */}
        {tab === 'ocr' && (
          <>
            {/* ── Visor del oficio original (turnado) — oculto cuando hay panel PDF externo ── */}
            {!hideDocumentVisor && <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Eye size={10} /> Oficio original (turnado)
                </p>
                <div className="flex items-center gap-2">
                  {originalUrl && (
                    <button onClick={() => setVisorFlotante('original')}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-medium border border-gray-200 text-gray-500 hover:bg-gray-50"
                      title="Abrir en ventana flotante">
                      <FolderOpen size={9} /> Ampliar
                    </button>
                  )}
                  {canSubirArchivo && doc.url_storage && (
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={subiendoArchivo}
                      className="text-[10px] text-blue-600 hover:text-blue-800 underline disabled:opacity-50">
                      Reemplazar
                    </button>
                  )}
                </div>
              </div>
              {loadingOriginal ? (
                <div className="flex items-center justify-center py-8 text-gray-400 bg-gray-50 rounded-lg">
                  <RotateCcw size={16} className="animate-spin mr-2" />
                  <span className="text-xs">Cargando documento original...</span>
                </div>
              ) : originalUrl ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 450 }}>
                  <iframe src={originalUrl} title="Oficio original" className="w-full h-full" style={{ border: 'none' }} />
                </div>
              ) : originalError ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
                  <AlertTriangle size={20} className="text-red-500" />
                  <p className="text-xs text-red-700 text-center">{originalError}</p>
                  <div className="flex gap-2">
                    <button onClick={cargarOriginal}
                      className="text-[10px] px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-100">
                      Reintentar
                    </button>
                    {canSubirArchivo && (
                      <button onClick={() => uploadInputRef.current?.click()}
                        disabled={subiendoArchivo}
                        className="text-[10px] px-2 py-1 rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                        {subiendoArchivo ? 'Subiendo…' : 'Subir de nuevo'}
                      </button>
                    )}
                  </div>
                </div>
              ) : !doc.url_storage ? (
                <div className="flex flex-col items-center justify-center py-6 px-4 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                  <FileText size={20} className="text-amber-600" />
                  <p className="text-xs text-amber-800 text-center font-medium">
                    Este oficio se registró sin archivo adjunto.
                  </p>
                  {canSubirArchivo ? (
                    <button
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={subiendoArchivo}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md text-white font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {subiendoArchivo
                        ? <><RotateCcw size={12} className="animate-spin" /> Subiendo…</>
                        : <><Upload size={12} /> Subir escaneo (PDF/JPG/PNG)</>}
                    </button>
                  ) : (
                    <p className="text-[10px] text-amber-600 text-center">
                      Solicita a Secretaría o Dirección adjuntar el escaneo.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-6 bg-gray-50 rounded-lg">
                  <button onClick={cargarOriginal}
                    className="text-xs text-gray-500 underline hover:text-gray-700">Cargar documento original</button>
                </div>
              )}
              {doc.nombre_archivo && (
                <p className="text-[10px] text-gray-400 text-center truncate">{doc.nombre_archivo}</p>
              )}
            </div>}

            {/* Upload scan (si no tiene archivo aún) */}
            {!doc.url_storage && (
              <div>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleOCR(f) }} />
                <button onClick={() => fileRef.current?.click()}
                  disabled={procesando}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-3 text-xs text-gray-500 hover:border-gray-400 transition-colors">
                  {procesando
                    ? <><RotateCcw size={13} className="animate-spin" /> Procesando con IA...</>
                    : <><Upload size={13} /> Subir scan/foto del oficio</>}
                </button>
              </div>
            )}

            {/* Reemplazar scan — oculto en modo flotante */}
            {!hideDocumentVisor && doc.url_storage && (
              <div>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleOCR(f) }} />
                <button onClick={() => fileRef.current?.click()}
                  disabled={procesando}
                  className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-1.5 text-[10px] text-gray-500 hover:bg-gray-50 transition-colors">
                  {procesando ? <><RotateCcw size={10} className="animate-spin" /> Procesando...</> : <><Upload size={10} /> Reemplazar documento</>}
                </button>
              </div>
            )}

            {/* ── Estado del trámite — visible en tab Respuesta ── */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Estado del trámite</p>
                {canCambiarEstado && <div className="flex gap-1 flex-wrap justify-end">
                  {(['en_atencion', 'respondido', ...(!doc.requiere_respuesta ? ['de_conocimiento'] : [])] as string[]).map(e => {
                    const sinTurno         = e === 'en_atencion' && !doc.area_turno_confirmada
                    const sinRespuesta     = e === 'respondido'  && doc.requiere_respuesta && !doc.borrador_respuesta
                    const secretariaSinDir = e === 'en_atencion' && isSecretaria && doc.area_turno !== 'DIR'
                    const bloqueado        = sinTurno || sinRespuesta || secretariaSinDir
                    return (
                      <button key={e}
                        onClick={() => estadoMutation.mutate(e)}
                        disabled={doc.estado === e || bloqueado}
                        title={
                          secretariaSinDir ? 'Solo puedes poner en atención oficios turnados directamente a Dirección' :
                          sinTurno         ? 'Confirma primero el área de turno' :
                          sinRespuesta     ? 'Genera primero la respuesta' :
                          undefined
                        }
                        className={clsx(
                          'text-[9px] px-2 py-0.5 rounded-full border transition-colors',
                          doc.estado === e
                            ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-default'
                            : bloqueado
                            ? 'border-gray-200 bg-gray-100 text-gray-300 cursor-not-allowed opacity-50'
                            : e === 'de_conocimiento'
                            ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                            : 'border-gray-200 text-gray-600 hover:bg-white',
                        )}>
                        {ESTADO_RECIBIDO_CONFIG[e as EstadoRecibido]?.label ?? e}
                      </button>
                    )
                  })}
                </div>}
              </div>
              <PipelineRecibido estado={doc.estado} />
            </div>

            {/* ── Datos del oficio de respuesta — al inicio en modo flotante ── */}
            {hideDocumentVisor && canGenerarRespuestaEfectivo && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Datos del oficio de respuesta</p>
                <div>
                  <label className="text-[10px] text-gray-500">Folio de respuesta</label>
                  <div className="flex gap-1.5">
                    <input type="text" placeholder="SFA/SF/DPP/SPFP/0001/2026"
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none font-mono"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={folioLocal} onChange={e => setFolioLocal(e.target.value)}
                      onBlur={() => folioLocal !== (doc.folio_respuesta ?? '') && guardarFolioRef('folio', folioLocal)} />
                    {!folioLocal && (
                      <button
                        onClick={async () => {
                          try {
                            const { folio } = await documentosApi.siguienteFolio(doc.tipo?.toUpperCase() || 'OFICIO', doc.area_turno || undefined)
                            setFolioLocal(folio)
                            await documentosApi.update(doc.id, { folio_respuesta: folio })
                            invalidate()
                          } catch { /* */ }
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-md border transition-colors whitespace-nowrap"
                        style={{ borderColor: GUINDA, color: GUINDA }}
                        title="Generar folio consecutivo automático">
                        <Hash size={10} /> Auto
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Fecha del oficio de respuesta</label>
                  <input type="text" placeholder="16 de marzo de 2026 (dejar vacío = fecha actual)"
                    className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                    style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                    value={fechaRespLocal} onChange={e => setFechaRespLocal(e.target.value)}
                    onBlur={() => fechaRespLocal !== (doc.fecha_respuesta ?? '') && guardarFolioRef('fecha', fechaRespLocal)} />
                  <p className="text-[9px] text-gray-400 mt-0.5">Si se deja vacío, se usa la fecha del día de descarga</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500">Elaboró</label>
                    <input type="text" placeholder="ECJ"
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={elaboroLocal} onChange={e => setElaboro(e.target.value)}
                      onBlur={() => elaboroLocal !== (doc.referencia_elaboro ?? '') && guardarFolioRef('elaboro', elaboroLocal)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Revisó</label>
                    <input type="text" placeholder="bhs"
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={revisoLocal} onChange={e => setReviso(e.target.value)}
                      onBlur={() => revisoLocal !== (doc.referencia_reviso ?? '') && guardarFolioRef('reviso', revisoLocal)} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Generación de respuesta con IA (solo Área + Director + Super) ── */}
            {canGenerarRespuestaEfectivo && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Wand2 size={14} className="text-blue-600" />
                  <p className="text-xs font-medium text-blue-800">Generar oficio de respuesta con IA</p>
                </div>
                <textarea
                  value={instruccionesIA}
                  onChange={e => setInstruccionesIA(e.target.value)}
                  placeholder="Instrucciones para la IA (ej: 'Contestar en sentido negativo', 'Incluir la tabla del documento adjunto en la respuesta', 'Usa el oficio adjunto como base, solo mejora redacción')..."
                  className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs h-16 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button onClick={() => handleBorrador(instruccionesIA)} disabled={generando}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-medium text-white transition-colors"
                  style={{ backgroundColor: GUINDA }}>
                  {generando
                    ? <><RotateCcw size={12} className="animate-spin" /> Generando oficio...</>
                    : <><Wand2 size={12} /> Generar oficio de respuesta</>}
                </button>
              </div>
            )}

            {/* ── Cargar documento de referencia para IA ── */}
            {canGenerarRespuestaEfectivo && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Upload size={14} className="text-blue-600" />
                  <p className="text-xs font-medium text-gray-700">Documento de referencia para IA</p>
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Adjunta tablas, respuestas previas, Excel o documentos Word. La IA los analiza directamente (incluyendo tablas y formato) al generar la respuesta. Usa las instrucciones para indicar: "incluye la tabla adjunta", "mejora la redacción del oficio adjunto", etc.
                </p>

                {doc.referencia_archivo_nombre ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      <FileText size={14} className="text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-blue-800 truncate">{doc.referencia_archivo_nombre}</p>
                        <p className="text-[9px] text-blue-600">
                          {doc.contenido_referencia
                            ? `${Math.min(doc.contenido_referencia.length, 99999).toLocaleString()} caracteres extraídos`
                            : 'Procesando…'}
                        </p>
                      </div>
                      <button onClick={handleEliminarReferencia}
                        className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar referencia">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input ref={refFileRef} type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx,.xlsx,.xls,.csv,.txt"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { handleEliminarReferencia().then(() => handleCargarReferencia(f)) }; if (e.target) e.target.value = '' }}
                      />
                      <button onClick={() => refFileRef.current?.click()}
                        disabled={cargandoReferencia}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg font-medium transition-colors border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                        {cargandoReferencia
                          ? <><RotateCcw size={10} className="animate-spin" /> Procesando…</>
                          : <><Upload size={10} /> Cambiar archivo</>}
                      </button>
                      <button onClick={handleEliminarReferencia}
                        className="flex items-center justify-center gap-1 py-1.5 px-3 text-[10px] rounded-lg font-medium transition-colors border border-red-300 text-red-600 hover:bg-red-50">
                        <X size={10} /> Eliminar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input ref={refFileRef} type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx,.xlsx,.xls,.csv,.txt"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleCargarReferencia(f) }}
                    />
                    <button onClick={() => refFileRef.current?.click()}
                      disabled={cargandoReferencia}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-medium text-white transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {cargandoReferencia
                        ? <><RotateCcw size={12} className="animate-spin" /> Procesando documento…</>
                        : <><Upload size={12} /> Cargar documento de referencia</>}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Secretaría: mensaje informativo solo cuando NO está turnado a DIR */}
            {isSecretaria && !doc.borrador_respuesta && doc.area_turno !== 'DIR' && (
              <div className="text-center py-4 text-gray-400">
                <p className="text-xs">El área responsable generará la respuesta al oficio.</p>
              </div>
            )}

            {/* ── Borrador generado (visible para todos los roles) ── */}
            {doc.borrador_respuesta && (
              <>
                {/* Datos del oficio de respuesta — solo en vista normal (en flotante aparece arriba) */}
                {canGenerarRespuestaEfectivo && !hideDocumentVisor && (
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Datos del oficio de respuesta</p>
                    <div>
                      <label className="text-[10px] text-gray-500">Folio de respuesta</label>
                      <div className="flex gap-1.5">
                        <input type="text" placeholder="SFA/SF/DPP/SPFP/0001/2026"
                          className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none font-mono"
                          style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                          value={folioLocal} onChange={e => setFolioLocal(e.target.value)}
                          onBlur={() => folioLocal !== (doc.folio_respuesta ?? '') && guardarFolioRef('folio', folioLocal)} />
                        {!folioLocal && (
                          <button
                            onClick={async () => {
                              try {
                                const { folio } = await documentosApi.siguienteFolio(doc.tipo?.toUpperCase() || 'OFICIO', doc.area_turno || undefined)
                                setFolioLocal(folio)
                                await documentosApi.update(doc.id, { folio_respuesta: folio })
                                invalidate()
                              } catch { /* */ }
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-md border transition-colors whitespace-nowrap"
                            style={{ borderColor: GUINDA, color: GUINDA }}
                            title="Generar folio consecutivo automático">
                            <Hash size={10} /> Auto
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Fecha del oficio de respuesta</label>
                      <input type="text" placeholder="16 de marzo de 2026 (dejar vacío = fecha actual)"
                        className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                        style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                        value={fechaRespLocal} onChange={e => setFechaRespLocal(e.target.value)}
                        onBlur={() => fechaRespLocal !== (doc.fecha_respuesta ?? '') && guardarFolioRef('fecha', fechaRespLocal)} />
                      <p className="text-[9px] text-gray-400 mt-0.5">Si se deja vacío, se usa la fecha del día de descarga</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Elaboró</label>
                        <input type="text" placeholder="ECJ"
                          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                          style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                          value={elaboroLocal} onChange={e => setElaboro(e.target.value)}
                          onBlur={() => elaboroLocal !== (doc.referencia_elaboro ?? '') && guardarFolioRef('elaboro', elaboroLocal)} />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Revisó</label>
                        <input type="text" placeholder="bhs"
                          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                          style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                          value={revisoLocal} onChange={e => setReviso(e.target.value)}
                          onBlur={() => revisoLocal !== (doc.referencia_reviso ?? '') && guardarFolioRef('reviso', revisoLocal)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabla/cuadro para el DOCX: imagen, Excel o pegado desde clipboard */}
                {canGenerarRespuestaEfectivo && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Tabla/Cuadro para el oficio (opcional)</p>
                    <p className="text-[9px] text-amber-600">
                      Sube una imagen (PNG/JPG), un archivo Excel (.xlsx), o pega directamente desde el portapapeles (Ctrl+V).
                      Se insertará como tabla real en el DOCX.
                    </p>
                    {(doc.tabla_imagen_nombre || doc.tabla_datos_json) ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 bg-green-100 border border-green-300 rounded-lg px-3 py-2">
                          <CheckCircle2 size={14} className="text-green-700 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-medium text-green-800 truncate">{doc.tabla_imagen_nombre || 'Tabla cargada'}</p>
                            {doc.tabla_datos_json && (
                              <p className="text-[9px] text-green-600">{doc.tabla_datos_json.length} filas × {doc.tabla_datos_json[0]?.length || 0} columnas — Se insertará automáticamente en el DOCX</p>
                            )}
                            {doc.tabla_imagen_url && !doc.tabla_datos_json && (
                              <p className="text-[9px] text-green-600">Imagen cargada — Se insertará automáticamente en el DOCX</p>
                            )}
                          </div>
                          <button onClick={async () => { try { await documentosApi.eliminarTablaImagen(doc.id); invalidate() } catch {} }}
                            className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600" title="Eliminar tabla">
                            <X size={12} />
                          </button>
                        </div>
                        {/* Preview de tabla Excel */}
                        {doc.tabla_datos_json && doc.tabla_datos_json.length > 0 && (
                          <div className="max-h-40 overflow-auto border border-amber-200 rounded">
                            <table className="w-full text-[9px]">
                              <thead><tr className="bg-amber-200">
                                {doc.tabla_datos_json[0].map((h: string, ci: number) => <th key={ci} className="px-1 py-0.5 text-left font-semibold text-amber-900 border-r border-amber-300 last:border-r-0">{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {doc.tabla_datos_json.slice(1, 8).map((row: string[], ri: number) => (
                                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-amber-50'}>
                                    {row.map((c: string, ci: number) => <td key={ci} className="px-1 py-0.5 border-r border-amber-100 last:border-r-0">{c}</td>)}
                                  </tr>
                                ))}
                                {doc.tabla_datos_json.length > 8 && (
                                  <tr><td colSpan={doc.tabla_datos_json[0].length} className="px-1 py-0.5 text-center text-amber-500 italic">...{doc.tabla_datos_json.length - 8} filas más</td></tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {/* Botón para cambiar tabla */}
                        <div>
                          <input id={`tabla-change-${doc.id}`} type="file" accept="image/png,image/jpeg,image/webp,.xlsx,.xls" className="hidden"
                            onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await documentosApi.cargarTablaImagen(doc.id, f); invalidate() } catch {} }; if (e.target) e.target.value = '' }} />
                          <button onClick={() => document.getElementById(`tabla-change-${doc.id}`)?.click()}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg font-medium transition-colors border border-amber-400 text-amber-700 hover:bg-amber-100">
                            <Upload size={10} /> Cambiar tabla
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <input id={`tabla-img-${doc.id}`} type="file" accept="image/png,image/jpeg,image/webp,.xlsx,.xls" className="hidden"
                          onChange={async e => { const f = e.target.files?.[0]; if (f) { try { await documentosApi.cargarTablaImagen(doc.id, f); invalidate() } catch {} }; if (e.target) e.target.value = '' }} />
                        <div className="flex gap-2">
                          <button onClick={() => document.getElementById(`tabla-img-${doc.id}`)?.click()}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] rounded-lg font-medium transition-colors border border-amber-400 text-amber-700 hover:bg-amber-100">
                            <Upload size={10} /> Subir imagen (PNG/JPG) o Excel (.xlsx)
                          </button>
                        </div>
                        {/* Zona de pegado desde clipboard — NO abre file picker */}
                        <div
                          className="border-2 border-dashed border-amber-300 rounded-lg p-3 text-center cursor-text hover:bg-amber-100 hover:border-amber-500 transition-colors focus:border-amber-600 focus:bg-amber-100 focus:outline-none"
                          tabIndex={0}
                          onPaste={async (e) => {
                            const items = e.clipboardData?.items;
                            if (!items) return;
                            for (const item of Array.from(items)) {
                              if (item.type.startsWith('image/')) {
                                e.preventDefault();
                                const blob = item.getAsFile();
                                if (blob) {
                                  const file = new File([blob], `tabla_pegada.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
                                  try { await documentosApi.cargarTablaImagen(doc.id, file); invalidate() } catch {}
                                }
                                return;
                              }
                            }
                          }}
                        >
                          <p className="text-[10px] text-amber-700 font-semibold">Pegar imagen del portapapeles</p>
                          <p className="text-[9px] text-amber-500 mt-1">1. Selecciona la tabla en Excel → Copiar como imagen</p>
                          <p className="text-[9px] text-amber-500">2. Haz click aquí para activar esta zona</p>
                          <p className="text-[9px] text-amber-500">3. Presiona Ctrl+V (⌘+V en Mac)</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── Fila horizontal: Editar borrador | Descargar oficio | Firmar documento ── */}
                <div className="flex gap-2">
                  {canGenerarRespuestaEfectivo && doc.borrador_respuesta && (
                    <button onClick={() => { setEditBorrador(prev => !prev); setBorradorText(doc.borrador_respuesta ?? '') }}
                      className={clsx(
                        'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border transition-colors',
                        editBorrador
                          ? 'bg-gray-100 border-gray-400 text-gray-700'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50',
                      )}>
                      <Edit3 size={11} /> Editar borrador
                    </button>
                  )}
                  {canDescargarDocx && (
                    <button onClick={handleDescargarOficio} disabled={descargando}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      {descargando
                        ? <><RotateCcw size={11} className="animate-spin" /> Generando…</>
                        : <><Download size={11} /> Descargar oficio</>}
                    </button>
                  )}
                  {doc.firmado_digitalmente ? (
                    <div className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <CheckCircle2 size={12} className="text-emerald-600" />
                      <span className="text-[10px] font-medium text-emerald-700">Firmado</span>
                    </div>
                  ) : doc.estado === 'respondido' && !canFirmar ? (
                    <div className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <Clock size={12} className="text-amber-600" />
                      <span className="text-[10px] font-medium text-amber-700">En espera de firma</span>
                    </div>
                  ) : canFirmar ? (
                    <button onClick={() => setShowFirmaModal(true)}
                      disabled={!['en_atencion', 'respondido', 'borrador', 'en_revision', 'turnado'].includes(doc.estado)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border transition-colors disabled:opacity-50"
                      style={{ borderColor: GUINDA, color: GUINDA }}>
                      <FileSignature size={11} /> Firmar documento
                    </button>
                  ) : canEnviarParaFirma ? (
                    <button onClick={async () => {
                      try {
                        setEnviandoFirma(true)
                        await documentosApi.cambiarEstado(doc.id, 'respondido' as never)
                        setEnviadoFirmaOk(true)
                        setTimeout(() => setEnviadoFirmaOk(false), 4000)
                        invalidate()
                      } catch (e) { window.alert('Error al enviar para firma: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo'))
                      } finally { setEnviandoFirma(false) }
                    }}
                      disabled={doc.estado === 'respondido' || enviandoFirma}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium text-white disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: GUINDA }}>
                      {enviandoFirma
                        ? <><RotateCcw size={11} className="animate-spin" /> Enviando…</>
                        : <><Send size={11} /> Enviar a firma</>}
                    </button>
                  ) : null}
                </div>

                {/* Editor expandible — aparece bajo la fila de botones */}
                {editBorrador && canGenerarRespuestaEfectivo && (
                  <div className="space-y-2">
                    <textarea rows={10} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs resize-none focus:ring-1"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={borradorText} onChange={e => setBorradorText(e.target.value)} />
                    <div className="flex gap-2">
                      <button onClick={() => setEditBorrador(false)}
                        className="flex-1 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
                      <button onClick={() => guardarBorradorMutation.mutate()}
                        disabled={guardarBorradorMutation.isPending}
                        className="flex-1 py-1.5 text-xs rounded-lg text-white font-medium"
                        style={{ backgroundColor: GUINDA }}>
                        {guardarBorradorMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Toast confirmación de envío a firma */}
                {enviadoFirmaOk && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg animate-pulse">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span className="text-xs font-medium text-emerald-700">Oficio enviado para firma del Director</span>
                  </div>
                )}
              </>
            )}

            {/* Datos extraídos (resumen compacto) — oculto en modo flotante */}
            {!hideDocumentVisor && doc.ocr_procesado && datosIA && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Datos extraídos por IA</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['No. oficio', datosIA['numero_oficio']],
                    ['Fecha', datosIA['fecha_documento']],
                    ['Remitente', datosIA['remitente_nombre']],
                    ['Dependencia', datosIA['remitente_dependencia']],
                    ['Páginas', datosIA['numero_paginas']],
                  ] as [string, unknown][]).filter(([, val]) => !!val).map(([label, val]) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5">
                      <span className="text-[9px] text-gray-500">{label}</span>
                      <p className="text-[10px] text-gray-800 font-medium truncate">{String(val)}</p>
                    </div>
                  ))}
                </div>

                {/* Firmantes adicionales (visto bueno, autoriza, etc.) */}
                {Array.isArray(datosIA['firmantes_adicionales']) && (datosIA['firmantes_adicionales'] as unknown[]).length > 0 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-2 py-1.5">
                    <p className="text-[9px] font-semibold text-blue-700 mb-1">Firmantes adicionales</p>
                    <div className="space-y-1">
                      {(datosIA['firmantes_adicionales'] as Array<{ nombre?: string; cargo?: string; rol?: string }>).map((f, i) => (
                        <div key={i} className="text-[10px] text-blue-800">
                          <span className="font-medium">{f.nombre || '—'}</span>
                          {f.cargo && <span className="text-blue-600"> · {f.cargo}</span>}
                          {f.rol && <span className="ml-1 text-[9px] bg-blue-100 px-1 rounded">{f.rol}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Anexos detectados */}
                {Array.isArray(datosIA['anexos']) && (datosIA['anexos'] as unknown[]).length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                    <p className="text-[9px] font-semibold text-amber-700 mb-1">
                      Anexos detectados ({(datosIA['anexos'] as unknown[]).length})
                    </p>
                    <div className="space-y-1">
                      {(datosIA['anexos'] as Array<{ tipo?: string; descripcion?: string; paginas?: string }>).map((a, i) => (
                        <div key={i} className="text-[10px] text-amber-800 flex items-start gap-1">
                          <span className="text-amber-500">•</span>
                          <div className="flex-1">
                            {a.tipo && <span className="font-medium">{a.tipo}</span>}
                            {a.descripcion && <span>: {a.descripcion}</span>}
                            {a.paginas && <span className="text-[9px] text-amber-500 ml-1">(p. {a.paginas})</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Panel Firma Digital ── */}
            {doc.firmado_digitalmente && doc.firma_metadata && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-emerald-600" />
                  <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Firma Digital</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="bg-white/60 rounded-lg px-3 py-2">
                    <p className="text-emerald-700 font-medium">Firmante</p>
                    <p className="text-gray-700 font-medium">{(doc.firma_metadata as Record<string,string>)['nombre_firmante'] || '—'}</p>
                  </div>
                  <div className="bg-white/60 rounded-lg px-3 py-2">
                    <p className="text-emerald-700 font-medium">Fecha firma</p>
                    <p className="text-gray-700 font-medium">{(doc.firma_metadata as Record<string,string>)['fecha_firma'] ? new Date((doc.firma_metadata as Record<string,string>)['fecha_firma']).toLocaleString('es-MX') : '—'}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Tab: Historial ───────────────────────────────────────────────── */}
        {/* ── Tab: Documento (visor PDF embebido) ─────────────────────────── */}
        {tab === 'documento' && (
          <>
            {loadingPdf ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RotateCcw size={24} className="animate-spin mb-3" />
                <p className="text-xs">Generando vista previa del oficio...</p>
              </div>
            ) : pdfUrl ? (
              <div className="space-y-3">
                {doc.firmado_digitalmente && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <Shield size={13} className="text-emerald-600" />
                    <span className="text-[10px] font-medium text-emerald-700">Documento firmado electrónicamente con e.firma</span>
                  </div>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setVisorFlotante('pdf')}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
                    title="Abrir en ventana flotante">
                    <FolderOpen size={10} /> Ampliar visor
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 'calc(100vh - 280px)', minHeight: 500 }}>
                  <iframe
                    src={pdfUrl}
                    title="Vista previa del oficio"
                    className="w-full h-full"
                    style={{ border: 'none' }}
                  />
                </div>
                <div className="flex gap-2">
                  {canDescargarDocx && (
                    <button onClick={handleDescargarOficio} disabled={descargando}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
                      <Download size={12} /> {descargando ? 'Descargando...' : 'Descargar DOCX'}
                    </button>
                  )}
                  <button onClick={async () => { await documentosApi.descargarOficioPdf(doc.id) }}
                    className={`${canDescargarDocx ? 'flex-1' : 'w-full'} flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium text-white transition-colors hover:opacity-90`}
                    style={{ backgroundColor: GUINDA }}>
                    <Download size={12} /> Descargar PDF
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <FileText size={24} className="mb-3 opacity-40" />
                <p className="text-xs mb-2">No se pudo generar la vista previa</p>
                <button onClick={() => {
                  setLoadingPdf(true)
                  documentosApi.obtenerOficioPdfUrl(doc.id)
                    .then(url => setPdfUrl(url))
                    .catch(() => {})
                    .finally(() => setLoadingPdf(false))
                }}
                  className="text-xs font-medium px-4 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
                  Reintentar
                </button>
              </div>
            )}
          </>
        )}

        {tab === 'historial' && (
          <>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Historial de acciones
            </p>
            {historial.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <History size={24} className="mx-auto mb-2 opacity-40" />
                <p className="text-xs">Sin historial registrado</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />
                <div className="space-y-3">
                  {historial.map((entry: HistorialItem) => {
                    const isDevolucion = entry.tipo_accion === 'devolucion'
                    const isReenvio = entry.tipo_accion === 'reenvio'
                    const isFirma = entry.tipo_accion === 'firma'
                    const dotColor = isDevolucion ? 'bg-red-500' : isReenvio ? 'bg-amber-500' : isFirma ? 'bg-green-500' : 'bg-gray-400'
                    const bgColor = isDevolucion ? 'bg-red-50 border-red-100' : isReenvio ? 'bg-amber-50 border-amber-100' : isFirma ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'
                    const icon = isDevolucion ? '🔴' : isReenvio ? '🟡' : isFirma ? '✅' : '🔄'

                    return (
                      <div key={entry.id} className="relative pl-8">
                        {/* Dot */}
                        <div className={`absolute left-1.5 top-2.5 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                        {/* Card */}
                        <div className={`rounded-lg border p-2.5 ${bgColor}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{icon}</span>
                              <span className="text-[10px] font-semibold text-gray-700">
                                v{entry.version} {isDevolucion ? 'Devuelto' : isReenvio ? 'Reenviado' : isFirma ? 'Firmado' : entry.tipo_accion}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-400">{formatDateTime(entry.timestamp)}</span>
                          </div>
                          {entry.usuario_nombre && (
                            <p className="text-[10px] text-gray-500 mb-0.5">{entry.usuario_nombre}</p>
                          )}
                          <p className="text-xs text-gray-700 leading-relaxed">{entry.observaciones}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Barra de acciones fija (visible en TODOS los tabs) ── */}
      {doc.flujo === 'recibido' && (
        <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
          {doc.firmado_digitalmente ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 py-2 px-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <Shield size={14} className="text-emerald-600" />
                  <span className="text-xs font-medium text-emerald-700">Documento firmado digitalmente</span>
                </div>
                <button onClick={() => setTab('info')} className="text-[10px] font-medium text-emerald-600 hover:text-emerald-800 underline">Ver firma</button>
              </div>
              <div className="flex gap-2">
                {canDescargarDocx && (
                  <button onClick={handleDescargarOficio} disabled={descargando}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50">
                    <Download size={12} /> {descargando ? 'Descargando...' : 'Descargar DOCX'}
                  </button>
                )}
                <button onClick={() => {
                  setTab('documento')
                  if (!pdfUrl && !loadingPdf) {
                    setLoadingPdf(true)
                    documentosApi.obtenerOficioPdfUrl(doc.id)
                      .then(url => setPdfUrl(url))
                      .catch(() => {})
                      .finally(() => setLoadingPdf(false))
                  }
                }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors">
                  <Eye size={12} /> Ver documento
                </button>
              </div>

              {/* ── Acuse de recibido (solo secretaria/admin) ── */}
              {(isSecretaria || isSuperadmin) && (
                <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-300 rounded-xl space-y-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                      <ClipboardCheck size={16} className="text-blue-600" />
                    </div>
                    <div>
                      <span className="text-sm font-bold text-blue-800">Acuse de recibido</span>
                      <p className="text-[10px] text-blue-500">Evidencia de entrega del oficio firmado</p>
                    </div>
                  </div>
                  {acuseLocal.url ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white rounded-lg border border-blue-200 shadow-sm">
                        <FileText size={16} className="text-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-blue-800 truncate">{acuseLocal.nombre}</p>
                          {acuseLocal.fecha && <p className="text-[10px] text-blue-500 mt-0.5">Fecha acuse: {acuseLocal.fecha}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          try {
                            const url = await documentosApi.obtenerAcuseRecibidoUrl(doc.id)
                            const w = window.open(url, '_blank')
                            if (!w) {
                              const a = document.createElement('a')
                              a.href = url; a.target = '_blank'; a.click()
                            }
                          } catch { window.alert('Error al cargar acuse') }
                        }} className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm">
                          <Eye size={14} /> Ver acuse de recibido
                        </button>
                        <button onClick={async () => {
                          if (!window.confirm('¿Eliminar acuse de recibido?')) return
                          await documentosApi.eliminarAcuseRecibido(doc.id)
                          setAcuseLocal({ url: null, nombre: null, fecha: null })
                          invalidate()
                        }} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">
                          <X size={13} /> Eliminar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-blue-600">Suba el escaneo del oficio con sello de acuse de la dependencia destino. La fecha se extrae automáticamente.</p>
                      <label className="flex items-center justify-center gap-2 py-4 text-sm rounded-xl font-semibold border-2 border-dashed border-blue-400 text-blue-700 hover:bg-blue-100 cursor-pointer transition-colors">
                        {subiendoAcuse
                          ? <><RotateCcw size={14} className="animate-spin" /> Subiendo y extrayendo fecha del sello...</>
                          : <><Upload size={16} /> Subir escaneo de acuse (PDF / imagen)</>}
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={subiendoAcuse} onChange={async (e) => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          try {
                            setSubiendoAcuse(true)
                            const updated = await documentosApi.subirAcuseRecibido(doc.id, f)
                            setAcuseLocal({ url: updated.acuse_recibido_url, nombre: updated.acuse_recibido_nombre, fecha: updated.acuse_recibido_fecha })
                            invalidate()
                          } catch (err) { window.alert('Error al subir acuse: ' + ((err as any)?.response?.data?.detail || 'Intente de nuevo'))
                          } finally { setSubiendoAcuse(false) }
                        }} />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Acuse visible para todos (solo lectura) */}
              {!(isSecretaria || isSuperadmin) && acuseLocal.url && (
                <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
                  <ClipboardCheck size={12} className="text-blue-600" />
                  <span className="text-[10px] text-blue-700 flex-1">Acuse de recibido registrado</span>
                  <button onClick={async () => {
                    const url = await documentosApi.obtenerAcuseRecibidoUrl(doc.id)
                    window.open(url, '_blank')
                  }} className="text-[10px] text-blue-600 underline hover:text-blue-800">Ver</button>
                </div>
              )}
            </div>
          ) : doc.estado === 'devuelto' ? (
            <div className="flex items-center gap-2 py-2 px-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle size={14} className="text-red-500" />
              <span className="text-xs font-medium text-red-600">Devuelto — requiere correcciones antes de firma</span>
            </div>
          ) : ['en_atencion', 'respondido', 'de_conocimiento'].includes(doc.estado) && doc.borrador_respuesta ? (
            <div className="space-y-2">
              {/* Fila horizontal: Enviar/Re-enviar a firma + Devolver para correcciones */}
              <div className="flex gap-2">
                {canFirmar ? (
                  <button onClick={() => setShowFirmaModal(true)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg text-white font-semibold transition-colors hover:opacity-90"
                    style={{ backgroundColor: GUINDA }}>
                    <FileSignature size={12} /> Firmar documento
                  </button>
                ) : (!hideDocumentVisor || tab === 'ocr') && canEnviarParaFirma ? (
                  <button onClick={async () => {
                    try {
                      await documentosApi.cambiarEstado(doc.id, 'respondido' as never)
                      invalidate()
                      setEnviadoFirmaOk(true)
                      setTimeout(() => setEnviadoFirmaOk(false), 4000)
                    } catch (e) { window.alert('Error al enviar a firma: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
                  }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg text-white font-semibold transition-colors hover:opacity-90"
                    style={{ backgroundColor: GUINDA }}>
                    <Send size={12} />
                    {doc.estado === 'respondido' ? 'Re-enviar a firma' : 'Enviar a firma'}
                  </button>
                ) : null}
                {(!hideDocumentVisor || tab === 'ocr') && can('devolver') && (
                  <button onClick={() => { setObservacionesDevolucion(''); setShowDevolucionModal(true) }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 transition-colors">
                    <AlertTriangle size={11} /> Devolver para correcciones
                  </button>
                )}
              </div>
              {/* Visto Bueno del Subdirector — no aplica cuando está turnado a Dirección */}
              {(!hideDocumentVisor || tab === 'ocr') && can('visto_bueno') && !doc.visto_bueno_subdirector && doc.area_turno !== 'DIR' && (
                <button onClick={async () => {
                  try { await documentosApi.registrarVistoBueno(doc.id); invalidate() } catch (e) { window.alert('Error (Visto Bueno): ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
                }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-lg font-medium bg-green-50 border border-green-300 text-green-700 hover:bg-green-100 transition-colors">
                  <CheckCircle2 size={12} /> Dar Visto Bueno
                </button>
              )}
              {(!hideDocumentVisor || tab === 'ocr') && doc.visto_bueno_subdirector && doc.area_turno !== 'DIR' && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 size={12} className="text-green-600" />
                  <span className="text-[10px] text-green-700 font-medium">Visto Bueno del Subdirector registrado</span>
                </div>
              )}
            </div>
          ) : doc.estado === 'en_atencion' && !doc.borrador_respuesta ? (
            <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 border border-gray-200 rounded-lg">
              <Edit3 size={13} className="text-gray-400" />
              <span className="text-[10px] text-gray-500">Genera un borrador de respuesta para habilitar la firma</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Footer certificación */}
      {tab === 'info' && doc.genera_tramite === 'certificacion_presupuestal' && (
        <div className="px-4 py-2 border-t border-gray-100 bg-amber-50">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            <p className="text-[10px] text-amber-700 leading-tight">
              Este oficio genera un <strong>expediente de Certificación Presupuestal</strong>
            </p>
          </div>
        </div>
      )}

      {/* ── Modal pre-firma: Vista previa institucional + Firmar o Devolver ── */}
      {showFirmaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[680px] max-h-[92vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2">
                <FileSignature size={16} style={{ color: GUINDA }} />
                <h3 className="text-sm font-semibold text-gray-900">Revisar y firmar documento</h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  {doc.folio_respuesta && <span className="px-2 py-0.5 bg-gray-100 rounded font-mono">{doc.folio_respuesta}</span>}
                  <span>v{doc.version}</span>
                </div>
                <button onClick={() => { setShowFirmaModal(false); setShowDevolucionForm(false); setObservacionesDevolucion(''); setFirmaError('') }}
                  className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
            </div>

            {/* Folio prominente antes de la vista previa */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-3 p-3 rounded-lg border-2" style={{ borderColor: doc.folio_respuesta ? GUINDA : '#F59E0B', backgroundColor: doc.folio_respuesta ? '#FDF2F8' : '#FFFBEB' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: doc.folio_respuesta ? GUINDA : '#B45309' }}>
                      No. de oficio que se firmará:
                    </p>
                    <p className="text-sm font-bold font-mono mt-0.5" style={{ color: doc.folio_respuesta ? GUINDA : '#B45309' }}>
                      {doc.folio_respuesta || 'SIN FOLIO — Se generará automáticamente'}
                    </p>
                  </div>
                  {doc.fecha_respuesta && (
                    <div className="text-right">
                      <p className="text-[9px] text-gray-500">Fecha del oficio:</p>
                      <p className="text-xs font-medium text-gray-700">{doc.fecha_respuesta}</p>
                    </div>
                  )}
                </div>
                {!doc.folio_respuesta && (
                  <p className="text-[9px] text-amber-600 mt-1">Si necesitas un folio específico, cierra este modal y asígnalo en "Datos del oficio de respuesta".</p>
                )}
              </div>

              {/* Vista previa del oficio con formato institucional */}
              <div className="bg-white border border-gray-300 rounded-lg shadow-sm mx-auto max-w-[580px]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
                <div className="px-8 py-6 space-y-4">

                  {/* Folio y fecha */}
                  <div className="flex justify-between items-start text-[10px]">
                    <div>
                      <p className="font-semibold text-gray-800">{doc.folio_respuesta || 'Sin folio asignado'}</p>
                    </div>
                    <div className="text-right text-gray-600">
                      <p>Morelia, Michoacán</p>
                      <p>{doc.fecha_respuesta || new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                    </div>
                  </div>

                  {/* Destinatario */}
                  <div className="text-[10px] space-y-0.5">
                    <p className="font-bold text-gray-900 uppercase">{doc.remitente_nombre || 'DESTINATARIO'}</p>
                    {doc.remitente_dependencia && (
                      <p className="text-gray-700 uppercase">{doc.remitente_dependencia}</p>
                    )}
                    <p className="text-gray-600 mt-1 italic">Presente</p>
                  </div>

                  {/* Cuerpo del oficio */}
                  <div className="text-[10px] text-gray-800 leading-relaxed space-y-3" style={{ textAlign: 'justify' }}>
                    <p className="whitespace-pre-wrap">{doc.borrador_respuesta}</p>
                  </div>

                  {/* Firma */}
                  <div className="pt-4 text-center space-y-1">
                    <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-wider">Atentamente</p>
                    <div className="py-3">
                      <div className="w-40 mx-auto border-b border-gray-300" />
                    </div>
                    <p className="text-[10px] font-bold text-gray-900">Mtro. Marco Antonio Flores Mejía</p>
                    <p className="text-[9px] text-gray-600">Director de Programación y Presupuesto</p>
                  </div>

                  {/* Referencias */}
                  {(doc.referencia_elaboro || doc.referencia_reviso) && (
                    <div className="pt-2 border-t border-gray-200 text-[8px] text-gray-400 font-mono">
                      MAFM/{doc.referencia_elaboro || '___'}/{doc.referencia_reviso || '___'}
                    </div>
                  )}
                </div>
              </div>

              {/* Nota: editar en tab IA */}
              <p className="text-[10px] text-gray-400 text-center mt-3">
                Para editar el contenido, usa la pestaña <strong>IA / OCR</strong>. Esta es una vista previa del documento final.
              </p>
            </div>

            {/* Footer fijo: contraseña + acciones */}
            <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-3 space-y-3">
              {showDevolucionForm ? (
                <div className="space-y-3 bg-red-50 border border-red-200 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <CornerUpLeft size={14} className="text-red-600" />
                    <p className="text-xs font-semibold text-red-800">Devolver al área responsable</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-red-700 mb-1 block">
                      Motivo de devolución <span className="text-red-500">*</span>
                    </label>
                    <textarea rows={3}
                      className="w-full border border-red-300 rounded-lg px-3 py-2 text-xs resize-none focus:ring-1 focus:ring-red-400 focus:outline-none"
                      placeholder="Describa las observaciones o correcciones requeridas (mínimo 10 caracteres)..."
                      value={observacionesDevolucion}
                      onChange={e => setObservacionesDevolucion(e.target.value)} />
                    {observacionesDevolucion.length > 0 && observacionesDevolucion.trim().length < 10 && (
                      <p className="text-[10px] text-red-500 mt-1">Mínimo 10 caracteres ({observacionesDevolucion.trim().length}/10)</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowDevolucionForm(false); setObservacionesDevolucion('') }}
                      className="flex-1 py-2 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                      Cancelar
                    </button>
                    <button onClick={handleDevolver}
                      disabled={devolviendo || observacionesDevolucion.trim().length < 10}
                      className="flex-1 py-2 text-xs rounded-lg text-white font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors">
                      {devolviendo
                        ? <span className="flex items-center justify-center gap-1"><RotateCcw size={11} className="animate-spin" /> Devolviendo...</span>
                        : <span className="flex items-center justify-center gap-1"><CornerUpLeft size={11} /> Confirmar devolución</span>}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Lock size={11} className="text-gray-500" />
                        <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                          Contraseña e.firma
                        </label>
                      </div>
                      <input
                        type="password"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-[#911A3A]/40 focus:border-[#911A3A] focus:outline-none"
                        placeholder="Ingrese su contraseña FIEL..."
                        value={firmaPassword}
                        onChange={e => setFirmaPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && firmaPassword.trim() && handleFirmar()}
                      />
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {(isDirector || isSuperadmin) && (
                        <button onClick={() => setShowDevolucionForm(true)}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg font-medium border border-red-300 text-red-700 hover:bg-red-50 transition-colors">
                          <CornerUpLeft size={12} /> Devolver
                        </button>
                      )}
                      <button onClick={handleFirmar} disabled={firmando || !firmaPassword.trim()}
                        className="flex items-center gap-1.5 px-5 py-2 text-xs rounded-lg text-white font-semibold transition-colors disabled:opacity-50"
                        style={{ backgroundColor: GUINDA }}>
                        {firmando
                          ? <><RotateCcw size={12} className="animate-spin" /> Firmando...</>
                          : <><CheckCircle2 size={12} /> Firmar con e.firma</>}
                      </button>
                    </div>
                  </div>

                  {/* Error de firma */}
                  {firmaError && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertTriangle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-red-700">{firmaError}</p>
                    </div>
                  )}

                  <p className="text-[9px] text-gray-400 text-center">
                    La firma generará sello digital RSA + SHA-256 y QR de verificación. La contraseña no se almacena.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Devolución independiente ── */}
      {showDevolucionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-96 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-red-50">
              <div className="flex items-center gap-2">
                <CornerUpLeft size={16} className="text-red-600" />
                <h3 className="text-sm font-semibold text-red-900">Devolver documento</h3>
              </div>
              <button onClick={() => { setShowDevolucionModal(false); setObservacionesDevolucion('') }}
                className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>

            {/* Info del documento */}
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-900 truncate">{doc.asunto}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{doc.numero_oficio_origen} · {doc.area_turno_nombre || 'Sin área'}</p>
            </div>

            {/* Formulario */}
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-red-800 block mb-1.5">Motivo de devolución *</label>
                <textarea
                  value={observacionesDevolucion}
                  onChange={e => setObservacionesDevolucion(e.target.value)}
                  placeholder="Describa las observaciones o correcciones requeridas (mínimo 10 caracteres)..."
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs h-28 resize-none focus:ring-1 focus:ring-red-300 focus:border-red-300"
                />
                <p className="text-[10px] text-gray-400 mt-1 text-right">
                  {observacionesDevolucion.trim().length}/10 mínimo
                </p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setShowDevolucionModal(false); setObservacionesDevolucion('') }}
                  className="flex-1 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={handleDevolver}
                  disabled={observacionesDevolucion.trim().length < 10 || devolviendo}
                  className="flex-1 py-2 text-xs rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                  {devolviendo
                    ? <><RotateCcw size={11} className="animate-spin" /> Devolviendo...</>
                    : <><CornerUpLeft size={11} /> Confirmar devolución</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Visor flotante modal */}
      {visorFlotante === 'pdf' && pdfUrl && (
        <VisorFlotante
          url={pdfUrl}
          titulo={`${doc.folio_respuesta || doc.numero_oficio_origen || doc.asunto}`}
          firmado={doc.firmado_digitalmente ?? undefined}
          onClose={() => setVisorFlotante(null)}
          onDownload={() => documentosApi.descargarOficioPdf(doc.id)}
        />
      )}
      {visorFlotante === 'original' && originalUrl && (
        <VisorFlotante
          url={originalUrl}
          titulo={`Oficio original — ${doc.numero_oficio_origen || doc.asunto}`}
          onClose={() => setVisorFlotante(null)}
        />
      )}
    </div>
  )
}

// ── Tarjeta de documento recibido ─────────────────────────────────────────────
export function TarjetaRecibido({
  doc, selected, onClick, multiSelect, multiSelected, onToggleSelect,
}: {
  doc: DocumentoListItem; selected: boolean; onClick: () => void;
  multiSelect?: boolean; multiSelected?: boolean; onToggleSelect?: () => void;
}) {
  const cfg = ESTADO_RECIBIDO_CONFIG[doc.estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
  const canSelect = (doc.estado === 'en_atencion' || doc.estado === 'respondido') && doc.has_borrador === true && !doc.firmado_digitalmente
  return (
    <div onClick={multiSelect ? (canSelect ? onToggleSelect : undefined) : onClick}
      title={multiSelect && !canSelect
        ? (doc.firmado_digitalmente
            ? 'No seleccionable: documento ya firmado'
            : doc.estado !== 'en_atencion'
            ? 'No seleccionable: requiere estado "En atención"'
            : 'No seleccionable: requiere borrador de respuesta')
        : undefined}
      className={clsx(
        'bg-white rounded-xl border p-3 cursor-pointer transition-all',
        multiSelect && multiSelected
          ? 'border-[#911A3A] shadow-md ring-1 ring-[#911A3A]/20 bg-[#FDF8F9]'
          : multiSelect && !canSelect
          ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
          : selected
          ? 'border-[#911A3A] shadow-md ring-1 ring-[#911A3A]/20'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm',
      )}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          {multiSelect && (
            <div className={clsx(
              'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
              multiSelected ? 'border-[#911A3A] bg-[#911A3A]' : canSelect ? 'border-gray-300' : 'border-gray-200 bg-gray-100',
            )}>
              {multiSelected && <CheckCircle2 size={10} className="text-white" />}
            </div>
          )}
          <span className="text-base">{TIPO_ICONS[doc.tipo]}</span>
          <span className="text-[10px] font-mono text-gray-400 truncate max-w-[100px]">
            {doc.numero_oficio_origen || '—'}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <PrioridadBadge prioridad={doc.prioridad} />
          {multiSelect && canSelect && !multiSelected && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-[#FDF2F4] text-[#911A3A]">
              Listo para firma
            </span>
          )}
          {cfg && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
          )}
        </div>
      </div>
      <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 mb-1.5">{doc.asunto}</p>
      <p className="text-[10px] text-gray-500 truncate mb-2">
        {doc.remitente_dependencia || doc.remitente_nombre || '—'}
      </p>
      <div className="flex items-center justify-between">
        <PipelineRecibido estado={doc.estado} />
        {doc.fecha_limite && <SemaforoAtencion fecha={doc.fecha_limite} estado={doc.estado} />}
      </div>
      {doc.area_turno_nombre && (
        <p className="text-[10px] text-gray-400 mt-1.5 truncate">
          → {doc.area_turno_nombre}
        </p>
      )}
      {doc.estado === 'devuelto' && doc.motivo_devolucion && (
        <p className="text-[10px] text-red-500 mt-1 truncate">
          ⚠️ {doc.motivo_devolucion}
        </p>
      )}
    </div>
  )
}

// ── Panel detalle — Emitido ────────────────────────────────────────────────────
function PanelEmitido({
  doc, areas: _areas, onClose, onRefetch, onDelete,
}: { doc: Documento; areas: AreaDPP[]; onClose: () => void; onRefetch: () => void; onDelete: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const fileRefEmitido = useRef<HTMLInputElement>(null)
  const refFileRefEmitido = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'datos' | 'contenido' | 'documento' | 'historial'>('datos')
  const [editBorrador, setEditBorrador] = useState(false)
  const [borradorText, setBorradorText] = useState(doc.borrador_respuesta ?? '')
  const [generando, setGenerando] = useState(false)
  const [descargando, setDescargando] = useState(false)
  const [firmando, setFirmando] = useState(false)
  const [firmaPassword, setFirmaPassword] = useState('')
  const [firmaError, setFirmaError] = useState('')
  const [showFirmaModal, setShowFirmaModal] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [loadingOriginal, setLoadingOriginal] = useState(false)
  const [visorFlotanteEmitido, setVisorFlotanteEmitido] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [editing, setEditing] = useState(false)
  const [cargandoReferencia, setCargandoReferencia] = useState(false)
  // Devolución
  const [showDevolucionModal, setShowDevolucionModal] = useState(false)
  const [observacionesDevolucion, setObservacionesDevolucion] = useState('')
  const [devolviendo, setDevolviendo] = useState(false)
  // Folio / ref fields con auto-save
  const [folioLocal, setFolioLocal] = useState(doc.folio_respuesta ?? '')
  const [fechaRespLocal, setFechaRespLocal] = useState(doc.fecha_respuesta ?? '')
  const [elaboroLocal, setElaboro] = useState(doc.referencia_elaboro ?? '')
  const [revisoLocal, setReviso] = useState(doc.referencia_reviso ?? '')
  const [editForm, setEditForm] = useState({
    asunto: doc.asunto || '',
    numero_control: doc.numero_control || '',
    dependencia_destino: doc.dependencia_destino || '',
    dependencia_origen: doc.dependencia_origen || '',
    fecha_documento: doc.fecha_documento || '',
  })

  // ── Roles ──
  const isDirector = user?.rol === 'admin_cliente'
  const isSuperadmin = user?.rol === 'superadmin'
  const isSecretaria = user?.rol === 'secretaria'
  const isAsesor = user?.rol === 'asesor'
  const isArea = ['analista', 'subdirector', 'jefe_depto'].includes(user?.rol || '')
  const permissionsVersionEmitido = usePermissionsVersion()
  const canEmitido = useMemo(() => makePermissionChecker(user?.rol ?? ''), [user?.rol, permissionsVersionEmitido])
  const canGenerar = canEmitido('generar_resp')
  const canFirmar = canEmitido('firmar')
  const canEnviarParaFirma = canEmitido('enviar_firma')
  const canDescargarDocx = canEmitido('descargar_docx')
  const canEliminar = canEmitido('eliminar')
  const canEditar = doc.estado === 'borrador' || (doc.estado === 'en_revision' && canFirmar)

  // Error del archivo original (si url_storage existe pero la carga falla)
  const [originalError, setOriginalError] = useState<string | null>(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['documentos'] })
    qc.invalidateQueries({ queryKey: ['documento', doc.id] })
    onRefetch()
  }

  const cargarOriginal = useCallback(() => {
    if (!doc.url_storage) return
    setLoadingOriginal(true)
    setOriginalError(null)
    documentosApi.obtenerArchivoOriginalUrl(doc.id)
      .then(url => setOriginalUrl(url))
      .catch((e: any) => {
        setOriginalUrl(null)
        setOriginalError(e?.response?.data?.detail || 'No se pudo cargar el archivo.')
      })
      .finally(() => setLoadingOriginal(false))
  }, [doc.id, doc.url_storage])

  // Auto-cargar original al montar
  useEffect(() => {
    if (doc.url_storage && !originalUrl && !loadingOriginal) {
      cargarOriginal()
    }
  }, [doc.id, doc.url_storage, cargarOriginal, originalUrl, loadingOriginal])

  const guardarBorradorMutation = useMutation({
    mutationFn: () => documentosApi.update(doc.id, { borrador_respuesta: borradorText }),
    onSuccess: () => { invalidate(); setEditBorrador(false) },
  })

  const guardarDatosMutation = useMutation({
    mutationFn: () => documentosApi.update(doc.id, editForm as DocumentoUpdate),
    onSuccess: () => { invalidate(); setEditing(false) },
  })

  const guardarFolioRef = async (field: string, value: string) => {
    const data: DocumentoUpdate = {}
    if (field === 'folio') data.folio_respuesta = value
    if (field === 'fecha') data.fecha_respuesta = value
    if (field === 'elaboro') data.referencia_elaboro = value
    if (field === 'reviso') data.referencia_reviso = value
    try { await documentosApi.update(doc.id, data); invalidate() } catch (e) { window.alert('Error al guardar: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
  }

  const handleGenerar = async (instrucciones?: string) => {
    setGenerando(true)
    try {
      await documentosApi.generarBorrador(doc.id, instrucciones || aiPrompt || undefined)
      invalidate()
      setTab('contenido')
    } catch (e) { window.alert('Error al generar borrador: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setGenerando(false) }
  }

  const handleUploadFile = async (file: File) => {
    setUploading(true)
    try {
      await documentosApi.uploadArchivo(doc.id, file)
      invalidate()
      setLoadingOriginal(true)
      documentosApi.obtenerArchivoOriginalUrl(doc.id)
        .then(url => setOriginalUrl(url))
        .catch(() => {})
        .finally(() => setLoadingOriginal(false))
    } catch (e) { window.alert('Error al subir archivo: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setUploading(false) }
  }

  const handleCargarReferencia = async (file: File) => {
    setCargandoReferencia(true)
    try { await documentosApi.cargarReferencia(doc.id, file); invalidate() }
    catch (e) { window.alert('Error al cargar referencia: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setCargandoReferencia(false) }
  }

  const handleEliminarReferencia = async () => {
    try { await documentosApi.eliminarReferencia(doc.id); invalidate() }
    catch (e) { window.alert('Error al eliminar referencia: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
  }

  const handleDescargarOficio = async () => {
    setDescargando(true)
    try { await documentosApi.descargarOficio(doc.id) }
    catch (e) { window.alert('Error al descargar oficio: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setDescargando(false) }
  }

  const handleFirmar = async () => {
    if (!firmaPassword.trim()) return
    setFirmando(true); setFirmaError('')
    try {
      await documentosApi.firmarDocumento(doc.id, firmaPassword.trim())
      invalidate()
      setShowFirmaModal(false)
      setFirmaPassword('')
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFirmaError(msg || 'Error al firmar.')
    } finally { setFirmando(false) }
  }

  const handleCambiarEstado = async (estado: string) => {
    try {
      await documentosApi.cambiarEstado(doc.id, estado as never)
      invalidate()
    } catch (e) { window.alert('Error al cambiar estado: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
  }

  const handleDevolver = async () => {
    // Validación defensiva: solo Director, Secretaría o Superadmin pueden devolver
    if (!isDirector && !isSecretaria && !isSuperadmin) {
      window.alert('No tiene permiso para devolver documentos. Solo Director o Secretaría.')
      return
    }
    if (observacionesDevolucion.trim().length < 10) return
    setDevolviendo(true)
    try {
      await documentosApi.devolverDocumento(doc.id, observacionesDevolucion.trim())
      invalidate()
      setShowDevolucionModal(false)
      setObservacionesDevolucion('')
    } catch (e) { window.alert('Error al devolver documento: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
    finally { setDevolviendo(false) }
  }

  // Historial query
  const { data: historial = [] } = useQuery({
    queryKey: ['historial-emitido', doc.id],
    queryFn: () => documentosApi.getHistorial(doc.id),
    enabled: tab === 'historial',
  })

  const estadoCfg = ESTADO_EMITIDO_CONFIG[doc.estado as keyof typeof ESTADO_EMITIDO_CONFIG]
  const hasBorrador = !!(doc.borrador_respuesta || doc.url_storage)
  const tabList: ('datos' | 'contenido' | 'documento' | 'historial')[] = ['datos', 'contenido', ...(doc.borrador_respuesta ? ['documento' as const] : []), 'historial']

  return (
    <div className="bg-white border border-gray-200 rounded-xl flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button onClick={onClose}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0">
              <ChevronLeft size={14} />
              <span className="hidden sm:inline">Volver</span>
            </button>
            <div className="h-5 w-px bg-gray-300 flex-shrink-0" />
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FDF2F4' }}>
              <span className="text-base">{TIPO_ICONS[doc.tipo]}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-gray-900 truncate">{doc.asunto}</h3>
              <p className="text-[10px] text-gray-500 truncate">{doc.numero_control || doc.folio_respuesta || 'Sin folio'} · {TIPO_LABELS[doc.tipo]}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {/* Estado badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {estadoCfg && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: estadoCfg.bg, color: estadoCfg.color }}>
              {estadoCfg.label}
            </span>
          )}
          {doc.firmado_digitalmente && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700 flex items-center gap-1">
              <Shield size={9} /> Firmado
            </span>
          )}
          {doc.motivo_devolucion && doc.estado === 'borrador' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 flex items-center gap-1">
              <CornerUpLeft size={9} /> Devuelto
            </span>
          )}
        </div>
      </div>

      {/* Banner de devolución */}
      {doc.motivo_devolucion && doc.estado === 'borrador' && (
        <div className="mx-4 mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-semibold text-red-700">Devuelto por el Director</p>
            <p className="text-[10px] text-red-600 mt-0.5">{doc.motivo_devolucion}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {tabList.map(t => (
          <button key={t} onClick={() => {
            setTab(t)
            if (t === 'documento' && !pdfUrl && !loadingPdf) {
              setLoadingPdf(true)
              documentosApi.obtenerOficioPdfUrl(doc.id)
                .then(url => setPdfUrl(url))
                .catch(() => {})
                .finally(() => setLoadingPdf(false))
            }
          }}
            className={clsx('flex-1 py-2 text-xs font-medium transition-colors',
              tab === t ? 'border-b-2 text-gray-900' : 'text-gray-500 hover:text-gray-700')}
            style={tab === t ? { borderColor: GUINDA, color: GUINDA } : {}}>
            {t === 'datos' ? 'Datos' : t === 'contenido' ? '✍️ Contenido' : t === 'documento' ? '📄 Documento' : '📋 Historial'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* ── Tab: Datos ──────────────────────────────────────────── */}
        {tab === 'datos' && (
          <>
            {editing ? (
              <div className="space-y-3">
                {[
                  ['Asunto', 'asunto'],
                  ['No. Control', 'numero_control'],
                  ['Dependencia destino', 'dependencia_destino'],
                  ['Dependencia origen', 'dependencia_origen'],
                  ['Fecha documento', 'fecha_documento'],
                ].map(([label, key]) => (
                  <div key={key}>
                    <label className="text-[10px] font-medium text-gray-500 block mb-1">{label}</label>
                    <input
                      type={key === 'fecha_documento' ? 'date' : 'text'}
                      value={(editForm as Record<string, string>)[key] || ''}
                      onChange={e => setEditForm(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1"
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => setEditing(false)}
                    className="flex-1 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
                  <button onClick={() => guardarDatosMutation.mutate()}
                    className="flex-1 py-1.5 text-xs rounded-lg text-white font-medium" style={{ backgroundColor: GUINDA }}>
                    {guardarDatosMutation.isPending ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Tipo', TIPO_LABELS[doc.tipo]],
                    ['Folio', doc.folio_respuesta || doc.numero_control],
                    ['Origen', doc.dependencia_origen],
                    ['Fecha', doc.fecha_documento ? formatDate(doc.fecha_documento) : '—'],
                    ['Referencia', elaboroLocal ? `MAFM/${elaboroLocal}/${revisoLocal || '?'}` : '—'],
                  ].map(([label, val]) => (
                    <div key={label} className="bg-gray-50 rounded-lg p-2">
                      <p className="text-[10px] text-gray-500">{label}</p>
                      <p className="text-xs font-medium text-gray-800">{val || '—'}</p>
                    </div>
                  ))}
                </div>
                {/* Bloque destinatario */}
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-[10px] text-gray-500 mb-0.5">Destinatario</p>
                  <p className="text-xs font-medium text-gray-800">{doc.destinatario_nombre || doc.dependencia_destino || '—'}</p>
                  {doc.destinatario_cargo && <p className="text-[10px] text-gray-600">{doc.destinatario_cargo}</p>}
                  {doc.dependencia_destino && doc.destinatario_nombre && <p className="text-[10px] text-gray-600">{doc.dependencia_destino}</p>}
                </div>
                {doc.descripcion && (
                  <div className="bg-gray-50 rounded-lg p-2">
                    <p className="text-[10px] text-gray-500 mb-1">Descripción</p>
                    <p className="text-xs text-gray-700 leading-relaxed">{doc.descripcion}</p>
                  </div>
                )}
                {canEditar && (
                  <button onClick={() => setEditing(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                    <Edit3 size={12} /> Editar datos
                  </button>
                )}
              </>
            )}

            {/* ── Datos del oficio (Folio, Elaboró, Revisó) — auto-save ── */}
            {canEditar && doc.borrador_respuesta && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Datos del oficio</p>
                <div>
                  <label className="text-[10px] text-gray-500">Folio</label>
                  <div className="flex gap-1.5">
                    <input type="text" placeholder="SFA/SF/DPP/0001/2026"
                      className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none font-mono"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={folioLocal} onChange={e => setFolioLocal(e.target.value)}
                      onBlur={() => folioLocal !== (doc.folio_respuesta ?? '') && guardarFolioRef('folio', folioLocal)} />
                    {!folioLocal && (
                      <button
                        onClick={async () => {
                          try {
                            const { folio } = await documentosApi.siguienteFolio(doc.tipo?.toUpperCase() || 'OFICIO', undefined)
                            setFolioLocal(folio)
                            await documentosApi.update(doc.id, { folio_respuesta: folio })
                            invalidate()
                          } catch { /* */ }
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded-md border transition-colors whitespace-nowrap"
                        style={{ borderColor: GUINDA, color: GUINDA }}
                        title="Generar folio consecutivo automático">
                        <Hash size={10} /> Auto
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">Fecha del oficio</label>
                  <input type="text" placeholder="16 de marzo de 2026 (vacío = fecha actual)"
                    className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                    style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                    value={fechaRespLocal} onChange={e => setFechaRespLocal(e.target.value)}
                    onBlur={() => fechaRespLocal !== (doc.fecha_respuesta ?? '') && guardarFolioRef('fecha', fechaRespLocal)} />
                  <p className="text-[9px] text-gray-400 mt-0.5">Si se deja vacío, se usa la fecha del día de descarga</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-500">Elaboró</label>
                    <input type="text" placeholder="ECJ"
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={elaboroLocal} onChange={e => setElaboro(e.target.value)}
                      onBlur={() => elaboroLocal !== (doc.referencia_elaboro ?? '') && guardarFolioRef('elaboro', elaboroLocal)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Revisó</label>
                    <input type="text" placeholder="bhs"
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-1 focus:outline-none"
                      style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      value={revisoLocal} onChange={e => setReviso(e.target.value)}
                      onBlur={() => revisoLocal !== (doc.referencia_reviso ?? '') && guardarFolioRef('reviso', revisoLocal)} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Tab: Contenido (borrador + IA + referencia) ──────────── */}
        {tab === 'contenido' && (
          <>
            {/* Zona de subida de documento escaneado */}
            <div className="space-y-3">
              <input ref={fileRefEmitido} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); if (e.target) e.target.value = '' }} />

              {/* Visor del documento adjunto (si existe) */}
              {doc.url_storage && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Eye size={10} /> Documento adjunto
                  </p>
                  {loadingOriginal ? (
                    <div className="flex items-center justify-center py-6 text-gray-400 bg-gray-50 rounded-lg">
                      <RotateCcw size={14} className="animate-spin mr-2" />
                      <span className="text-xs">Cargando...</span>
                    </div>
                  ) : originalUrl ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 220 }}>
                      <iframe src={originalUrl} title="Documento adjunto" className="w-full h-full" style={{ border: 'none' }} />
                    </div>
                  ) : originalError ? (
                    <div className="flex flex-col items-center justify-center py-4 px-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                      <AlertTriangle size={18} className="text-red-500" />
                      <p className="text-[11px] text-red-700 text-center">{originalError}</p>
                      <div className="flex gap-2">
                        <button onClick={cargarOriginal}
                          className="text-[10px] px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-100">
                          Reintentar
                        </button>
                        {canEditar && (
                          <button onClick={() => fileRefEmitido.current?.click()} disabled={uploading}
                            className="text-[10px] px-2 py-1 rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                            {uploading ? 'Subiendo…' : 'Subir de nuevo'}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {canEditar && !loadingOriginal && originalUrl && (
                    <div className="flex gap-2">
                      <button onClick={() => fileRefEmitido.current?.click()} disabled={uploading}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50">
                        {uploading ? <><RotateCcw size={10} className="animate-spin" /> Subiendo...</> : <><Upload size={10} /> Reemplazar</>}
                      </button>
                      <p className="flex-1 text-[10px] text-gray-400 truncate py-1.5">{doc.nombre_archivo}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Sin documento: zona de subida */}
              {!doc.url_storage && canEditar && (
                <div
                  onClick={() => fileRefEmitido.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl py-6 px-4 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
                    <Upload size={18} style={{ color: GUINDA }} />
                  </div>
                  <p className="text-xs font-medium text-gray-700 mb-0.5">Subir documento escaneado</p>
                  <p className="text-[10px] text-gray-400">PDF, Word, JPG, PNG — Max. 20 MB</p>
                  {uploading && (
                    <div className="flex items-center justify-center gap-2 mt-2 text-xs text-gray-500">
                      <RotateCcw size={12} className="animate-spin" /> Subiendo...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Generación IA con instrucciones ── */}
            {canGenerar && canEditar && !doc.borrador_respuesta && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Wand2 size={14} className="text-blue-600" />
                  <p className="text-xs font-medium text-blue-800">Generar oficio con IA</p>
                </div>
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Instrucciones para la IA (ej: 'Oficio de autorización de certificación presupuestal para SEDECO por $500,000 para mobiliario', 'Circular informando sobre el nuevo calendario de cierre presupuestal')..."
                  className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs h-20 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button onClick={() => handleGenerar(aiPrompt)} disabled={generando}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg text-white font-medium disabled:opacity-50"
                  style={{ backgroundColor: GUINDA }}>
                  {generando
                    ? <><RotateCcw size={12} className="animate-spin" /> Generando oficio...</>
                    : <><Wand2 size={12} /> Generar con IA</>}
                </button>
              </div>
            )}

            {/* ── Cargar documento de referencia para IA ── */}
            {canGenerar && canEditar && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Upload size={14} className="text-blue-600" />
                  <p className="text-xs font-medium text-gray-700">Documento de referencia para IA</p>
                </div>
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Adjunta tablas, oficios previos, Excel o Word. La IA los analiza al generar el oficio. Usa las instrucciones para indicar: "usa el oficio adjunto como base", "incluye la tabla adjunta", etc.
                </p>

                {doc.referencia_archivo_nombre ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      <FileText size={14} className="text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-blue-800 truncate">{doc.referencia_archivo_nombre}</p>
                        <p className="text-[9px] text-blue-600">
                          {doc.contenido_referencia
                            ? `${Math.min(doc.contenido_referencia.length, 99999).toLocaleString()} caracteres extraídos`
                            : 'Procesando…'}
                        </p>
                      </div>
                      <button onClick={handleEliminarReferencia}
                        className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                        title="Eliminar referencia">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input ref={refFileRefEmitido} type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx,.xlsx,.xls,.csv,.txt"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { handleEliminarReferencia().then(() => handleCargarReferencia(f)) }; if (e.target) e.target.value = '' }}
                      />
                      <button onClick={() => refFileRefEmitido.current?.click()}
                        disabled={cargandoReferencia}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg font-medium transition-colors border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                        {cargandoReferencia
                          ? <><RotateCcw size={10} className="animate-spin" /> Procesando…</>
                          : <><Upload size={10} /> Cambiar archivo</>}
                      </button>
                      <button onClick={handleEliminarReferencia}
                        className="flex items-center justify-center gap-1 py-1.5 px-3 text-[10px] rounded-lg font-medium transition-colors border border-red-300 text-red-600 hover:bg-red-50">
                        <X size={10} /> Eliminar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <input ref={refFileRefEmitido} type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.tiff,.webp,.doc,.docx,.xlsx,.xls,.csv,.txt"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleCargarReferencia(f); if (e.target) e.target.value = '' }}
                    />
                    <button onClick={() => refFileRefEmitido.current?.click()}
                      disabled={cargandoReferencia}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-medium text-white transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {cargandoReferencia
                        ? <><RotateCcw size={12} className="animate-spin" /> Procesando documento…</>
                        : <><Upload size={12} /> Cargar documento de referencia</>}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ── Escribir manual (solo si no hay borrador) ── */}
            {canGenerar && canEditar && !doc.borrador_respuesta && (
              <button onClick={() => { setBorradorText(''); setEditBorrador(true) }}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                <Edit3 size={12} /> Escribir manualmente
              </button>
            )}

            {/* ── Borrador existente ── */}
            {doc.borrador_respuesta && (
              <div className="space-y-3">
                {editBorrador ? (
                  <>
                    <textarea
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs h-48 resize-none focus:outline-none focus:ring-1"
                      value={borradorText}
                      onChange={e => setBorradorText(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setEditBorrador(false); setBorradorText(doc.borrador_respuesta ?? '') }}
                        className="flex-1 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
                      <button onClick={() => guardarBorradorMutation.mutate()} disabled={guardarBorradorMutation.isPending}
                        className="flex-1 py-1.5 text-xs rounded-lg text-white font-medium" style={{ backgroundColor: GUINDA }}>
                        {guardarBorradorMutation.isPending ? 'Guardando...' : 'Guardar borrador'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {doc.borrador_respuesta}
                    </div>
                    {canEditar && (
                      <div className="flex gap-2">
                        <button onClick={() => setEditBorrador(true)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">
                          <Edit3 size={12} /> Editar
                        </button>
                        <button onClick={() => handleGenerar(aiPrompt)} disabled={generando}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                          <Wand2 size={12} /> {generando ? 'Regenerando...' : 'Regenerar IA'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Tab: Documento (visor PDF) ──────────────────────────── */}
        {tab === 'documento' && (
          <>
            {loadingPdf ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <RotateCcw size={24} className="animate-spin mb-3" />
                <p className="text-xs">Generando vista previa...</p>
              </div>
            ) : pdfUrl ? (
              <div className="space-y-3">
                {doc.firmado_digitalmente && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <Shield size={13} className="text-emerald-600" />
                    <span className="text-[10px] font-medium text-emerald-700">Documento firmado electrónicamente</span>
                  </div>
                )}
                <div className="flex justify-end">
                  <button onClick={() => setVisorFlotanteEmitido(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md font-medium border border-gray-200 text-gray-600 hover:bg-gray-50"
                    title="Abrir en ventana flotante">
                    <FolderOpen size={10} /> Ampliar visor
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 'calc(100vh - 300px)', minHeight: 400 }}>
                  <iframe src={pdfUrl} title="Vista previa" className="w-full h-full" style={{ border: 'none' }} />
                </div>
                <div className="flex gap-2">
                  {canDescargarDocx && (
                    <button onClick={handleDescargarOficio} disabled={descargando}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      <Download size={12} /> DOCX
                    </button>
                  )}
                  <button onClick={async () => { await documentosApi.descargarOficioPdf(doc.id) }}
                    className={`${canDescargarDocx ? 'flex-1' : 'w-full'} flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium text-white`} style={{ backgroundColor: GUINDA }}>
                    <Download size={12} /> PDF
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <FileText size={24} className="mb-3 opacity-40" />
                <p className="text-xs mb-2">No se pudo cargar la vista previa</p>
                <button onClick={() => {
                  setLoadingPdf(true)
                  documentosApi.obtenerOficioPdfUrl(doc.id)
                    .then(url => setPdfUrl(url))
                    .catch(() => {})
                    .finally(() => setLoadingPdf(false))
                }}
                  className="text-xs font-medium px-4 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                  Reintentar
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Tab: Historial ──────────────────────────────────────── */}
        {tab === 'historial' && (
          <>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Historial de acciones
            </p>
            {historial.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <History size={24} className="mx-auto mb-2 opacity-40" />
                <p className="text-xs">Sin historial registrado</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />
                <div className="space-y-3">
                  {historial.map((entry: HistorialItem) => {
                    const isDevolucion = entry.tipo_accion === 'devolucion'
                    const isReenvio = entry.tipo_accion === 'reenvio'
                    const isFirma = entry.tipo_accion === 'firma'
                    const dotColor = isDevolucion ? 'bg-red-500' : isReenvio ? 'bg-amber-500' : isFirma ? 'bg-green-500' : 'bg-gray-400'
                    const bgColor = isDevolucion ? 'bg-red-50 border-red-100' : isReenvio ? 'bg-amber-50 border-amber-100' : isFirma ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'
                    const icon = isDevolucion ? '🔴' : isReenvio ? '🟡' : isFirma ? '✅' : '🔄'
                    return (
                      <div key={entry.id} className="relative pl-8">
                        <div className={`absolute left-1.5 top-2.5 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                        <div className={`rounded-lg border p-2.5 ${bgColor}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs">{icon}</span>
                              <span className="text-[10px] font-semibold text-gray-700">
                                v{entry.version} {isDevolucion ? 'Devuelto' : isReenvio ? 'Reenviado' : isFirma ? 'Firmado' : entry.tipo_accion}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-400">{formatDateTime(entry.timestamp)}</span>
                          </div>
                          {entry.usuario_nombre && (
                            <p className="text-[10px] text-gray-500 mb-0.5">{entry.usuario_nombre}</p>
                          )}
                          <p className="text-xs text-gray-700 leading-relaxed">{entry.observaciones}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Barra de acciones inferior ──────────────────────────────── */}
      <div className="px-4 py-3 border-t border-gray-100 bg-white flex-shrink-0">
        {doc.firmado_digitalmente ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
              <Shield size={14} className="text-emerald-600" />
              <span className="text-xs font-medium text-emerald-700">Documento firmado</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                setTab('documento')
                if (!pdfUrl && !loadingPdf) {
                  setLoadingPdf(true)
                  documentosApi.obtenerOficioPdfUrl(doc.id).then(url => setPdfUrl(url)).catch(() => {}).finally(() => setLoadingPdf(false))
                }
              }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <Eye size={12} /> Ver documento
              </button>
              <button onClick={handleDescargarOficio} disabled={descargando}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <Download size={12} /> Descargar
              </button>
            </div>
          </div>
        ) : doc.estado === 'borrador' ? (
          <div className="space-y-2">
            {/* Director puede firmar directamente desde borrador si hay contenido */}
            {hasBorrador && canFirmar && (
              <button onClick={() => setShowFirmaModal(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg text-white font-semibold hover:opacity-90"
                style={{ backgroundColor: GUINDA }}>
                <FileSignature size={13} /> Firmar y publicar
              </button>
            )}
            {/* Secretaría / Área envía para firma del Director */}
            {hasBorrador && canEnviarParaFirma && !canFirmar && (
              <button onClick={() => handleCambiarEstado('en_revision')}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg text-white font-semibold hover:opacity-90"
                style={{ backgroundColor: GUINDA }}>
                <Send size={13} /> Enviar a firma del Director
              </button>
            )}
            {canEliminar && (
              <button onClick={onDelete}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg border border-red-200 text-red-500 hover:bg-red-50">
                <Trash2 size={10} /> Eliminar borrador
              </button>
            )}
          </div>
        ) : doc.estado === 'en_revision' ? (
          <div className="space-y-2">
            {/* Banner: En revisión del Director */}
            {!canFirmar && (
              <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                <Clock size={13} className="text-purple-600" />
                <span className="text-[11px] font-medium text-purple-700">Enviado para firma del Director. Pendiente de revisión.</span>
              </div>
            )}
            {canFirmar && (
              <>
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <Mail size={13} className="text-amber-600" />
                  <span className="text-[11px] font-medium text-amber-700">Oficio recibido para su firma</span>
                </div>
                <button onClick={() => setShowFirmaModal(true)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg text-white font-semibold hover:opacity-90"
                  style={{ backgroundColor: GUINDA }}>
                  <FileSignature size={13} /> Firmar y publicar
                </button>
              </>
            )}
            {(canFirmar || isSecretaria) && (
              <>
                <button onClick={() => setShowDevolucionModal(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] rounded-lg border border-red-300 text-red-600 hover:bg-red-50">
                  <CornerUpLeft size={10} /> Devolver con observaciones
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Modal firma emitido ── */}
      {showFirmaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileSignature size={16} style={{ color: GUINDA }} />
                <h3 className="text-sm font-semibold text-gray-900">Firmar documento emitido</h3>
              </div>
              <button onClick={() => { setShowFirmaModal(false); setFirmaError('') }}
                className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-600">{doc.asunto}</p>
              {doc.folio_respuesta && (
                <p className="text-[10px] text-gray-500 font-mono">{doc.folio_respuesta}</p>
              )}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Lock size={11} className="text-gray-500" />
                  <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Contraseña e.firma</label>
                </div>
                <input type="password" value={firmaPassword} onChange={e => setFirmaPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && firmaPassword.trim() && handleFirmar()}
                  placeholder="Ingrese contraseña FIEL..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1" />
              </div>
              {firmaError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-700">{firmaError}</p>
                </div>
              )}
              <button onClick={handleFirmar} disabled={firmando || !firmaPassword.trim()}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg text-white font-semibold disabled:opacity-50"
                style={{ backgroundColor: GUINDA }}>
                {firmando
                  ? <><RotateCcw size={12} className="animate-spin" /> Firmando...</>
                  : <><CheckCircle2 size={12} /> Firmar con e.firma</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal devolución con observaciones ── */}
      {showDevolucionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CornerUpLeft size={16} className="text-red-600" />
                <h3 className="text-sm font-semibold text-gray-900">Devolver oficio</h3>
              </div>
              <button onClick={() => { setShowDevolucionModal(false); setObservacionesDevolucion('') }}
                className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-gray-600">{doc.asunto}</p>
              <div>
                <label className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">
                  Observaciones para la Secretaría
                </label>
                <textarea
                  value={observacionesDevolucion}
                  onChange={e => setObservacionesDevolucion(e.target.value)}
                  placeholder="Indique las correcciones necesarias (mín. 10 caracteres)..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs h-24 resize-none focus:outline-none focus:ring-1"
                />
                <p className="text-[9px] text-gray-400 mt-0.5">{observacionesDevolucion.length}/10 caracteres mínimos</p>
              </div>
              <button onClick={handleDevolver}
                disabled={devolviendo || observacionesDevolucion.trim().length < 10}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-lg font-semibold text-white disabled:opacity-50 bg-red-600 hover:bg-red-700">
                {devolviendo
                  ? <><RotateCcw size={12} className="animate-spin" /> Devolviendo...</>
                  : <><CornerUpLeft size={12} /> Devolver con observaciones</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visor flotante modal — emitido */}
      {visorFlotanteEmitido && pdfUrl && (
        <VisorFlotante
          url={pdfUrl}
          titulo={`${doc.folio_respuesta || doc.numero_control || doc.asunto}`}
          firmado={doc.firmado_digitalmente ?? undefined}
          onClose={() => setVisorFlotanteEmitido(false)}
          onDownload={() => documentosApi.descargarOficioPdf(doc.id)}
        />
      )}
    </div>
  )
}


// ── Modal edición rápida de registro (secretaria/admin) ─────────────────────
function ModalEditarRegistro({ doc, onClose, onSaved }: {
  doc: DocumentoListItem; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    numero_oficio_origen: doc.numero_oficio_origen || '',
    asunto: doc.asunto || '',
    remitente_nombre: doc.remitente_nombre || '',
    remitente_dependencia: doc.remitente_dependencia || '',
    fecha_documento: doc.fecha_documento || '',
    fecha_recibido: doc.fecha_recibido || '',
    fecha_limite: doc.fecha_limite || '',
    prioridad: doc.prioridad || 'normal',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await documentosApi.update(doc.id, form as any)
      onSaved()
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-semibold text-gray-900">Modificar registro</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">No. Oficio</label>
            <input value={form.numero_oficio_origen} onChange={e => set('numero_oficio_origen', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Asunto</label>
            <input value={form.asunto} onChange={e => set('asunto', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Remitente</label>
              <input value={form.remitente_nombre} onChange={e => set('remitente_nombre', e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Dependencia</label>
              <input value={form.remitente_dependencia} onChange={e => set('remitente_dependencia', e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Fecha oficio</label>
              <input type="date" value={form.fecha_documento} onChange={e => set('fecha_documento', e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Fecha recibido</label>
              <input type="date" value={form.fecha_recibido} onChange={e => set('fecha_recibido', e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Fecha límite</label>
              <input type="date" value={form.fecha_limite} onChange={e => set('fecha_limite', e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Prioridad</label>
            <select value={form.prioridad} onChange={e => set('prioridad', e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-blue-500">
              <option value="normal">Normal</option>
              <option value="urgente">Urgente</option>
              <option value="muy_urgente">Muy urgente</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Página principal ───────────────────────────────────────────────────────────
export default function GestionDocumental() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'recibidos' | 'emitidos' | 'oficios' | 'memorandums'>('recibidos')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [filtroUrgente, setFiltroUrgente] = useState(false)
  const [showColFiltros, setShowColFiltros] = useState(false)
  const [colFiltros, setColFiltros] = useState({ fecha: '', oficio: '', upp: '', remitente: '', asunto: '', area: '', estado: '' })
  const setColFiltro = (k: keyof typeof colFiltros, v: string) => setColFiltros(p => ({ ...p, [k]: v }))
  const [showColFiltrosEmitidos, setShowColFiltrosEmitidos] = useState(false)
  const [colFiltrosEmitidos, setColFiltrosEmitidos] = useState({ no: '', fecha: '', oficio: '', upp: '', destinatario: '', asunto: '', tipo: '', estado: '' })
  const setColFiltroEmitidos = (k: keyof typeof colFiltrosEmitidos, v: string) => setColFiltrosEmitidos(p => ({ ...p, [k]: v }))
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [fechaDesdeDebounced, setFechaDesdeDebounced] = useState('')
  const [fechaHastaDebounced, setFechaHastaDebounced] = useState('')
  const [showDateFilters, setShowDateFilters] = useState(false)
  const [showModalRecibido, setShowModalRecibido] = useState(false)
  const [showModalEmitido, setShowModalEmitido] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<'info' | 'ocr' | 'documento' | 'historial'>('info')
  // Modal edición rápida (secretaria)
  const [editDocId, setEditDocId] = useState<string | null>(null)
  // Multi-select para firma por lote
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showFirmaLote, setShowFirmaLote] = useState(false)
  // Certificado e.firma
  const [showCertModal, setShowCertModal] = useState(false)
  // Modal memorándum
  const [showMemoModal, setShowMemoModal] = useState(false)
  // Toast de confirmación
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  // Roles (usados para lógica interna que no es configurable desde AdminPermisos)
  const isDirector = user?.rol === 'admin_cliente' || user?.rol === 'superadmin'
  const isSecretaria = user?.rol === 'secretaria'
  const isReadOnly = user?.rol === 'auditor'
  // Permisos configurables desde AdminPermisos → Roles y Permisos
  const permissionsVersionMain = usePermissionsVersion()
  const canMain = useMemo(() => makePermissionChecker(user?.rol ?? ''), [user?.rol, permissionsVersionMain])
  const canCrearDocumento    = canMain('crear_oficio')
  const canFirmarLote        = canMain('firmar_lote')
  const canVerCert           = canMain('registrar_cert')
  const canVerVisorFlotante  = canMain('ver_visor_flotante')
  const canRegistrarMemo     = canMain('registrar_memo')

  // Debounce de búsqueda (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setBusquedaDebounced(busqueda), 300)
    return () => clearTimeout(timer)
  }, [busqueda])

  // Debounce de fechas (500ms) — evita refetch en cada keystroke del date picker
  useEffect(() => {
    const timer = setTimeout(() => setFechaDesdeDebounced(fechaDesde), 500)
    return () => clearTimeout(timer)
  }, [fechaDesde])
  useEffect(() => {
    const timer = setTimeout(() => setFechaHastaDebounced(fechaHasta), 500)
    return () => clearTimeout(timer)
  }, [fechaHasta])

  // Paginación
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(15)

  const params = {
    flujo:               tab === 'memorandums' ? 'recibido' : tab === 'recibidos' ? 'recibido' : 'emitido',
    incluir_respuestas:  tab === 'emitidos' ? true : undefined,
    tipo:                tab === 'memorandums' ? 'memorandum' as string : undefined,
    busqueda:            busquedaDebounced || undefined,
    estado:              filtroEstado || undefined,
    area_turno:          filtroArea || undefined,
    solo_urgentes:       filtroUrgente || undefined,
    fecha_desde:         fechaDesdeDebounced || undefined,
    fecha_hasta:         fechaHastaDebounced || undefined,
    skip:  page * pageSize,
    limit: pageSize,
  }

  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['documentos', params],
    queryFn:  () => documentosApi.list(params),
  })
  const docs = queryResult?.items
  // Si el backend no expone X-Total-Count (p.ej. CORS strip), caemos en
  // un estimado defensivo basado en el tamaño del page: así la paginación
  // sigue funcionando aunque el header no llegue.
  const totalFromHeader = queryResult?.total ?? 0
  const pageCount = docs?.length ?? 0
  const totalDocs = totalFromHeader > 0
    ? totalFromHeader
    : (page * pageSize) + pageCount + (pageCount >= pageSize ? 1 : 0)
  const totalPages = Math.max(1, Math.ceil(totalDocs / pageSize))
  // Hay más páginas si el backend lo confirma, o si la página actual vino llena
  // (pista de que hay al menos una siguiente).
  const hasNextPage = totalFromHeader > 0
    ? page < totalPages - 1
    : pageCount >= pageSize

  // Query separada SIN paginación para calcular métricas reales del tab
  // (los contadores deben reflejar carga TOTAL del usuario, no solo la página)
  const paramsMetricas = {
    flujo:              params.flujo,
    incluir_respuestas: params.incluir_respuestas,
    tipo:               params.tipo,
    limit: 500,
  }
  const { data: metricasResult } = useQuery({
    queryKey: ['documentos-metricas', paramsMetricas],
    queryFn: () => documentosApi.list(paramsMetricas),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const docsMetricas = metricasResult?.items ?? []

  // Reset page cuando cambian filtros
  useEffect(() => { setPage(0) }, [tab, busquedaDebounced, filtroEstado, filtroArea, filtroUrgente, fechaDesdeDebounced, fechaHastaDebounced, pageSize])

  // Anchos fijos de columnas
  const colW: Record<string, number> = {
    fecha: 80, oficio: 130, upp: 170, remitente: 180,
    asunto: 220, area: 180, atencion: 80, check: 80, estado: 80,
  }

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-dpp'],
    queryFn:  documentosApi.areas,
  })

  // Catálogo de Dependencias (Panel Admin) — fuente para la columna UPP
  const { data: uppsCatalogo = [] } = useQuery<Cliente[]>({
    queryKey: ['clientes-catalogo-main'],
    queryFn:  clientesApi.list,
    staleTime: 10 * 60_000,
  })

  // Normalizador: minúsculas, sin acentos, sin puntuación, colapsa espacios.
  const normalizeText = (s: string): string =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const uppsByCode: Record<string, Cliente> = {}
  const uppsByName: Record<string, Cliente> = {}
  const uppsNorm: Array<{ u: Cliente; nombreN: string }> = []

  for (const u of uppsCatalogo) {
    if (!u.activo) continue
    const code = u.codigo_upp.toUpperCase().trim()
    // Indexar por el código exacto del catálogo
    uppsByCode[code] = u
    // Si el código es puramente numérico, indexar también sin ceros y con 2/3 dígitos
    // para tolerar variantes del OCR ("7", "07", "007" → mismo registro)
    if (/^\d+$/.test(code)) {
      const n = parseInt(code, 10)
      uppsByCode[String(n)]              = u   // "7"
      uppsByCode[String(n).padStart(2, '0')] = u   // "07"
      uppsByCode[String(n).padStart(3, '0')] = u   // "007"
    }
    uppsByName[u.nombre.toLowerCase()] = u
    uppsNorm.push({ u, nombreN: normalizeText(u.nombre) })
  }

  // Busca la mejor dependencia para un texto libre usando matching fuzzy.
  const fuzzyFindUpp = (texto: string): Cliente | null => {
    const tN = normalizeText(texto)
    if (!tN || tN.length < 3) return null
    // 1) Match exacto por nombre normalizado
    for (const { u, nombreN } of uppsNorm) {
      if (nombreN === tN) return u
    }
    // 2) Contención por tokens significativos
    const tTokens = tN.split(' ').filter(w => w.length >= 4)
    let best: { u: Cliente; score: number } | null = null
    for (const { u, nombreN } of uppsNorm) {
      const nTokens = nombreN.split(' ').filter(w => w.length >= 4)
      if (!nTokens.length) continue
      const comunes = tTokens.filter(t => nTokens.some(n => n === t || n.includes(t) || t.includes(n)))
      const score = comunes.length / Math.max(nTokens.length, tTokens.length)
      if (score >= 0.5 && (!best || score > best.score)) best = { u, score }
    }
    return best ? best.u : null
  }

  // Etiqueta final: código a 3 dígitos + nombre (Vinculado al catálogo del Admin Panel)
  const labelUpp = (u: Cliente): string => {
    const code = /^\d+$/.test(u.codigo_upp) ? u.codigo_upp.padStart(3, '0') : u.codigo_upp
    return `${code} - ${u.nombre}`
  }

  // Devuelve la etiqueta buscando por código, texto OCR o remitente.
  const formatUpp = (
    codigo: string | null | undefined,
    texto: string | null | undefined,
    remitente?: string | null,
  ): string | null => {
    // Normaliza un código para buscar en el índice (sin UPP prefix, solo alfanumérico)
    const normCode = (raw: string): string => raw.toUpperCase().trim()
      .replace(/^UPP[\s-]*/i, '').replace(/[^A-Z0-9]/g, '')

    // 1) Código explícito guardado en la BD
    if (codigo) {
      const nc = normCode(codigo)
      // Probar el código tal cual, y también variantes numéricas
      const tries = [nc]
      if (/^\d+$/.test(nc)) {
        const n = parseInt(nc, 10)
        tries.push(String(n), String(n).padStart(2, '0'), String(n).padStart(3, '0'))
      }
      for (const t of tries) { if (uppsByCode[t]) return labelUpp(uppsByCode[t]) }
    }

    // 2) Texto del OCR
    if (texto) {
      const t = texto.trim()
      const nc = normCode(t)
      if (nc && uppsByCode[nc]) return labelUpp(uppsByCode[nc])
      // Variantes numéricas
      if (/^\d+$/.test(nc)) {
        const n = parseInt(nc, 10)
        for (const variant of [String(n), String(n).padStart(2, '0'), String(n).padStart(3, '0')]) {
          if (uppsByCode[variant]) return labelUpp(uppsByCode[variant])
        }
      }
      const tLower = t.toLowerCase()
      if (uppsByName[tLower]) return labelUpp(uppsByName[tLower])
      // Código al inicio del texto, p.ej. "007 SFA" o "07-SecFin"
      const m = t.match(/^\s*(\d{1,4})\b/i)
      if (m) {
        const n = parseInt(m[1], 10)
        for (const variant of [String(n), String(n).padStart(2, '0'), String(n).padStart(3, '0')]) {
          if (uppsByCode[variant]) return labelUpp(uppsByCode[variant])
        }
      }
      const fz = fuzzyFindUpp(t)
      if (fz) return labelUpp(fz)
    }

    // 3) Remitente como último recurso
    if (remitente) {
      const fz = fuzzyFindUpp(remitente)
      if (fz) return labelUpp(fz)
    }
    return null
  }

  const { data: selectedDoc } = useQuery({
    queryKey: ['documento', selectedId],
    queryFn:  () => selectedId ? documentosApi.get(selectedId) : null,
    enabled:  !!selectedId,
  })

  // ── Floating panel (Turnar / Respuesta / Historial) ──────────────────────────
  const [floatingDocId, setFloatingDocId]   = useState<string | null>(null)
  const [floatingDocTab, setFloatingDocTab] = useState<'info' | 'ocr' | 'documento' | 'historial'>('info')
  const [floatingPdfUrl, setFloatingPdfUrl]     = useState<string | null>(null)
  const [floatingPdfLoading, setFloatingPdfLoading] = useState(false)
  const { data: floatingDoc } = useQuery({
    queryKey: ['documento', floatingDocId],
    queryFn:  () => floatingDocId ? documentosApi.get(floatingDocId) : null,
    enabled:  !!floatingDocId,
  })
  const [floatingActiveTab, setFloatingActiveTab] = useState<string>('info')

  const loadFloatingPdf = useCallback((docId: string, activeTab: string) => {
    setFloatingPdfLoading(true)
    const loader = activeTab === 'ocr'
      ? documentosApi.obtenerOficioPdfUrl(docId)
      : documentosApi.obtenerArchivoOriginalUrl(docId)
    loader
      .then(url => setFloatingPdfUrl(url))
      .catch(() => setFloatingPdfUrl(null))
      .finally(() => setFloatingPdfLoading(false))
  }, [])

  useEffect(() => {
    if (!floatingDocId) { setFloatingPdfUrl(null); return }
    loadFloatingPdf(floatingDocId, floatingActiveTab)
  }, [floatingDocId])

  const handleFloatingTabChange = useCallback((newTab: string) => {
    setFloatingActiveTab(newTab)
    if (floatingDocId) loadFloatingPdf(floatingDocId, newTab)
  }, [floatingDocId, loadFloatingPdf])

  // Recargar PDF de respuesta cuando se genera el borrador estando en tab 'ocr'
  const floatingDocBorrador = floatingDoc?.borrador_respuesta
  useEffect(() => {
    if (floatingDocId && floatingActiveTab === 'ocr' && floatingDocBorrador) {
      loadFloatingPdf(floatingDocId, 'ocr')
    }
  }, [floatingDocBorrador])

  const deleteMutation = useMutation({
    mutationFn: documentosApi.delete,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['documentos'] }); setSelectedId(null) },
  })

  // Certificado e.firma status — con auto-refresh para detectar registros recientes
  const { data: certStatus } = useQuery<CertificadoInfo>({
    queryKey: ['mi-certificado'],
    queryFn: certificadosApi.miCertificado,
    staleTime: 5_000,                 // considerar fresca 5s
    refetchOnMount: 'always',         // siempre refrescar al montar
    refetchOnWindowFocus: true,       // refrescar al volver a la pestaña
    refetchInterval: 15_000,          // poll cada 15s
    enabled: !!user?.rol && (user.rol === 'admin_cliente' || user.rol === 'superadmin'),
  })
  const tieneCert = certStatus?.tiene_certificado ?? false
  const certVigente = certStatus?.vigente ?? false
  const certProximoVencer = (() => {
    if (!certStatus?.valido_hasta) return false
    const diasRestantes = Math.ceil((new Date(certStatus.valido_hasta).getTime() - Date.now()) / 86400000)
    return diasRestantes > 0 && diasRestantes <= 30
  })()

  // Métricas recibidos
  // Los contadores usan docsMetricas (sin paginación) para reflejar el total real
  const porEstado = (e: string) => docsMetricas.filter(d => d.estado === e).length
  const urgentes  = docsMetricas.filter(d =>
    d.prioridad !== 'normal' &&
    !['firmado', 'archivado', 'de_conocimiento'].includes(d.estado)
  ).length

  // Pendientes: solo estado "turnado" (coincide con el filtro que aplica la tarjeta)
  const pendientesReales = docsMetricas.filter(d =>
    d.estado === 'turnado' &&
    !d.firmado_digitalmente
  ).length

  if (isLoading) return <PageSpinner />

  return (
    <div className="flex h-full bg-gray-50 relative">
      {/* Toast de confirmación */}
      {toast && (
        <div className={clsx(
          'fixed top-4 right-4 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-xs font-medium animate-in fade-in slide-in-from-top-2',
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white',
        )}>
          {toast.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100"><X size={12} /></button>
        </div>
      )}
      {/* ── Panel izquierdo (lista) — oculto cuando hay detalle seleccionado */}
      <div className={clsx('flex flex-col', selectedId ? 'hidden' : 'flex-1')}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FDF2F4' }}>
                <FolderOpen size={16} style={{ color: GUINDA }} />
              </div>
              <div className="flex-shrink-0">
                <h1 className="text-sm font-bold text-gray-900">Gestión Documental</h1>
                <p className="text-[10px] text-gray-500">Correspondencia institucional DPP</p>
              </div>
            </div>
            {tab === 'emitidos' && (
              <div className="flex items-center gap-1.5 flex-1 justify-center px-4">
                {[
                  { label: 'Borradores',  val: porEstado('borrador'),    color: '#d97706', filtro: 'borrador' },
                  { label: 'En revisión', val: porEstado('en_revision'), color: '#a855f7', filtro: 'en_revision' },
                  { label: 'Vigentes',    val: porEstado('vigente'),     color: '#10b981', filtro: 'vigente' },
                  { label: 'Respondidos', val: porEstado('respondido'),  color: '#3b82f6', filtro: 'respondido' },
                  { label: 'Firmados',    val: porEstado('firmado'),     color: '#059669', filtro: 'firmado' },
                ].map(({ label, val, color, filtro }) => {
                  const activo = filtroEstado === filtro
                  return (
                  <button key={label}
                    onClick={() => setFiltroEstado(activo ? '' : filtro)}
                    title={label}
                    className="flex flex-col items-center px-3 py-1 rounded-md transition-colors min-w-[52px]"
                    style={{
                      backgroundColor: activo ? color + '22' : '#f9fafb',
                      border: `1px solid ${activo ? color : '#e5e7eb'}`,
                    }}>
                    <span className="text-sm font-bold leading-tight" style={{ color }}>{val}</span>
                    <span className="text-[9px] leading-tight" style={{ color: activo ? color : '#6b7280' }}>{label}</span>
                  </button>
                  )
                })}
              </div>
            )}
            {tab === 'recibidos' && (
              <div className="flex items-center gap-1.5 flex-1 justify-center px-4">
                {([
                  { label: 'Recibidos',   val: porEstado('recibido'),    color: '#3b82f6', filtro: 'recibido',    urgente: false, title: 'Oficios nuevos sin turno' },
                  { label: 'Pendientes',  val: pendientesReales,         color: '#f59e0b', filtro: 'turnado',     urgente: false, title: 'Turnados o en atención' },
                  { label: 'En atención', val: porEstado('en_atencion'), color: '#a855f7', filtro: 'en_atencion', urgente: false, title: 'En atención por el área' },
                  { label: 'Firmados',    val: porEstado('firmado'),     color: '#10b981', filtro: 'firmado',     urgente: false, title: 'Firmados por el Director' },
                  { label: 'Devueltos',   val: porEstado('devuelto'),    color: '#dc2626', filtro: 'devuelto',    urgente: false, title: 'Devueltos para corrección' },
                  { label: 'Urgentes',    val: urgentes,                 color: '#ef4444', filtro: '',            urgente: true,  title: 'Prioridad alta o urgente' },
                ] as { label: string; val: number; color: string; filtro: string; urgente: boolean; title: string }[]).map(({ label, val, color, filtro, urgente: esUrgente, title }) => {
                  const activo = esUrgente ? filtroUrgente : filtroEstado === filtro
                  return (
                    <button
                      key={label}
                      title={title}
                      onClick={() => {
                        if (esUrgente) {
                          setFiltroUrgente(p => !p)
                          setFiltroEstado('')
                        } else {
                          setFiltroEstado(activo ? '' : filtro)
                          setFiltroUrgente(false)
                        }
                      }}
                      className="flex flex-col items-center px-3 py-1 rounded-md transition-colors min-w-[52px]"
                      style={{
                        backgroundColor: activo ? color + '22' : '#f9fafb',
                        border: `1px solid ${activo ? color : '#e5e7eb'}`,
                      }}>
                      <span className="text-sm font-bold leading-tight" style={{ color }}>{val}</span>
                      <span className="text-[9px] leading-tight" style={{ color: activo ? color : '#6b7280' }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-2">
              {/* Indicador e.firma */}
              {canVerCert && (
                <button
                  onClick={() => setShowCertModal(true)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] rounded-lg font-medium border transition-colors',
                    tieneCert && certVigente && !certProximoVencer
                      ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                      : tieneCert && certProximoVencer
                      ? 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                      : tieneCert && !certVigente
                      ? 'border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
                  )}
                  title={tieneCert ? 'Ver certificado e.firma' : 'Registrar certificado e.firma'}>
                  <Shield size={11} />
                  {tieneCert && certVigente && !certProximoVencer
                    ? 'e.firma vigente'
                    : tieneCert && certProximoVencer
                    ? 'e.firma por vencer'
                    : tieneCert && !certVigente
                    ? 'e.firma vencida'
                    : 'e.firma no configurada'}
                </button>
              )}

              {tab === 'recibidos' && canFirmarLote && (
                <button
                  onClick={() => {
                    if (multiSelectMode) {
                      setMultiSelectMode(false)
                      setSelectedIds(new Set())
                    } else {
                      setMultiSelectMode(true)
                      setSelectedId(null)
                    }
                  }}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border transition-colors',
                    multiSelectMode
                      ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100'
                      : 'text-white'
                  )}
                  style={!multiSelectMode ? { backgroundColor: GUINDA } : {}}>
                  <FileSignature size={12} />
                  {multiSelectMode ? 'Cancelar selección' : 'Firma por lote'}
                </button>
              )}
              {tab !== 'oficios' && canCrearDocumento && (
                <Button size="sm" onClick={() => tab === 'recibidos' ? setShowModalRecibido(true) : setShowModalEmitido(true)}>
                  <Plus size={13} />
                  {tab === 'recibidos' ? 'Registrar recibido' : 'Nuevo emitido'}
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0">
            {([['recibidos', 'Correspondencia recibida', InboxIcon], ['emitidos', 'Documentos emitidos', SendIcon], ['memorandums', 'MEMORANDUMS', FileText], ['oficios', 'Control de Oficios', Mail]] as const).map(([key, label, Icon]) => (
              <button key={key}
                onClick={() => { setTab(key); setSelectedId(null); setFiltroEstado(''); setFiltroArea(''); setFiltroUrgente(false); setColFiltros({ fecha: '', oficio: '', upp: '', remitente: '', asunto: '', area: '', estado: '' }) }}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                  tab === key ? 'border-[#911A3A] text-[#911A3A]' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'oficios' ? (
          /* ── Tab: Control de Oficios (registro y exportación) ── */
          <div className="flex-1 overflow-y-auto p-4">
            <ControlOficios />
          </div>
        ) : tab === 'memorandums' ? (<>
          {/* ── Tab: MEMORANDUMS ── */}
          {/* Métricas memorándums */}
          <div className="px-4 py-2 bg-white border-b border-gray-100 space-y-2">
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'Recibidos',        val: docs?.filter(d => d.estado === 'recibido').length ?? 0,        color: '#3b82f6' },
                { label: 'Req. atención',    val: docs?.filter(d => d.tipo_memorandum === 'requiere_atencion').length ?? 0, color: '#f59e0b' },
                { label: 'Conocimiento',     val: docs?.filter(d => d.tipo_memorandum === 'conocimiento' || d.estado === 'de_conocimiento').length ?? 0, color: '#6b7280' },
                { label: 'En atención',      val: docs?.filter(d => d.estado === 'en_atencion').length ?? 0,     color: '#a855f7' },
                { label: 'Respondidos',      val: docs?.filter(d => ['respondido', 'firmado'].includes(d.estado)).length ?? 0, color: '#10b981' },
              ].map(({ label, val, color }) => (
                <div key={label} className="text-center">
                  <p className="text-lg font-bold" style={{ color }}>{val}</p>
                  <p className="text-[9px] text-gray-500 leading-tight">{label}</p>
                </div>
              ))}
            </div>
            {canRegistrarMemo && (
              <button onClick={() => setShowMemoModal(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: '#911A3A' }}>
                <Plus size={12} /> Registrar memorándum
              </button>
            )}
          </div>

          {/* Filtros memorándums */}
          <div className="px-4 py-2 bg-white border-b border-gray-100">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1"
                  style={{ '--tw-ring-color': '#911A3A' } as React.CSSProperties}
                  placeholder="Buscar memorándums..."
                  value={busqueda} onChange={e => setBusqueda(e.target.value)} />
              </div>
              <select value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setPage(0) }}
                className="text-xs border border-gray-300 rounded-lg px-2 py-1.5">
                <option value="">Todos los estados</option>
                <option value="recibido">Recibido</option>
                <option value="turnado">Turnado</option>
                <option value="en_atencion">En atención</option>
                <option value="respondido">Respondido</option>
                <option value="firmado">Firmado</option>
                <option value="de_conocimiento">Conocimiento</option>
              </select>
            </div>
          </div>

          {/* Tabla memorándums */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="text-white" style={{ backgroundColor: '#911A3A' }}>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 120 }}>No. Memo</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 200 }}>Asunto</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 130 }}>Emisor</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 130 }}>UPP Solicitante</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 100 }}>Tipo</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 90 }}>Estado</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 80 }}>Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {docs?.map(doc => {
                    const cfg = ESTADO_RECIBIDO_CONFIG[doc.estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
                    return (
                      <tr key={doc.id}
                        onClick={() => setSelectedId(doc.id === selectedId ? null : doc.id)}
                        className={clsx('cursor-pointer transition-colors', doc.id === selectedId ? 'bg-[#FDF8F9]' : 'hover:bg-gray-50')}>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[10px] text-gray-600 truncate block">{doc.numero_oficio_origen || '—'}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-medium text-gray-900 truncate leading-tight">{doc.asunto}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-[10px] text-gray-600 truncate">{doc.remitente_dependencia || doc.remitente_nombre || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-[10px] text-gray-600 truncate">{doc.dependencia_solicitante || doc.upp_solicitante || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {doc.tipo_memorandum === 'requiere_atencion' ? (
                            <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              Req. atención
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200">
                              Conocimiento
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {cfg && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                              style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                              {cfg.label}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{doc.fecha_recibido ? formatDate(doc.fecha_recibido) : doc.creado_en ? formatDate(doc.creado_en) : '—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Paginación */}
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">Mostrar</span>
                  <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                    className="text-[10px] border border-gray-300 rounded px-1.5 py-0.5 bg-white">
                    <option value={5}>5</option><option value={10}>10</option><option value={15}>15</option><option value={25}>25</option>
                  </select>
                  <span className="text-[10px] text-gray-500">
                    {totalFromHeader > 0
                      ? <>de {totalDocs} registro{totalDocs !== 1 ? 's' : ''} · Página {page + 1} de {totalPages}</>
                      : <>Página {page + 1}{pageCount ? ` · ${pageCount} registro${pageCount !== 1 ? 's' : ''}` : ''}</>}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    title="Página anterior"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                    <ChevronLeft size={11} /> Atrás
                  </button>
                  {totalPages > 1 && Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p: number
                    if (totalPages <= 7) { p = i } else if (page < 3) { p = i } else if (page > totalPages - 4) { p = totalPages - 7 + i } else { p = page - 3 + i }
                    return (<button key={p} onClick={() => setPage(p)} className={clsx('px-2 py-0.5 text-[10px] rounded border', p === page ? 'bg-[#911A3A] text-white border-[#911A3A]' : 'border-gray-300 hover:bg-gray-100')}>{p + 1}</button>)
                  })}
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!hasNextPage}
                    title="Página siguiente"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                    Adelante <ChevronRight size={11} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>) : (<>


        {/* Alertas por rol */}
        {tab === 'recibidos' && (
          <div className="px-4 py-2 bg-white border-b border-gray-100">
            {/* Alerta secretaria: firmados pendientes de despacho */}
            {(() => {
              const firmadosSinDespachar = docs?.filter(d => d.estado === 'firmado' && !d.despachado) ?? []
              if (!isSecretaria || firmadosSinDespachar.length === 0) return null
              return (
                <div className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-emerald-700 flex-1">
                    {firmadosSinDespachar.length} documento{firmadosSinDespachar.length !== 1 ? 's' : ''} firmado{firmadosSinDespachar.length !== 1 ? 's' : ''} listo{firmadosSinDespachar.length !== 1 ? 's' : ''} para despacho
                  </span>
                  <button onClick={() => setFiltroEstado('firmado')}
                    className="text-[10px] px-2 py-1 rounded font-medium text-emerald-700 hover:bg-emerald-100 border border-emerald-300">
                    Ver
                  </button>
                  <button onClick={async () => {
                    if (!window.confirm(`¿Marcar ${firmadosSinDespachar.length} documento(s) como despachado(s)?`)) return
                    try {
                      await documentosApi.acusarDespachoLote(firmadosSinDespachar.map(d => d.id))
                      qc.invalidateQueries({ queryKey: ['documentos'] })
                      refetch()
                      setFiltroEstado('')
                    } catch {}
                  }}
                    className="text-[10px] px-2 py-1 rounded font-medium text-white bg-emerald-600 hover:bg-emerald-700">
                    Acusar despacho
                  </button>
                </div>
              )
            })()}

            {/* Alerta director: respondidos para firma */}
            {isDirector && porEstado('respondido') > 0 && (
              <button onClick={() => setFiltroEstado('respondido')}
                className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-left hover:bg-amber-100 transition-colors">
                <FileSignature size={14} className="text-amber-600 flex-shrink-0" />
                <span className="text-xs font-medium text-amber-700">{porEstado('respondido')} documento{porEstado('respondido') !== 1 ? 's' : ''} pendiente{porEstado('respondido') !== 1 ? 's' : ''} de firma</span>
              </button>
            )}

            {/* Alerta director: oficios turnados a Dirección para revisión/atención directa */}
            {(() => {
              const turnadosADireccion = docs?.filter(d =>
                d.area_turno === 'DIR' && ['turnado', 'en_atencion'].includes(d.estado)
              ) ?? []
              if (!isDirector || turnadosADireccion.length === 0) return null
              return (
                <button onClick={() => { setFiltroArea('DIR'); setFiltroEstado('') }}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-left hover:bg-purple-100 transition-colors">
                  <InboxIcon size={14} className="text-purple-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-purple-700">{turnadosADireccion.length} oficio{turnadosADireccion.length !== 1 ? 's' : ''} turnado{turnadosADireccion.length !== 1 ? 's' : ''} a Dirección para revisión</span>
                </button>
              )
            })()}

            {/* Alerta secretaria: oficios turnados a Dirección pendientes de respuesta */}
            {(() => {
              const turnadosDirSecretaria = docs?.filter(d =>
                d.area_turno === 'DIR' && ['turnado', 'en_atencion'].includes(d.estado)
              ) ?? []
              if (!isSecretaria || turnadosDirSecretaria.length === 0) return null
              return (
                <button onClick={() => { setFiltroArea('DIR'); setFiltroEstado('') }}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-left hover:bg-purple-100 transition-colors">
                  <InboxIcon size={14} className="text-purple-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-purple-700">{turnadosDirSecretaria.length} oficio{turnadosDirSecretaria.length !== 1 ? 's' : ''} turnado{turnadosDirSecretaria.length !== 1 ? 's' : ''} a Dirección — requiere{turnadosDirSecretaria.length !== 1 ? 'n' : ''} respuesta</span>
                </button>
              )
            })()}

            {/* Alerta director: oficios de conocimiento turnados a Dirección */}
            {(() => {
              const conocimientoDireccion = docs?.filter(d =>
                d.area_turno === 'DIR' && d.estado === 'de_conocimiento'
              ) ?? []
              if (!isDirector || conocimientoDireccion.length === 0) return null
              return (
                <button onClick={() => { setFiltroArea('DIR'); setFiltroEstado('de_conocimiento') }}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg text-left hover:bg-sky-100 transition-colors">
                  <FileText size={14} className="text-sky-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-sky-700">{conocimientoDireccion.length} oficio{conocimientoDireccion.length !== 1 ? 's' : ''} para conocimiento de Dirección</span>
                </button>
              )
            })()}

            {/* Alerta director: turnados de conocimiento (legado — otros turnos sin respuesta) */}
            {(() => {
              const turnadosConocimiento = docs?.filter(d =>
                d.estado === 'turnado' && !d.requiere_respuesta && d.area_turno !== 'DIR'
              ) ?? []
              if (!isDirector || turnadosConocimiento.length === 0) return null
              return (
                <button onClick={() => setFiltroEstado('turnado')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-left hover:bg-blue-100 transition-colors">
                  <BookOpen size={14} className="text-blue-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-blue-700">{turnadosConocimiento.length} oficio{turnadosConocimiento.length !== 1 ? 's' : ''} turnado{turnadosConocimiento.length !== 1 ? 's' : ''} para conocimiento</span>
                </button>
              )
            })()}

            {/* Alerta subdirectores: pendientes de visto bueno */}
            {(() => {
              const pendientesVB = docs?.filter(d => d.estado === 'respondido' && !d.visto_bueno_subdirector && d.area_turno !== 'DIR') ?? []
              if (user?.rol !== 'subdirector' || pendientesVB.length === 0) return null
              return (
                <button onClick={() => setFiltroEstado('respondido')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-left hover:bg-amber-100 transition-colors">
                  <CheckCircle2 size={14} className="text-amber-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-amber-700">{pendientesVB.length} documento{pendientesVB.length !== 1 ? 's' : ''} pendiente{pendientesVB.length !== 1 ? 's' : ''} de Visto Bueno</span>
                </button>
              )
            })()}

            {/* Alerta áreas: en atención */}
            {!isDirector && !isSecretaria && porEstado('en_atencion') > 0 && (
              <button onClick={() => setFiltroEstado('en_atencion')}
                className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-left hover:bg-purple-100 transition-colors">
                <Clock size={14} className="text-purple-600 flex-shrink-0" />
                <span className="text-xs font-medium text-purple-700">{porEstado('en_atencion')} documento{porEstado('en_atencion') !== 1 ? 's' : ''} para atender</span>
              </button>
            )}
          </div>
        )}

        {/* Filtros */}
        <div className="px-4 py-2 bg-white border-b border-gray-100 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-7 pr-8 py-1.5 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-1"
                placeholder={tab === 'recibidos' ? 'Buscar por oficio, folio, dependencia, asunto…' : 'Buscar documento…'}
                value={busqueda} onChange={e => setBusqueda(e.target.value)}
              />
              {busqueda && (
                <button onClick={() => setBusqueda('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={12} />
                </button>
              )}
            </div>
            {tab === 'emitidos' && (
              <button onClick={async () => {
                const token = localStorage.getItem('access_token')
                try {
                  const res = await fetch(`${window.location.origin}/api/v1/documentos/export-emitidos`, {
                    headers: { Authorization: `Bearer ${token}` },
                  })
                  if (!res.ok) throw new Error('Error al exportar')
                  const blob = await res.blob()
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = `emitidos_${localToday()}.xlsx`
                  a.click()
                } catch { window.alert('Error al exportar a Excel') }
              }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg font-medium border border-green-300 text-green-700 hover:bg-green-50 transition-colors whitespace-nowrap">
                <Download size={12} /> Exportar Excel
              </button>
            )}
            <select className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
              value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="">Estado</option>
              {tab === 'recibidos'
                ? ['recibido','turnado','en_atencion','devuelto','respondido','firmado','de_conocimiento'].map(e => (
                    <option key={e} value={e}>{ESTADO_RECIBIDO_CONFIG[e as keyof typeof ESTADO_RECIBIDO_CONFIG]?.label ?? e}</option>
                  ))
                : ['borrador','en_revision','vigente','respondido','firmado'].map(e => {
                    const label = ESTADO_EMITIDO_CONFIG[e as keyof typeof ESTADO_EMITIDO_CONFIG]?.label
                      ?? ESTADO_RECIBIDO_CONFIG[e as keyof typeof ESTADO_RECIBIDO_CONFIG]?.label
                      ?? e
                    return <option key={e} value={e}>{label}</option>
                  })
              }
            </select>
            {tab === 'recibidos' && (
              <select className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
                value={filtroArea} onChange={e => setFiltroArea(e.target.value)}>
                <option value="">Área</option>
                {areas.map(a => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.titular.split(' ')[0]}</option>)}
              </select>
            )}
            {filtroUrgente && (
              <button onClick={() => setFiltroUrgente(false)}
                title="Quitar filtro de urgentes"
                className="flex items-center gap-1 px-2 py-1.5 text-xs border border-red-300 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors">
                <span className="font-medium">Urgentes</span>
                <X size={10} />
              </button>
            )}
            <button onClick={() => setShowDateFilters(!showDateFilters)}
              title="Filtrar por fecha"
              className={clsx('px-2 py-1.5 text-xs border rounded-lg transition-colors',
                showDateFilters || fechaDesde || fechaHasta
                  ? 'border-[#911A3A]/30 bg-[#FDF2F4] text-[#911A3A]'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50')}>
              <Clock size={12} />
            </button>
            {tab === 'emitidos' && (
              <button onClick={() => { setShowColFiltrosEmitidos(p => !p); if (showColFiltrosEmitidos) setColFiltrosEmitidos({ no: '', fecha: '', oficio: '', upp: '', destinatario: '', asunto: '', tipo: '', estado: '' }) }}
                title="Filtros por columna"
                className={clsx('px-2 py-1.5 text-xs border rounded-lg transition-colors',
                  showColFiltrosEmitidos || Object.values(colFiltrosEmitidos).some(Boolean)
                    ? 'border-[#911A3A]/30 bg-[#FDF2F4] text-[#911A3A]'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50')}>
                <SlidersHorizontal size={12} />
              </button>
            )}
            {tab === 'recibidos' && (
              <button onClick={() => { setShowColFiltros(p => !p); if (showColFiltros) setColFiltros({ fecha: '', oficio: '', upp: '', remitente: '', asunto: '', area: '', estado: '' }) }}
                title="Filtros por columna"
                className={clsx('px-2 py-1.5 text-xs border rounded-lg transition-colors',
                  showColFiltros || Object.values(colFiltros).some(Boolean)
                    ? 'border-[#911A3A]/30 bg-[#FDF2F4] text-[#911A3A]'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50')}>
                <SlidersHorizontal size={12} />
              </button>
            )}
          </div>
          {/* Filtro de fechas expandible */}
          {showDateFilters && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-medium">Desde:</span>
              <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-1" />
              <span className="text-[10px] text-gray-500 font-medium">Hasta:</span>
              <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-1" />
              {(fechaDesde || fechaHasta) && (
                <button onClick={() => { setFechaDesde(''); setFechaHasta('') }}
                  className="text-[10px] text-gray-400 hover:text-gray-600 underline">Limpiar</button>
              )}
            </div>
          )}
          {/* Contador de resultados */}
          {docs && (busquedaDebounced || filtroEstado || filtroArea || filtroUrgente || fechaDesde || fechaHasta) && (() => {
            const countVisible = filtroUrgente
              ? docs.filter(d => d.prioridad !== 'normal' && d.prioridad != null && !['firmado', 'archivado', 'de_conocimiento'].includes(d.estado)).length
              : docs.length
            return (
              <p className="text-[10px] text-gray-500">
                {countVisible} documento{countVisible !== 1 ? 's' : ''} encontrado{countVisible !== 1 ? 's' : ''}
                {busquedaDebounced && <> para "<strong>{busquedaDebounced}</strong>"</>}
                {filtroUrgente && !busquedaDebounced && <> — <strong>urgentes</strong></>}
              </p>
            )
          })()}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {!docs || docs.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
                {tab === 'recibidos' ? <InboxIcon size={22} style={{ color: GUINDA }} /> : <SendIcon size={22} style={{ color: GUINDA }} />}
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">
                {busqueda || filtroEstado || filtroArea || filtroUrgente ? 'Sin resultados' : tab === 'recibidos' ? 'Sin correspondencia recibida' : 'Sin documentos emitidos'}
              </p>
              <p className="text-xs text-gray-500 mb-3">
                {busqueda || filtroEstado || filtroArea || filtroUrgente
                  ? 'Ajusta los filtros de búsqueda'
                  : tab === 'recibidos' ? 'Registra el primer oficio recibido' : 'Crea el primer documento emitido'}
              </p>
              {!busqueda && !filtroEstado && !filtroArea && !filtroUrgente && (
                <Button size="sm" onClick={() => tab === 'recibidos' ? setShowModalRecibido(true) : setShowModalEmitido(true)}>
                  <Plus size={13} />
                  {tab === 'recibidos' ? 'Registrar recibido' : 'Nuevo emitido'}
                </Button>
              )}
            </div>
          ) : tab === 'recibidos' ? (
            <>
              {/* Barra seleccionar/deseleccionar todos (multi-select) */}
              {multiSelectMode && docs && (() => {
                const eligible = docs.filter(d => (d.estado === 'en_atencion' || d.estado === 'respondido') && d.has_borrador && !d.firmado_digitalmente)
                const allSelected = eligible.length > 0 && eligible.every(d => selectedIds.has(d.id))
                return (
                  <div className="px-3 py-2 bg-[#FDF8F9] border border-[#911A3A]/10 rounded-lg mb-1 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedIds(new Set(eligible.map(d => d.id)))}
                          disabled={eligible.length === 0 || allSelected}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/20 text-[#911A3A] hover:bg-[#911A3A]/10">
                          <CheckCircle2 size={10} /> Seleccionar todos
                        </button>
                        <button
                          onClick={() => setSelectedIds(new Set())}
                          disabled={selectedIds.size === 0}
                          className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-gray-300 text-gray-600 hover:bg-gray-100">
                          <X size={10} /> Deseleccionar todos
                        </button>
                      </div>
                      <span className="text-[10px] text-gray-500 font-medium">
                        {selectedIds.size > 0
                          ? `${selectedIds.size} seleccionado${selectedIds.size !== 1 ? 's' : ''} · `
                          : ''
                        }
                        {eligible.length} de {docs.length} listos para firma
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Tabla funcional de recibidos */}
              <div className="bg-white rounded-xl border border-gray-200">
                <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                  <thead className="sticky top-0 z-10" style={{ backgroundColor: '#911A3A' }}>
                    <tr className="text-white" style={{ backgroundColor: '#911A3A' }}>
                      {multiSelectMode && <th className="px-2 py-2.5 w-8" style={{ backgroundColor: '#911A3A' }} />}
                      {([
                        ['fecha', 'Fecha', 'left'],
                        ['oficio', 'No. Oficio', 'left'],
                        ['upp', 'UPP', 'left'],
                        ['remitente', 'Remitente', 'left'],
                        ['asunto', 'Asunto', 'left'],
                        ['area', 'Área', 'left'],
                        ['atencion', 'Atención', 'left'],
                        ['check', 'V°B° Sub.', 'center'],
                        ['estado', 'Estado', 'center'],
                      ] as const).map(([key, label, align]) => (
                        <th key={key} className={`px-3 py-2.5 text-${align} text-xs font-semibold`}
                          style={{ width: colW[key], minWidth: 50, backgroundColor: '#911A3A' }}>
                          {label}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 90, backgroundColor: '#911A3A' }}>Acciones</th>
                    </tr>
                    {/* Fila de filtros por columna */}
                    <tr className={showColFiltros ? 'bg-[#7a1530]' : 'hidden'}>
                      {multiSelectMode && <th className="px-2 py-1 w-8" />}
                      {/* Fecha */}
                      <th className="px-1.5 py-1" style={{ width: colW['fecha'] }}>
                        <input type="text" placeholder="ej: 28, abr, 2026" value={colFiltros.fecha}
                          onChange={e => setColFiltro('fecha', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* No. Oficio */}
                      <th className="px-1.5 py-1" style={{ width: colW['oficio'] }}>
                        <input type="text" placeholder="Buscar…" value={colFiltros.oficio}
                          onChange={e => setColFiltro('oficio', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* UPP */}
                      <th className="px-1.5 py-1" style={{ width: colW['upp'] }}>
                        <input type="text" placeholder="Buscar…" value={colFiltros.upp}
                          onChange={e => setColFiltro('upp', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* Remitente */}
                      <th className="px-1.5 py-1" style={{ width: colW['remitente'] }}>
                        <input type="text" placeholder="Buscar…" value={colFiltros.remitente}
                          onChange={e => setColFiltro('remitente', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* Asunto */}
                      <th className="px-1.5 py-1" style={{ width: colW['asunto'] }}>
                        <input type="text" placeholder="Buscar…" value={colFiltros.asunto}
                          onChange={e => setColFiltro('asunto', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* Área */}
                      <th className="px-1.5 py-1" style={{ width: colW['area'] }}>
                        <input type="text" placeholder="Buscar…" value={colFiltros.area}
                          onChange={e => setColFiltro('area', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                      </th>
                      {/* Atención — sin filtro */}
                      <th className="px-1.5 py-1" style={{ width: colW['atencion'] }} />
                      {/* V°B° — sin filtro */}
                      <th className="px-1.5 py-1" style={{ width: colW['check'] }} />
                      {/* Estado — select */}
                      <th className="px-1.5 py-1" style={{ width: colW['estado'] }}>
                        <select value={colFiltros.estado}
                          onChange={e => setColFiltro('estado', e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-1 py-0.5 text-[9px] rounded bg-white/15 text-white border border-white/20 focus:outline-none focus:bg-white/25"
                          style={{ colorScheme: 'dark' }}>
                          <option value="" className="text-gray-900 bg-white">Todos</option>
                          {Object.entries(ESTADO_RECIBIDO_CONFIG).map(([k, v]) => (
                            <option key={k} value={k} className="text-gray-900 bg-white">{v.label}</option>
                          ))}
                        </select>
                      </th>
                      {/* Acciones — botón limpiar */}
                      <th className="px-1.5 py-1 text-center">
                        {Object.values(colFiltros).some(Boolean) && (
                          <button
                            onClick={() => setColFiltros({ fecha: '', oficio: '', upp: '', remitente: '', asunto: '', area: '', estado: '' })}
                            title="Limpiar filtros de columna"
                            className="text-[9px] text-white/70 hover:text-white underline">
                            Limpiar
                          </button>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {docs.filter(doc => {
                      const fechaIso = doc.fecha_recibido || doc.creado_en?.slice(0, 10) || ''
                      const fechaDisplay = formatDate(fechaIso).toLowerCase()
                      const uppLabel = (formatUpp(doc.upp_solicitante_codigo, doc.upp_solicitante, doc.remitente_dependencia) || doc.remitente_dependencia || doc.upp_solicitante || '').toLowerCase()
                      const area = (doc.area_turno_nombre || '').toLowerCase()
                      const cf = colFiltros
                      const pasaUrgente = !filtroUrgente || (doc.prioridad !== 'normal' && doc.prioridad != null && !['firmado', 'archivado', 'de_conocimiento'].includes(doc.estado))
                      return (
                        pasaUrgente &&
                        (!cf.fecha     || fechaDisplay.includes(cf.fecha.toLowerCase()) || fechaIso.includes(cf.fecha)) &&
                        (!cf.oficio    || (doc.numero_oficio_origen || '').toLowerCase().includes(cf.oficio.toLowerCase())) &&
                        (!cf.upp       || uppLabel.includes(cf.upp.toLowerCase())) &&
                        (!cf.remitente || (doc.remitente_nombre || '').toLowerCase().includes(cf.remitente.toLowerCase())) &&
                        (!cf.asunto    || (doc.asunto || '').toLowerCase().includes(cf.asunto.toLowerCase())) &&
                        (!cf.area      || area.includes(cf.area.toLowerCase())) &&
                        (!cf.estado    || doc.estado === cf.estado)
                      )
                    }).map(doc => {
                      const cfg = ESTADO_RECIBIDO_CONFIG[doc.estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
                      const canSelect = (doc.estado === 'en_atencion' || doc.estado === 'respondido') && doc.has_borrador === true && !doc.firmado_digitalmente
                      const isToday = doc.fecha_recibido === localToday() || doc.creado_en?.slice(0, 10) === localToday()
                      return (
                        <tr key={doc.id}
                          onClick={() => {
                            if (multiSelectMode) {
                              if (canSelect) {
                                setSelectedIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(doc.id)) next.delete(doc.id)
                                  else next.add(doc.id)
                                  return next
                                })
                              }
                            } else if (canVerVisorFlotante) {
                              setFloatingDocTab('info'); setFloatingActiveTab('info'); setFloatingDocId(doc.id === floatingDocId ? null : doc.id)
                            }
                          }}
                          className={clsx(
                            'cursor-pointer transition-colors',
                            doc.id === floatingDocId ? 'bg-[#FDF8F9]' : isToday ? 'bg-blue-50/30 hover:bg-blue-50/60' : 'hover:bg-gray-50',
                            multiSelectMode && !canSelect && 'opacity-50',
                            multiSelectMode && selectedIds.has(doc.id) && 'bg-[#FDF8F9] ring-1 ring-inset ring-[#911A3A]/20',
                          )}>
                          {multiSelectMode && (
                            <td className="px-2 py-2">
                              <div className={clsx(
                                'w-4 h-4 rounded border-2 flex items-center justify-center',
                                selectedIds.has(doc.id) ? 'border-[#911A3A] bg-[#911A3A]' : canSelect ? 'border-gray-300' : 'border-gray-200 bg-gray-100',
                              )}>
                                {selectedIds.has(doc.id) && <CheckCircle2 size={10} className="text-white" />}
                              </div>
                            </td>
                          )}
                          {/* Fecha */}
                          <td className="px-3 py-2.5">
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">
                              {doc.fecha_recibido ? formatDate(doc.fecha_recibido) : doc.creado_en ? formatDate(doc.creado_en) : '—'}
                            </span>
                          </td>
                          {/* No. Oficio */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-[10px] text-gray-600 truncate min-w-0 flex-1">
                                {doc.numero_oficio_origen || '—'}
                              </span>
                              <span className="flex-shrink-0">
                                <PrioridadBadge prioridad={doc.prioridad} />
                              </span>
                            </div>
                          </td>
                          {/* UPP */}
                          <td className="px-3 py-2.5">
                            {(() => {
                              const uppLabel = formatUpp(
                                doc.upp_solicitante_codigo,
                                doc.upp_solicitante,
                                doc.remitente_dependencia,
                              )
                              const fallback = doc.remitente_dependencia || doc.upp_solicitante || ''
                              const oficina = doc.remitente_dependencia || ''
                              // Mostrar oficina solo si el uppLabel la identifica diferente (evitar duplicar)
                              const mostrarOficina = uppLabel && oficina && !uppLabel.toLowerCase().includes(oficina.toLowerCase().slice(0, 15))
                              return (
                                <div className="max-w-[180px]">
                                  <p className="text-[10px] text-gray-500 truncate" title={uppLabel || fallback}>
                                    {uppLabel || fallback || '—'}
                                  </p>
                                  {mostrarOficina && (
                                    <p className="text-[9px] text-gray-400 truncate leading-tight mt-0.5" title={oficina}>
                                      {oficina}
                                    </p>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                          {/* Remitente (quien firma) */}
                          <td className="px-3 py-2.5">
                            <p className="text-[10px] text-gray-600 truncate" title={doc.remitente_nombre || ''}>
                              {doc.remitente_nombre || '—'}
                            </p>
                            {doc.remitente_cargo && (
                              <p className="text-[9px] text-gray-400 truncate">{doc.remitente_cargo}</p>
                            )}
                          </td>
                          {/* Asunto */}
                          <td className="px-3 py-2.5">
                            <p className="text-xs font-bold text-gray-900 leading-tight line-clamp-2">{doc.asunto}</p>
                            {doc.dependencia_origen && (
                              <p className="text-[9px] text-gray-400 truncate mt-0.5">{doc.dependencia_origen}</p>
                            )}
                          </td>
                          {/* Área */}
                          <td className="px-3 py-2.5">
                            <p className="text-[10px] text-gray-500 truncate">
                              {doc.area_turno_nombre ? doc.area_turno_nombre.replace(/^(Departamento|Subdirección|Dirección)\s+de\s+/i, '') : '—'}
                            </p>
                          </td>
                          {/* Atención */}
                          <td className="px-3 py-2.5">
                            <SemaforoAtencion fecha={doc.fecha_limite} estado={doc.estado} />
                          </td>
                          {/* V°B° Subdirector — no aplica para turnos directos a DIR */}
                          <td className="px-3 py-2.5 text-center">
                            {doc.area_turno === 'DIR' ? (
                              <span className="text-[10px] text-gray-300">—</span>
                            ) : doc.visto_bueno_subdirector ? (
                              <span className="inline-flex items-center justify-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-50 text-green-700 border border-green-200 whitespace-nowrap" title="Visto bueno del Subdirector registrado">
                                <CheckCircle2 size={12} /> V°B°
                              </span>
                            ) : doc.estado === 'respondido' && doc.has_borrador ? (
                              <span className="inline-flex items-center justify-center text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap" title="Pendiente V°B° del Subdirector">
                                Pendiente
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-300">—</span>
                            )}
                          </td>
                          {/* Estado */}
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center">
                              {cfg && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                                  style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                                  {cfg.label}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center gap-1">
                              {/* Visualizar — abre panel flotante en tab Turnar */}
                              {canVerVisorFlotante && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setFloatingDocTab('info'); setFloatingActiveTab('info'); setFloatingDocId(doc.id) }}
                                className="inline-flex items-center justify-center w-6 h-6 rounded text-indigo-600 hover:bg-indigo-50 border border-indigo-200 transition-colors"
                                title="Visualizar documento">
                                <Eye size={11} />
                              </button>
                              )}
                              {/* Editar (solo quien tenga permiso de eliminar/modificar registro base) */}
                              {canMain('eliminar') && !doc.firmado_digitalmente && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditDocId(doc.id) }}
                                  className="inline-flex items-center justify-center w-6 h-6 rounded text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors"
                                  title="Modificar registro">
                                  <Edit3 size={11} />
                                </button>
                              )}
                              {/* Separador + Eliminar */}
                              {canMain('eliminar') && !doc.firmado_digitalmente && (
                                <>
                                  <span className="w-px h-4 bg-gray-200 mx-1" />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (window.confirm(`¿Eliminar "${doc.asunto}"? Esta acción no se puede deshacer.`))
                                        deleteMutation.mutate(doc.id)
                                    }}
                                    className="inline-flex items-center justify-center w-6 h-6 rounded text-red-500 hover:bg-red-50 border border-red-200 transition-colors"
                                    title="Eliminar documento">
                                    <Trash2 size={11} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {/* Paginación */}
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500">Mostrar</span>
                    <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                      className="text-[10px] border border-gray-300 rounded px-1.5 py-0.5 bg-white">
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                    <span className="text-[10px] text-gray-500">
                      {totalFromHeader > 0
                        ? <>de {totalDocs} registro{totalDocs !== 1 ? 's' : ''} · Página {page + 1} de {totalPages}</>
                        : <>Página {page + 1}{pageCount ? ` · ${pageCount} registro${pageCount !== 1 ? 's' : ''}` : ''}</>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      title="Página anterior"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                      <ChevronLeft size={11} /> Atrás
                    </button>
                    {totalPages > 1 && Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let p: number
                      if (totalPages <= 7) { p = i }
                      else if (page < 3) { p = i }
                      else if (page > totalPages - 4) { p = totalPages - 7 + i }
                      else { p = page - 3 + i }
                      return (
                        <button key={p} onClick={() => setPage(p)}
                          className={clsx('px-2 py-0.5 text-[10px] rounded border', p === page ? 'bg-[#911A3A] text-white border-[#911A3A]' : 'border-gray-300 hover:bg-gray-100')}>
                          {p + 1}
                        </button>
                      )
                    })}
                    <button
                      onClick={() => setPage(page + 1)}
                      disabled={!hasNextPage}
                      title="Página siguiente"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                      Adelante <ChevronRight size={11} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Floating action bar for multi-select */}
              {multiSelectMode && selectedIds.size > 0 && (
                <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-lg rounded-t-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700">
                    {selectedIds.size} documento{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setMultiSelectMode(false); setSelectedIds(new Set()) }}
                      className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                      Cancelar
                    </button>
                    <button onClick={() => setShowFirmaLote(true)}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg text-white font-medium"
                      style={{ backgroundColor: GUINDA }}>
                      <FileSignature size={12} /> Firmar selección
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Tabla completa para emitidos */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                <thead className="sticky top-0 z-10">
                  <tr className="text-white" style={{ backgroundColor: '#911A3A' }}>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 52, backgroundColor: '#911A3A' }}>No.</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 85, backgroundColor: '#911A3A' }}>Fecha</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 130, backgroundColor: '#911A3A' }}>No. Oficio</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 175, backgroundColor: '#911A3A' }}>UPP / Dependencia</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 140, backgroundColor: '#911A3A' }}>Destinatario</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold" style={{ width: 160, backgroundColor: '#911A3A' }}>Asunto</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 80, backgroundColor: '#911A3A' }}>Tipo</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 90, backgroundColor: '#911A3A' }}>Estado</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold" style={{ width: 80, backgroundColor: '#911A3A' }}>Acuse</th>
                  </tr>
                  <tr className={showColFiltrosEmitidos ? 'bg-[#7a1530]' : 'hidden'}>
                    {/* No. */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.no}
                        onChange={e => setColFiltroEmitidos('no', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Fecha */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.fecha}
                        onChange={e => setColFiltroEmitidos('fecha', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* No. Oficio */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.oficio}
                        onChange={e => setColFiltroEmitidos('oficio', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* UPP */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.upp}
                        onChange={e => setColFiltroEmitidos('upp', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Destinatario */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.destinatario}
                        onChange={e => setColFiltroEmitidos('destinatario', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Asunto */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.asunto}
                        onChange={e => setColFiltroEmitidos('asunto', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Tipo */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.tipo}
                        onChange={e => setColFiltroEmitidos('tipo', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Estado */}
                    <th className="px-1.5 py-1" style={{ backgroundColor: '#7a1530' }}>
                      <input type="text" placeholder="Buscar…" value={colFiltrosEmitidos.estado}
                        onChange={e => setColFiltroEmitidos('estado', e.target.value)}
                        className="w-full px-1.5 py-0.5 text-[9px] rounded bg-white/15 text-white placeholder-white/50 border border-white/20 focus:outline-none focus:bg-white/25" />
                    </th>
                    {/* Acuse */}
                    <th style={{ backgroundColor: '#7a1530' }} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {docs?.slice().sort((a, b) => {
                    const extractNum = (d: typeof a) => {
                      const noOf = d.flujo === 'recibido' ? d.folio_respuesta : d.numero_control
                      const seg = noOf ? noOf.split('/').slice(-2, -1)[0] : null
                      return seg ? parseInt(seg, 10) : -1
                    }
                    return extractNum(b) - extractNum(a)
                  }).filter(doc => {
                    const esR = doc.flujo === 'recibido'
                    const noOf = esR ? doc.folio_respuesta : doc.numero_control
                    const numFol = noOf ? (noOf.split('/').slice(-2, -1)[0] ?? '') : ''
                    // Fecha: combinar raw + formateada + creado_en para que "21", "mar", "2026" coincidan
                    const fechaRawStr = esR ? (doc.fecha_respuesta || '') : (doc.fecha_documento || '')
                    const fechaFmt = fechaRawStr && /^\d{4}-\d{2}-\d{2}/.test(fechaRawStr) ? formatDate(fechaRawStr) : fechaRawStr
                    const fechaFallback = doc.creado_en ? formatDate(doc.creado_en) : ''
                    const fechaBusqueda = `${fechaRawStr} ${fechaFmt} ${fechaFallback}`.toLowerCase()
                    const upp = doc.upp_solicitante_codigo
                      ? `${doc.upp_solicitante_codigo}-${esR ? doc.remitente_dependencia : (doc.dependencia_destino || doc.upp_solicitante)}`
                      : (esR ? doc.remitente_dependencia : (doc.dependencia_destino || doc.upp_solicitante))
                    const dest = esR ? doc.remitente_nombre : doc.destinatario_nombre
                    // Tipo: "respuesta" para recibidos mostrados aquí, "emitido <tipo>" para los emitidos reales
                    const tipoLabel = esR ? 'respuesta' : `emitido ${doc.tipo || ''}`
                    const { no: fNo, fecha: fFecha, oficio: fOf, upp: fUpp, destinatario: fDest, asunto: fAs, tipo: fTipo, estado: fEst } = colFiltrosEmitidos
                    if (fNo   && !numFol.toLowerCase().includes(fNo.toLowerCase()))              return false
                    if (fFecha && !fechaBusqueda.includes(fFecha.toLowerCase()))                 return false
                    if (fOf   && !(noOf  || '').toLowerCase().includes(fOf.toLowerCase()))       return false
                    if (fUpp  && !(upp   || '').toLowerCase().includes(fUpp.toLowerCase()))      return false
                    if (fDest && !(dest  || '').toLowerCase().includes(fDest.toLowerCase()))     return false
                    if (fAs   && !doc.asunto.toLowerCase().includes(fAs.toLowerCase()))          return false
                    if (fTipo && !tipoLabel.toLowerCase().includes(fTipo.toLowerCase()))         return false
                    if (fEst  && !doc.estado.toLowerCase().includes(fEst.toLowerCase()))         return false
                    return true
                  }).map(doc => {
                    const esRespuesta = doc.flujo === 'recibido'
                    const cfg = esRespuesta
                      ? ESTADO_RECIBIDO_CONFIG[doc.estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
                      : ESTADO_EMITIDO_CONFIG[doc.estado as keyof typeof ESTADO_EMITIDO_CONFIG]
                    const fechaDocRaw = esRespuesta
                      ? (doc.fecha_respuesta || null)
                      : (doc.fecha_documento || null)
                    const isIsoFecha = fechaDocRaw ? /^\d{4}-\d{2}-\d{2}/.test(fechaDocRaw) : false
                    const noOficio = esRespuesta ? doc.folio_respuesta : doc.numero_control
                    const destNombre = esRespuesta ? doc.remitente_nombre : doc.destinatario_nombre
                    const destCargo  = esRespuesta ? doc.remitente_cargo  : doc.destinatario_cargo
                    const uppCodigo  = doc.upp_solicitante_codigo
                    const uppNombre  = esRespuesta ? doc.remitente_dependencia : (doc.dependencia_destino || doc.upp_solicitante)
                    // Extraer solo el número del folio: "SFA/SF/DPP/0002/2026" → "0002"
                    const numFolio = noOficio ? (noOficio.split('/').slice(-2, -1)[0] ?? '—') : '—'
                    return (
                      <tr key={doc.id}
                        onClick={() => {
                          if (esRespuesta) {
                            setFloatingDocTab('ocr'); setFloatingActiveTab('ocr'); setFloatingDocId(doc.id)
                          } else {
                            setSelectedId(doc.id === selectedId ? null : doc.id)
                          }
                        }}
                        className={clsx('cursor-pointer transition-colors', doc.id === selectedId ? 'bg-[#FDF8F9]' : 'hover:bg-gray-50')}>
                        {/* No. (número extraído del folio) */}
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs font-bold text-gray-700">{numFolio}</span>
                        </td>
                        {/* Fecha */}
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] text-gray-500 whitespace-nowrap">
                            {fechaDocRaw
                              ? (isIsoFecha ? formatDate(fechaDocRaw) : fechaDocRaw.slice(0, 20))
                              : doc.creado_en ? formatDate(doc.creado_en) : '—'}
                          </span>
                        </td>
                        {/* No. Oficio */}
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-[10px] text-gray-600 truncate block" title={noOficio || ''}>
                            {noOficio || '—'}
                          </span>
                        </td>
                        {/* UPP / Dependencia — "007-Secretaría de Finanzas..." */}
                        <td className="px-3 py-2.5">
                          <p className="text-[10px] text-gray-600 truncate"
                            title={uppCodigo && uppNombre ? `${uppCodigo}-${uppNombre}` : (uppNombre || '')}>
                            {uppCodigo && uppNombre
                              ? `${uppCodigo}-${uppNombre}`
                              : uppNombre || '—'}
                          </p>
                        </td>
                        {/* Destinatario — nombre + cargo */}
                        <td className="px-3 py-2.5">
                          <p className="text-[10px] text-gray-700 font-medium truncate" title={destNombre || ''}>{destNombre || '—'}</p>
                          {destCargo && (
                            <p className="text-[9px] text-gray-400 truncate mt-0.5">{destCargo}</p>
                          )}
                        </td>
                        {/* Asunto */}
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-medium text-gray-900 truncate leading-tight">{doc.asunto}</p>
                          {esRespuesta && doc.numero_oficio_origen && (
                            <p className="text-[9px] text-gray-400 truncate mt-0.5">Resp. a: {doc.numero_oficio_origen}</p>
                          )}
                        </td>
                        {/* Tipo */}
                        <td className="px-3 py-2.5 text-center">
                          {esRespuesta ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                              <CornerUpLeft size={9} /> Respuesta
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap">
                              <SendIcon size={9} /> Emitido
                            </span>
                          )}
                        </td>
                        {/* Estado */}
                        <td className="px-3 py-2.5 text-center">
                          {cfg && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                              style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                              {cfg.label}
                            </span>
                          )}
                        </td>
                        {/* Acuse */}
                        <td className="px-3 py-2.5 text-center">
                          {doc.acuse_recibido_url ? (
                            <button onClick={(e) => { e.stopPropagation(); window.open(`/api/v1/documentos/${doc.id}/acuse-recibido/archivo`, '_blank') }}
                              title={`Acuse: ${doc.acuse_recibido_fecha || 'Ver'}`}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                              <CheckCircle2 size={10} />
                              {doc.acuse_recibido_fecha ? doc.acuse_recibido_fecha.slice(0, 10) : 'Ver'}
                            </button>
                          ) : !esRespuesta && (doc.estado === 'vigente' || doc.firmado_digitalmente) ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 border border-red-200">
                              Pendiente
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Paginación emitidos */}
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">Mostrar</span>
                  <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                    className="text-[10px] border border-gray-300 rounded px-1.5 py-0.5 bg-white">
                    <option value={5}>5</option><option value={10}>10</option><option value={15}>15</option><option value={25}>25</option>
                  </select>
                  <span className="text-[10px] text-gray-500">
                    {totalFromHeader > 0
                      ? <>de {totalDocs} registro{totalDocs !== 1 ? 's' : ''} · Página {page + 1} de {totalPages}</>
                      : <>Página {page + 1}{pageCount ? ` · ${pageCount} registro${pageCount !== 1 ? 's' : ''}` : ''}</>}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    title="Página anterior"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                    <ChevronLeft size={11} /> Atrás
                  </button>
                  {totalPages > 1 && Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p: number
                    if (totalPages <= 7) { p = i } else if (page < 3) { p = i } else if (page > totalPages - 4) { p = totalPages - 7 + i } else { p = page - 3 + i }
                    return (<button key={p} onClick={() => setPage(p)} className={clsx('px-2 py-0.5 text-[10px] rounded border', p === page ? 'bg-[#911A3A] text-white border-[#911A3A]' : 'border-gray-300 hover:bg-gray-100')}>{p + 1}</button>)
                  })}
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!hasNextPage}
                    title="Página siguiente"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-[#911A3A]/30 text-[#911A3A] hover:bg-[#911A3A]/10">
                    Adelante <ChevronRight size={11} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* ── Panel detalle (full-width cuando hay selección) — solo para emitidos ── */}
      {selectedId && selectedDoc && selectedDoc.flujo !== 'recibido' && (
        <div className="flex-1 flex flex-col min-w-0">
          <PanelEmitido
            doc={selectedDoc}
            areas={areas}
            onClose={() => setSelectedId(null)}
            onRefetch={refetch}
            onDelete={() => { if (window.confirm('¿Eliminar este documento?')) deleteMutation.mutate(selectedDoc.id) }}
          />
        </div>
      )}

      {/* ── Floating viewer: Turnar / Respuesta / Historial ─────────────────── */}
      {floatingDocId && floatingDoc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="flex overflow-hidden rounded-2xl shadow-2xl bg-white" style={{ width: '92vw', height: '92vh' }}>
            {/* Izquierda: Panel con tabs de acciones */}
            <div className="w-[52%] flex flex-col overflow-hidden border-r border-gray-200 rounded-l-2xl">
              <PanelRecibido
                doc={floatingDoc}
                areas={areas}
                onClose={() => { setFloatingDocId(null); setFloatingPdfUrl(null) }}
                onRefetch={refetch}
                initialTab={floatingDocTab}
                hideDocumentVisor={true}
                onTabChange={handleFloatingTabChange}
              />
            </div>
            {/* Derecha: Vista previa — recibido (Turnar) o respuesta (Respuesta) */}
            <div className="w-[48%] flex flex-col bg-gray-50 rounded-r-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-2 flex-shrink-0">
                <FileText size={14} className="text-gray-400 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-700 truncate flex-1">
                  {floatingActiveTab === 'ocr'
                    ? `Respuesta — ${floatingDoc.asunto}`
                    : floatingDoc.numero_oficio_origen
                      ? `${floatingDoc.numero_oficio_origen} — ${floatingDoc.asunto}`
                      : floatingDoc.asunto}
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                {floatingPdfLoading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                    <RotateCcw size={28} className="animate-spin" />
                    <p className="text-xs">Cargando documento...</p>
                  </div>
                ) : floatingPdfUrl ? (
                  <iframe
                    src={floatingPdfUrl}
                    title="Vista previa"
                    className="w-full h-full"
                    style={{ border: 'none' }}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-300">
                    <FileText size={40} />
                    <p className="text-xs text-gray-400">
                      {floatingActiveTab === 'ocr' ? 'Genera el oficio de respuesta para visualizarlo aquí' : 'Sin documento adjunto'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal edición rápida — secretaria/admin */}
      {editDocId && (() => {
        const editDoc = (docs ?? []).find(d => d.id === editDocId)
        if (!editDoc) return null
        return <ModalEditarRegistro doc={editDoc} onClose={() => setEditDocId(null)} onSaved={() => { setEditDocId(null); refetch() }} />
      })()}

      {/* Modals */}
      {showModalRecibido && (
        <ModalRegistrarRecibido
          onClose={() => setShowModalRecibido(false)}
          onCreated={doc => { setShowModalRecibido(false); setFloatingDocTab('info'); setFloatingActiveTab('info'); setFloatingDocId(doc.id) }}
        />
      )}
      {showModalEmitido && (
        <ModalNuevoEmitido
          onClose={() => setShowModalEmitido(false)}
          onCreated={doc => { setShowModalEmitido(false); setSelectedId(doc.id) }}
        />
      )}
      {showFirmaLote && docs && (
        <FirmaLoteWizard
          documentos={docs.filter(d => selectedIds.has(d.id))}
          onClose={() => setShowFirmaLote(false)}
          onComplete={() => {
            setMultiSelectMode(false)
            setSelectedIds(new Set())
            qc.invalidateQueries({ queryKey: ['documentos'] })
            refetch()
          }}
        />
      )}
      {showCertModal && (
        <RegistroCertificado
          open={showCertModal}
          onClose={() => setShowCertModal(false)}
        />
      )}

      {/* ── Modal: Registrar Memorándum ── */}
      {showMemoModal && (
        <RegistroMemorandumModal
          clienteId={user?.cliente_id ?? ''}
          onClose={() => setShowMemoModal(false)}
          onSaved={() => { setShowMemoModal(false); qc.invalidateQueries({ queryKey: ['documentos'] }); refetch() }}
        />
      )}
    </div>
  )
}


// ── Modal de registro de memorándum ──────────────────────────────────────────

function RegistroMemorandumModal({ clienteId, onClose, onSaved }: {
  clienteId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // OCR / archivo
  const [step, setStep] = useState<'upload' | 'processing' | 'form'>('upload')
  const [ocrResult, setOcrResult] = useState<PreviewOCRResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [fileMime, setFileMime] = useState('')

  // Campos del formulario
  const [emisor, setEmisor] = useState('Secretaría de Finanzas y Administración')
  const [numeroMemo, setNumeroMemo] = useState('')
  const [fechaMemo, setFechaMemo] = useState(localToday())
  const [asunto, setAsunto] = useState('')
  const [tipoMemo, setTipoMemo] = useState<'requiere_atencion' | 'conocimiento'>('requiere_atencion')
  const [depSolicitante, setDepSolicitante] = useState('')
  const [uppSolicitanteCodigo, setUppSolicitanteCodigo] = useState('')
  const [ordenDireccion, setOrdenDireccion] = useState(1)
  const [prioridad, setPrioridad] = useState('normal')
  const [descripcion, setDescripcion] = useState('')

  // Autocompletado UPP
  const [uppSearch, setUppSearch] = useState('')
  const { data: uppSugerencias } = useQuery({
    queryKey: ['upps-memo', uppSearch],
    queryFn: () => catalogoApi.buscarUPPs(uppSearch),
    enabled: uppSearch.length >= 2,
  })

  // Procesar archivo con OCR
  const handleFile = async (file: File) => {
    setFileName(file.name)
    setError('')
    setStep('processing')
    try {
      const result = await documentosApi.previewOCR(file)
      setOcrResult(result)
      // Pre-llenar con datos extraídos
      const d = result.datos_extraidos
      if (d.asunto) setAsunto(d.asunto as string)
      if (d.numero_oficio) setNumeroMemo(d.numero_oficio as string)
      if (d.fecha_documento) setFechaMemo(d.fecha_documento as string)
      if (d.remitente_dependencia) setEmisor(d.remitente_dependencia as string)
      // Guardar referencia al archivo pre-procesado
      if (result.archivo?.url_storage) setFileUrl(result.archivo.url_storage)
      if (result.archivo?.nombre_archivo) setFileName(result.archivo.nombre_archivo)
      if (result.archivo?.mime_type) setFileMime(result.archivo.mime_type)
      setStep('form')
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error al procesar archivo')
      setStep('upload')
    }
  }

  const handleSave = async () => {
    if (!asunto.trim()) return setError('El asunto es obligatorio')
    setSaving(true)
    setError('')
    try {
      await documentosApi.registrarMemorandum({
        cliente_id: clienteId,
        tipo: 'memorandum',
        asunto: asunto.trim(),
        numero_oficio_origen: numeroMemo.trim() || undefined,
        remitente_nombre: emisor,
        remitente_dependencia: emisor,
        fecha_documento: fechaMemo,
        fecha_recibido: localToday(),
        prioridad,
        descripcion: descripcion || undefined,
        requiere_respuesta: tipoMemo === 'requiere_atencion',
        tipo_memorandum: tipoMemo,
        dependencia_solicitante: depSolicitante || undefined,
        upp_solicitante_codigo: uppSolicitanteCodigo || undefined,
        memorandum_orden_direccion: ordenDireccion,
        // Datos del archivo OCR pre-procesado
        ...(fileUrl ? { nombre_archivo: fileName, url_storage: fileUrl, mime_type: fileMime } : {}),
        ...(ocrResult ? {
          datos_extraidos_ia: ocrResult.datos_extraidos,
          ocr_procesado: true,
          sugerencia_area_codigo: ocrResult.clasificacion?.area_codigo,
          sugerencia_area_nombre: ocrResult.clasificacion?.area_nombre,
          sugerencia_fundamento: ocrResult.clasificacion?.fundamento,
          sugerencia_plazo_dias: ocrResult.clasificacion?.plazo_dias,
          confianza_clasificacion: ocrResult.clasificacion?.confianza,
        } : {}),
      })
      onSaved()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error al registrar memorándum')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#911A3A20' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
              <FileText size={14} style={{ color: '#911A3A' }} />
            </div>
            <h2 className="text-sm font-bold text-gray-900">Registrar Memorándum</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* Paso 1: Carga de archivo */}
          {step === 'upload' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">Sube el PDF o foto del memorándum para extraer datos automáticamente, o llena el formulario manualmente.</p>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff,image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-6 hover:border-[#911A3A] hover:bg-[#FDF2F4] transition-colors cursor-pointer">
                <Upload size={24} className="text-gray-400" />
                <span className="text-xs text-gray-600 font-medium">Subir PDF o imagen del memorándum</span>
                <span className="text-[10px] text-gray-400">PDF, JPG, PNG, TIFF</span>
              </button>
              <button onClick={() => setStep('form')}
                className="w-full text-center text-xs text-gray-500 hover:text-[#911A3A] py-1">
                O llenar formulario manualmente
              </button>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={12} className="inline mr-1" /> {error}
                </div>
              )}
            </div>
          )}

          {/* Paso 2: Procesando OCR */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-8">
              <RotateCcw size={28} className="animate-spin mb-3" style={{ color: '#911A3A' }} />
              <p className="text-xs font-medium text-gray-700">Procesando {fileName}...</p>
              <p className="text-[10px] text-gray-400 mt-1">Extrayendo datos con IA</p>
            </div>
          )}

          {/* Paso 3: Formulario (con o sin datos OCR) */}
          {step === 'form' && (<>

          {/* Indicador de archivo cargado */}
          {ocrResult && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 size={12} className="text-green-600" />
              <span className="text-[10px] text-green-700 font-medium">Datos extraídos de: {fileName}</span>
              <button onClick={() => { setOcrResult(null); setStep('upload'); setFileUrl(''); setFileName('') }}
                className="ml-auto text-[10px] text-gray-400 hover:text-red-500">Cambiar archivo</button>
            </div>
          )}

          {/* Emisor */}
          <div>
            <label className="text-[10px] font-medium text-gray-700 mb-1 block">Emisor</label>
            <select value={emisor} onChange={e => setEmisor(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2">
              <option>Secretaría de Finanzas y Administración</option>
              <option>Subsecretaría de Finanzas</option>
              <option>Secretaría Particular</option>
            </select>
          </div>

          {/* No. memo + Fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium text-gray-700 mb-1 block">No. de memorándum</label>
              <input value={numeroMemo} onChange={e => setNumeroMemo(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2" placeholder="MEMO/SFA/001/2026" />
            </div>
            <div>
              <label className="text-[10px] font-medium text-gray-700 mb-1 block">Fecha</label>
              <input type="date" value={fechaMemo} onChange={e => setFechaMemo(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2" />
            </div>
          </div>

          {/* Asunto */}
          <div>
            <label className="text-[10px] font-medium text-gray-700 mb-1 block">Asunto *</label>
            <input value={asunto} onChange={e => setAsunto(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2" placeholder="Asunto del memorándum" />
          </div>

          {/* Tipo memo + Prioridad */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium text-gray-700 mb-1 block">Tipo de memorándum</label>
              <select value={tipoMemo} onChange={e => setTipoMemo(e.target.value as 'requiere_atencion' | 'conocimiento')}
                className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2">
                <option value="requiere_atencion">Requiere atención</option>
                <option value="conocimiento">Solo conocimiento</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-gray-700 mb-1 block">Prioridad</label>
              <select value={prioridad} onChange={e => setPrioridad(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2">
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
          </div>

          {/* Dependencia/UPP solicitante */}
          <div>
            <label className="text-[10px] font-medium text-gray-700 mb-1 block">Dependencia / UPP solicitante (a quien se responde)</label>
            <input value={uppSearch || depSolicitante} onChange={e => { setUppSearch(e.target.value); setDepSolicitante(e.target.value) }}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2" placeholder="Buscar dependencia o UPP..." />
            {uppSugerencias && uppSugerencias.length > 0 && uppSearch.length >= 2 && (
              <div className="mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                {uppSugerencias.map((u: { codigo_upp: string; nombre_upp: string }) => (
                  <button key={u.codigo_upp} onClick={() => {
                    setDepSolicitante(u.nombre_upp)
                    setUppSolicitanteCodigo(u.codigo_upp)
                    setUppSearch('')
                  }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 border-b border-gray-50">
                    <span className="font-mono text-[10px] text-gray-400">{u.codigo_upp}</span> {u.nombre_upp}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Orden de dirección (multi-dirección) */}
          <div>
            <label className="text-[10px] font-medium text-gray-700 mb-1 block">Posición de esta Dirección en el memorándum</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" name="orden" checked={ordenDireccion === 1} onChange={() => setOrdenDireccion(1)} />
                <span>1ra (Responsable de atender)</span>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="radio" name="orden" checked={ordenDireccion > 1} onChange={() => setOrdenDireccion(2)} />
                <span>2da+ (Solo conocimiento)</span>
              </label>
            </div>
            <p className="text-[9px] text-gray-400 mt-1">Si esta Dirección no es la primera en el orden, se registra automáticamente como documento de conocimiento.</p>
          </div>

          {/* Descripción */}
          <div>
            <label className="text-[10px] font-medium text-gray-700 mb-1 block">Observaciones (opcional)</label>
            <textarea rows={2} value={descripcion} onChange={e => setDescripcion(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 resize-none" placeholder="Notas adicionales..." />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} className="inline mr-1" /> {error}
            </div>
          )}

          </>)}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !asunto.trim()}
            className="px-4 py-2 text-xs rounded-lg font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#911A3A' }}>
            {saving ? 'Registrando...' : 'Registrar memorándum'}
          </button>
        </div>
      </div>
    </div>
  )
}
