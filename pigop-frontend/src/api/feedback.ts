import apiClient from './client'

export type TipoFeedback = 'bug' | 'mejora' | 'consulta'
export type EstadoFeedback = 'pendiente' | 'en_revision' | 'resuelto'

export interface FeedbackItem {
  id: string
  usuario_nombre: string
  area_codigo: string | null
  modulo: string
  tipo: TipoFeedback
  tipo_label: string
  descripcion: string
  estado: EstadoFeedback
  estado_label: string
  notas_admin: string | null
  tiene_captura: boolean
  captura_nombre: string | null
  creado_en: string | null
}

export const feedbackApi = {
  enviar: async (data: {
    modulo: string
    tipo: TipoFeedback
    descripcion: string
    captura?: File | null
  }): Promise<{ id: string; message: string }> => {
    const form = new FormData()
    form.append('modulo', data.modulo)
    form.append('tipo', data.tipo)
    form.append('descripcion', data.descripcion)
    if (data.captura) form.append('captura', data.captura)
    const res = await apiClient.post('/feedback/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  listar: async (params?: {
    estado?: string
    tipo?: string
    modulo?: string
    skip?: number
    limit?: number
  }): Promise<{ items: FeedbackItem[]; total: number }> => {
    const res = await apiClient.get('/feedback/', { params })
    return res.data
  },

  obtenerCapturaUrl: (feedbackId: string): string => {
    const base = (import.meta.env.VITE_API_URL as string) || '/api/v1'
    return `${base}/feedback/${feedbackId}/captura`
  },

  actualizar: async (
    feedbackId: string,
    data: { estado?: string; notas_admin?: string },
  ): Promise<{ id: string; estado: string; message: string }> => {
    const form = new FormData()
    if (data.estado) form.append('estado', data.estado)
    if (data.notas_admin !== undefined) form.append('notas_admin', data.notas_admin)
    const res = await apiClient.patch(`/feedback/${feedbackId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },
}
