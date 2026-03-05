import apiClient from './client'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface LoteMetricas {
  total: number
  revisados: number
  aprobados: number
  rechazados: number
  omitidos: number
  pendientes: number
  progreso_pct: number
  tiempo_total_seg: number | null
}

export interface ValidacionResumen {
  tipo: string
  resultado: string
  gravedad: string | null
  mensaje: string | null
}

export interface DeppEnLote {
  id: string
  folio: string
  upp: string
  ejercicio: number
  mes: number | null
  monto_total: number
  beneficiario: string | null
  clasificador_tipo: string | null
  capitulo: number | null
  estado: string
  validado_automaticamente: boolean
  puede_aprobar: boolean
  validaciones_resumen: ValidacionResumen[]
}

export interface LoteItem {
  id: string
  orden: number
  estado: string  // pendiente | en_revision | aprobado | rechazado | omitido
  observaciones: string | null
  tiempo_seg: number | null
  revisado_en: string | null
  depp: DeppEnLote | null
}

export interface Lote {
  id: string
  nombre: string
  descripcion: string | null
  tamaño: number
  ejercicio: number
  mes: number | null
  tipo_tramite: string | null
  upp_filtro: string | null
  estado: string  // pendiente | en_revision | completado | archivado
  revisor_id: string | null
  creado_por_id: string
  creado_en: string | null
  asignado_en: string | null
  iniciado_en: string | null
  completado_en: string | null
  metricas: LoteMetricas
  items: LoteItem[]
}

export type LoteListItem = Omit<Lote, 'items'> & { items: [] }

export interface LoteCreate {
  nombre: string
  descripcion?: string
  tamaño: 5 | 10 | 15
  ejercicio: number
  mes?: number | null
  tipo_tramite?: string | null
  upp_filtro?: string | null
  revisor_id?: string | null
  depp_ids?: string[] | null
}

export interface ItemRevisionBody {
  estado: 'aprobado' | 'rechazado' | 'omitido'
  observaciones?: string | null
  tiempo_seg?: number | null
}

export interface LoteResumen {
  lote_id: string
  nombre: string
  estado: string
  revisor_id: string | null
  ejercicio: number
  mes: number | null
  metricas: LoteMetricas & {
    tiempo_promedio_seg: number | null
  }
  items: {
    orden: number
    estado: string
    depp_folio: string | null
    depp_upp: string | null
    depp_monto: number | null
    observaciones: string | null
    tiempo_seg: number | null
  }[]
  iniciado_en: string | null
  completado_en: string | null
}

// ── API ────────────────────────────────────────────────────────────────────────

export const lotesApi = {
  /** Crear nuevo lote de revisión */
  crear: async (data: LoteCreate): Promise<Lote> => {
    const res = await apiClient.post('/lotes/', data)
    return res.data
  },

  /** Listar lotes (supervisor: todos; revisor: solo sus lotes) */
  listar: async (params?: {
    estado?: string
    ejercicio?: number
  }): Promise<LoteListItem[]> => {
    const res = await apiClient.get('/lotes/', { params })
    return res.data
  },

  /** Lotes activos asignados al usuario actual */
  miBandeja: async (): Promise<Lote[]> => {
    const res = await apiClient.get('/lotes/mi-bandeja')
    return res.data
  },

  /** Detalle completo de un lote con todos sus items */
  obtener: async (loteId: string): Promise<Lote> => {
    const res = await apiClient.get(`/lotes/${loteId}`)
    return res.data
  },

  /** Asignar revisor al lote (admin) */
  asignar: async (loteId: string, revisorId: string): Promise<Lote> => {
    const res = await apiClient.post(`/lotes/${loteId}/asignar`, { revisor_id: revisorId })
    return res.data
  },

  /** Marcar lote como en_revision (el revisor lo abre) */
  iniciar: async (loteId: string): Promise<Lote> => {
    const res = await apiClient.post(`/lotes/${loteId}/iniciar`)
    return res.data
  },

  /** Registrar dictamen sobre un item del lote */
  revisarItem: async (
    loteId: string,
    itemId: string,
    body: ItemRevisionBody,
  ): Promise<Lote> => {
    const res = await apiClient.post(`/lotes/${loteId}/items/${itemId}/revisar`, body)
    return res.data
  },

  /** Cerrar el lote manualmente */
  completar: async (loteId: string): Promise<Lote> => {
    const res = await apiClient.post(`/lotes/${loteId}/completar`)
    return res.data
  },

  /** Métricas del lote para reporte supervisor */
  resumen: async (loteId: string): Promise<LoteResumen> => {
    const res = await apiClient.get(`/lotes/${loteId}/resumen`)
    return res.data
  },

  /** Eliminar lote (solo si está pendiente) */
  eliminar: async (loteId: string): Promise<void> => {
    await apiClient.delete(`/lotes/${loteId}`)
  },
}
