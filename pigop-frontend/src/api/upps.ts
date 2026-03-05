import apiClient from './client'

export interface UPP {
  id: string
  codigo: string
  nombre: string
  clasificacion_admin: 'CENTRALIZADA' | 'PARAESTATAL' | 'AUTÓNOMA' | 'PODER'
  organismo_code: string | null
  sigla: string | null
  ejercicio: number
  activa: boolean
}

export interface UPPStats {
  total: number
  por_clasificacion: { clasificacion: string; total: number }[]
}

export const uppsApi = {
  list: async (params?: { clasificacion?: string; q?: string }): Promise<UPP[]> => {
    const res = await apiClient.get('/upps/', { params })
    return res.data
  },

  lookup: async (codigo: string): Promise<UPP | null> => {
    try {
      const res = await apiClient.get(`/upps/lookup/${codigo}`)
      return res.data
    } catch {
      return null
    }
  },

  stats: async (): Promise<UPPStats> => {
    const res = await apiClient.get('/upps/stats')
    return res.data
  },
}

export const CLASIFICACION_COLORS: Record<string, { bg: string; text: string }> = {
  CENTRALIZADA:  { bg: '#eff6ff', text: '#1d4ed8' },
  PARAESTATAL:   { bg: '#f0fdf4', text: '#15803d' },
  'AUTÓNOMA':    { bg: '#fdf4ff', text: '#7e22ce' },
  PODER:         { bg: '#fff7ed', text: '#c2410c' },
}
