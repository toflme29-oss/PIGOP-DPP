import apiClient from './client'
import type { LoginRequest, TokenResponse, Usuario } from '../types'

export const authApi = {
  login: async (data: LoginRequest): Promise<TokenResponse> => {
    const res = await apiClient.post('/auth/login', data)
    return res.data
  },

  me: async (): Promise<Usuario> => {
    const res = await apiClient.get('/auth/me')
    return res.data
  },
}
