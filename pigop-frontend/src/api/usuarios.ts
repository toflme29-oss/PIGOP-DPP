import apiClient from './client'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface ClienteAdmin {
  id: string
  codigo_upp: string
  nombre: string
  tipo: string | null
  activo: boolean
  configuracion: Record<string, unknown>
  creado_en: string
}

export interface UsuarioAdmin {
  id: string
  email: string
  nombre_completo: string | null
  rol: string
  activo: boolean
  cliente_id: string | null
  modulos_acceso: string[]
  ultimo_acceso: string | null
  creado_en: string
}

export interface UsuarioCreate {
  email: string
  nombre_completo: string
  rol: string
  password: string
  cliente_id?: string | null
  activo?: boolean
  modulos_acceso?: string[]
}

export interface UsuarioUpdate {
  nombre_completo?: string
  rol?: string
  activo?: boolean
  cliente_id?: string | null
  modulos_acceso?: string[]
}

export interface ClienteCreate {
  codigo_upp: string
  nombre: string
  tipo?: string
  activo?: boolean
}

export interface ClienteUpdate {
  nombre?: string
  tipo?: string
  activo?: boolean
}

// ── API usuarios ───────────────────────────────────────────────────────────────

export const usuariosApi = {
  list: async (params?: { cliente_id?: string }): Promise<UsuarioAdmin[]> => {
    const res = await apiClient.get('/usuarios/', { params })
    return res.data
  },

  create: async (data: UsuarioCreate): Promise<UsuarioAdmin> => {
    const res = await apiClient.post('/usuarios/', data)
    return res.data
  },

  update: async (id: string, data: UsuarioUpdate): Promise<UsuarioAdmin> => {
    const res = await apiClient.put(`/usuarios/${id}`, data)
    return res.data
  },

  deactivate: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/usuarios/${id}`)
    return res.data
  },

  activate: async (id: string): Promise<UsuarioAdmin> => {
    const res = await apiClient.put(`/usuarios/${id}`, { activo: true })
    return res.data
  },
}

// ── API clientes (dependencias) ────────────────────────────────────────────────

export const clientesAdminApi = {
  list: async (): Promise<ClienteAdmin[]> => {
    const res = await apiClient.get('/usuarios/clientes')
    return res.data
  },

  create: async (data: ClienteCreate): Promise<ClienteAdmin> => {
    const res = await apiClient.post('/usuarios/clientes', data)
    return res.data
  },

  update: async (id: string, data: ClienteUpdate): Promise<ClienteAdmin> => {
    const res = await apiClient.put(`/usuarios/clientes/${id}`, data)
    return res.data
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export const ROL_LABELS: Record<string, string> = {
  superadmin:    'Superadministrador',
  admin_cliente: 'Director',
  secretaria:    'Secretaría',
  analista:      'Analista',
  consulta:      'Solo consulta',
}

export const ROL_COLORS: Record<string, { bg: string; text: string }> = {
  superadmin:    { bg: '#fdf2f8', text: '#9d174d' },
  admin_cliente: { bg: '#eff6ff', text: '#1d4ed8' },
  secretaria:    { bg: '#fef3c7', text: '#92400e' },
  analista:      { bg: '#f0fdf4', text: '#15803d' },
  consulta:      { bg: '#f9fafb', text: '#6b7280' },
}

export const MODULOS_DISPONIBLES = [
  { id: 'gestion_documental', label: 'Gestión Documental' },
  { id: 'validacion_depp',    label: 'Validación DEPP' },
  { id: 'certificaciones',    label: 'Certificaciones' },
  { id: 'minutas',            label: 'Minutas' },
]

export const TIPO_CLIENTE_LABELS: Record<string, string> = {
  centralizada:  'Centralizada',
  paraestatal:   'Paraestatal',
  autonoma:      'Autónoma',
  poder:         'Poder del Estado',
}
