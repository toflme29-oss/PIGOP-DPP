/**
 * Admin — Panel de Administración del Sistema PIGOP
 *
 * Tabs:
 *   - Usuarios: crear, editar rol, activar/desactivar
 *   - Clientes: dependencias registradas en el sistema
 *
 * Acceso: superadmin y admin_cliente
 */
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Building2, Plus, ToggleLeft, ToggleRight,
  Shield, UserCheck, Eye, Loader2, X, AlertCircle,
  KeyRound, RefreshCw, Search, ChevronDown, Lock,
  Upload, CheckCircle2, FileImage, Trash2, Settings2, Save,
} from 'lucide-react'
import {
  usuariosApi, clientesAdminApi,
  ROL_LABELS, ROL_COLORS, TIPO_CLIENTE_LABELS, MODULOS_DISPONIBLES,
  type UsuarioAdmin, type ClienteAdmin,
  type UsuarioCreate, type ClienteCreate,
} from '../api/usuarios'
import { documentosApi, type MembreteConfig, type MembreteCampo } from '../api/documentos'
import { useAuth } from '../hooks/useAuth'
import { formatDate } from '../utils'
import { TablaPermisos } from './AdminPermisos'

// ── Constantes ─────────────────────────────────────────────────────────────────
const GUINDA = '#911A3A'
const ROLES = ['superadmin', 'admin_cliente', 'secretaria', 'analista', 'consulta'] as const
const TIPOS_CLIENTE = ['centralizada', 'paraestatal', 'autonoma', 'poder'] as const
const TIPOS_VALIDOS_IMPORT = ['centralizada', 'paraestatal', 'autonoma', 'poder'] as const

// ── Importación Excel/CSV ──────────────────────────────────────────────────────

type FilaImport = { codigo_upp: string; nombre: string; tipo: string }

function colLetterToIndex(letters: string): number {
  let col = 0
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64)
  return col - 1
}

/** Extrae el texto entre la primera aparición de <tag...> y </tag> */
function xmlInner(chunk: string, tag: string): string {
  const open = chunk.indexOf(`<${tag}`)
  if (open === -1) return ''
  const closeTag = chunk.indexOf('>', open)
  if (closeTag === -1) return ''
  const end = chunk.indexOf(`</${tag}>`, closeTag)
  if (end === -1) return ''
  return chunk.substring(closeTag + 1, end)
}

/** Extrae el valor de un atributo name="value" dentro de una cadena */
function xmlAttr(chunk: string, name: string): string {
  const needle = `${name}="`
  const s = chunk.indexOf(needle)
  if (s === -1) return ''
  const e = chunk.indexOf('"', s + needle.length)
  if (e === -1) return ''
  return chunk.substring(s + needle.length, e)
}

/** Decodifica entidades XML básicas */
function xmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#xD;/g, '')
}

async function parsearArchivoImport(file: File): Promise<FilaImport[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()

  // ── CSV ──────────────────────────────────────────────────────────────────────
  if (ext === 'csv') {
    const text = await file.text()
    const delim = text.includes(';') ? ';' : ','
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const firstCols = lines[0]?.split(delim).map(c => c.trim().toLowerCase().replace(/^"|"$/g, ''))
    const start = firstCols?.some(c => c.includes('codigo') || c.includes('nombre') || c.includes('upp')) ? 1 : 0
    const rows: FilaImport[] = []
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
      const codigo = cols[0] ?? ''
      const nombre = cols[1] ?? ''
      if (!codigo && !nombre) continue
      const tipo = (cols[2] ?? '').toLowerCase()
      rows.push({ codigo_upp: codigo, nombre, tipo: (TIPOS_VALIDOS_IMPORT as readonly string[]).includes(tipo) ? tipo : 'centralizada' })
    }
    return rows
  }

  // ── XLSX / XLS ────────────────────────────────────────────────────────────────
  if (ext === 'xlsx' || ext === 'xls') {
    const JSZip = (await import('jszip')).default
    const ab = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(ab)

    // ── Shared strings: split por <si> para evitar backtracking ──────────────
    const ssXml = (await zip.file('xl/sharedStrings.xml')?.async('text')) ?? ''
    const sharedStrings: string[] = []
    const siParts = ssXml.split('<si>')
    for (let i = 1; i < siParts.length; i++) {
      const siChunk = siParts[i].split('</si>')[0]
      // Concatena todos los <t>…</t> dentro del <si>
      let combined = ''
      const tParts = siChunk.split('<t')
      for (let j = 1; j < tParts.length; j++) {
        const tChunk = tParts[j]
        const gt = tChunk.indexOf('>')
        const lt = tChunk.indexOf('</t>')
        if (gt !== -1 && lt > gt) combined += tChunk.substring(gt + 1, lt)
      }
      sharedStrings.push(xmlDecode(combined))
    }

    // ── Sheet XML: split por <row para evitar backtracking ────────────────────
    const sheetXml = (await zip.file('xl/worksheets/sheet1.xml')?.async('text')) ?? ''
    const grid = new Map<number, string[]>()
    let maxRow = 0

    const rowParts = sheetXml.split('<row')
    for (let ri = 1; ri < rowParts.length; ri++) {
      const rowChunk = rowParts[ri]
      const rVal = xmlAttr(rowChunk, 'r')
      if (!rVal) continue
      const rowIdx = parseInt(rVal) - 1
      if (rowIdx > maxRow) maxRow = rowIdx

      const cells: string[] = []
      // Contenido hasta </row>
      const rowContent = rowChunk.split('</row>')[0]

      // Split por <c (inicio de celda)
      const cellParts = rowContent.split('<c ')
      for (let ci = 1; ci < cellParts.length; ci++) {
        const cellChunk = cellParts[ci]

        // Referencia de celda: r="B3" → extraer letras
        const ref = xmlAttr(cellChunk, 'r')
        if (!ref) continue
        const letters = ref.replace(/[0-9]/g, '')
        const col = colLetterToIndex(letters)

        // Tipo de celda: t="s" | t="str" | t="inlineStr" | (vacío = número)
        const type = xmlAttr(cellChunk, 't')

        let val = ''

        if (type === 'inlineStr') {
          // <is><t>…</t></is>
          const isStart = cellChunk.indexOf('<is>')
          if (isStart !== -1) {
            const tStart = cellChunk.indexOf('<t', isStart)
            if (tStart !== -1) {
              const gt = cellChunk.indexOf('>', tStart)
              const lt = cellChunk.indexOf('</t>', gt)
              if (gt !== -1 && lt > gt) val = xmlDecode(cellChunk.substring(gt + 1, lt))
            }
          }
        } else {
          // <v>…</v>
          const vOpen = cellChunk.indexOf('<v>')
          const vClose = cellChunk.indexOf('</v>')
          if (vOpen !== -1 && vClose > vOpen) {
            const raw = cellChunk.substring(vOpen + 3, vClose)
            val = type === 's' ? (sharedStrings[parseInt(raw)] ?? '') : raw
          }
        }

        while (cells.length <= col) cells.push('')
        cells[col] = val
      }
      grid.set(rowIdx, cells)
    }

    if (grid.size === 0) return []

    const firstRow = grid.get(0) ?? []
    const hasHeaders = firstRow.some(c =>
      c.toLowerCase().includes('codigo') || c.toLowerCase().includes('nombre') || c.toLowerCase().includes('upp'),
    )

    const result: FilaImport[] = []
    for (let i = hasHeaders ? 1 : 0; i <= maxRow; i++) {
      const row = grid.get(i) ?? []
      const codigo = (row[0] ?? '').trim()
      const nombre = (row[1] ?? '').trim()
      if (!codigo && !nombre) continue
      const tipo = (row[2] ?? '').trim().toLowerCase()
      result.push({ codigo_upp: codigo, nombre, tipo: (TIPOS_VALIDOS_IMPORT as readonly string[]).includes(tipo) ? tipo : 'centralizada' })
    }
    return result
  }

  throw new Error('Formato no soportado. Usa .xlsx o .csv')
}

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

      <div className="overflow-auto rounded-xl border border-gray-200 max-h-[calc(100vh-300px)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
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
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Módulos
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

                {/* Módulos de acceso */}
                <td className="px-4 py-3">
                  {u.rol === 'superadmin' || u.rol === 'admin_cliente' ? (
                    <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                      Todos
                    </span>
                  ) : (u.modulos_acceso ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {(u.modulos_acceso ?? []).map(m => {
                        const mod = MODULOS_DISPONIBLES.find(md => md.id === m)
                        return (
                          <span key={m} className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {mod?.label ?? m}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-300">Ninguno</span>
                  )}
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
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
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

function TablaClientes({
  clientes,
  onEdit,
  onDelete,
}: {
  clientes: ClienteAdmin[]
  onEdit: (c: ClienteAdmin) => void
  onDelete: (c: ClienteAdmin) => void
}) {
  return (
    <div className="overflow-auto rounded-xl border border-gray-200 max-h-[calc(100vh-300px)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
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
            <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              Acciones
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
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => onEdit(c)}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-colors"
                    title="Editar"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    onClick={() => onDelete(c)}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                    title="Eliminar"
                  >
                    <X size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {clientes.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">
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

          {/* Módulos de acceso — visible solo para roles que no son admin/superadmin */}
          {form.rol !== 'superadmin' && form.rol !== 'admin_cliente' && (
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-2">
                Módulos de acceso
              </label>
              <div className="space-y-2">
                {MODULOS_DISPONIBLES.map(mod => {
                  const checked = (form.modulos_acceso ?? []).includes(mod.id)
                  return (
                    <label key={mod.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const current = form.modulos_acceso ?? []
                          const next = checked
                            ? current.filter(m => m !== mod.id)
                            : [...current, mod.id]
                          set('modulos_acceso', next)
                        }}
                        className="w-3.5 h-3.5 rounded border-gray-300 accent-[#911A3A]"
                      />
                      <span className="text-xs text-gray-700 group-hover:text-gray-900">
                        {mod.label}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Director y Superadmin acceden a todos los módulos automáticamente.
              </p>
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

// ── Modal: Editar Cliente ───────────────────────────────────────────────────────

function ModalEditarCliente({
  cliente,
  onClose,
  onEditado,
}: {
  cliente: ClienteAdmin
  onClose: () => void
  onEditado: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    nombre: cliente.nombre,
    tipo: cliente.tipo || 'centralizada',
    activo: cliente.activo,
  })
  const [error, setError] = useState('')

  const actualizar = useMutation({
    mutationFn: () => clientesAdminApi.update(cliente.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-clientes'] })
      onEditado()
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Error al actualizar cliente.')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={16} style={{ color: GUINDA }} />
            Editar dependencia: {cliente.codigo_upp}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Nombre / Dependencia *</label>
            <input
              value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
              style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Tipo *</label>
            <select
              value={form.tipo}
              onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
            >
              {TIPOS_CLIENTE.map(t => (
                <option key={t} value={t}>{TIPO_CLIENTE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-gray-300 accent-[#911A3A]"
            />
            <span className="text-xs font-semibold text-gray-700 group-hover:text-gray-900">Activa</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => actualizar.mutate()}
            disabled={!form.nombre || actualizar.isPending}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: GUINDA }}
          >
            {actualizar.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Importar Dependencias ───────────────────────────────────────────────

function ModalImportarDependencias({
  onClose,
  onImportado,
}: {
  onClose: () => void
  onImportado: () => void
}) {
  const qc = useQueryClient()
  const [filas, setFilas] = useState<FilaImport[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [resultados, setResultados] = useState<{ ok: number; fail: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setParsing(true)
    setError('')
    setFilas(null)
    setFileName(file.name)
    try {
      const rows = await parsearArchivoImport(file)
      if (rows.length === 0) setError('El archivo no contiene filas de datos.')
      else setFilas(rows)
    } catch (e) {
      setError((e as Error).message ?? 'Error al leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!filas) return
    setImporting(true)
    let ok = 0
    let fail = 0
    for (const fila of filas) {
      try {
        await clientesAdminApi.create({ codigo_upp: fila.codigo_upp, nombre: fila.nombre, tipo: fila.tipo || 'centralizada', activo: true })
        ok++
      } catch {
        fail++
      }
    }
    await qc.invalidateQueries({ queryKey: ['admin-clientes'] })
    setResultados({ ok, fail })
    setImporting(false)
    if (fail === 0) setTimeout(() => onImportado(), 1400)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Upload size={16} style={{ color: GUINDA }} />
            Importar dependencias desde Excel
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Instrucciones */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">Formato esperado (.xlsx o .csv):</p>
            <p>
              Columna A: <strong>Código UPP</strong> &nbsp;|&nbsp;
              Columna B: <strong>Nombre</strong> &nbsp;|&nbsp;
              Columna C: <strong>Tipo</strong> (centralizada, paraestatal, autonoma, poder) — opcional
            </p>
            <p className="text-[10px] text-blue-500">
              Los encabezados en la primera fila se detectan automáticamente y se omiten.
            </p>
          </div>

          {/* Selector de archivo */}
          {!resultados && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-60"
              >
                {parsing ? (
                  <><Loader2 size={20} className="animate-spin" /><span className="text-sm">Procesando archivo…</span></>
                ) : (
                  <>
                    <Upload size={22} />
                    <span className="text-sm font-medium">{fileName || 'Seleccionar archivo Excel o CSV'}</span>
                    <span className="text-xs text-gray-400">.xlsx · .xls · .csv</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Vista previa */}
          {filas && !resultados && (
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">
                Vista previa — {filas.length} dependencia{filas.length !== 1 ? 's' : ''} encontrada{filas.length !== 1 ? 's' : ''}
              </p>
              <div className="rounded-xl border border-gray-200 overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Código UPP</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Nombre</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filas.map((f, i) => (
                      <tr key={i} className={!f.codigo_upp || !f.nombre ? 'bg-yellow-50' : 'hover:bg-gray-50/50'}>
                        <td className="px-3 py-2 font-mono font-bold text-gray-800">
                          {f.codigo_upp || <span className="text-red-400 font-normal">—</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {f.nombre || <span className="text-red-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {TIPO_CLIENTE_LABELS[f.tipo] ?? f.tipo}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Resultado */}
          {resultados && (
            <div className="text-center py-8 space-y-4">
              <CheckCircle2 size={44} className="mx-auto text-green-500" />
              <p className="text-sm font-bold text-gray-900">Importación completada</p>
              <div className="flex justify-center gap-4">
                <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-3 text-center">
                  <p className="text-3xl font-bold text-green-700">{resultados.ok}</p>
                  <p className="text-[10px] text-green-600 font-medium mt-0.5">Registradas</p>
                </div>
                {resultados.fail > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-3 text-center">
                    <p className="text-3xl font-bold text-red-700">{resultados.fail}</p>
                    <p className="text-[10px] text-red-600 font-medium mt-0.5">Con error</p>
                  </div>
                )}
              </div>
              {resultados.fail > 0 && (
                <p className="text-xs text-gray-500 max-w-xs mx-auto">
                  Algunas dependencias no pudieron registrarse (puede que ya existan o tengan datos inválidos).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!resultados ? (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={!filas || filas.length === 0 || importing}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: GUINDA }}
            >
              {importing ? (
                <><Loader2 size={13} className="animate-spin" />Importando…</>
              ) : (
                <><Upload size={13} />Importar {filas ? filas.length : ''} dependencia{filas && filas.length !== 1 ? 's' : ''}</>
              )}
            </button>
          </div>
        ) : (
          <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Panel Membrete ─────────────────────────────────────────────────────────────

// ── Panel de configuración de coordenadas del membrete ────────────────────────
function PanelConfigMembrete() {
  const queryClient = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [cfg, setCfg] = useState<MembreteConfig | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)

  const { data: cfgRemota, isLoading } = useQuery({
    queryKey: ['membrete-config'],
    queryFn: () => documentosApi.getMembreteConfig(),
  })

  useEffect(() => {
    if (!cfgRemota) return
    // Sincronizar cfg desde el cache; garantizar defaults para campos opcionales
    // que backends más viejos pueden no devolver (ej. word_spacer_correction).
    setCfg({
      word_spacer_correction: 30,
      ...structuredClone(cfgRemota),
    })
  }, [cfgRemota])

  const setCampo = (idx: number, field: keyof MembreteCampo, value: unknown) => {
    if (!cfg) return
    const next = structuredClone(cfg)
    ;(next.campos[idx] as any)[field] = value
    setCfg(next)
  }

  const setGlobal = (field: keyof Omit<MembreteConfig, 'campos'>, value: number) => {
    if (!cfg) return
    setCfg({ ...cfg, [field]: value })
  }

  const guardar = async () => {
    if (!cfg) return
    setGuardando(true)
    setMsg(null)
    try {
      const res = await documentosApi.saveMembreteConfig(cfg)
      setMsg({ tipo: 'ok', texto: res.mensaje })
      // Actualizar el cache con el cfg completo (incluye campos nuevos que
      // el backend podría no devolver si no fue reiniciado tras el deploy)
      queryClient.setQueryData(['membrete-config'], structuredClone(cfg))
    } catch (e: any) {
      setMsg({ tipo: 'err', texto: e?.response?.data?.detail || 'Error al guardar.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Cabecera colapsable */}
      <button
        onClick={() => setAbierto(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-2">
          <Settings2 size={15} style={{ color: GUINDA }} />
          Configuración avanzada — coordenadas y tipografía
        </span>
        <ChevronDown size={15} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="p-4 space-y-5 bg-white">
          {isLoading || !cfg ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Cargando configuración...
            </div>
          ) : (
            <>
              {/* Parámetros globales */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Parámetros globales</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(
                    [
                      { field: 'fontsize'              as const, label: 'Tamaño fuente (pt)'       },
                      { field: 'max_chars'             as const, label: 'Máx. caracteres (línea)'  },
                      { field: 'line_height'           as const, label: 'Interlineado (pt)'        },
                      { field: 'fecha_y'               as const, label: 'Fecha — posición Y (PDF)' },
                      { field: 'word_spacer_correction'as const, label: 'Corrección espacio Word (pt)' },
                    ] as { field: keyof Omit<MembreteConfig,'campos'>; label: string }[]
                  ).map(({ field, label }) => (
                    <label key={field} className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-500">{label}</span>
                      <input
                        type="number"
                        value={cfg[field] ?? 0}
                        onChange={e => setGlobal(field, Number(e.target.value))}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-center w-full focus:outline-none focus:ring-1"
                        style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Tabla de campos */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Campos del recuadro</p>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 w-36">Campo</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 w-20">X</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-500 w-20 bg-yellow-50">
                          <span className="text-yellow-700 font-bold">Y ↕</span>
                          <span className="block text-[9px] font-normal text-yellow-600">posición vertical</span>
                        </th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 w-24">Ancho máx.</th>
                        <th className="text-center px-2 py-2 font-semibold text-gray-600 w-24">Multilínea</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cfg.campos.map((campo, idx) => (
                        <tr key={campo.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2 font-medium text-gray-700">{campo.label}</td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              value={campo.x}
                              onChange={e => setCampo(idx, 'x', Number(e.target.value))}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-xs text-center w-full focus:outline-none focus:ring-1"
                            />
                          </td>
                          <td className="px-2 py-1.5 bg-yellow-50">
                            <input
                              type="number"
                              value={campo.y}
                              onChange={e => setCampo(idx, 'y', Number(e.target.value))}
                              className="border border-yellow-300 rounded-lg px-2 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 font-bold"
                              style={{ '--tw-ring-color': '#ca8a04' } as React.CSSProperties}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              value={campo.max_width}
                              onChange={e => setCampo(idx, 'max_width', Number(e.target.value))}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-xs text-center w-full focus:outline-none focus:ring-1"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={campo.multiline}
                              onChange={e => setCampo(idx, 'multiline', e.target.checked)}
                              className="w-4 h-4 rounded cursor-pointer"
                              style={{ accentColor: GUINDA }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  Coordenadas en puntos (pt). Origen = esquina inferior izquierda. Página carta: 612 × 792 pt.
                  <br />
                  <span className="text-yellow-700 font-semibold">↕ Columna Y</span>: controla la posición <b>vertical</b> de cada campo.
                  <b>Sube Y</b> (ej. 654→670) para mover el campo hacia arriba. <b>Baja Y</b> para moverlo hacia abajo.
                  Úsala junto con el <b>PDF de calibración</b> para encontrar el valor exacto.
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <b>Fecha — posición Y</b>: misma lógica que los campos; súbela para acercar la fecha al remitente.
                  <b> Corrección espacio Word</b>: ajusta el espaciado en .docx (aumenta si la fecha queda lejos; baja si queda muy cerca).
                </p>
              </div>

              {/* Mensaje */}
              {msg && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
                  msg.tipo === 'ok'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {msg.tipo === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {msg.texto}
                </div>
              )}

              {/* Guardar */}
              <div className="flex justify-end">
                <button
                  onClick={guardar}
                  disabled={guardando}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: GUINDA }}
                >
                  {guardando
                    ? <><Loader2 size={14} className="animate-spin" /> Guardando...</>
                    : <><Save size={14} /> Guardar configuración</>
                  }
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PanelMembrete() {
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<string | null>(null)
  const [membreteBlob, setMembreteBlob] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)

  const { data: info, isLoading } = useQuery({
    queryKey: ['membrete-info'],
    queryFn: () => documentosApi.infoMembrete(),
  })

  // Cargar la imagen del membrete activo como blob (para enviar el token de auth)
  useQuery({
    queryKey: ['membrete-preview'],
    queryFn: async () => {
      const apiClient = (await import('../api/client')).default
      const res = await apiClient.get('/documentos/membrete/preview', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      setMembreteBlob(url)
      return url
    },
    enabled: !!info?.activo && !preview,
    staleTime: 0,
  })

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setMsg({ tipo: 'err', texto: 'Solo se aceptan imágenes PNG o JPG.' })
      return
    }
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    setMembreteBlob(null)
    setMsg(null)
    setSubiendo(true)
    try {
      const res = await documentosApi.subirMembrete(file)
      setMsg({ tipo: 'ok', texto: res.mensaje })
      queryClient.invalidateQueries({ queryKey: ['membrete-info'] })
      queryClient.invalidateQueries({ queryKey: ['membrete-preview'] })
    } catch (e: any) {
      setMsg({ tipo: 'err', texto: e?.response?.data?.detail || 'Error al subir el membrete.' })
      setPreview(null)
    } finally {
      setSubiendo(false)
    }
  }

  const imgSrc = preview || membreteBlob

  return (
    <div className="max-w-2xl overflow-y-auto">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
        {/* Encabezado */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: '#FDF0F3' }}>
            <FileImage size={20} style={{ color: GUINDA }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Membrete institucional</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Imagen PNG o JPG que se usará como fondo de página en todos los oficios generados.
              Se recomienda una imagen tamaño carta (2550 × 3300 px) con fondo transparente o blanco.
            </p>
          </div>
        </div>

        {/* Estado actual */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={13} className="animate-spin" /> Verificando membrete activo...
          </div>
        ) : info?.activo ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
            <CheckCircle2 size={13} />
            <span>Membrete activo: <b>{info.filename}</b> — {info.size_kb} KB — subido el {info.actualizado}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <AlertCircle size={13} />
            <span>No hay membrete configurado. Los oficios se generarán sin fondo.</span>
          </div>
        )}

        {/* Previsualización */}
        {imgSrc && (
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
            <p className="text-[10px] text-gray-400 px-3 py-1.5 border-b border-gray-100">
              Vista previa del membrete actual
            </p>
            <img
              src={imgSrc}
              alt="Membrete"
              className="w-full object-contain max-h-80"
              style={{ imageRendering: 'auto' }}
            />
          </div>
        )}

        {/* Mensaje de resultado */}
        {msg && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
            msg.tipo === 'ok'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}>
            {msg.tipo === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {msg.texto}
          </div>
        )}

        {/* Botón subir */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
        />
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={subiendo}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: GUINDA }}
          >
            {subiendo
              ? <><Loader2 size={14} className="animate-spin" /> Subiendo...</>
              : <><Upload size={14} /> {info?.activo ? 'Reemplazar membrete' : 'Subir membrete'}</>
            }
          </button>
          {info?.activo && (
            <button
              onClick={async () => {
                try {
                  const apiClient = (await import('../api/client')).default
                  const res = await apiClient.get('/documentos/membrete/calibrar', { responseType: 'blob' })
                  const url = URL.createObjectURL(res.data as Blob)
                  window.open(url, '_blank')
                } catch { alert('Error al generar PDF de calibración.') }
              }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <FileImage size={14} /> PDF de calibración
            </button>
          )}
        </div>

        {/* Configuración avanzada */}
        <PanelConfigMembrete />

        {/* Instrucciones */}
        <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-700">Recomendaciones:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Formato PNG con fondo transparente (recomendado) o JPG con fondo blanco</li>
            <li>Tamaño carta: 2550 × 3300 píxeles a 300 dpi</li>
            <li>El membrete se aplica de inmediato a todos los nuevos oficios</li>
            <li>Los oficios ya generados no se modifican</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

type Tab = 'usuarios' | 'clientes' | 'permisos' | 'membrete'

export default function Admin() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isSuperadmin = user?.rol === 'superadmin'

  const [tab, setTab] = useState<Tab>('usuarios')
  const [showModalUsuario, setShowModalUsuario] = useState(false)
  const [showModalCliente, setShowModalCliente] = useState(false)
  const [showModalImportar, setShowModalImportar] = useState(false)
  const [clienteAEditar, setClienteAEditar] = useState<ClienteAdmin | null>(null)


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

  const eliminarClienteMutation = useMutation({
    mutationFn: (id: string) => clientesAdminApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-clientes'] }),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      alert(typeof msg === 'string' ? msg : 'Error al eliminar dependencia. Puede que tenga usuarios asociados.')
    }
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
          { key: 'usuarios',  label: 'Usuarios',          icon: Users     },
          { key: 'clientes',  label: 'Dependencias',      icon: Building2 },
          { key: 'permisos',  label: 'Roles y Permisos',  icon: Lock      },
          { key: 'membrete',  label: 'Membrete',           icon: FileImage },
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
            {key === 'permisos' && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: tab === key ? '#FDF2F4' : '#e5e7eb', color: tab === key ? GUINDA : '#9ca3af' }}>
                9
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Acción principal */}
      <div className="flex justify-end mb-4">
        {tab === 'permisos' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
            <Lock size={12} className="text-blue-500" />
            <span className="text-[11px] text-blue-600 font-medium">
              Haz clic en cualquier celda para activar o desactivar un permiso
            </span>
          </div>
        )}
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
        {tab === 'clientes' && (isSuperadmin || user?.rol === 'admin_cliente') && (
          <div className="flex items-center gap-2">

            <button
              onClick={() => setShowModalImportar(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors border"
              style={{ borderColor: GUINDA, color: GUINDA, backgroundColor: '#FDF2F4' }}
            >
              <Upload size={14} />
              Importar Excel
            </button>
            <button
              onClick={() => setShowModalCliente(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
              style={{ backgroundColor: GUINDA }}
            >
              <Plus size={14} />
              Nueva dependencia
            </button>
          </div>
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
          <TablaClientes
            clientes={clientes}
            onEdit={c => setClienteAEditar(c)}
            onDelete={c => {
              if (confirm(`¿Estás seguro de eliminar la dependencia "${c.nombre}"?`)) {
                eliminarClienteMutation.mutate(c.id)
              }
            }}
          />
        )
      )}


      {tab === 'permisos' && <TablaPermisos />}

      {tab === 'membrete' && <PanelMembrete />}

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
      {showModalImportar && (
        <ModalImportarDependencias
          onClose={() => setShowModalImportar(false)}
          onImportado={() => setShowModalImportar(false)}
        />
      )}
      {clienteAEditar && (
        <ModalEditarCliente
          cliente={clienteAEditar}
          onClose={() => setClienteAEditar(null)}
          onEditado={() => setClienteAEditar(null)}
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
