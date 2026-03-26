import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FolderOpen, Plus, Search, FileText, Trash2, Upload,
  X, CheckCircle2, Clock,
  Wand2, Send, AlertTriangle, Eye, Edit3, RotateCcw,
  ArrowRight, InboxIcon, SendIcon, Building2,
  Download, Shield, BookOpen, FileSignature,
  History, CornerUpLeft, RefreshCw, Lock, Hash, Mail, ChevronLeft,
  ClipboardCheck, ArrowLeftRight,
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
import { clientesApi } from '../api/depps'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Spinner'
import { formatDate, formatDateTime } from '../utils'
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
    <div className="flex items-center gap-0.5">
      {PASOS_RECIBIDO.map((label, i) => {
        const n = i + 1
        const done   = n < step
        const active = n === step
        return (
          <div key={label} className="flex items-center gap-0.5">
            <div className={clsx(
              'w-2 h-2 rounded-full',
              done   ? 'bg-green-500' :
              active ? 'bg-blue-500 ring-2 ring-blue-200' :
                       'bg-gray-200',
            )} title={label} />
            {i < PASOS_RECIBIDO.length - 1 && (
              <div className={clsx('w-4 h-px', done ? 'bg-green-300' : 'bg-gray-200')} />
            )}
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
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: documentosApi.crearRecibido,
    onSuccess: (doc) => { qc.invalidateQueries({ queryKey: ['documentos'] }); onCreated(doc) },
  })
  const clienteId = user?.rol === 'superadmin' ? (clientes?.[0]?.id ?? '') : (user?.cliente_id ?? '')

  // Wizard state
  const [step, setStep] = useState<'upload' | 'crop' | 'processing' | 'review' | 'manual'>('upload')
  const [ocrResult, setOcrResult] = useState<PreviewOCRResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const [form, setForm] = useState<DocumentoRecibidoCreate>({
    cliente_id: clienteId,
    tipo: 'oficio',
    asunto: '',
    numero_oficio_origen: '',
    remitente_nombre: '',
    remitente_cargo: '',
    remitente_dependencia: '',
    fecha_documento: new Date().toISOString().slice(0, 10),
    fecha_recibido: new Date().toISOString().slice(0, 10),
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
      // Pre-fill form with OCR data
      const d = result.datos_extraidos
      setForm(prev => ({
        ...prev,
        asunto: (d.asunto as string) || prev.asunto,
        numero_oficio_origen: (d.numero_oficio as string) || prev.numero_oficio_origen,
        remitente_nombre: (d.remitente_nombre as string) || prev.remitente_nombre,
        remitente_cargo: (d.remitente_cargo as string) || prev.remitente_cargo,
        remitente_dependencia: (d.remitente_dependencia as string) || prev.remitente_dependencia,
        fecha_documento: (d.fecha_documento as string) || prev.fecha_documento,
        descripcion: (d.cuerpo_resumen as string) || prev.descripcion,
        // File info
        nombre_archivo: result.archivo.nombre_archivo,
        url_storage: result.archivo.url_storage,
        mime_type: result.archivo.mime_type,
        // OCR data
        datos_extraidos_ia: result.datos_extraidos,
        ocr_procesado: true,
        // Classification
        sugerencia_area_codigo: (result.clasificacion.area_codigo as string) || undefined,
        sugerencia_area_nombre: (result.clasificacion.area_nombre as string) || undefined,
        sugerencia_fundamento: (result.clasificacion.fundamento as string) || undefined,
        sugerencia_plazo_dias: (result.clasificacion.plazo_dias as number) || undefined,
        confianza_clasificacion: (result.clasificacion.confianza as number) || undefined,
        regla_turno_codigo: (result.clasificacion.regla_codigo as string) || undefined,
        genera_tramite: (result.clasificacion.genera_tramite as string) || undefined,
        fecha_limite: result.fecha_limite || undefined,
        // Auto-prioridad urgente si la IA detecta plazos o remitente crítico
        prioridad: (result.prioridad_sugerida as 'normal' | 'urgente' | 'muy_urgente') || prev.prioridad,
      }))
      setStep('review')
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
              <InboxIcon size={14} style={{ color: GUINDA }} />
            </div>
            <h2 className="font-semibold text-gray-900 text-sm">
              {step === 'upload' ? 'Registrar oficio recibido' :
               step === 'processing' ? 'Procesando documento...' :
               step === 'review' ? 'Revisar datos extraidos' :
               'Captura manual'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-6 py-5">
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
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="SCOP, IMSS, etc."
                    value={form.remitente_dependencia ?? ''} onChange={e => set('remitente_dependencia', e.target.value)} />
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
                  onClick={() => { setStep('upload'); setOcrResult(null); setFileName('') }}
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
                  <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="SCOP, IMSS, etc."
                    value={form.remitente_dependencia ?? ''} onChange={e => set('remitente_dependencia', e.target.value)} />
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
  const [form, setForm] = useState<DocumentoEmitidoCreate>({
    cliente_id: clienteId,
    tipo: 'oficio',
    asunto: '',
    numero_control: '',
    dependencia_origen: 'Dirección de Programación y Presupuesto',
    dependencia_destino: '',
    destinatario_nombre: '',
    destinatario_cargo: '',
    fecha_documento: new Date().toISOString().slice(0, 10),
    estado: 'borrador',
    referencia_elaboro: '',
    referencia_reviso: '',
  })
  const [err, setErr] = useState('')
  const [archivoSubir, setArchivoSubir] = useState<File | null>(null)
  const fileRefModal = useRef<HTMLInputElement>(null)
  const [directoDirector, setDirectoDirector] = useState(false)
  const [yaFirmadoAutografa, setYaFirmadoAutografa] = useState(false)
  const [extrayendoMeta, setExtrayendoMeta] = useState(false)
  const set = (k: keyof DocumentoEmitidoCreate, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  // Auto-generar folio al seleccionar área
  const handleAreaChange = async (codigo: string) => {
    setAreaOrigen(codigo)
    setFolioEditado(false)
    if (!codigo) { setFolioGenerado(''); setPlantillas([]); setPlantillaSel(''); return }
    setCargandoFolio(true)
    try {
      const r = await documentosApi.siguienteFolio('OFICIO', codigo)
      setFolioGenerado(r.folio)
      set('numero_control', r.folio)
    } catch { /* keep empty */ }
    setCargandoFolio(false)
    // Cargar plantillas para el área
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
    const areaInfo = areasDisponibles?.find(a => a.codigo === areaOrigen)
    const folioFinal = folioEditado ? (form.numero_control ?? '') : folioGenerado
    // Si ya tiene firma autógrafa, se registra como firmado directamente
    const estadoInicial = yaFirmadoAutografa ? 'firmado' : 'borrador'
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
                  onChange={e => { const f = e.target.files?.[0]; if (f) setArchivoSubir(f) }} />
                {archivoSubir ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                      <FileText size={18} className="text-blue-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-blue-800 truncate">{archivoSubir.name}</p>
                        <p className="text-[10px] text-blue-600">{(archivoSubir.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <button type="button" onClick={() => setArchivoSubir(null)} className="text-blue-400 hover:text-blue-600">
                        <X size={14} />
                      </button>
                    </div>
                    {!extrayendoMeta && !form.asunto && (
                      <p className="text-[9px] text-blue-500 italic px-1">Al registrar, se extraerán los metadatos automáticamente con IA</p>
                    )}
                    {extrayendoMeta && (
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-blue-600">
                        <RotateCcw size={10} className="animate-spin" /> Extrayendo metadatos del documento...
                      </div>
                    )}
                  </div>
                ) : (
                  <div onClick={() => fileRefModal.current?.click()}
                    className="border-2 border-dashed border-blue-200 rounded-xl py-5 px-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                    <Upload size={22} className="mx-auto mb-2 text-blue-500" />
                    <p className="text-xs font-medium text-gray-700 mb-0.5">Seleccionar archivo</p>
                    <p className="text-[10px] text-gray-400">PDF, Word, JPG, PNG — Max. 20 MB</p>
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
                  <label className="block text-[10px] text-gray-600 mb-1">
                    No. de oficio {cargandoFolio && <span className="text-amber-600">(generando...)</span>}
                  </label>
                  <div className="flex gap-2 items-center">
                    <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                      placeholder="SFA/SF/DPP/SPFP/0001/2026"
                      value={folioEditado ? (form.numero_control ?? '') : folioGenerado}
                      onChange={e => { setFolioEditado(true); set('numero_control', e.target.value) }} />
                    {folioEditado && (
                      <button type="button" onClick={() => { setFolioEditado(false); set('numero_control', folioGenerado) }}
                        className="text-[10px] text-amber-600 hover:text-amber-800 whitespace-nowrap">
                        <RefreshCw size={12} />
                      </button>
                    )}
                  </div>
                  {!folioEditado && folioGenerado && (
                    <p className="text-[10px] text-gray-400 mt-1">Folio auto-generado. Puede editarlo manualmente.</p>
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
            {/* ── Destinatario (3 campos) ── */}
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600 mb-1">Destinatario</p>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Nombre completo</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  placeholder="C.P. Leticia Gálvez"
                  value={form.destinatario_nombre ?? ''} onChange={e => set('destinatario_nombre', e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Cargo</label>
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
  doc, areas, onClose, onRefetch, onDelete,
}: { doc: Documento; areas: AreaDPP[]; onClose: () => void; onRefetch: () => void; onDelete?: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'info' | 'ocr' | 'documento' | 'historial'>('info')
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
  const [fechaAcuse, setFechaAcuse] = useState('')
  const [subiendoAcuse, setSubiendoAcuse] = useState(false)
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
  const isAuditor = user?.rol === 'auditor'
  const isReadOnly = isAuditor
  const canTurnar = isDirector || isSecretaria || isSuperadmin
  const canReasignar = canTurnar || isSubdirector || isJefeDepto  // Áreas pueden redirigir
  const canGenerarRespuesta = isArea || isAsesor || isDirector || isSuperadmin
  const canFirmar = isDirector || isSuperadmin
  const canEnviarParaFirma = isArea || isAsesor || isSecretaria || isSuperadmin
  const canDescargarDocx = isDirector || isSuperadmin
  const canEliminar = isSecretaria || isSuperadmin

  // Auto-cargar original al montar
  useEffect(() => {
    if (doc.url_storage && !originalUrl && !loadingOriginal) {
      setLoadingOriginal(true)
      documentosApi.obtenerArchivoOriginalUrl(doc.id)
        .then(url => setOriginalUrl(url))
        .catch(() => {})
        .finally(() => setLoadingOriginal(false))
    }
  }, [doc.id, doc.url_storage])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['documentos'] })
    qc.invalidateQueries({ queryKey: ['documento', doc.id] })
    onRefetch()
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
  })
  const cambiarTurnoMutation = useMutation({
    mutationFn: ({ cod, nom }: { cod: string; nom: string }) =>
      documentosApi.cambiarTurno(doc.id, cod, nom, instruccionesCambioTurno || undefined),
    onSuccess: () => { invalidate(); setCambiarTurnoOpen(false); setInstruccionesCambioTurno('') },
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
          ...(doc.requiere_respuesta !== false && doc.borrador_respuesta ? ['documento'] : []),
          'historial',
        ] as const).map(t => (
          <button key={t} onClick={() => {
            setTab(t as typeof tab)
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
            {t === 'info' ? 'Datos' : t === 'ocr' ? '🤖 IA' : t === 'documento' ? '📄 Documento' : '📋 Historial'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ── Tab: Info ─────────────────────────────────────────────────────── */}
        {tab === 'info' && (
          <>
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

            {/* ── Visor del oficio original (duplicado en tab Datos) ── */}
            {doc.url_storage && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Eye size={10} /> Documento original
                </p>
                {loadingOriginal ? (
                  <div className="flex items-center justify-center py-6 text-gray-400">
                    <RotateCcw size={14} className="animate-spin mr-2" />
                    <span className="text-xs">Cargando…</span>
                  </div>
                ) : originalUrl ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 450 }}>
                    <iframe src={originalUrl} title="Oficio original" className="w-full h-full" style={{ border: 'none' }} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-4 bg-gray-50 rounded-lg">
                    <button onClick={() => {
                      setLoadingOriginal(true)
                      documentosApi.obtenerArchivoOriginalUrl(doc.id)
                        .then(url => setOriginalUrl(url))
                        .catch(() => {})
                        .finally(() => setLoadingOriginal(false))
                    }}
                      className="text-xs text-gray-500 underline hover:text-gray-700">Cargar documento</button>
                  </div>
                )}
                {doc.nombre_archivo && (
                  <p className="text-[10px] text-gray-400 text-center truncate">{doc.nombre_archivo}</p>
                )}
              </div>
            )}

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
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500">Fecha oficio</p>
                <p className="text-xs font-medium text-gray-800">{doc.fecha_documento ? formatDate(doc.fecha_documento) : '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500">Recibido en DPP</p>
                <p className="text-xs font-medium text-gray-800">{doc.fecha_recibido ? formatDate(doc.fecha_recibido) : '—'}</p>
              </div>
            </div>

            {doc.fecha_limite && (
              <div className="flex items-center gap-2 bg-amber-50 rounded-lg px-3 py-2">
                <Clock size={13} className="text-amber-600 flex-shrink-0" />
                <div>
                  <p className="text-[10px] text-amber-700">Fecha límite de atención</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-amber-800">{formatDate(doc.fecha_limite)}</p>
                    <SemaforoAtencion fecha={doc.fecha_limite} estado={doc.estado} />
                  </div>
                </div>
              </div>
            )}

            {/* Área de turno */}
            <div>
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
                        {areas.map(a => (
                          <option key={a.codigo} value={a.codigo}>{a.nombre}</option>
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
                    {areas.map(a => (
                      <option key={a.codigo} value={a.codigo}>{a.nombre}</option>
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

            {/* Pipeline */}
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Estado del trámite</p>
              <PipelineRecibido estado={doc.estado} />
              <div className="flex gap-1 mt-2 flex-wrap">
                {(['en_atencion', 'respondido', ...(!doc.requiere_respuesta ? ['de_conocimiento'] : [])] as string[]).map(e => (
                  <button key={e} onClick={() => estadoMutation.mutate(e)}
                    disabled={doc.estado === e}
                    className={clsx(
                      'text-[10px] px-2 py-1 rounded-full border transition-colors',
                      doc.estado === e ? 'border-gray-300 bg-gray-100 text-gray-500 cursor-default'
                        : e === 'de_conocimiento' ? 'border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}>
                    {ESTADO_RECIBIDO_CONFIG[e as EstadoRecibido]?.label ?? e}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Tab: IA (Oficio original + Generación con instrucciones) ──── */}
        {tab === 'ocr' && (
          <>
            {/* ── Visor del oficio original (turnado) ── */}
            {doc.url_storage && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Eye size={10} /> Oficio original (turnado)
                  </p>
                  {originalUrl && (
                    <button onClick={() => setVisorFlotante('original')}
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-medium border border-gray-200 text-gray-500 hover:bg-gray-50"
                      title="Abrir en ventana flotante">
                      <FolderOpen size={9} /> Ampliar
                    </button>
                  )}
                </div>
                {loadingOriginal ? (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <RotateCcw size={16} className="animate-spin mr-2" />
                    <span className="text-xs">Cargando documento original...</span>
                  </div>
                ) : originalUrl ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 450 }}>
                    <iframe src={originalUrl} title="Oficio original" className="w-full h-full" style={{ border: 'none' }} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 bg-gray-50 rounded-lg">
                    <button onClick={() => {
                      setLoadingOriginal(true)
                      documentosApi.obtenerArchivoOriginalUrl(doc.id)
                        .then(url => setOriginalUrl(url))
                        .catch(() => {})
                        .finally(() => setLoadingOriginal(false))
                    }}
                      className="text-xs text-gray-500 underline hover:text-gray-700">Cargar documento original</button>
                  </div>
                )}
                {doc.nombre_archivo && (
                  <p className="text-[10px] text-gray-400 text-center truncate">{doc.nombre_archivo}</p>
                )}
              </div>
            )}

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

            {/* Reemplazar scan (si ya tiene archivo) */}
            {doc.url_storage && (
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

            {/* ── Generación de respuesta con IA (solo Área + Director + Super) ── */}
            {canGenerarRespuesta && (
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
            {canGenerarRespuesta && (
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

            {/* Secretaría: solo puede ver el borrador, no generar */}
            {isSecretaria && !doc.borrador_respuesta && (
              <div className="text-center py-4 text-gray-400">
                <p className="text-xs">El área responsable generará la respuesta al oficio.</p>
              </div>
            )}

            {/* ── Borrador generado (visible para todos los roles) ── */}
            {doc.borrador_respuesta && (
              <>
                {/* Datos del oficio de respuesta (editable solo por área/director/super) */}
                {canGenerarRespuesta && (
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
                {canGenerarRespuesta && (
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

                {/* Texto del borrador */}
                {editBorrador && canGenerarRespuesta ? (
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
                ) : (
                  <div className="space-y-2">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{doc.borrador_respuesta}</p>
                    </div>
                    {canGenerarRespuesta && (
                      <button onClick={() => { setEditBorrador(true); setBorradorText(doc.borrador_respuesta ?? '') }}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                        <Edit3 size={11} /> Editar borrador
                      </button>
                    )}
                  </div>
                )}

                {/* ── Acciones según rol ── */}
                <div className="space-y-2 pt-1">
                  {/* Descargar DOCX — solo Director y Administrador */}
                  {canDescargarDocx && (
                    <button onClick={handleDescargarOficio} disabled={descargando}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-lg font-medium text-white transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                      {descargando
                        ? <><RotateCcw size={12} className="animate-spin" /> Generando DOCX...</>
                        : <><Download size={12} /> Descargar oficio (.docx)</>}
                    </button>
                  )}

                  {doc.firmado_digitalmente ? (
                    <div className="flex items-center justify-center gap-2 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span className="text-xs font-medium text-emerald-700">Documento firmado electrónicamente</span>
                    </div>
                  ) : doc.estado === 'respondido' && !canFirmar ? (
                    <div className="flex items-center justify-center gap-2 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <Clock size={14} className="text-amber-600" />
                      <span className="text-xs font-medium text-amber-700">Enviado para firma del Director</span>
                    </div>
                  ) : canFirmar ? (
                    <button onClick={() => setShowFirmaModal(true)}
                      disabled={!['en_atencion', 'respondido', 'borrador', 'en_revision', 'turnado'].includes(doc.estado)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-lg font-medium border transition-colors disabled:opacity-50"
                      style={{ borderColor: GUINDA, color: GUINDA }}>
                      <FileSignature size={12} /> Firmar documento
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
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                      style={{ backgroundColor: GUINDA }}>
                      {enviandoFirma
                        ? <><RotateCcw size={12} className="animate-spin" /> Enviando...</>
                        : <><Send size={12} /> Enviar para firma del Director</>}
                    </button>

                  ) : null}

                  {/* Toast confirmación de envío a firma */}
                  {enviadoFirmaOk && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg animate-pulse">
                      <CheckCircle2 size={14} className="text-emerald-600" />
                      <span className="text-xs font-medium text-emerald-700">Oficio enviado para firma del Director</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Datos extraídos (resumen compacto) */}
            {doc.ocr_procesado && datosIA && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Datos extraídos por IA</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['No. oficio', datosIA['numero_oficio']],
                    ['Fecha', datosIA['fecha_documento']],
                    ['Remitente', datosIA['remitente_nombre']],
                    ['Dependencia', datosIA['remitente_dependencia']],
                  ] as [string, unknown][]).filter(([, val]) => !!val).map(([label, val]) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-2 py-1.5">
                      <span className="text-[9px] text-gray-500">{label}</span>
                      <p className="text-[10px] text-gray-800 font-medium truncate">{String(val)}</p>
                    </div>
                  ))}
                </div>
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
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={13} className="text-blue-600" />
                    <span className="text-[10px] font-semibold text-blue-800 uppercase tracking-wide">Acuse de recibido</span>
                  </div>
                  {doc.acuse_recibido_url ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-blue-100">
                        <FileText size={11} className="text-blue-500" />
                        <span className="text-[10px] text-blue-700 flex-1 truncate">{doc.acuse_recibido_nombre}</span>
                        {doc.acuse_recibido_fecha && <span className="text-[9px] text-blue-500">{doc.acuse_recibido_fecha}</span>}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={async () => {
                          const url = await documentosApi.obtenerAcuseRecibidoUrl(doc.id)
                          window.open(url, '_blank')
                        }} className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
                          <Eye size={10} /> Ver acuse
                        </button>
                        <button onClick={async () => {
                          if (!window.confirm('¿Eliminar acuse de recibido?')) return
                          await documentosApi.eliminarAcuseRecibido(doc.id)
                          invalidate()
                        }} className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] rounded border border-red-200 text-red-600 hover:bg-red-50">
                          <X size={10} /> Eliminar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[9px] text-blue-600">Suba el escaneo del oficio con sello de acuse de la dependencia destino</p>
                      <div className="flex gap-1.5">
                        <input type="text" placeholder="Fecha del acuse" value={fechaAcuse}
                          onChange={e => setFechaAcuse(e.target.value)}
                          className="flex-1 px-2 py-1 text-[10px] rounded border border-blue-200 focus:ring-1 focus:ring-blue-400" />
                      </div>
                      <label className="flex items-center justify-center gap-1.5 py-2 text-[10px] rounded-lg font-medium border-2 border-dashed border-blue-300 text-blue-700 hover:bg-blue-100 cursor-pointer transition-colors">
                        <Upload size={11} /> Subir escaneo de acuse (PDF/imagen)
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={async (e) => {
                          const f = e.target.files?.[0]
                          if (!f) return
                          try {
                            setSubiendoAcuse(true)
                            await documentosApi.subirAcuseRecibido(doc.id, f, fechaAcuse)
                            setFechaAcuse('')
                            invalidate()
                          } catch (err) { window.alert('Error al subir acuse: ' + ((err as any)?.response?.data?.detail || 'Intente de nuevo'))
                          } finally { setSubiendoAcuse(false) }
                        }} />
                      </label>
                      {subiendoAcuse && (
                        <div className="flex items-center justify-center gap-1.5 py-1 text-[10px] text-blue-600">
                          <RotateCcw size={10} className="animate-spin" /> Subiendo acuse...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Acuse visible para todos (solo lectura) */}
              {!(isSecretaria || isSuperadmin) && doc.acuse_recibido_url && (
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
          ) : ['en_atencion', 'respondido'].includes(doc.estado) && doc.borrador_respuesta ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                {isDirector ? (
                  <button onClick={() => setShowFirmaModal(true)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg text-white font-semibold transition-colors hover:opacity-90"
                    style={{ backgroundColor: GUINDA }}>
                    <FileSignature size={13} /> Firmar documento
                  </button>
                ) : (
                  <button onClick={async () => {
                    try { await documentosApi.cambiarEstado(doc.id, 'respondido' as never); invalidate() } catch (e) { window.alert('Error al enviar a firma: ' + ((e as any)?.response?.data?.detail || 'Intente de nuevo')) }
                  }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs rounded-lg text-white font-semibold transition-colors hover:opacity-90"
                    style={{ backgroundColor: GUINDA }}>
                    <Send size={13} /> Enviar a firma del Director
                  </button>
                )}
              </div>
              {isDirector && (
                <button onClick={() => { setObservacionesDevolucion(''); setShowDevolucionModal(true) }}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-lg font-medium bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 transition-colors">
                  <AlertTriangle size={12} /> Devolver para correcciones
                </button>
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
                      {isDirector && (
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
  const canGenerar = isSecretaria || isAsesor || isArea || isDirector || isSuperadmin
  const canFirmar = isDirector || isSuperadmin
  const canEnviarParaFirma = isSecretaria || isAsesor || isArea || isSuperadmin
  const canDescargarDocx = isDirector || isSuperadmin
  const canEliminar = isSecretaria || isSuperadmin
  const canEditar = doc.estado === 'borrador' || (doc.estado === 'en_revision' && canFirmar)

  // Auto-cargar original al montar
  useEffect(() => {
    if (doc.url_storage && !originalUrl && !loadingOriginal) {
      setLoadingOriginal(true)
      documentosApi.obtenerArchivoOriginalUrl(doc.id)
        .then(url => setOriginalUrl(url))
        .catch(() => {})
        .finally(() => setLoadingOriginal(false))
    }
  }, [doc.id, doc.url_storage])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['documentos'] })
    qc.invalidateQueries({ queryKey: ['documento', doc.id] })
    onRefetch()
  }

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
                    <div className="flex items-center justify-center py-6 text-gray-400">
                      <RotateCcw size={14} className="animate-spin mr-2" />
                      <span className="text-xs">Cargando...</span>
                    </div>
                  ) : originalUrl ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ height: 220 }}>
                      <iframe src={originalUrl} title="Documento adjunto" className="w-full h-full" style={{ border: 'none' }} />
                    </div>
                  ) : null}
                  {canEditar && (
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
  const [tab, setTab] = useState<'recibidos' | 'emitidos' | 'oficios'>('recibidos')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroArea, setFiltroArea] = useState('')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [showDateFilters, setShowDateFilters] = useState(false)
  const [showModalRecibido, setShowModalRecibido] = useState(false)
  const [showModalEmitido, setShowModalEmitido] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Modal edición rápida (secretaria)
  const [editDocId, setEditDocId] = useState<string | null>(null)
  // Multi-select para firma por lote
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showFirmaLote, setShowFirmaLote] = useState(false)
  // Certificado e.firma
  const [showCertModal, setShowCertModal] = useState(false)
  // Roles
  const isDirector = user?.rol === 'admin_cliente' || user?.rol === 'superadmin'
  const isSecretaria = user?.rol === 'secretaria'
  const isReadOnly = user?.rol === 'auditor'

  // Debounce de búsqueda (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setBusquedaDebounced(busqueda), 300)
    return () => clearTimeout(timer)
  }, [busqueda])

  const params = {
    flujo:      tab === 'recibidos' ? 'recibido' : 'emitido',
    busqueda:   busquedaDebounced || undefined,
    estado:     filtroEstado || undefined,
    area_turno: filtroArea || undefined,
    fecha_desde: fechaDesde || undefined,
    fecha_hasta: fechaHasta || undefined,
  }

  const { data: docs, isLoading, refetch } = useQuery({
    queryKey: ['documentos', params],
    queryFn:  () => documentosApi.list(params),
  })

  const { data: areas = [] } = useQuery({
    queryKey: ['areas-dpp'],
    queryFn:  documentosApi.areas,
  })

  const { data: selectedDoc } = useQuery({
    queryKey: ['documento', selectedId],
    queryFn:  () => selectedId ? documentosApi.get(selectedId) : null,
    enabled:  !!selectedId,
  })

  const deleteMutation = useMutation({
    mutationFn: documentosApi.delete,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['documentos'] }); setSelectedId(null) },
  })

  // Certificado e.firma status
  const { data: certStatus } = useQuery<CertificadoInfo>({
    queryKey: ['mi-certificado'],
    queryFn: certificadosApi.miCertificado,
  })
  const tieneCert = certStatus?.tiene_certificado ?? false
  const certVigente = certStatus?.vigente ?? false
  const certProximoVencer = (() => {
    if (!certStatus?.valido_hasta) return false
    const diasRestantes = Math.ceil((new Date(certStatus.valido_hasta).getTime() - Date.now()) / 86400000)
    return diasRestantes > 0 && diasRestantes <= 30
  })()

  // Métricas recibidos
  const porEstado = (e: string) => docs?.filter(d => d.estado === e).length ?? 0
  const urgentes  = docs?.filter(d => d.prioridad !== 'normal').length ?? 0

  if (isLoading) return <PageSpinner />

  return (
    <div className="flex h-full bg-gray-50">
      {/* ── Panel izquierdo (lista) — oculto cuando hay detalle seleccionado */}
      <div className={clsx('flex flex-col', selectedId ? 'hidden' : 'flex-1')}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
                <FolderOpen size={16} style={{ color: GUINDA }} />
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">Gestión Documental</h1>
                <p className="text-[10px] text-gray-500">Correspondencia institucional DPP</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Indicador e.firma — solo Director */}
              {isDirector && (
                <button
                  onClick={() => setShowCertModal(true)}
                  className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] rounded-lg font-medium border transition-colors',
                    tieneCert && certVigente && !certProximoVencer
                      ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                      : tieneCert && certProximoVencer
                      ? 'border-yellow-200 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                      : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
                  )}
                  title={tieneCert ? 'Ver certificado e.firma' : 'Registrar certificado e.firma'}>
                  <Shield size={11} />
                  {tieneCert && certVigente && !certProximoVencer
                    ? 'e.firma vigente'
                    : tieneCert && certProximoVencer
                    ? 'e.firma por vencer'
                    : 'e.firma no configurada'}
                </button>
              )}

              {tab === 'recibidos' && isDirector && (
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
              {tab !== 'oficios' && !isReadOnly && (
                <Button size="sm" onClick={() => tab === 'recibidos' ? setShowModalRecibido(true) : setShowModalEmitido(true)}>
                  <Plus size={13} />
                  {tab === 'recibidos' ? 'Registrar recibido' : 'Nuevo emitido'}
                </Button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0">
            {([['recibidos', 'Correspondencia recibida', InboxIcon], ['emitidos', 'Documentos emitidos', SendIcon], ['oficios', 'Control de Oficios', Mail]] as const).map(([key, label, Icon]) => (
              <button key={key}
                onClick={() => { setTab(key); setSelectedId(null); setFiltroEstado(''); setFiltroArea('') }}
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
        ) : (<>

        {/* Métricas rápidas */}
        {tab === 'recibidos' ? (
          <div className="grid grid-cols-6 gap-2 px-4 py-2 bg-white border-b border-gray-100">
            {[
              { label: 'Recibidos',   val: porEstado('recibido'),    color: '#3b82f6' },
              { label: 'Turnados',    val: porEstado('turnado'),     color: '#f59e0b' },
              { label: 'En atención', val: porEstado('en_atencion'), color: '#a855f7' },
              { label: 'Firmados',    val: porEstado('firmado'),     color: '#10b981' },
              { label: 'Devueltos',   val: porEstado('devuelto'),    color: '#dc2626' },
              { label: 'Urgentes',    val: urgentes,                 color: '#ef4444' },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-center">
                <p className="text-lg font-bold" style={{ color }}>{val}</p>
                <p className="text-[9px] text-gray-500 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-4 py-2 bg-white border-b border-gray-100">
            {[
              { label: 'Borradores',  val: porEstado('borrador'),    color: '#d97706' },
              { label: 'En revisión', val: porEstado('en_revision'), color: '#a855f7' },
              { label: 'Vigentes',    val: porEstado('vigente'),     color: '#10b981' },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-center">
                <p className="text-lg font-bold" style={{ color }}>{val}</p>
                <p className="text-[9px] text-gray-500 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        )}

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
                      refetch()
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

            {/* Alerta director: turnados de conocimiento */}
            {(() => {
              const turnadosConocimiento = docs?.filter(d => d.estado === 'turnado' && !d.requiere_respuesta) ?? []
              if (!isDirector || turnadosConocimiento.length === 0) return null
              return (
                <button onClick={() => setFiltroEstado('turnado')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-left hover:bg-blue-100 transition-colors">
                  <BookOpen size={14} className="text-blue-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-blue-700">{turnadosConocimiento.length} oficio{turnadosConocimiento.length !== 1 ? 's' : ''} turnado{turnadosConocimiento.length !== 1 ? 's' : ''} para conocimiento</span>
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
            <select className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
              value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="">Estado</option>
              {tab === 'recibidos'
                ? ['recibido','turnado','en_atencion','devuelto','respondido','firmado','de_conocimiento'].map(e => (
                    <option key={e} value={e}>{ESTADO_RECIBIDO_CONFIG[e as keyof typeof ESTADO_RECIBIDO_CONFIG]?.label ?? e}</option>
                  ))
                : ['borrador','en_revision','vigente'].map(e => (
                    <option key={e} value={e}>{ESTADO_EMITIDO_CONFIG[e as keyof typeof ESTADO_EMITIDO_CONFIG]?.label ?? e}</option>
                  ))
              }
            </select>
            {tab === 'recibidos' && (
              <select className="px-2 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
                value={filtroArea} onChange={e => setFiltroArea(e.target.value)}>
                <option value="">Área</option>
                {areas.map(a => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.titular.split(' ')[0]}</option>)}
              </select>
            )}
            <button onClick={() => setShowDateFilters(!showDateFilters)}
              className={clsx('px-2 py-1.5 text-xs border rounded-lg transition-colors',
                showDateFilters || fechaDesde || fechaHasta
                  ? 'border-[#911A3A]/30 bg-[#FDF2F4] text-[#911A3A]'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50')}>
              <Clock size={12} />
            </button>
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
          {docs && (busquedaDebounced || filtroEstado || filtroArea || fechaDesde || fechaHasta) && (
            <p className="text-[10px] text-gray-500">
              {docs.length} documento{docs.length !== 1 ? 's' : ''} encontrado{docs.length !== 1 ? 's' : ''}
              {busquedaDebounced && <> para "<strong>{busquedaDebounced}</strong>"</>}
            </p>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {!docs || docs.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
                {tab === 'recibidos' ? <InboxIcon size={22} style={{ color: GUINDA }} /> : <SendIcon size={22} style={{ color: GUINDA }} />}
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">
                {busqueda || filtroEstado || filtroArea ? 'Sin resultados' : tab === 'recibidos' ? 'Sin correspondencia recibida' : 'Sin documentos emitidos'}
              </p>
              <p className="text-xs text-gray-500 mb-3">
                {busqueda || filtroEstado || filtroArea
                  ? 'Ajusta los filtros de búsqueda'
                  : tab === 'recibidos' ? 'Registra el primer oficio recibido' : 'Crea el primer documento emitido'}
              </p>
              {!busqueda && !filtroEstado && !filtroArea && (
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
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {multiSelectMode && <th className="px-2 py-2 w-8" />}
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">No. Oficio</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Asunto</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Remitente</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Area</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Atención</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                      {(user?.rol === 'secretaria' || user?.rol === 'superadmin') && (
                        <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {docs.map(doc => {
                      const cfg = ESTADO_RECIBIDO_CONFIG[doc.estado as keyof typeof ESTADO_RECIBIDO_CONFIG]
                      const canSelect = (doc.estado === 'en_atencion' || doc.estado === 'respondido') && doc.has_borrador === true && !doc.firmado_digitalmente
                      const isToday = doc.fecha_recibido === new Date().toISOString().slice(0, 10) || doc.creado_en?.slice(0, 10) === new Date().toISOString().slice(0, 10)
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
                            } else {
                              setSelectedId(doc.id === selectedId ? null : doc.id)
                            }
                          }}
                          className={clsx(
                            'cursor-pointer transition-colors',
                            doc.id === selectedId ? 'bg-[#FDF8F9]' : isToday ? 'bg-blue-50/30 hover:bg-blue-50/60' : 'hover:bg-gray-50',
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
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <PrioridadBadge prioridad={doc.prioridad} />
                              <span className="font-mono text-[10px] text-gray-600 truncate max-w-[120px]">
                                {doc.numero_oficio_origen || '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-xs font-medium text-gray-900 truncate max-w-[200px] leading-tight">{doc.asunto}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-[10px] text-gray-600 truncate max-w-[120px]">
                              {doc.remitente_dependencia || doc.remitente_nombre || '—'}
                            </p>
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="text-[10px] text-gray-500 truncate max-w-[100px]">
                              {doc.area_turno_nombre ? doc.area_turno_nombre.replace(/^(Departamento|Subdirección|Dirección)\s+de\s+/i, '') : '—'}
                            </p>
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
                            <SemaforoAtencion fecha={doc.fecha_limite} estado={doc.estado} />
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">
                              {doc.fecha_recibido ? formatDate(doc.fecha_recibido) : doc.creado_en ? formatDate(doc.creado_en) : '—'}
                            </span>
                          </td>
                          {(user?.rol === 'secretaria' || user?.rol === 'superadmin') && (
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {!doc.firmado_digitalmente && (
                                  <>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditDocId(doc.id) }}
                                      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors"
                                      title="Modificar registro">
                                      <Edit3 size={10} />
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (window.confirm(`¿Eliminar "${doc.asunto}"? Esta acción no se puede deshacer.`))
                                          deleteMutation.mutate(doc.id)
                                      }}
                                      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-1 rounded font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors"
                                      title="Eliminar documento">
                                      <Trash2 size={10} />
                                    </button>
                                  </>
                                )}
                                {doc.firmado_digitalmente && <span className="text-[9px] text-gray-300">—</span>}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                  <p className="text-[10px] text-gray-500">{docs.length} documento{docs.length !== 1 ? 's' : ''}</p>
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
            /* Tabla simple para emitidos */
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-2 bg-gray-50 border-b border-gray-100">
                {['', 'DOCUMENTO', 'FECHA', 'ESTADO'].map(h => (
                  <p key={h} className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{h}</p>
                ))}
              </div>
              {docs.map(doc => {
                const cfg = ESTADO_EMITIDO_CONFIG[doc.estado as keyof typeof ESTADO_EMITIDO_CONFIG]
                return (
                  <div key={doc.id}
                    onClick={() => setSelectedId(doc.id === selectedId ? null : doc.id)}
                    className={clsx(
                      'grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors items-center',
                      doc.id === selectedId ? 'bg-[#FDF8F9]' : 'hover:bg-gray-50',
                    )}>
                    <span className="text-base">{TIPO_ICONS[doc.tipo]}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{doc.asunto}</p>
                      <p className="text-[10px] text-gray-400 truncate">{doc.numero_control || doc.dependencia_destino || '—'}</p>
                    </div>
                    <p className="text-xs text-gray-500">{doc.fecha_documento ? formatDate(doc.fecha_documento) : '—'}</p>
                    {cfg && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    )}
                  </div>
                )
              })}
              <div className="px-4 py-2 bg-gray-50">
                <p className="text-[10px] text-gray-500">{docs.length} documento{docs.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
          )}
        </div>
        </>)}
      </div>

      {/* ── Panel detalle (full-width cuando hay selección) ────────────────── */}
      {selectedId && selectedDoc && (
        <div className="flex-1 flex flex-col min-w-0">
          {selectedDoc.flujo === 'recibido' ? (
            <PanelRecibido
              doc={selectedDoc}
              areas={areas}
              onClose={() => setSelectedId(null)}
              onRefetch={refetch}
              onDelete={() => { if (window.confirm('¿Eliminar este documento? Esta acción no se puede deshacer.')) deleteMutation.mutate(selectedDoc.id) }}
            />
          ) : (
            <PanelEmitido
              doc={selectedDoc}
              areas={areas}
              onClose={() => setSelectedId(null)}
              onRefetch={refetch}
              onDelete={() => { if (window.confirm('¿Eliminar este documento?')) deleteMutation.mutate(selectedDoc.id) }}
            />
          )}
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
          onCreated={doc => { setShowModalRecibido(false); setSelectedId(doc.id) }}
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
    </div>
  )
}
