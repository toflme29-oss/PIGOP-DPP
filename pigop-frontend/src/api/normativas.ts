import apiClient from './client'

export interface Normativa {
  id: string
  clave: string
  titulo: string
  descripcion: string | null
  tipo: string          // ley | manual | lineamiento | reglamento | acuerdo | clasificador
  filename: string | null
  tamano_bytes: number | null
  aplica_tramite: string[] | null
  referencias_clave: { art: string; desc: string }[] | null
  orden: number
  url_descarga: string | null
}

export interface ChecklistItemApi {
  id: string
  tipo_tramite: string
  seccion: string | null
  pregunta: string
  detalle: string | null
  is_header: boolean
  is_subitem: boolean
  tipo_verificacion: string
  normativa_clave: string | null
  articulo_referencia: string | null
  orden: number
}

export interface ChecklistSeccion {
  nombre: string
  items: {
    id: string
    pregunta: string
    detalle: string | null
    is_subitem: boolean
    tipo_verificacion: string
    normativa_clave: string | null
    articulo_referencia: string | null
  }[]
}

export interface ChecklistResponse {
  tipo_tramite: string
  titulo: string
  total_items: number
  secciones: ChecklistSeccion[]
}

export const normativasApi = {
  /** Lista todos los documentos normativos */
  list: async (params?: { tipo?: string; tramite?: string }): Promise<Normativa[]> => {
    const res = await apiClient.get('/normativas/', { params })
    return res.data
  },

  /** URL directa al PDF (incluye token) */
  getPdfUrl: (clave: string): string => {
    const token = localStorage.getItem('access_token') ?? ''
    return `/api/v1/normativas/${clave}/pdf?token=${token}`
  },

  /** Checklist por tipo de trámite */
  getChecklist: async (tipo_tramite: string): Promise<ChecklistResponse> => {
    const res = await apiClient.get(`/normativas/checklist/${tipo_tramite}`)
    return res.data
  },
}

export const TRAMITE_LABELS: Record<string, string> = {
  fondo_revolvente: 'Fondo Revolvente',
  beneficiarios_directos: 'Beneficiarios Directos',
  viaticos: 'Viáticos',
  reasignacion_paraestales: 'Reasignación Paraestales',
}

export const TIPO_NORMATIVA_LABELS: Record<string, { label: string; color: string }> = {
  ley:          { label: 'Ley',          color: '#1e40af' },
  manual:       { label: 'Manual',       color: '#047857' },
  lineamiento:  { label: 'Lineamiento',  color: '#92400e' },
  reglamento:   { label: 'Reglamento',   color: '#6b21a8' },
  acuerdo:      { label: 'Acuerdo',      color: '#be185d' },
  clasificador: { label: 'Clasificador', color: '#0f766e' },
}

export const VERIFICACION_COLOR: Record<string, string> = {
  fiscal:       '#1d4ed8',   // azul
  documental:   '#374151',   // gris oscuro
  presupuestal: '#b45309',   // ámbar
  plazo:        '#dc2626',   // rojo
  exclusion:    '#7c3aed',   // violeta
}
