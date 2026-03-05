import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Plus, RefreshCw, Search, Filter,
  ShieldCheck, CheckCircle2, XCircle, AlertTriangle,
  Clock, DollarSign, ChevronRight, Trash2, FileX,
} from 'lucide-react'
import { deppsApi, clientesApi } from '../api/depps'
import { useAuth } from '../hooks/useAuth'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'
import {
  formatCurrency, formatDate,
  ESTADO_CONFIG, CLASIFICACION_LABELS, CAPITULO_LABELS
} from '../utils'
import { UPPBadge } from '../components/UPPBadge'
import type { EstadoDEPP, DEPPCreate } from '../types'

// Colores institucionales
const GUINDA = '#911A3A'

// Flujo oficial: en_tramite → en_revision → aprobado | rechazado
const ESTADO_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  en_revision:    'warning',
  aprobado:       'success',
  rechazado:      'error',
  // Legacy → mismo color que en_revision
  en_tramite:     'warning',
  borrador:       'warning',
  en_validacion:  'warning',
  observado:      'error',
  pagado:         'success',
}

// ── Modal Crear DEPP ───────────────────────────────────────────────────────────
function ModalCrearDEPP({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { user } = useAuth()
  const { data: clientes } = useQuery({
    queryKey: ['clientes'],
    queryFn: clientesApi.list,
  })
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: deppsApi.create,
    onSuccess: (depp) => {
      qc.invalidateQueries({ queryKey: ['depps'] })
      onCreated(depp.id)
    },
  })

  const [form, setForm] = useState<DEPPCreate>({
    folio: '',
    cliente_id: clientes?.[0]?.id ?? '',
    upp: user?.rol === 'superadmin' ? 'DPP' : '',
    ejercicio: 2026,
    monto_total: undefined,
    beneficiario: '',
    capitulo: undefined,
  })
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.folio.trim()) { setError('El folio es obligatorio.'); return }
    try {
      await mutation.mutateAsync({
        ...form,
        cliente_id: form.cliente_id || clientes?.[0]?.id || '',
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string | Array<{msg:string}> } } })?.response?.data?.detail
      if (Array.isArray(msg)) setError(msg.map(e => e.msg).join(', '))
      else setError(typeof msg === 'string' ? msg : 'Error al crear el DEPP.')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Nuevo DEPP</h2>
            <p className="text-xs text-gray-500">Documento de Ejecución Presupuestaria y Pago</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Folio *</label>
              <input
                required
                value={form.folio}
                onChange={e => setForm(f => ({...f, folio: e.target.value}))}
                placeholder="2026-DPP-001"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
              />
            </div>
            {user?.rol === 'superadmin' && clientes && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Cliente / Dependencia</label>
                <select
                  value={form.cliente_id}
                  onChange={e => setForm(f => ({...f, cliente_id: e.target.value}))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                >
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">UPP *</label>
              <input
                required
                value={form.upp}
                onChange={e => setForm(f => ({...f, upp: e.target.value}))}
                placeholder="DPP"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ejercicio *</label>
              <input
                type="number"
                required
                value={form.ejercicio}
                onChange={e => setForm(f => ({...f, ejercicio: parseInt(e.target.value)}))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Proveedor / Beneficiario</label>
              <input
                value={form.beneficiario ?? ''}
                onChange={e => setForm(f => ({...f, beneficiario: e.target.value}))}
                placeholder="Nombre del proveedor o beneficiario"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monto total ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.monto_total ?? ''}
                onChange={e => setForm(f => ({...f, monto_total: e.target.value ? parseFloat(e.target.value) : undefined}))}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Capítulo</label>
              <select
                value={form.capitulo ?? ''}
                onChange={e => setForm(f => ({...f, capitulo: e.target.value ? parseInt(e.target.value) : undefined}))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
              >
                <option value="">— Seleccionar capítulo —</option>
                {Object.entries(CAPITULO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancelar</Button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-60 transition-all"
              style={{ backgroundColor: GUINDA }}
            >
              {mutation.isPending ? 'Creando...' : 'Crear DEPP'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Dashboard principal ───────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [showModal, setShowModal] = useState(false)

  const { data: depps, isLoading, isError } = useQuery({
    queryKey: ['depps', filtroEstado],
    queryFn: () => deppsApi.list({ estado: filtroEstado || undefined, limit: 200 }),
    refetchInterval: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deppsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['depps'] }),
  })

  const filtered = (depps ?? []).filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      d.folio.toLowerCase().includes(q) ||
      d.upp.toLowerCase().includes(q) ||
      (d.beneficiario ?? '').toLowerCase().includes(q)
    )
  })

  // Métricas de resumen
  const totales = {
    total:     depps?.length ?? 0,
    aprobados: depps?.filter(d => d.estado === 'aprobado').length ?? 0,
    rechazados: depps?.filter(d => d.estado === 'rechazado' || d.estado === 'observado').length ?? 0,
    pendientes: depps?.filter(d => d.estado === 'en_revision').length ?? 0,
    monto:     depps?.reduce((s, d) => s + Number(d.monto_total ?? 0), 0) ?? 0,
  }

  if (isLoading) return <PageSpinner label="Cargando expedientes..." />

  return (
    <div className="p-6 space-y-5">
      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total de expedientes',
            value: totales.total,
            icon: ShieldCheck,
            iconColor: GUINDA,
            iconBg: '#FDF2F4',
          },
          {
            label: 'Aprobados',
            value: totales.aprobados,
            icon: CheckCircle2,
            iconColor: '#15803d',
            iconBg: '#f0fdf4',
          },
          {
            label: 'Rechazados',
            value: totales.rechazados,
            icon: XCircle,
            iconColor: '#dc2626',
            iconBg: '#fff1f2',
          },
          {
            label: 'Monto total ejercido',
            value: formatCurrency(totales.monto),
            icon: DollarSign,
            iconColor: '#7c3aed',
            iconBg: '#f5f3ff',
            isText: true,
          },
        ].map(({ label, value, icon: Icon, iconColor, iconBg, isText }) => (
          <Card key={label} className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: iconBg }}>
              <Icon size={20} style={{ color: iconColor }} />
            </div>
            <div>
              <p className="text-xs text-gray-500 leading-tight">{label}</p>
              <p className={`font-bold text-gray-900 leading-tight ${isText ? 'text-base mt-0.5' : 'text-2xl'}`}>
                {value}
              </p>
            </div>
          </Card>
        ))}
      </div>

      {/* Filtros y acciones */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por folio, UPP o proveedor/beneficiario..."
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 bg-white"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-2 bg-white">
            <Filter size={13} className="text-gray-400" />
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="text-sm text-gray-700 focus:outline-none bg-transparent"
            >
              <option value="">Todos los estados</option>
              <option value="en_revision">🔍 En Revisión</option>
              <option value="aprobado">✓ Aprobado</option>
              <option value="rechazado">✗ Rechazado</option>
            </select>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={() => qc.invalidateQueries({ queryKey: ['depps'] })}
          >
            Actualizar
          </Button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-semibold rounded-lg transition-all shadow-sm"
            style={{ backgroundColor: GUINDA }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7B1535' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = GUINDA }}
          >
            <Plus size={15} />
            Nuevo DEPP
          </button>
        </div>
      </div>

      {/* Tabla */}
      <Card padding={false} className="overflow-hidden">
        {isError ? (
          <div className="p-8 text-center text-gray-500">
            Error al cargar los expedientes. Verifica la conexión con el servidor.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileX size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">
              {search || filtroEstado
                ? 'No se encontraron DEPPs con los filtros aplicados.'
                : 'No hay expedientes registrados. Crea el primero.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {[
                    { label: 'Folio / Ejercicio',    align: 'left'   },
                    { label: 'UPP · Proveedor',      align: 'left'   },
                    { label: 'Clasificación',         align: 'left'   },
                    { label: 'Monto total',           align: 'right'  },
                    { label: 'Estado',                align: 'center' },
                    { label: 'Registro',              align: 'left'   },
                    { label: '',                      align: 'right'  },
                  ].map(({ label, align }) => (
                    <th
                      key={label}
                      className={`px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide text-${align}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((depp) => (
                  <tr
                    key={depp.id}
                    className="hover:bg-red-50/30 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/depps/${depp.id}`)}
                  >
                    {/* Folio */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ESTADO_CONFIG[depp.estado]?.dot ?? 'bg-gray-400'}`} />
                        <span className="font-mono font-semibold text-gray-900 text-xs">{depp.folio}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 ml-4 mt-0.5">Ej. {depp.ejercicio}</p>
                    </td>

                    {/* UPP · Proveedor */}
                    <td className="px-4 py-3">
                      <UPPBadge codigo={depp.upp} showNombre showClasificacion={false} />
                      {depp.beneficiario && (
                        <p className="text-[10px] text-gray-400 truncate max-w-[200px] mt-1">{depp.beneficiario}</p>
                      )}
                    </td>

                    {/* Clasificación */}
                    <td className="px-4 py-3">
                      {depp.clasificador_tipo ? (
                        <Badge variant="info">{depp.clasificador_tipo}</Badge>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                      {depp.capitulo && (
                        <p className="text-[10px] text-gray-400 mt-0.5">Cap. {depp.capitulo}</p>
                      )}
                    </td>

                    {/* Monto */}
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-gray-900 text-xs">
                        {formatCurrency(depp.monto_total)}
                      </span>
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3 text-center">
                      <Badge variant={ESTADO_VARIANT[depp.estado]}>
                        {ESTADO_CONFIG[depp.estado]?.label ?? depp.estado}
                      </Badge>
                      {depp.validado_automaticamente && (
                        <div className="flex justify-center mt-1">
                          {depp.puede_aprobar
                            ? <CheckCircle2 size={11} className="text-green-500" />
                            : <AlertTriangle size={11} className="text-amber-500" />
                          }
                        </div>
                      )}
                    </td>

                    {/* Fecha registro */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Clock size={10} />
                        {formatDate(depp.creado_en)}
                      </div>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {depp.estado === 'en_tramite' && (
                          <button
                            onClick={() => {
                              if (confirm(`¿Eliminar el expediente ${depp.folio}?`)) {
                                deleteMutation.mutate(depp.id)
                              }
                            }}
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Eliminar expediente (solo en trámite)"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                        <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pie de tabla */}
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                {filtered.length} de {depps?.length ?? 0} expediente{(depps?.length ?? 0) !== 1 ? 's' : ''}
                {(search || filtroEstado) ? ' (filtrado)' : ''}
              </p>
              <p className="text-[11px] text-gray-400">
                Dirección de Programación y Presupuesto · Ejercicio {new Date().getFullYear()}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Modal */}
      {showModal && (
        <ModalCrearDEPP
          onClose={() => setShowModal(false)}
          onCreated={(id) => { setShowModal(false); navigate(`/depps/${id}`) }}
        />
      )}
    </div>
  )
}
