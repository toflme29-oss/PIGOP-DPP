import apiClient from './client'

export interface PermisosResponse {
  overrides: Record<string, boolean>
  version: number
}

export interface VersionResponse {
  version: number
}

export const permisosApi = {
  get: async (): Promise<PermisosResponse> => {
    const res = await apiClient.get('/permisos/')
    return res.data
  },

  getVersion: async (): Promise<VersionResponse> => {
    const res = await apiClient.get('/permisos/version')
    return res.data
  },

  update: async (overrides: Record<string, boolean>): Promise<PermisosResponse> => {
    const res = await apiClient.put('/permisos/', { overrides })
    return res.data
  },
}
