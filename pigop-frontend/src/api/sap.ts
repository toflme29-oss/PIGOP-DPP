import apiClient from './client'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SAPModo {
  modo: string
  activo: boolean
  descripcion: string
}

export interface SAPStatus {
  modo: string
  disponible: boolean
  descripcion: string
  modos_disponibles: SAPModo[]
}

export interface SAPPreviewRow {
  folio: string | null
  upp: string | null
  ejercicio: number | null
  mes: number | null
  monto_total: number | null
  beneficiario: string | null
  clasificador: string | null
  [key: string]: unknown
}

export interface SAPError {
  fila?: number
  folio?: string
  error: string
}

export interface SAPPreviewResponse {
  log_id: string
  estado: string
  nombre_archivo: string
  total_filas: number
  preview: SAPPreviewRow[] | null
  errores: SAPError[] | null
}

export interface SAPConfirmarResponse {
  log_id: string
  estado: string
  total_filas: number
  depps_creados: number
  depps_omitidos: number
  depps_error: number
  errores: SAPError[] | null
  mensaje: string
}

export interface SAPImportLog {
  id: string
  modo: string
  nombre_archivo: string | null
  ejercicio: number
  mes: number | null
  estado: string
  total_filas: number | null
  depps_creados: number | null
  depps_omitidos: number | null
  depps_error: number | null
  iniciado_en: string | null
  completado_en: string | null
}

// ── API ────────────────────────────────────────────────────────────────────────

export const sapApi = {
  /** Estado actual de la conexión SAP */
  status: async (): Promise<SAPStatus> => {
    const res = await apiClient.get('/sap/status')
    return res.data
  },

  /** Descarga plantilla Excel — abre en nueva pestaña */
  downloadTemplate: () => {
    const token = localStorage.getItem('access_token')
    const base = (apiClient.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
    const url = `${base}/sap/import/template`
    // Usa fetch para incluir el token
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'PIGOP_Plantilla_SAP_2026.xlsx'
        a.click()
        URL.revokeObjectURL(a.href)
      })
  },

  /**
   * Paso 1 — preview: sube archivo y retorna las primeras filas sin crear DEPPs.
   */
  preview: async (
    file: File,
    ejercicio: number,
    mes?: number | null,
    uppFiltro?: string | null,
  ): Promise<SAPPreviewResponse> => {
    const form = new FormData()
    form.append('file', file)
    const params: Record<string, unknown> = { ejercicio }
    if (mes) params.mes = mes
    if (uppFiltro) params.upp_filtro = uppFiltro
    const res = await apiClient.post('/sap/import/preview', form, {
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /**
   * Paso 2 — confirmar: ejecuta la importación real.
   * El usuario sube el mismo archivo del preview.
   */
  confirmar: async (logId: string, file: File): Promise<SAPConfirmarResponse> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/sap/import/confirmar/${logId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /** Historial de importaciones */
  logs: async (limit = 20): Promise<SAPImportLog[]> => {
    const res = await apiClient.get('/sap/import/logs', { params: { limit } })
    return res.data
  },
}
