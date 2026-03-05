/**
 * Bandejas — Módulo de revisión por lotes.
 *
 * Supervisor (admin/superadmin):
 *   - Ve todos los lotes del cliente
 *   - Puede crear nuevos lotes (auto-selección de DEPPs)
 *   - Puede asignar revisores
 *   - Ve el resumen/progreso de cada lote
 *
 * Revisor/Analista:
 *   - Ve solo sus lotes asignados
 *   - Puede iniciar y trabajar en la revisión
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList, Plus, Play, CheckCircle2, Clock,
  Archive, ChevronRight, Trash2, User, Loader2,
  AlertCircle, X, RefreshCw, BarChart3, FileText,
  Inbox, AlertTriangle,
} from 'lucide-react'
import { lotesApi, type LoteCreate, type LoteListItem } from '../api/lotes'
import { useAuth } from '../hooks/useAuth'
import { formatDateTime, formatCurrency } from '../utils'

// ── Constantes ─────────────────────────────────────────────────────────────────
const GUINDA = '#911A3A'
const GUINDA_DARK = '#6B1029'

const MESES = [
  { v: 1, l: 'Enero' }, { v: 2, l: 'Febrero' }, { v: 3, l: 'Marzo' },
  { v: 4, l: 'Abril' }, { v: 5, l: 'Mayo' }, { v: 6, l: 'Junio' },
  { v: 7, l: 'Julio' }, { v: 8, l: 'Agosto' }, { v: 9, l: 'Septiembre' },
  { v: 10, l: 'Octubre' }, { v: 11, l: 'Noviembre' }, { v: 12, l: 'Diciembre' },
]

const ESTADO_LOTE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pendiente:   { label: 'Pendiente',   cls: 'bg-sky-100 text-sky-700',     icon: <Clock size={11} /> },
  en_revision: { label: 'En Revisión', cls: 'bg-amber-100 text-amber-700', icon: <Play size={11} /> },
  completado:  { label: 'Completado',  cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 size={11} /> },
  archivado:   { label: 'Archivado',   cls: 'bg-gray-100 text-gray-500',   icon: <Archive size={11} /> },
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function Bandejas() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const isSupervisor = user?.rol === 'superadmin' || user?.rol === 'admin_cliente'

  const [filtroEstado, setFiltroEstado] = useState('')
  const [showCrear, setShowCrear] = useState(false)

  // ── Datos ──────────────────────────────────────────────────────────────────
  const { data: lotes, isLoading, isError, refetch } = useQuery({
    queryKey: ['lotes', filtroEstado],
    queryFn: () => lotesApi.listar({ estado: filtroEstado || undefined, ejercicio: 2026 }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lotesApi.eliminar(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lotes'] }),
  })

  // ── Métricas resumen ───────────────────────────────────────────────────────
  const stats = {
    total:       lotes?.length ?? 0,
    pendientes:  lotes?.filter(l => l.estado === 'pendiente').length ?? 0,
    enRevision:  lotes?.filter(l => l.estado === 'en_revision').length ?? 0,
    completados: lotes?.filter(l => l.estado === 'completado').length ?? 0,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-gray-50 p-6">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <ClipboardList size={20} style={{ color: GUINDA }} />
              Bandejas de Revisión
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isSupervisor
                ? 'Gestión de lotes · Crea, asigna y monitorea la revisión de DEPPs'
                : 'Tus lotes asignados · Revisa los DEPPs en orden'
              }
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              className="p-2 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-700 transition-colors"
              title="Actualizar"
            >
              <RefreshCw size={14} />
            </button>
            {isSupervisor && (
              <button
                onClick={() => setShowCrear(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: GUINDA }}
              >
                <Plus size={15} />
                Nuevo Lote
              </button>
            )}
          </div>
        </div>

        {/* ── Stats cards ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4 mt-5">
          {[
            { label: 'Total lotes', v: stats.total,       cls: 'text-gray-900', bg: 'bg-white' },
            { label: 'Pendientes',  v: stats.pendientes,  cls: 'text-sky-700',  bg: 'bg-sky-50' },
            { label: 'En Revisión', v: stats.enRevision,  cls: 'text-amber-700',bg: 'bg-amber-50' },
            { label: 'Completados', v: stats.completados, cls: 'text-green-700',bg: 'bg-green-50' },
          ].map(({ label, v, cls, bg }) => (
            <div key={label} className={`${bg} border border-gray-200 rounded-xl p-4`}>
              <p className="text-xs text-gray-500 font-medium">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${cls}`}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Filtro ─────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto mb-4 flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500">Filtrar:</span>
        {['', 'pendiente', 'en_revision', 'completado', 'archivado'].map((e) => (
          <button
            key={e}
            onClick={() => setFiltroEstado(e)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
              ${filtroEstado === e
                ? 'text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            style={filtroEstado === e ? { backgroundColor: GUINDA, borderColor: GUINDA } : {}}
          >
            {e === '' ? 'Todos' : ESTADO_LOTE[e]?.label ?? e}
          </button>
        ))}
      </div>

      {/* ── Lista de lotes ─────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={32} className="text-red-400 mb-2" />
            <p className="text-sm font-medium text-gray-700">Error al cargar los lotes</p>
            <button onClick={() => refetch()} className="mt-2 text-xs text-blue-600 hover:underline">Reintentar</button>
          </div>
        )}

        {!isLoading && !isError && (!lotes || lotes.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox size={40} className="text-gray-300 mb-3" />
            <p className="text-sm font-semibold text-gray-700">No hay lotes {filtroEstado ? `en estado "${ESTADO_LOTE[filtroEstado]?.label}"` : ''}</p>
            {isSupervisor && (
              <p className="text-xs text-gray-400 mt-1">
                Crea un nuevo lote para comenzar la revisión de DEPPs en bloque
              </p>
            )}
          </div>
        )}

        {lotes && lotes.length > 0 && (
          <div className="space-y-3">
            {lotes.map((lote) => (
              <LoteCard
                key={lote.id}
                lote={lote}
                isSupervisor={isSupervisor}
                onRevisar={() => navigate(`/bandejas/${lote.id}`)}
                onDelete={() => {
                  if (confirm(`¿Eliminar lote "${lote.nombre}"?`)) {
                    deleteMutation.mutate(lote.id)
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modal crear lote ────────────────────────────────────────────────── */}
      {showCrear && (
        <ModalCrearLote
          onClose={() => setShowCrear(false)}
          onCreado={(loteId) => {
            setShowCrear(false)
            navigate(`/bandejas/${loteId}`)
          }}
        />
      )}
    </div>
  )
}

// ── LoteCard ──────────────────────────────────────────────────────────────────

function LoteCard({
  lote, isSupervisor, onRevisar, onDelete,
}: {
  lote: LoteListItem
  isSupervisor: boolean
  onRevisar: () => void
  onDelete: () => void
}) {
  const cfg = ESTADO_LOTE[lote.estado] ?? ESTADO_LOTE.pendiente
  const m = lote.metricas

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-4">
        {/* Ícono */}
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: `${GUINDA}15` }}>
          <ClipboardList size={18} style={{ color: GUINDA }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">{lote.nombre}</h3>
              {lote.descripcion && (
                <p className="text-xs text-gray-500 truncate">{lote.descripcion}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.cls}`}>
                {cfg.icon}{cfg.label}
              </span>
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
            <span>Ejercicio {lote.ejercicio}</span>
            {lote.mes && <span>{MESES.find(m => m.v === lote.mes)?.l}</span>}
            {lote.upp_filtro && <span>UPP: {lote.upp_filtro}</span>}
            <span className="flex items-center gap-1">
              <FileText size={10} />
              {m.total} DEPPs
            </span>
            {lote.revisor_id && (
              <span className="flex items-center gap-1">
                <User size={10} />
                Revisor asignado
              </span>
            )}
            <span>{formatDateTime(lote.creado_en)}</span>
          </div>

          {/* Barra de progreso */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${m.progreso_pct}%`,
                  backgroundColor: m.progreso_pct === 100
                    ? '#16a34a'
                    : m.progreso_pct > 0
                    ? '#f59e0b'
                    : '#d1d5db',
                }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-600 flex-shrink-0 w-10 text-right">
              {m.progreso_pct}%
            </span>
            <div className="flex items-center gap-3 text-xs">
              {m.aprobados > 0 && (
                <span className="text-green-600 font-medium">✓ {m.aprobados}</span>
              )}
              {m.rechazados > 0 && (
                <span className="text-red-600 font-medium">✗ {m.rechazados}</span>
              )}
              {m.pendientes > 0 && (
                <span className="text-gray-400">{m.pendientes} pend.</span>
              )}
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {lote.estado === 'completado' && isSupervisor && (
            <button
              onClick={onRevisar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <BarChart3 size={12} />
              Resumen
            </button>
          )}
          {lote.estado !== 'completado' && lote.estado !== 'archivado' && (
            <button
              onClick={onRevisar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
              style={{ backgroundColor: GUINDA }}
            >
              {lote.estado === 'pendiente' ? <Play size={12} /> : <ChevronRight size={12} />}
              {lote.estado === 'pendiente' ? 'Iniciar' : 'Continuar'}
            </button>
          )}
          {isSupervisor && lote.estado === 'pendiente' && (
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
              title="Eliminar lote"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal Crear Lote ──────────────────────────────────────────────────────────

function ModalCrearLote({
  onClose,
  onCreado,
}: {
  onClose: () => void
  onCreado: (loteId: string) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<LoteCreate>({
    nombre: '',
    descripcion: '',
    tamaño: 10,
    ejercicio: 2026,
    mes: null,
    tipo_tramite: null,
    upp_filtro: null,
    revisor_id: null,
  })

  const crear = useMutation({
    mutationFn: () => lotesApi.crear(form),
    onSuccess: (lote) => {
      qc.invalidateQueries({ queryKey: ['lotes'] })
      onCreado(lote.id)
    },
  })

  const set = <K extends keyof LoteCreate>(k: K, v: LoteCreate[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Plus size={16} style={{ color: GUINDA }} />
            Crear Nuevo Lote de Revisión
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <div className="px-6 py-5 space-y-4">
          {/* Nombre */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Nombre del lote *</label>
            <input
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="ej: Lote MAR-2026 · Viaticos UPP 007"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
            />
          </div>

          {/* Descripción */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Descripción (opcional)</label>
            <input
              value={form.descripcion ?? ''}
              onChange={(e) => set('descripcion', e.target.value || '')}
              placeholder="Observaciones sobre este lote…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
            />
          </div>

          {/* Tamaño + Ejercicio */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Tamaño del lote *</label>
              <div className="flex gap-2">
                {([5, 10, 15] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => set('tamaño', n)}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all
                      ${form.tamaño === n ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    style={form.tamaño === n ? { backgroundColor: GUINDA } : {}}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-1">DEPPs por lote</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Ejercicio *</label>
              <select
                value={form.ejercicio}
                onChange={(e) => set('ejercicio', +e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
              >
                {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Mes + UPP filtro */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Mes (opcional)</label>
              <select
                value={form.mes ?? ''}
                onChange={(e) => set('mes', e.target.value ? +e.target.value : null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
              >
                <option value="">Todos los meses</option>
                {MESES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Filtrar UPP (opcional)</label>
              <input
                value={form.upp_filtro ?? ''}
                onChange={(e) => set('upp_filtro', e.target.value.toUpperCase() || null)}
                placeholder="ej: 007"
                maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
              />
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              El sistema seleccionará automáticamente los DEPPs en estado <strong>En Trámite</strong> o{' '}
              <strong>En Revisión</strong> que no estén asignados a otro lote activo.
            </p>
          </div>

          {/* Error */}
          {crear.isError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {(crear.error as Error)?.message ?? 'Error al crear el lote'}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => crear.mutate()}
            disabled={!form.nombre.trim() || crear.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: GUINDA }}
          >
            {crear.isPending
              ? <><Loader2 size={13} className="animate-spin" />Creando lote…</>
              : <><Plus size={13} />Crear Lote ({form.tamaño} DEPPs)</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
