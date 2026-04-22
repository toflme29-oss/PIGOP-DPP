import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { permisosApi } from '../api/permisos'
import { setPermissionOverrides, getCachedVersion } from '../utils/rolePermissions'
import { useAuth } from './useAuth'

/**
 * Hidrata el cache de permisos desde backend al iniciar sesión
 * y hace polling liviano a /permisos/version para propagar cambios
 * hechos por otros usuarios sin refrescar la página.
 */
const POLL_INTERVAL_MS = 20_000

export function usePermissionsBootstrap(): void {
  const { user } = useAuth()

  // Carga completa: overrides + version. Se refetchea cuando changes en version lo invaliden.
  useQuery({
    queryKey: ['permisos', 'full'],
    queryFn: async () => {
      const res = await permisosApi.get()
      setPermissionOverrides(res.overrides, res.version)
      return res
    },
    enabled: !!user,
    staleTime: Infinity, // invalidación manual desde el polling
    refetchOnWindowFocus: false,
  })

  // Polling de versión. Si cambia, re-pide overrides y actualiza cache.
  const { data: versionData } = useQuery({
    queryKey: ['permisos', 'version'],
    queryFn: permisosApi.getVersion,
    enabled: !!user,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!versionData) return
    if (versionData.version === getCachedVersion()) return
    // Versión cambió → volver a leer overrides completos
    permisosApi.get().then((res) => {
      setPermissionOverrides(res.overrides, res.version)
    }).catch(() => { /* silencioso; reintentará en el próximo poll */ })
  }, [versionData])
}
