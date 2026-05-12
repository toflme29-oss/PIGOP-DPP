import { useRef, useState } from 'react'
import { X, Upload, Bug, Lightbulb, HelpCircle, CheckCircle, ImageIcon, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { feedbackApi, type TipoFeedback } from '../api/feedback'
import { useAuth } from '../hooks/useAuth'
import { useLocation } from 'react-router-dom'

// Mapa de rutas → nombre de módulo legible
const RUTA_A_MODULO: Record<string, string> = {
  '/': 'Inicio / Dashboard',
  '/depps': 'Validación DEPP',
  '/gestion-documental': 'Gestión Documental',
  '/certificaciones': 'Certificaciones',
  '/bandejas': 'Bandejas de Revisión',
  '/minutas': 'Minutas de Conciliación',
  '/revision-documental': 'Revisión Documental',
  '/admin': 'Administración',
  '/sap-import': 'Importación SAP',
}

const TIPOS: { value: TipoFeedback; label: string; desc: string; icon: typeof Bug; color: string }[] = [
  { value: 'bug',     label: 'Error / Problema',      desc: 'Algo no funciona correctamente',   icon: Bug,         color: 'border-red-300 bg-red-50 text-red-700 hover:border-red-400' },
  { value: 'mejora',  label: 'Mejora / Sugerencia',   desc: 'Propuesta para mejorar el sistema', icon: Lightbulb,   color: 'border-yellow-300 bg-yellow-50 text-yellow-700 hover:border-yellow-400' },
  { value: 'consulta',label: 'Consulta / Duda',       desc: 'Pregunta o solicitud de apoyo',     icon: HelpCircle,  color: 'border-blue-300 bg-blue-50 text-blue-700 hover:border-blue-400' },
]

interface Props {
  onClose: () => void
}

export default function FeedbackModal({ onClose }: Props) {
  const { user } = useAuth()
  const location = useLocation()
  const fileRef = useRef<HTMLInputElement>(null)

  // Detectar módulo actual
  const moduloActual = Object.entries(RUTA_A_MODULO).find(([ruta]) =>
    ruta === '/' ? location.pathname === '/' : location.pathname.startsWith(ruta)
  )?.[1] ?? 'General'

  const [tipo, setTipo] = useState<TipoFeedback>('bug')
  const [modulo, setModulo] = useState(moduloActual)
  const [descripcion, setDescripcion] = useState('')
  const [captura, setCaptura] = useState<File | null>(null)
  const [capturaPreview, setCapturaPreview] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState('')

  const handleCaptura = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCaptura(f)
    const url = URL.createObjectURL(f)
    setCapturaPreview(url)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!descripcion.trim()) { setError('La descripción es obligatoria'); return }
    setError('')
    setEnviando(true)
    try {
      await feedbackApi.enviar({ modulo, tipo, descripcion: descripcion.trim(), captura })
      setEnviado(true)
    } catch {
      setError('No se pudo enviar el reporte. Intente de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (enviado) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">¡Reporte enviado!</h2>
          <p className="text-sm text-gray-500 mb-6">Gracias por tu comentario. Lo revisaremos y tomaremos las acciones necesarias.</p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#6B1029] text-white font-medium text-sm hover:bg-[#8B1535] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-gray-900">💬 Reportar / Sugerir</h2>
            <p className="text-xs text-gray-500 mt-0.5">Tu feedback nos ayuda a mejorar el sistema</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Info del usuario (solo lectura) */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#6B1029]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-[#6B1029]">
                {(user as any)?.nombre_completo?.charAt(0)?.toUpperCase() ?? '?'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{(user as any)?.nombre_completo ?? (user as any)?.email ?? 'Usuario'}</p>
              <p className="text-xs text-gray-400">{(user as any)?.area_codigo ? `Área: ${(user as any).area_codigo}` : 'Sin área asignada'}</p>
            </div>
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Tipo de reporte</label>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map(t => {
                const Icon = t.icon
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTipo(t.value)}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center',
                      tipo === t.value ? t.color + ' border-opacity-100' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                    )}
                  >
                    <Icon size={18} />
                    <span className="text-[10px] font-semibold leading-tight">{t.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{TIPOS.find(t => t.value === tipo)?.desc}</p>
          </div>

          {/* Módulo */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Módulo / Sección</label>
            <select
              value={modulo}
              onChange={e => setModulo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1029]/30 focus:border-[#6B1029]"
            >
              {Object.values(RUTA_A_MODULO).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="General">General / Otro</option>
            </select>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Descripción <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={descripcion}
              onChange={e => { setDescripcion(e.target.value); setError('') }}
              placeholder={
                tipo === 'bug'
                  ? 'Describe qué pasó, qué esperabas que sucediera y los pasos para reproducirlo...'
                  : tipo === 'mejora'
                  ? 'Describe qué mejora propones y cómo beneficiaría el uso del sistema...'
                  : 'Escribe tu pregunta o qué necesitas aclarar...'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#6B1029]/30 focus:border-[#6B1029]"
            />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>

          {/* Captura de pantalla */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Captura de pantalla <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleCaptura} />

            {capturaPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={capturaPreview} alt="Captura" className="w-full max-h-48 object-contain" />
                <button
                  type="button"
                  onClick={() => { setCaptura(null); setCapturaPreview(null) }}
                  className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-red-50"
                >
                  <X size={14} className="text-gray-600" />
                </button>
                <p className="text-[10px] text-gray-500 px-3 py-1.5 truncate">{captura?.name}</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 px-4 flex flex-col items-center gap-2 text-gray-400 hover:border-gray-300 hover:bg-gray-50 transition-all"
              >
                <div className="flex items-center gap-2">
                  <ImageIcon size={18} />
                  <Upload size={14} />
                </div>
                <span className="text-xs">Clic para adjuntar una captura</span>
                <span className="text-[10px]">PNG, JPG, WEBP</span>
              </button>
            )}
          </div>

          {/* Botones */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviando || !descripcion.trim()}
              className="flex-1 py-2.5 rounded-xl bg-[#6B1029] text-white text-sm font-medium hover:bg-[#8B1535] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {enviando ? <><Loader2 size={14} className="animate-spin" /> Enviando…</> : '📤 Enviar reporte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
