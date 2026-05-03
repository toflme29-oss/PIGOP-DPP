import apiClient from './client'

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface MembreteCampo {
  key: string
  label: string
  x: number
  y: number
  multiline: boolean
  max_width: number
}

export interface MembreteConfig {
  fontsize: number
  max_chars: number
  line_height: number
  fecha_y: number
  campos: MembreteCampo[]
}

export type TipoDocumento =
  | 'oficio' | 'circular' | 'memorandum' | 'acuerdo'
  | 'convenio' | 'resolucion' | 'informe' | 'otro'

export type Flujo = 'recibido' | 'emitido'
export type Prioridad = 'normal' | 'urgente' | 'muy_urgente'
export type EstadoRecibido = 'recibido' | 'turnado' | 'en_atencion' | 'devuelto' | 'respondido' | 'firmado' | 'archivado' | 'de_conocimiento'
export type EstadoEmitido  = 'borrador' | 'en_revision' | 'vigente' | 'archivado'
export type Estado = EstadoRecibido | EstadoEmitido

export interface AreaDPP {
  codigo:  string
  nombre:  string
  titular: string
  cargo:   string
}

export interface PlantillaOficio {
  categoria:        string
  nombre:           string
  area_origen:      string
  fundamento_legal: string
}

export interface UsuarioInfo {
  id: string
  nombre_completo: string
  email: string
}

export interface DocumentoListItem {
  id: string
  flujo: Flujo
  numero_control:       string | null
  numero_oficio_origen: string | null
  tipo: TipoDocumento
  asunto: string
  remitente_nombre:      string | null
  remitente_cargo:       string | null
  remitente_dependencia: string | null
  dependencia_origen:    string | null
  dependencia_destino:   string | null
  destinatario_nombre:   string | null
  destinatario_cargo:    string | null
  fecha_documento:  string | null
  fecha_recibido:   string | null
  fecha_limite:     string | null
  prioridad:        Prioridad
  estado:           Estado
  nombre_archivo:   string | null
  ocr_procesado:    boolean
  area_turno:       string | null
  area_turno_nombre: string | null
  area_turno_confirmada: boolean
  genera_tramite:   string | null
  instrucciones_turno: string | null
  tags:             string[] | null
  version:          number
  motivo_devolucion: string | null
  firmado_digitalmente: boolean | null
  requiere_respuesta: boolean
  despachado:       boolean
  acuse_recibido_url:    string | null
  acuse_recibido_nombre: string | null
  acuse_recibido_fecha:  string | null
  visto_bueno_subdirector: boolean
  upp_solicitante:  string | null
  tipo_memorandum:  string | null
  dependencia_solicitante: string | null
  upp_solicitante_codigo: string | null
  documento_origen_id: string | null
  memorandum_orden_direccion: number | null
  has_borrador:     boolean
  folio_respuesta:  string | null
  fecha_respuesta:  string | null
  creado_en:        string
}

export interface Documento extends DocumentoListItem {
  cliente_id:            string
  descripcion:           string | null
  datos_extraidos_ia:    Record<string, unknown> | null
  sugerencia_area_codigo: string | null
  sugerencia_area_nombre: string | null
  sugerencia_fundamento:  string | null
  sugerencia_plazo_dias:  number | null
  confianza_clasificacion: number | null
  regla_turno_codigo:    string | null
  borrador_respuesta:    string | null
  referencia_elaboro:    string | null
  referencia_reviso:     string | null
  tabla_imagen_url:      string | null
  tabla_imagen_nombre:   string | null
  tabla_datos_json:      string[][] | null
  url_storage:           string | null
  mime_type:             string | null
  firmado_digitalmente:  boolean | null
  firma_metadata:        Record<string, unknown> | null
  version:               number
  devuelto_por_id:       string | null
  devuelto_en:           string | null
  motivo_devolucion:     string | null
  atendido_por_id:       string | null
  atendido_en:           string | null
  atendido_area:         string | null
  referencia_archivo_nombre: string | null
  referencia_archivo_url:    string | null
  contenido_referencia:      string | null
  oficio_externo_url:        string | null
  oficio_externo_nombre:     string | null
  actualizado_en:        string | null
  creado_por:            UsuarioInfo | null
  turnado_por:           UsuarioInfo | null
}

export interface DocumentoRecibidoCreate {
  cliente_id:            string
  tipo?:                 TipoDocumento
  asunto:                string
  numero_oficio_origen?: string
  remitente_nombre?:     string
  remitente_cargo?:      string
  remitente_dependencia?: string
  fecha_documento?:      string
  fecha_recibido?:       string
  prioridad?:            Prioridad
  descripcion?:          string
  tags?:                 string[]
  requiere_respuesta?:   boolean
  // Archivo pre-subido (desde preview-ocr)
  nombre_archivo?:       string
  url_storage?:          string
  mime_type?:            string
  // Datos OCR pre-procesados (desde preview-ocr)
  datos_extraidos_ia?:   Record<string, unknown>
  ocr_procesado?:        boolean
  sugerencia_area_codigo?: string
  sugerencia_area_nombre?: string
  sugerencia_fundamento?:  string
  sugerencia_plazo_dias?:  number
  confianza_clasificacion?: number
  regla_turno_codigo?:   string
  genera_tramite?:       string
  fecha_limite?:         string
}

export interface DocumentoEmitidoCreate {
  cliente_id:         string
  tipo:               TipoDocumento
  asunto:             string
  numero_control?:    string
  dependencia_origen?:  string
  dependencia_destino?: string
  destinatario_nombre?: string
  destinatario_cargo?:  string
  fecha_documento?:   string
  estado?:            EstadoEmitido
  descripcion?:       string
  referencia_elaboro?: string
  referencia_reviso?:  string
  area_turno?:        string
  area_turno_nombre?: string
  folio_respuesta?:   string
  tags?:              string[]
}

export interface DocumentoUpdate {
  asunto?:             string
  numero_control?:     string
  numero_oficio_origen?: string
  tipo?:               TipoDocumento
  remitente_nombre?:   string
  remitente_cargo?:    string
  remitente_dependencia?: string
  dependencia_origen?:  string
  dependencia_destino?: string
  destinatario_nombre?: string
  destinatario_cargo?:  string
  fecha_documento?:    string
  fecha_recibido?:     string
  prioridad?:          Prioridad
  estado?:             Estado
  descripcion?:        string
  borrador_respuesta?: string
  folio_respuesta?:    string
  fecha_respuesta?:    string
  referencia_elaboro?: string
  referencia_reviso?:  string
  firmado_digitalmente?: boolean
  firma_metadata?:     Record<string, unknown>
  tags?:               string[]
}

export interface OficioEstructuradoResult {
  secciones: {
    fundamento: string
    referencia: string
    objeto:     string
    cierre:     string
  }
  borrador_completo: string
  message:           string
}

export interface FirmaResult {
  firmado_digitalmente: boolean
  firma_metadata:       Record<string, unknown>
  message:              string
}

export interface HistorialItem {
  id: string
  tipo_accion: string
  estado_anterior: string | null
  estado_nuevo: string | null
  observaciones: string
  version: number
  timestamp: string
  usuario_nombre: string | null
}

export interface DevolucionResult {
  documento_id: string
  estado: string
  historial_entry: HistorialItem
  message: string
}

export interface CertificadoValidation {
  valido: boolean
  serial: string | null
  rfc: string
  nombre: string
  valido_desde: string | null
  valido_hasta: string | null
  message: string
}

export interface LoteFirmaItem {
  id: string
  documento_id: string
  orden: number
  estado: string
  hash_documento: string | null
  qr_data: string | null
  error_mensaje: string | null
  firmado_en: string | null
  asunto?: string
  numero_oficio_origen?: string
  folio_respuesta?: string
}

export interface LoteFirma {
  id: string
  nombre: string | null
  estado: string
  certificado_serial: string | null
  certificado_rfc: string | null
  certificado_nombre: string | null
  total_documentos: number
  total_firmados: number
  total_errores: number
  progreso_pct: number
  items: LoteFirmaItem[]
  creado_en: string
  completado_en: string | null
}

export interface FirmaLoteResult {
  lote_firma: LoteFirma
  message: string
}

export interface OCRResult {
  datos_extraidos: Record<string, unknown>
  clasificacion:   Record<string, unknown>
  fecha_limite:    string
  message:         string
}

export interface PreviewOCRResult {
  datos_extraidos: Record<string, unknown>
  clasificacion:   Record<string, unknown>
  fecha_limite:    string
  archivo: {
    nombre_archivo: string
    url_storage:    string
    mime_type:      string
  }
  message:         string
  prioridad_sugerida?: string  // normal | urgente | muy_urgente
  duplicado?: {
    id: string
    numero_oficio: string
    asunto: string
    fecha: string
  } | null
}

// ── Labels y config visual ─────────────────────────────────────────────────────

export const TIPO_LABELS: Record<TipoDocumento, string> = {
  oficio:     'Oficio',
  circular:   'Circular',
  memorandum: 'Memorándum',
  acuerdo:    'Acuerdo',
  convenio:   'Convenio',
  resolucion: 'Resolución',
  informe:    'Informe',
  otro:       'Otro',
}

export const TIPO_ICONS: Record<TipoDocumento, string> = {
  oficio:     '📄',
  circular:   '📢',
  memorandum: '📝',
  acuerdo:    '🤝',
  convenio:   '📋',
  resolucion: '⚖️',
  informe:    '📊',
  otro:       '📁',
}

export const PRIORIDAD_CONFIG: Record<Prioridad, { label: string; color: string; bg: string; dot: string }> = {
  normal:      { label: 'Normal',      color: '#374151', bg: '#f3f4f6', dot: '#9ca3af' },
  urgente:     { label: 'Urgente',     color: '#92400e', bg: '#fef3c7', dot: '#d97706' },
  muy_urgente: { label: 'Muy urgente', color: '#991b1b', bg: '#fee2e2', dot: '#ef4444' },
}

export const ESTADO_RECIBIDO_CONFIG: Record<EstadoRecibido, { label: string; color: string; bg: string; dot: string; step: number }> = {
  recibido:    { label: 'Recibido',    color: '#1e40af', bg: '#dbeafe', dot: '#3b82f6', step: 1 },
  turnado:     { label: 'Turnado',     color: '#92400e', bg: '#fef3c7', dot: '#f59e0b', step: 2 },
  en_atencion: { label: 'En atención', color: '#7e22ce', bg: '#f3e8ff', dot: '#a855f7', step: 3 },
  devuelto:    { label: 'Devuelto',    color: '#991b1b', bg: '#fee2e2', dot: '#dc2626', step: 3 },
  respondido:  { label: 'Respondido',  color: '#0369a1', bg: '#e0f2fe', dot: '#0ea5e9', step: 4 },
  firmado:     { label: 'Firmado',     color: '#065f46', bg: '#d1fae5', dot: '#10b981', step: 5 },
  archivado:       { label: 'Archivado',       color: '#374151', bg: '#f3f4f6', dot: '#6b7280', step: 6 },
  de_conocimiento: { label: 'De conocimiento', color: '#0e7490', bg: '#e0f7fa', dot: '#06b6d4', step: 6 },
}

export const ESTADO_EMITIDO_CONFIG: Record<EstadoEmitido, { label: string; color: string; bg: string; dot: string }> = {
  borrador:    { label: 'Borrador',     color: '#92400e', bg: '#fef3c7', dot: '#d97706' },
  en_revision: { label: 'En revisión',  color: '#7e22ce', bg: '#f3e8ff', dot: '#a855f7' },
  vigente:     { label: 'Vigente',      color: '#065f46', bg: '#d1fae5', dot: '#10b981' },
  archivado:   { label: 'Archivado',    color: '#374151', bg: '#f3f4f6', dot: '#6b7280' },
}

// ── Certificados e.firma (bóveda) ─────────────────────────────────────────────

export interface CertificadoInfo {
  tiene_certificado: boolean
  vigente: boolean
  rfc: string | null
  nombre_titular: string | null
  numero_serie: string | null
  valido_desde: string | null
  valido_hasta: string | null
  emisor: string | null
  activo: boolean
  total_firmas: number
  registrado_en: string | null
  ultima_firma_en: string | null
}

export interface CertificadoRegistro {
  rfc: string
  nombre_titular: string
  numero_serie: string
  valido_desde: string | null
  valido_hasta: string | null
  emisor: string | null
  message: string
}

export interface VigenciaResult {
  vigente: boolean
  dias_restantes: number | null
  valido_hasta: string | null
  message: string
}

// ── API client ─────────────────────────────────────────────────────────────────

export const documentosApi = {
  list: async (params?: {
    flujo?:      string
    tipo?:       string
    estado?:     string
    area_turno?: string
    cliente_id?: string
    busqueda?:   string
    fecha_desde?: string
    fecha_hasta?: string
    solo_urgentes?: boolean
    incluir_respuestas?: boolean
    skip?: number
    limit?: number
  }): Promise<{ items: DocumentoListItem[]; total: number }> => {
    const res = await apiClient.get('/documentos/', { params })
    const total = parseInt(res.headers['x-total-count'] || '0', 10)
    return { items: res.data, total }
  },

  areas: async (): Promise<AreaDPP[]> => {
    const res = await apiClient.get('/documentos/areas')
    return res.data
  },

  /** Obtener catálogo de plantillas de oficios (opcionalmente por área) */
  plantillas: async (areaCodigo?: string): Promise<PlantillaOficio[]> => {
    const params: Record<string, string> = {}
    if (areaCodigo) params.area_codigo = areaCodigo
    const res = await apiClient.get('/documentos/plantillas', { params })
    return res.data
  },

  get: async (id: string): Promise<Documento> => {
    const res = await apiClient.get(`/documentos/${id}`)
    return res.data
  },

  previewOCR: async (file: File): Promise<PreviewOCRResult> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post('/documentos/preview-ocr', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  crearRecibido: async (data: DocumentoRecibidoCreate): Promise<Documento> => {
    const res = await apiClient.post('/documentos/recibido', data)
    return res.data
  },

  crearEmitido: async (data: DocumentoEmitidoCreate): Promise<Documento> => {
    const res = await apiClient.post('/documentos/emitido', data)
    return res.data
  },

  update: async (id: string, data: DocumentoUpdate): Promise<Documento> => {
    const res = await apiClient.put(`/documentos/${id}`, data)
    return res.data
  },

  cambiarEstado: async (id: string, estado: Estado): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/estado`, null, {
      params: { nuevo_estado: estado },
    })
    return res.data
  },

  acusarConocimiento: async (id: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/acusar-conocimiento`)
    return res.data
  },

  // Secretaría: cambiar si un oficio requiere respuesta o es solo conocimiento
  cambiarTipoRespuesta: async (id: string, requiere_respuesta: boolean): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/cambiar-tipo-respuesta`, { requiere_respuesta })
    return res.data
  },

  cargarReferencia: async (id: string, file: File): Promise<Documento> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/documentos/${id}/cargar-referencia`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  eliminarReferencia: async (id: string): Promise<Documento> => {
    const res = await apiClient.delete(`/documentos/${id}/referencia`)
    return res.data
  },

  cargarTablaImagen: async (id: string, file: File): Promise<Documento> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/documentos/${id}/tabla-imagen`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  eliminarTablaImagen: async (id: string): Promise<Documento> => {
    const res = await apiClient.delete(`/documentos/${id}/tabla-imagen`)
    return res.data
  },

  // ── Acuse de recibido ──
  subirAcuseRecibido: async (id: string, archivo: File, fechaAcuse?: string): Promise<Documento> => {
    const form = new FormData()
    form.append('archivo', archivo)
    if (fechaAcuse) form.append('fecha_acuse', fechaAcuse)
    const res = await apiClient.post(`/documentos/${id}/acuse-recibido`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },
  eliminarAcuseRecibido: async (id: string): Promise<Documento> => {
    const res = await apiClient.delete(`/documentos/${id}/acuse-recibido`)
    return res.data
  },
  obtenerAcuseRecibidoUrl: async (id: string): Promise<string> => {
    const res = await apiClient.get(`/documentos/${id}/acuse-recibido/archivo`, { responseType: 'blob' })
    return URL.createObjectURL(res.data)
  },

  procesarOCR: async (id: string, file: File): Promise<OCRResult> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/documentos/${id}/procesar-ocr`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  clasificar: async (id: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/clasificar`)
    return res.data
  },

  confirmarTurno: async (id: string, area_codigo: string, area_nombre?: string, instrucciones?: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/confirmar-turno`, {
      area_codigo, area_nombre, instrucciones: instrucciones || undefined,
    })
    return res.data
  },

  cambiarTurno: async (id: string, area_codigo: string, area_nombre?: string, instrucciones?: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/cambiar-turno`, {
      area_codigo, area_nombre, instrucciones: instrucciones || undefined,
    })
    return res.data
  },

  generarBorrador: async (id: string, instrucciones?: string): Promise<Documento> => {
    const body = instrucciones ? { instrucciones } : undefined
    const res = await apiClient.post(`/documentos/${id}/generar-borrador`, body)
    return res.data
  },

  subirOficioExterno: async (id: string, file: File): Promise<Documento> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/documentos/${id}/subir-oficio-externo`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  eliminarOficioExterno: async (id: string): Promise<Documento> => {
    const res = await apiClient.delete(`/documentos/${id}/oficio-externo`)
    return res.data
  },

  extraerDatosOficioExterno: async (id: string): Promise<{ no_oficio_extraido: string | null; fecha_extraida: string | null }> => {
    const res = await apiClient.get(`/documentos/${id}/extraer-datos-oficio-externo`)
    return res.data
  },

  uploadArchivo: async (id: string, file: File): Promise<Documento> => {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post(`/documentos/${id}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  generarOficioEstructurado: async (id: string, instrucciones?: string): Promise<OficioEstructuradoResult> => {
    const body = instrucciones ? { instrucciones } : undefined
    const res = await apiClient.post(`/documentos/${id}/generar-oficio-estructurado`, body)
    return res.data
  },

  descargarOficio: async (id: string, folioRespuesta?: string | null): Promise<void> => {
    const res = await apiClient.post(`/documentos/${id}/descargar-oficio`, null, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url

    // Construir nombre desde folio (cliente-side, sin depender del header CORS).
    // Formato folio: "SFA/SF/DPP/1260/2026" → "OF. RESP. 1260-2026.docx"
    let nombreArchivo = `OF. RESP. ${id.slice(0, 8)}.docx` // fallback con parte del UUID
    if (folioRespuesta) {
      const partes = folioRespuesta.split('/').map(p => p.trim()).filter(Boolean)
      if (partes.length >= 2) {
        const consecutivo = partes[partes.length - 2]
        const anio        = partes[partes.length - 1]
        nombreArchivo = `OF. RESP. ${consecutivo}-${anio}.docx`
      } else if (folioRespuesta.trim()) {
        nombreArchivo = `OF. RESP. ${folioRespuesta.trim()}.docx`
      }
    } else {
      // Intentar leer del header CORS si está disponible
      const disposition = res.headers['content-disposition'] || ''
      const matchStar  = disposition.match(/filename\*=UTF-8''([^;\s]+)/i)
      const matchPlain = disposition.match(/filename="([^"]+)"/)
      if (matchStar)       nombreArchivo = decodeURIComponent(matchStar[1])
      else if (matchPlain) nombreArchivo = matchPlain[1]
    }

    a.download = nombreArchivo
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    a.remove()
  },

  firmarDocumento: async (
    id: string,
    password: string,
    cerFile?: File,
    keyFile?: File,
  ): Promise<FirmaResult> => {
    const formData = new FormData()
    formData.append('password', password)
    if (cerFile) formData.append('cer_file', cerFile)
    if (keyFile) formData.append('key_file', keyFile)
    const res = await apiClient.post(`/documentos/${id}/firmar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  delete: async (id: string): Promise<{ message: string; success: boolean }> => {
    const res = await apiClient.delete(`/documentos/${id}?confirmar=si`)
    return res.data
  },

  // ── Despacho (secretaria) ──
  acusarDespacho: async (id: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/acusar-despacho`)
    return res.data
  },

  acusarDespachoLote: async (ids: string[]): Promise<{ message: string; success: boolean }> => {
    const res = await apiClient.post('/documentos/acusar-despacho-lote', { ids })
    return res.data
  },

  // ── Visto Bueno del Subdirector ──
  registrarVistoBueno: async (id: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/visto-bueno`)
    return res.data
  },

  // ── Memorándums ──
  registrarMemorandum: async (data: Record<string, unknown>): Promise<Documento> => {
    const res = await apiClient.post('/documentos/memorandum', data)
    return res.data
  },

  // ── Devolución y reenvío ──
  devolverDocumento: async (id: string, observaciones: string): Promise<DevolucionResult> => {
    const res = await apiClient.post(`/documentos/${id}/devolver`, { observaciones })
    return res.data
  },

  reenviarDocumento: async (id: string, comentario?: string): Promise<Documento> => {
    const res = await apiClient.post(`/documentos/${id}/reenviar`, { comentario: comentario || '' })
    return res.data
  },

  getHistorial: async (id: string): Promise<HistorialItem[]> => {
    const res = await apiClient.get(`/documentos/${id}/historial`)
    return res.data
  },

  listarDevueltos: async (areaTurno?: string): Promise<Documento[]> => {
    const params = areaTurno ? { area_turno: areaTurno } : {}
    const res = await apiClient.get('/documentos/devueltos', { params })
    return res.data
  },

  /** Obtener siguiente folio consecutivo (con área opcional para formato institucional) */
  siguienteFolio: async (
    tipo: string = 'OFICIO',
    areaCodigo?: string,
  ): Promise<{ folio: string; numero: number; anio: number; area_codigo?: string; prefijo?: string }> => {
    const params: Record<string, string> = { tipo }
    if (areaCodigo) params.area_codigo = areaCodigo
    const res = await apiClient.get('/documentos/siguiente-folio', { params })
    return res.data
  },

  /** Verificar si un folio ya existe en el sistema */
  verificarFolio: async (
    folio: string,
  ): Promise<{ disponible: boolean; documento_id?: string; folio: string }> => {
    const res = await apiClient.get('/documentos/verificar-folio', { params: { folio } })
    return res.data
  },

  /** Obtener PDF del oficio como blob URL (para visor embebido) */
  obtenerOficioPdfUrl: async (id: string): Promise<string> => {
    const res = await apiClient.get(`/documentos/${id}/descargar-oficio-pdf`, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'application/pdf' })
    return window.URL.createObjectURL(blob)
  },

  /** Obtener URL del archivo original (turnado/escaneado) como blob URL */
  obtenerArchivoOriginalUrl: async (id: string): Promise<string> => {
    const res = await apiClient.get(`/documentos/${id}/archivo-original`, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/pdf' })
    return window.URL.createObjectURL(blob)
  },

  /** Descargar PDF del oficio directamente */
  descargarOficioPdf: async (id: string): Promise<void> => {
    const res = await apiClient.get(`/documentos/${id}/descargar-oficio-pdf`, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'application/pdf' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disposition = res.headers['content-disposition'] || ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    a.download = match ? match[1] : `oficio_${id}.pdf`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    a.remove()
  },

  // ── Membrete institucional ──────────────────────────────────────────────────

  /** Subir nuevo membrete (PNG/JPG) para usarlo como fondo en los oficios PDF */
  subirMembrete: async (file: File): Promise<{ ok: boolean; filename: string; size_kb: number; mensaje: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await apiClient.post('/documentos/membrete', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /** Obtener información del membrete activo */
  infoMembrete: async (): Promise<{ activo: boolean; filename?: string; size_kb?: number; actualizado?: string; url?: string }> => {
    const res = await apiClient.get('/documentos/membrete/info')
    return res.data
  },

  /** URL de previsualización del membrete activo */
  membretePreviewUrl: (): string => {
    const base = (import.meta.env.VITE_API_URL as string) || '/api/v1'
    return `${base}/documentos/membrete/preview`
  },

  /** Obtener configuración de coordenadas del membrete */
  getMembreteConfig: async (): Promise<MembreteConfig> => {
    const res = await apiClient.get('/documentos/membrete/config')
    return res.data
  },

  /** Guardar configuración de coordenadas del membrete */
  saveMembreteConfig: async (cfg: MembreteConfig): Promise<{ ok: boolean; mensaje: string }> => {
    const res = await apiClient.put('/documentos/membrete/config', cfg)
    return res.data
  },
}

export const firmaLoteApi = {
  validarCertificado: async (cer: File, key: File, password: string): Promise<CertificadoValidation> => {
    const formData = new FormData()
    formData.append('cer_file', cer)
    formData.append('key_file', key)
    formData.append('password', password)
    const res = await apiClient.post('/firma-lote/validar-certificado', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  crear: async (documentoIds: string[]): Promise<LoteFirma> => {
    const res = await apiClient.post('/firma-lote/crear', { documento_ids: documentoIds })
    return res.data
  },

  ejecutar: async (
    loteId: string,
    password: string,
    cer?: File,
    key?: File,
  ): Promise<FirmaLoteResult> => {
    const formData = new FormData()
    formData.append('password', password)
    if (cer) formData.append('cer_file', cer)
    if (key) formData.append('key_file', key)
    const res = await apiClient.post(`/firma-lote/${loteId}/ejecutar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  get: async (loteId: string): Promise<LoteFirma> => {
    const res = await apiClient.get(`/firma-lote/${loteId}`)
    return res.data
  },

  list: async (): Promise<LoteFirma[]> => {
    const res = await apiClient.get('/firma-lote/')
    return res.data
  },
}

export const certificadosApi = {
  /** Obtener info del certificado registrado (sin clave privada) */
  miCertificado: async (): Promise<CertificadoInfo> => {
    const res = await apiClient.get('/certificados/mi-certificado')
    return res.data
  },

  /** Registrar certificado e.firma en la bóveda cifrada */
  registrar: async (cer: File, key: File, password: string): Promise<CertificadoRegistro> => {
    const formData = new FormData()
    formData.append('cer_file', cer)
    formData.append('key_file', key)
    formData.append('password', password)
    const res = await apiClient.post('/certificados/registrar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /** Validar vigencia del certificado */
  validarVigencia: async (): Promise<VigenciaResult> => {
    const res = await apiClient.post('/certificados/validar-vigencia')
    return res.data
  },

  /** Revocar certificado */
  revocar: async (): Promise<{ message: string; success: boolean }> => {
    const res = await apiClient.delete('/certificados/revocar')
    return res.data
  },

  /** Renovar certificado con nuevos archivos */
  renovar: async (cer: File, key: File, password: string): Promise<CertificadoRegistro> => {
    const formData = new FormData()
    formData.append('cer_file', cer)
    formData.append('key_file', key)
    formData.append('password', password)
    const res = await apiClient.post('/certificados/renovar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },
}

// ── Catálogo de UPPs y Funcionarios ─────────────────────────────────────────

export interface UPPItem {
  codigo_upp: string
  nombre_upp: string
}

export interface FuncionarioItem {
  id: number
  codigo_upp: string
  nombre_upp: string
  codigo_ur: string | null
  nombre_ur: string | null
  nombre_titular: string | null
  cargo: string | null
}

export const catalogoApi = {
  buscarUPPs: async (q: string = ''): Promise<UPPItem[]> => {
    const res = await apiClient.get('/catalogo/upps', { params: { q } })
    return res.data
  },
  buscarFuncionarios: async (q: string = '', upp: string = ''): Promise<FuncionarioItem[]> => {
    const res = await apiClient.get('/catalogo/funcionarios', { params: { q, upp } })
    return res.data
  },
}
