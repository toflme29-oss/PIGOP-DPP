import apiClient from './client'
import type { DEPP, DEPPCreate, DEPPListItem, UploadResponse, Cliente } from '../types'

export const deppsApi = {
  // ── Listado y CRUD ─────────────────────────────────────────────────────────

  list: async (params?: {
    skip?: number
    limit?: number
    upp?: string
    ejercicio?: number
    estado?: string
    cliente_id?: string
  }): Promise<DEPPListItem[]> => {
    const res = await apiClient.get('/depps/', { params })
    return res.data
  },

  get: async (id: string): Promise<DEPP> => {
    const res = await apiClient.get(`/depps/${id}`)
    return res.data
  },

  create: async (data: DEPPCreate): Promise<DEPP> => {
    const res = await apiClient.post('/depps/', data)
    return res.data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/depps/${id}`)
  },

  cambiarEstado: async (id: string, estado: string): Promise<DEPP> => {
    const res = await apiClient.post(`/depps/${id}/estado`, null, {
      params: { nuevo_estado: estado },
    })
    return res.data
  },

  // ── Documentos ──────────────────────────────────────────────────────────────

  uploadDocumentos: async (id: string, files: File[]): Promise<UploadResponse> => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    const res = await apiClient.post(`/depps/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  eliminarDocumento: async (deppId: string, docId: string): Promise<void> => {
    await apiClient.delete(`/depps/${deppId}/documentos/${docId}`)
  },

  // ── Validaciones ────────────────────────────────────────────────────────────

  validar: async (id: string): Promise<DEPP> => {
    const res = await apiClient.post(`/depps/${id}/validar`)
    return res.data
  },

  validarIA: async (id: string): Promise<DEPP> => {
    const res = await apiClient.post(`/depps/${id}/validar-ia`)
    return res.data
  },
}

export const clientesApi = {
  list: async (): Promise<Cliente[]> => {
    const res = await apiClient.get('/usuarios/clientes')
    return res.data
  },
}
