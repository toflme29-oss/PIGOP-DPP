/**
 * RevisionLote — UI de revisión rápida de un lote de DEPPs.
 *
 * Atajos de teclado:
 *   A → Aprobar DEPP actual
 *   R → Rechazar DEPP actual
 *   O → Omitir DEPP actual
 *   → / N → Siguiente ítem
 *   ← / P → Ítem anterior
 *   Escape → Volver a bandejas
 *
 * Flujo:
 *   1. Carga el lote completo
 *   2. Inicia automáticamente (PATCH estado → en_revision) si está pendiente
 *   3. Para cada ítem: muestra info del DEPP + formulario de dictamen
 *   4. Al dictaminar: POST /lotes/{id}/items/{itemId}/revisar
 *   5. Avanza automáticamente al siguiente ítem
 *   6. Al terminar todos: muestra resumen y enlace a bandejas
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, MinusCircle, ArrowLeft, ArrowRight,
  Keyboard, Clock, BarChart3, FileText, AlertTriangle,
  Loader2, ChevronLeft, CheckCheck, User, Building,
  AlertCircle, Play,
} from 'lucide-react'
import { lotesApi, type Lote, type LoteItem } from '../api/lotes'
import { formatCurrency, GRAVEDAD_CONFIG, getValidacionLabel } from '../utils'

// ── Constantes ─────────────────────────────────────────────────────────────────
const GUINDA = '#911A3A'

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

// ── Componente principal ───────────────────────────────────────────────────────

export default function RevisionLote() {
  const { loteId } = useParams<{ loteId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // ── Estado local ───────────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx] = useState(0)
  const [observaciones, setObservaciones] = useState('')
  const [showAtajos, setShowAtajos] = useState(false)
  const [timerStart, setTimerStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const obsRef = useRef<HTMLTextAreaElement>(null)

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (timerStart) setElapsed(Math.floor((Date.now() - timerStart) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [timerStart])

  const fmtTimer = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── Datos ──────────────────────────────────────────────────────────────────
  const { data: lote, isLoading, isError } = useQuery({
    queryKey: ['lote', loteId],
    queryFn: () => lotesApi.obtener(loteId!),
    staleTime: 5_000,
    refetchInterval: 10_000,
    enabled: !!loteId,
  })

  // ── Iniciar lote si está pendiente ─────────────────────────────────────────
  const iniciarMutation = useMutation({
    mutationFn: () => lotesApi.iniciar(loteId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lote', loteId] }),
  })

  useEffect(() => {
    if (lote?.estado === 'pendiente' && !iniciarMutation.isPending) {
      iniciarMutation.mutate()
    }
  }, [lote?.estado])

  // Saltar al primer ítem pendiente al cargar
  useEffect(() => {
    if (lote?.items) {
      const firstPending = lote.items.findIndex(i => i.estado === 'pendiente')
      if (firstPending >= 0 && currentIdx === 0) {
        setCurrentIdx(firstPending)
        setTimerStart(Date.now())
        setElapsed(0)
      }
    }
  }, [lote?.items?.length])

  // ── Ítem actual ────────────────────────────────────────────────────────────
  const items = lote?.items ?? []
  const currentItem: LoteItem | undefined = items[currentIdx]
  const depp = currentItem?.depp

  // Navegar entre ítems
  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= items.length) return
    setCurrentIdx(idx)
    setObservaciones('')
    setTimerStart(Date.now())
    setElapsed(0)
    obsRef.current?.blur()
  }, [items.length])

  // ── Dictaminar ítem ────────────────────────────────────────────────────────
  const revisarMutation = useMutation({
    mutationFn: (body: { estado: 'aprobado' | 'rechazado' | 'omitido' }) =>
      lotesApi.revisarItem(loteId!, currentItem!.id, {
        estado: body.estado,
        observaciones: observaciones.trim() || null,
        tiempo_seg: elapsed || null,
      }),
    onSuccess: (updatedLote) => {
      qc.setQueryData(['lote', loteId], updatedLote)
      // Avanzar automáticamente al siguiente ítem pendiente
      const nextPending = updatedLote.items.findIndex(
        (i, idx) => idx > currentIdx && i.estado === 'pendiente'
      )
      if (nextPending >= 0) {
        goTo(nextPending)
      } else {
        // Buscar cualquier pendiente desde el inicio
        const anyPending = updatedLote.items.findIndex(i => i.estado === 'pendiente')
        if (anyPending >= 0) goTo(anyPending)
        else goTo(currentIdx) // Ya terminó, quedarse aquí para ver resumen
      }
    },
  })

  const aprobar  = () => !revisarMutation.isPending && revisarMutation.mutate({ estado: 'aprobado' })
  const rechazar = () => !revisarMutation.isPending && revisarMutation.mutate({ estado: 'rechazado' })
  const omitir   = () => !revisarMutation.isPending && revisarMutation.mutate({ estado: 'omitido' })

  // ── Atajos de teclado ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignorar si el foco está en el textarea
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (e.key === 'a' || e.key === 'A') aprobar()
      if (e.key === 'r' || e.key === 'R') rechazar()
      if (e.key === 'o' || e.key === 'O') omitir()
      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') goTo(currentIdx + 1)
      if (e.key === 'ArrowLeft'  || e.key === 'p' || e.key === 'P') goTo(currentIdx - 1)
      if (e.key === 'Escape') navigate('/bandejas')
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentIdx, revisarMutation.isPending, aprobar, rechazar, omitir, goTo])

  // ── Métricas globales ──────────────────────────────────────────────────────
  const m = lote?.metricas
  const completado = lote?.estado === 'completado'

  // ── Estados de carga ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-full bg-gray-50 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    )
  }

  if (isError || !lote) {
    return (
      <div className="min-h-full bg-gray-50 flex flex-col items-center justify-center gap-3">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm text-gray-600">No se pudo cargar el lote</p>
        <Link to="/bandejas" className="text-xs text-blue-600 hover:underline">Volver a Bandejas</Link>
      </div>
    )
  }

  // ── Vista lote completado ──────────────────────────────────────────────────
  if (completado) {
    return <VistaCompletado lote={lote} onVolver={() => navigate('/bandejas')} />
  }

  // ── Vista principal de revisión ────────────────────────────────────────────
  return (
    <div className="min-h-full bg-gray-100 flex flex-col">
      {/* ── Header de revisión ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/bandejas')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft size={14} />
            Bandejas
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <div>
            <h1 className="text-sm font-bold text-gray-900">{lote.nombre}</h1>
            <p className="text-xs text-gray-500">Ejercicio {lote.ejercicio}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Timer */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
            <Clock size={13} />
            <span>{fmtTimer(elapsed)}</span>
          </div>

          {/* Progreso */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">{m?.revisados ?? 0} / {m?.total ?? 0}</span>
            <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${m?.progreso_pct ?? 0}%`, backgroundColor: GUINDA }}
              />
            </div>
            <span className="font-semibold" style={{ color: GUINDA }}>{m?.progreso_pct ?? 0}%</span>
          </div>

          {/* Atajos */}
          <button
            onClick={() => setShowAtajos(!showAtajos)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <Keyboard size={12} />
            Atajos
          </button>
        </div>
      </header>

      {/* Atajos panel */}
      {showAtajos && (
        <div className="bg-gray-900 text-white px-6 py-3 flex items-center gap-6 text-xs">
          {[
            { key: 'A', label: 'Aprobar' },
            { key: 'R', label: 'Rechazar' },
            { key: 'O', label: 'Omitir' },
            { key: '→ / N', label: 'Siguiente' },
            { key: '← / P', label: 'Anterior' },
            { key: 'Esc', label: 'Salir' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <kbd className="px-2 py-0.5 bg-white/10 rounded font-mono font-bold">{key}</kbd>
              <span className="text-white/60">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Cuerpo ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Panel izquierdo: cola de ítems ─────────────────────────────── */}
        <aside className="w-56 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 px-1">
              Cola de revisión
            </p>
            {items.map((item, idx) => {
              const esActivo = idx === currentIdx
              const estadoIcon = {
                aprobado:   <CheckCircle2 size={12} className="text-green-500" />,
                rechazado:  <XCircle      size={12} className="text-red-500" />,
                omitido:    <MinusCircle  size={12} className="text-gray-400" />,
                en_revision:<Loader2      size={12} className="text-amber-500 animate-spin" />,
                pendiente:  <div className="w-3 h-3 rounded-full border-2 border-gray-300" />,
              }[item.estado] ?? null
              return (
                <button
                  key={item.id}
                  onClick={() => goTo(idx)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-all ${
                    esActivo
                      ? 'text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  style={esActivo ? { backgroundColor: GUINDA } : {}}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold">#{item.orden}</span>
                    {estadoIcon}
                  </div>
                  <p className={`text-[10px] truncate mt-0.5 ${esActivo ? 'text-white/80' : 'text-gray-500'}`}>
                    {item.depp?.folio ?? '—'}
                  </p>
                </button>
              )
            })}
          </div>
        </aside>

        {/* ── Panel central: info del DEPP ───────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-5">
          {!currentItem || !depp ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p className="text-sm">Selecciona un ítem de la cola</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-4">
              {/* Número e identificación */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Ítem {currentItem.orden} de {items.length}
                      </span>
                      <ItemEstadoBadge estado={currentItem.estado} />
                    </div>
                    <h2 className="text-lg font-bold font-mono text-gray-900">{depp.folio}</h2>
                  </div>
                  {depp.validado_automaticamente && (
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                      <CheckCheck size={12} />
                      Validado IA
                    </div>
                  )}
                </div>

                {/* Datos clave */}
                <div className="grid grid-cols-2 gap-3">
                  <DataItem icon={<Building size={13} />} label="UPP" value={depp.upp} />
                  <DataItem icon={<FileText size={13} />}   label="Clasificador" value={depp.clasificador_tipo ?? '—'} />
                  <DataItem
                    icon={<BarChart3 size={13} />}
                    label="Monto total"
                    value={formatCurrency(depp.monto_total)}
                    large
                  />
                  <DataItem icon={<User size={13} />} label="Beneficiario" value={depp.beneficiario ?? '—'} />
                  {depp.capitulo && (
                    <DataItem label="Capítulo" value={`${depp.capitulo}`} />
                  )}
                  {depp.mes && (
                    <DataItem label="Mes" value={MESES_CORTO[(depp.mes ?? 1) - 1]} />
                  )}
                </div>
              </div>

              {/* Validaciones */}
              {depp.validaciones_resumen && depp.validaciones_resumen.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                    Validaciones ({depp.validaciones_resumen.length})
                  </h3>
                  <div className="space-y-2">
                    {depp.validaciones_resumen.map((v, i) => {
                      const colorMap: Record<string, string> = {
                        exitosa:     'bg-green-50 border-green-200 text-green-800',
                        advertencia: 'bg-amber-50 border-amber-200 text-amber-800',
                        error:       'bg-red-50 border-red-200 text-red-800',
                        no_aplica:   'bg-gray-50 border-gray-200 text-gray-600',
                      }
                      const resultIcon: Record<string, React.ReactNode> = {
                        exitosa:     <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />,
                        advertencia: <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />,
                        error:       <XCircle      size={12} className="text-red-500 flex-shrink-0" />,
                        no_aplica:   <MinusCircle  size={12} className="text-gray-400 flex-shrink-0" />,
                      }
                      return (
                        <div key={i}
                          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs
                            ${colorMap[v.resultado] ?? 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                          {resultIcon[v.resultado]}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{getValidacionLabel(v.tipo)}</span>
                              {v.gravedad && (
                                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                                  GRAVEDAD_CONFIG[v.gravedad as keyof typeof GRAVEDAD_CONFIG]?.color ?? 'bg-gray-100 text-gray-600'
                                }`}>
                                  {GRAVEDAD_CONFIG[v.gravedad as keyof typeof GRAVEDAD_CONFIG]?.label ?? v.gravedad}
                                </span>
                              )}
                            </div>
                            {v.mensaje && <p className="mt-0.5 opacity-80 truncate">{v.mensaje}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── Panel derecho: formulario de dictamen ───────────────────────── */}
        <aside className="w-72 bg-white border-l border-gray-200 flex flex-col flex-shrink-0">
          <div className="p-5 flex-1 flex flex-col">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-4">
              Dictamen del Revisor
            </h3>

            {currentItem?.estado !== 'pendiente' && currentItem?.estado !== 'en_revision' ? (
              /* Ítem ya dictaminado */
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                <ItemEstadoBadge estado={currentItem?.estado ?? ''} large />
                {currentItem?.observaciones && (
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 text-left w-full">
                    {currentItem.observaciones}
                  </p>
                )}
                {currentItem?.tiempo_seg && (
                  <p className="text-[10px] text-gray-400">
                    Revisado en {fmtTimer(currentItem.tiempo_seg)}
                  </p>
                )}
                <p className="text-xs text-gray-400">Este DEPP ya fue dictaminado</p>
              </div>
            ) : (
              /* Formulario activo */
              <div className="flex-1 flex flex-col gap-4">
                {/* Botones de dictamen */}
                <div className="space-y-2">
                  <button
                    onClick={aprobar}
                    disabled={revisarMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border-2 transition-all font-semibold text-sm
                      border-green-300 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-400
                      disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 size={18} />
                      Aprobar DEPP
                    </div>
                    <kbd className="text-[10px] font-mono bg-green-200 text-green-700 px-1.5 py-0.5 rounded">A</kbd>
                  </button>

                  <button
                    onClick={rechazar}
                    disabled={revisarMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border-2 transition-all font-semibold text-sm
                      border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-400
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <XCircle size={18} />
                      Rechazar DEPP
                    </div>
                    <kbd className="text-[10px] font-mono bg-red-200 text-red-700 px-1.5 py-0.5 rounded">R</kbd>
                  </button>

                  <button
                    onClick={omitir}
                    disabled={revisarMutation.isPending}
                    className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border-2 transition-all font-semibold text-sm
                      border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <MinusCircle size={18} />
                      Omitir
                    </div>
                    <kbd className="text-[10px] font-mono bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">O</kbd>
                  </button>
                </div>

                {/* Observaciones */}
                <div className="flex-1">
                  <label className="text-xs font-semibold text-gray-600 block mb-1">
                    Observaciones / Motivo (opcional)
                  </label>
                  <textarea
                    ref={obsRef}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Ej: Factura con RFC incorrecto, falta MCL, montos no coinciden…"
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
                  />
                </div>

                {/* Error */}
                {revisarMutation.isError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                    {(revisarMutation.error as Error)?.message ?? 'Error al registrar el dictamen'}
                  </div>
                )}

                {revisarMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                    <Loader2 size={13} className="animate-spin" />
                    Guardando dictamen…
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navegación inferior */}
          <div className="border-t border-gray-100 p-4 flex items-center justify-between gap-3">
            <button
              onClick={() => goTo(currentIdx - 1)}
              disabled={currentIdx === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600
                hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeft size={13} />
              Anterior
            </button>
            <span className="text-xs text-gray-400">{currentIdx + 1} / {items.length}</span>
            <button
              onClick={() => goTo(currentIdx + 1)}
              disabled={currentIdx >= items.length - 1}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600
                hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente
              <ArrowRight size={13} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function DataItem({ icon, label, value, large }: {
  icon?: React.ReactNode
  label: string
  value: string
  large?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon && <span className="text-gray-400">{icon}</span>}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
      </div>
      <p className={`font-semibold text-gray-900 ${large ? 'text-base' : 'text-sm'} truncate`}>{value}</p>
    </div>
  )
}

function ItemEstadoBadge({ estado, large }: { estado: string; large?: boolean }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pendiente:   { label: 'Pendiente',   cls: 'bg-gray-100 text-gray-500',    icon: <div className="w-3 h-3 rounded-full border-2 border-gray-400" /> },
    en_revision: { label: 'En Revisión', cls: 'bg-amber-100 text-amber-700',  icon: <Loader2 size={12} className="animate-spin" /> },
    aprobado:    { label: 'Aprobado',    cls: 'bg-green-100 text-green-700',  icon: <CheckCircle2 size={12} /> },
    rechazado:   { label: 'Rechazado',   cls: 'bg-red-100 text-red-700',      icon: <XCircle size={12} /> },
    omitido:     { label: 'Omitido',     cls: 'bg-gray-100 text-gray-500',    icon: <MinusCircle size={12} /> },
  }
  const cfg = map[estado] ?? map.pendiente
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold ${large ? 'text-sm' : 'text-xs'} ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  )
}

// ── Vista de lote completado ──────────────────────────────────────────────────

function VistaCompletado({ lote, onVolver }: { lote: Lote; onVolver: () => void }) {
  const m = lote.metricas
  const fmtTimer = (s: number | null) => {
    if (!s) return '—'
    const h = Math.floor(s / 3600)
    const min = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${min}m`
    return `${min}m ${sec}s`
  }
  return (
    <div className="min-h-full bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 max-w-2xl w-full">
        {/* Ícono */}
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCheck size={32} className="text-green-500" />
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-1">
          Lote completado
        </h2>
        <p className="text-sm text-gray-500 text-center mb-6">{lote.nombre}</p>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-700">{m.aprobados}</p>
            <p className="text-xs text-green-600 font-medium mt-1">Aprobados</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{m.rechazados}</p>
            <p className="text-xs text-red-500 font-medium mt-1">Rechazados</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-500">{m.omitidos}</p>
            <p className="text-xs text-gray-400 font-medium mt-1">Omitidos</p>
          </div>
        </div>

        {/* Info adicional */}
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-around text-center mb-6">
          <div>
            <p className="text-xs text-gray-500">Total revisados</p>
            <p className="text-lg font-bold text-gray-800">{m.revisados} / {m.total}</p>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div>
            <p className="text-xs text-gray-500">Tiempo total</p>
            <p className="text-lg font-bold text-gray-800">{fmtTimer(m.tiempo_total_seg)}</p>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div>
            <p className="text-xs text-gray-500">Ejercicio</p>
            <p className="text-lg font-bold text-gray-800">{lote.ejercicio}</p>
          </div>
        </div>

        {/* Items resumen */}
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-6">
          <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 border-b border-gray-200">
            Detalle por DEPP
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
            {lote.items.map((item) => {
              const iconMap: Record<string, React.ReactNode> = {
                aprobado:  <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />,
                rechazado: <XCircle      size={13} className="text-red-500 flex-shrink-0" />,
                omitido:   <MinusCircle  size={13} className="text-gray-400 flex-shrink-0" />,
                pendiente: <div className="w-3 h-3 rounded-full border-2 border-gray-300 flex-shrink-0" />,
              }
              return (
                <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                  <span className="text-gray-400 font-mono w-4 flex-shrink-0">#{item.orden}</span>
                  {iconMap[item.estado]}
                  <span className="font-mono font-medium text-gray-700 flex-1 truncate">
                    {item.depp?.folio ?? '—'}
                  </span>
                  <span className="text-gray-400">{item.depp?.upp}</span>
                  {item.observaciones && (
                    <span className="text-gray-400 truncate max-w-[140px]" title={item.observaciones}>
                      {item.observaciones}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Acciones */}
        <div className="flex justify-center gap-3">
          <button
            onClick={onVolver}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: GUINDA }}
          >
            <ChevronLeft size={15} />
            Volver a Bandejas
          </button>
        </div>
      </div>
    </div>
  )
}
