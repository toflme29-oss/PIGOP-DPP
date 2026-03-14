/**
 * API — Control de Oficios Recibidos
 */
import { apiClient } from './client'

export interface Oficio {
  id: string
  folio: number
  numero_oficio: string
  remitente: string
  dependencia: string
  asunto: string
  descripcion: string | null
  observaciones: string | null
  fecha_oficio: string
  fecha_registro: string
  cliente_id: string
  registrado_por: string
  registrador_nombre: string | null
}

export interface OficioCreate {
  numero_oficio: string
  remitente: string
  dependencia: string
  asunto: string
  fecha_oficio: string
  descripcion?: string
  observaciones?: string
}

export interface OficioUpdate {
  numero_oficio?: string
  remitente?: string
  dependencia?: string
  asunto?: string
  fecha_oficio?: string
  descripcion?: string
  observaciones?: string
}

export interface PaginatedOficios {
  items: Oficio[]
  total: number
  skip: number
  limit: number
}

export interface OficioFilters {
  skip?: number
  limit?: number
  fecha_desde?: string
  fecha_hasta?: string
  dependencia?: string
  busqueda?: string
}

export const oficiosApi = {
  listar: async (filters: OficioFilters = {}): Promise<PaginatedOficios> => {
    const params = new URLSearchParams()
    if (filters.skip !== undefined) params.set('skip', String(filters.skip))
    if (filters.limit !== undefined) params.set('limit', String(filters.limit))
    if (filters.fecha_desde) params.set('fecha_desde', filters.fecha_desde)
    if (filters.fecha_hasta) params.set('fecha_hasta', filters.fecha_hasta)
    if (filters.dependencia) params.set('dependencia', filters.dependencia)
    if (filters.busqueda) params.set('busqueda', filters.busqueda)
    const res = await apiClient.get(`/oficios?${params.toString()}`)
    return res.data
  },

  obtener: async (id: string): Promise<Oficio> => {
    const res = await apiClient.get(`/oficios/${id}`)
    return res.data
  },

  crear: async (data: OficioCreate): Promise<Oficio> => {
    const res = await apiClient.post('/oficios', data)
    return res.data
  },

  actualizar: async (id: string, data: OficioUpdate): Promise<Oficio> => {
    const res = await apiClient.put(`/oficios/${id}`, data)
    return res.data
  },

  eliminar: async (id: string): Promise<void> => {
    await apiClient.delete(`/oficios/${id}`)
  },

  exportarExcel: async (filters: OficioFilters = {}) => {
    const token = localStorage.getItem('access_token')
    const base = (apiClient.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
    const params = new URLSearchParams()
    if (filters.fecha_desde) params.set('fecha_desde', filters.fecha_desde)
    if (filters.fecha_hasta) params.set('fecha_hasta', filters.fecha_hasta)
    if (filters.dependencia) params.set('dependencia', filters.dependencia)
    if (filters.busqueda) params.set('busqueda', filters.busqueda)
    const qs = params.toString()
    const url = `${base}/oficios/export${qs ? `?${qs}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Error al exportar: ${res.status} — ${text}`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const disposition = res.headers.get('Content-Disposition')
    const filename = disposition?.match(/filename=(.+)/)?.[1] ?? 'PIGOP_Oficios_Recibidos.xlsx'
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  },
}
