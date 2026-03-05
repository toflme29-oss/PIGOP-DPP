/**
 * Admin — Panel de Administración del Sistema PIGOP
 *
 * Tabs:
 *   - Usuarios: crear, editar rol, activar/desactivar
 *   - Clientes: dependencias registradas en el sistema
 *
 * Acceso: superadmin y admin_cliente
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Building2, Plus, ToggleLeft, ToggleRight,
  Shield, UserCheck, Eye, Loader2, X, AlertCircle,
  KeyRound, RefreshCw, Search, ChevronDown,
} from 'lucide-react'
import {
  usuariosApi, clientesAdminApi,
  ROL_LABELS, ROL_COLORS, TIPO_CLIENTE_LABELS,
  type UsuarioAdmin, type ClienteAdmin,
  type UsuarioCreate, type ClienteCreate,
} from '../api/usuarios'
import { useAuth } from '../hooks/useAuth'
import { formatDate } from '../utils'

// ── Constantes ─────────────────────────────────────────────────────────────────
const GUINDA = '#911A3A'
const ROLES = ['superadmin', 'admin_cliente', 'analista', 'consulta'] as const
const TIPOS_CLIENTE = ['centralizada', 'paraestatal', 'autonoma', 'poder'] as const

// ── Helpers ────────────────────────────────────────────────────────────────────

function RolBadge({ rol }: { rol: string }) {
  const c = ROL_COLORS[rol] ?? { bg: '#f9fafb', text: '#6b7280' }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ backgroundColor: c.bg, color: c.text }}>
      {ROL_LABELS[rol] ?? rol}
    </span>
  )
}

function EstadoBadge({ activo }: { activo: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
      activo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${activo ? 'bg-green-500' : 'bg-gray-400'}`} />
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

// ── Tabla de Usuarios ──────────────────────────────────────────────────────────

function TablaUsuarios({
  usuarios,
  clientes,
  isSuperadmin,
  currentUserId,
  onToggle,
  onCambiarRol,
}: {
  usuarios: UsuarioAdmin[]
  clientes: ClienteAdmin[]
  isSuperadmin: boolean
  currentUserId: string
  onToggle: (u: UsuarioAdmin) => void
  onCambiarRol: (u: UsuarioAdmin, rol: string) => void
}) {
  const [openRol, setOpenRol] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = usuarios.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.email.toLowerCase().includes(q) ||
      (u.nombre_completo ?? '').toLowerCase().includes(q)
    )
  })

  const getClienteNombre = (clienteId: string | null) => {
    if (!clienteId) return null
    return clientes.find(c => c.id === clienteId)?.nombre ?? clienteId.slice(0, 8) + '…'
  }

  return (
    <div>
      {/* Barra de búsqueda */}
      <div className="mb-4 relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1"
          style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Usuario
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Rol
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Cliente / Dependencia
              </th>
              <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Estado
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Último acceso
              </th>
              <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                {/* Nombre + email */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                         style={{ backgroundColor: GUINDA }}>
                      {(u.nombre_completo ?? u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-900">
                        {u.nombre_completo ?? '—'}
                        {u.id === currentUserId && (
                          <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            Tú
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400">{u.email}</p>
                    </div>
                  </div>
                </td>

                {/* Rol con dropdown */}
                <td className="px-4 py-3">
                  {isSuperadmin && u.id !== currentUserId ? (
                    <div className="relative">
                      <button
                        onClick={() => setOpenRol(openRol === u.id ? null : u.id)}
                        className="flex items-center gap-1 group"
                        title="Cambiar rol"
                      >
                        <RolBadge rol={u.rol} />
                        <ChevronDown size={11} className="text-gray-400 group-hover:text-gray-600" />
                      </button>
                      {openRol === u.id && (
                        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[180px]">
                          {ROLES.map(r => (
                            <button
                              key={r}
                              onClick={() => { onCambiarRol(u, r); setOpenRol(null) }}
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                            >
                              {r === u.rol && <span className="text-green-500">✓</span>}
                              <RolBadge rol={r} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <RolBadge rol={u.rol} />
                  )}
                </td>

                {/* Cliente */}
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">
                    {getClienteNombre(u.cliente_id) ?? (
                      <span className="text-gray-300">—</span>
                    )}
                  </span>
                </td>

                {/* Estado */}
                <td className="px-4 py-3 text-center">
                  <EstadoBadge activo={u.activo} />
                </td>

                {/* Último acceso */}
                <td className="px-4 py-3">
                  <span className="text-[11px] text-gray-400">
                    {u.ultimo_acceso ? formatDate(u.ultimo_acceso) : 'Nunca'}
                  </span>
                </td>

                {/* Acciones */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {u.id !== currentUserId && (
                      <button
                        onClick={() => onToggle(u)}
                        title={u.activo ? 'Desactivar usuario' : 'Activar usuario'}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors"
                        style={u.activo
                          ? { borderColor: '#fecaca', color: '#dc2626', backgroundColor: '#fff1f2' }
                          : { borderColor: '#bbf7d0', color: '#15803d', backgroundColor: '#f0fdf4' }
                        }
                      >
                        {u.activo
                          ? <><ToggleLeft size={12} />Desactivar</>
                          : <><ToggleRight size={12} />Activar</>
                        }
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
                  {search ? 'No se encontraron usuarios con esa búsqueda.' : 'No hay usuarios registrados.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <p className="text-[11px] text-gray-400">
            {filtered.length} de {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Tabla de Clientes ──────────────────────────────────────────────────────────

function TablaClientes({ clientes }: { clientes: ClienteAdmin[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Código UPP
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Nombre / Dependencia
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Tipo
            </th>
            <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Estado
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Registrado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {clientes.map(c => (
            <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">
                  {c.codigo_upp}
                </span>
              </td>
              <td className="px-4 py-3">
                <p className="text-xs font-semibold text-gray-900">{c.nombre}</p>
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-gray-500">
                  {TIPO_CLIENTE_LABELS[c.tipo ?? ''] ?? c.tipo ?? '—'}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <EstadoBadge activo={c.activo} />
              </td>
              <td className="px-4 py-3">
                <span className="text-[11px] text-gray-400">{formatDate(c.creado_en)}</span>
              </td>
            </tr>
          ))}
          {clientes.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                No hay clientes registrados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
        <p className="text-[11px] text-gray-400">
          {clientes.length} cliente{clientes.length !== 1 ? 's' : ''} registrado{clientes.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  )
}

// ── Modal: Crear Usuario ───────────────────────────────────────────────────────

function ModalCrearUsuario({
  clientes,
  isSuperadmin,
  currentClienteId,
  onClose,
  onCreado,
}: {
  clientes: ClienteAdmin[]
  isSuperadmin: boolean
  currentClienteId: string | null
  onClose: () => void
  onCreado: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<UsuarioCreate>({
    email: '',
    nombre_completo: '',
    rol: 'analista',
    password: '',
    cliente_id: currentClienteId ?? (clientes[0]?.id ?? null),
    activo: true,
  })
  const [error, setError] = useState('')
  const [showPass, setShowPass] = useState(false)

  const crear = useMutation({
    mutationFn: () => usuariosApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-usuarios'] })
      onCreado()
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string | { msg: string }[] } } })?.response?.data?.detail
      if (Array.isArray(msg)) setError(msg.map(m => m.msg).join(', '))
      else setError(typeof msg === 'string' ? msg : 'Error al crear usuario.')
    },
  })

  const set = <K extends keyof UsuarioCreate>(k: K, v: UsuarioCreate[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <UserCheck size={16} style={{ color: GUINDA }} />
            Crear nuevo usuario
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Nombre completo *</label>
            <input
              value={form.nombre_completo}
              onChange={e => set('nombre_completo', e.target.value)}
              placeholder="Ej: María García López"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Email institucional *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="usuario@michoacan.gob.mx"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Contraseña temporal *</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="Mín. 8 caracteres"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1"
              />
              <button
                type="button"
                onClick={() => setShowPass(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <KeyRound size={13} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">El usuario deberá cambiarla en su primer acceso.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Rol *</label>
              <select
                value={form.rol}
                onChange={e => set('rol', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              >
                {ROLES
                  .filter(r => isSuperadmin || r !== 'superadmin')
                  .map(r => (
                    <option key={r} value={r}>{ROL_LABELS[r]}</option>
                  ))
                }
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                {isSuperadmin ? 'Cliente / Dependencia' : 'Dependencia'}
              </label>
              {isSuperadmin ? (
                <select
                  value={form.cliente_id ?? ''}
                  onChange={e => set('cliente_id', e.target.value || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
                >
                  <option value="">— Sin cliente —</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.codigo_upp} — {c.nombre}</option>
                  ))}
                </select>
              ) : (
                <input
                  readOnly
                  value={clientes.find(c => c.id === currentClienteId)?.nombre ?? '—'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                />
              )}
            </div>
          </div>
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
            disabled={!form.email || !form.password || !form.nombre_completo || crear.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: GUINDA }}
          >
            {crear.isPending
              ? <><Loader2 size={13} className="animate-spin" />Creando…</>
              : <><Plus size={13} />Crear usuario</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Crear Cliente ───────────────────────────────────────────────────────

function ModalCrearCliente({
  onClose,
  onCreado,
}: {
  onClose: () => void
  onCreado: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<ClienteCreate>({
    codigo_upp: '',
    nombre: '',
    tipo: 'centralizada',
    activo: true,
  })
  const [error, setError] = useState('')

  const crear = useMutation({
    mutationFn: () => clientesAdminApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-clientes'] })
      onCreado()
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Error al crear cliente.')
    },
  })

  const set = <K extends keyof ClienteCreate>(k: K, v: ClienteCreate[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={16} style={{ color: GUINDA }} />
            Registrar nueva dependencia
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Formulario */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Código UPP *</label>
              <input
                value={form.codigo_upp}
                onChange={e => set('codigo_upp', e.target.value.toUpperCase())}
                placeholder="Ej: 007"
                maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase font-mono font-bold focus:outline-none focus:ring-1"
                style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Tipo *</label>
              <select
                value={form.tipo}
                onChange={e => set('tipo', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              >
                {TIPOS_CLIENTE.map(t => (
                  <option key={t} value={t}>{TIPO_CLIENTE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Nombre / Razón social *</label>
            <input
              value={form.nombre}
              onChange={e => set('nombre', e.target.value)}
              placeholder="Ej: Secretaría de Educación"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <p className="text-xs text-blue-700">
              El cliente registrado podrá gestionar sus propios DEPPs y usuarios
              dentro del sistema PIGOP.
            </p>
          </div>
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
            disabled={!form.codigo_upp || !form.nombre || crear.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: GUINDA }}
          >
            {crear.isPending
              ? <><Loader2 size={13} className="animate-spin" />Registrando…</>
              : <><Plus size={13} />Registrar</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

type Tab = 'usuarios' | 'clientes'

export default function Admin() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isSuperadmin = user?.rol === 'superadmin'

  const [tab, setTab] = useState<Tab>('usuarios')
  const [showModalUsuario, setShowModalUsuario] = useState(false)
  const [showModalCliente, setShowModalCliente] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: usuarios = [], isLoading: loadingUsuarios, refetch: refetchUsuarios } = useQuery({
    queryKey: ['admin-usuarios'],
    queryFn: () => usuariosApi.list(),
    staleTime: 30_000,
  })

  const { data: clientes = [], isLoading: loadingClientes, refetch: refetchClientes } = useQuery({
    queryKey: ['admin-clientes'],
    queryFn: () => clientesAdminApi.list(),
    staleTime: 30_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: async (u: UsuarioAdmin) => {
      if (u.activo) {
        return usuariosApi.deactivate(u.id)
      } else {
        return usuariosApi.activate(u.id)
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] }),
  })

  const cambiarRolMutation = useMutation({
    mutationFn: ({ id, rol }: { id: string; rol: string }) =>
      usuariosApi.update(id, { rol }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-usuarios'] }),
  })

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = {
    totalUsuarios: usuarios.length,
    activos:       usuarios.filter(u => u.activo).length,
    admins:        usuarios.filter(u => u.rol === 'superadmin' || u.rol === 'admin_cliente').length,
    clientes:      clientes.length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: '#FDF2F4' }}>
            <Shield size={20} style={{ color: GUINDA }} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Panel de Administración</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Gestión de usuarios y dependencias registradas en PIGOP
            </p>
          </div>
        </div>
        <button
          onClick={() => { refetchUsuarios(); refetchClientes() }}
          className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          title="Actualizar"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Usuarios totales', value: stats.totalUsuarios, icon: Users,     color: GUINDA,     bg: '#FDF2F4' },
          { label: 'Usuarios activos', value: stats.activos,       icon: UserCheck, color: '#15803d',  bg: '#f0fdf4' },
          { label: 'Administradores',  value: stats.admins,        icon: Shield,    color: '#1d4ed8',  bg: '#eff6ff' },
          { label: 'Dependencias',     value: stats.clientes,      icon: Building2, color: '#7c3aed',  bg: '#f5f3ff' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: bg }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <p className="text-[10px] text-gray-500 leading-tight">{label}</p>
              <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
        {([
          { key: 'usuarios', label: 'Usuarios', icon: Users },
          { key: 'clientes', label: 'Dependencias', icon: Building2 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={tab === key
              ? { backgroundColor: '#fff', color: GUINDA, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: '#6b7280' }
            }
          >
            <Icon size={14} />
            {label}
            {key === 'usuarios' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: tab === key ? '#FDF2F4' : '#e5e7eb', color: tab === key ? GUINDA : '#9ca3af' }}>
                {usuarios.length}
              </span>
            )}
            {key === 'clientes' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: tab === key ? '#FDF2F4' : '#e5e7eb', color: tab === key ? GUINDA : '#9ca3af' }}>
                {clientes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Acción principal */}
      <div className="flex justify-end mb-4">
        {tab === 'usuarios' && (
          <button
            onClick={() => setShowModalUsuario(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: GUINDA }}
          >
            <Plus size={14} />
            Nuevo usuario
          </button>
        )}
        {tab === 'clientes' && isSuperadmin && (
          <button
            onClick={() => setShowModalCliente(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: GUINDA }}
          >
            <Plus size={14} />
            Nueva dependencia
          </button>
        )}
      </div>

      {/* Contenido del tab */}
      {tab === 'usuarios' && (
        loadingUsuarios ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <TablaUsuarios
            usuarios={usuarios}
            clientes={clientes}
            isSuperadmin={isSuperadmin}
            currentUserId={user?.id ?? ''}
            onToggle={u => toggleMutation.mutate(u)}
            onCambiarRol={(u, rol) => cambiarRolMutation.mutate({ id: u.id, rol })}
          />
        )
      )}

      {tab === 'clientes' && (
        loadingClientes ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="animate-spin text-gray-400" />
          </div>
        ) : (
          <TablaClientes clientes={clientes} />
        )
      )}

      {/* Modales */}
      {showModalUsuario && (
        <ModalCrearUsuario
          clientes={clientes}
          isSuperadmin={isSuperadmin}
          currentClienteId={user?.cliente_id ?? null}
          onClose={() => setShowModalUsuario(false)}
          onCreado={() => setShowModalUsuario(false)}
        />
      )}
      {showModalCliente && (
        <ModalCrearCliente
          onClose={() => setShowModalCliente(false)}
          onCreado={() => setShowModalCliente(false)}
        />
      )}

      {/* Nota de acceso restringido */}
      {!isSuperadmin && (
        <div className="mt-6 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Eye size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Como administrador de cliente, puedes ver y gestionar solo los usuarios de tu dependencia.
            Para crear nuevas dependencias o asignar roles de superadmin, contacta al administrador del sistema.
          </p>
        </div>
      )}
    </div>
  )
}
