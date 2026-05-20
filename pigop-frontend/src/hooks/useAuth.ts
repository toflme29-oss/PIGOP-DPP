import { useState, useEffect } from 'react'
import { authApi } from '../api/auth'
import type { Usuario } from '../types'

export function useAuth() {
  const [user, setUser] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      setLoading(false)
      return
    }
    authApi.me()
      .then(setUser)
      .catch(() => {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password })
    localStorage.setItem('access_token', res.access_token)
    // Guardar refresh_token para renovación automática de sesión
    if (res.refresh_token) {
      localStorage.setItem('refresh_token', res.refresh_token)
    }
    const me = await authApi.me()
    setUser(me)
    return me
  }

  const logout = () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    setUser(null)
  }

  return { user, loading, login, logout }
}
