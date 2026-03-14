/**
 * Control de Oficios Recibidos
 * Vista tabular de los documentos registrados como "recibido" en Gestión Documental.
 * Genera folio interno secuencial y permite exportar a Excel.
 */
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Download, Search, ChevronLeft, ChevronRight, Eye, Mail, FileText, Loader2,
} from 'lucide-react'
import {
  documentosApi,
  ESTADO_RECIBIDO_CONFIG,
  PRIORIDAD_CONFIG,
  type DocumentoListItem,
  type EstadoRecibido,
} from '../api/documentos'
import { apiClient } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { PageSpinner } from '../components/ui/Spinner'

const GUINDA = '#911A3A'
const PAGE_SIZE = 25

// ── Exportar Excel (usa endpoint dedicado) ──────────────────────────────────

async function exportarExcelRecibidos(filters: {
  fecha_desde?: string
  fecha_hasta?: string
  dependencia?: string
  busqueda?: string
}) {
  const token = localStorage.getItem('access_token')
  const base = (apiClient.defaults.baseURL ?? '/api/v1').replace(/\/$/, '')
  const params = new URLSearchParams()
  if (filters.fecha_desde) params.set('fecha_desde', filters.fecha_desde)
  if (filters.fecha_hasta) params.set('fecha_hasta', filters.fecha_hasta)
  if (filters.dependencia) params.set('dependencia', filters.dependencia)
  if (filters.busqueda) params.set('busqueda', filters.busqueda)
  const qs = params.toString()
  const url = `${base}/documentos/export-recibidos${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Error al exportar: ${res.status} — ${text}`)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const disposition = res.headers.get('Content-Disposition')
  const filename = disposition?.match(/filename=(.+)/)?.[1] ?? 'PIGOP_Control_Oficios.xlsx'
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Modal Detalle ───────────────────────────────────────────────────────────

function ModalDetalle({ doc, folio, onClose }: { doc: DocumentoListItem; folio: number; onClose: () => void }) {
  const estadoCfg = ESTADO_RECIBIDO_CONFIG[doc.estado as EstadoRecibido]
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const hasFile = !!doc.nombre_archivo

  useEffect(() => {
    if (!hasFile) return
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(false)
    documentosApi.obtenerArchivoOriginalUrl(doc.id)
      .then((url) => { if (!cancelled) setPreviewUrl(url) })
      .catch(() => { if (!cancelled) setPreviewError(true) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [doc.id, hasFile])

  const handleDownload = async () => {
    try {
      const url = previewUrl ?? await documentosApi.obtenerArchivoOriginalUrl(doc.id)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.nombre_archivo ?? `oficio_${folio}.pdf`
      a.click()
    } catch {
      // silently fail
    }
  }

  const isPdf = doc.nombre_archivo?.toLowerCase().endsWith('.pdf')
  const isImage = /\.(jpe?g|png|webp|tiff?)$/i.test(doc.nombre_archivo ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl mx-4 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="text-lg font-bold" style={{ color: GUINDA }}>
            Oficio — Folio #{folio}
          </h2>
          <div className="flex items-center gap-2">
            {hasFile && (
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-1.5" />
                Descargar
              </Button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-500">✕</button>
          </div>
        </div>

        {/* Body: datos + preview lado a lado */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Panel izquierdo: datos */}
          <div className="w-80 flex-shrink-0 p-6 space-y-3 text-sm overflow-y-auto border-r">
            <InfoRow label="Folio Interno" value={String(folio)} />
            <InfoRow label="No. Oficio" value={doc.numero_oficio_origen ?? '—'} />
            <InfoRow label="Asunto" value={doc.asunto} />
            <InfoRow label="Remitente" value={doc.remitente_nombre ?? '—'} />
            <InfoRow label="Dependencia" value={doc.remitente_dependencia ?? doc.dependencia_origen ?? '—'} />
            <InfoRow label="Fecha Oficio" value={doc.fecha_documento ?? '—'} />
            <InfoRow label="Fecha Recibido" value={doc.fecha_recibido ?? '—'} />
            <InfoRow label="Prioridad" value={PRIORIDAD_CONFIG[doc.prioridad]?.label ?? doc.prioridad} />
            <div className="flex gap-2 items-center">
              <span className="font-medium text-gray-500 w-36 shrink-0">Estado:</span>
              {estadoCfg ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{ backgroundColor: estadoCfg.bg, color: estadoCfg.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: estadoCfg.dot }} />
                  {estadoCfg.label}
                </span>
              ) : (
                <span className="text-gray-800">{doc.estado}</span>
              )}
            </div>
            {doc.area_turno_nombre && <InfoRow label="Área Turno" value={doc.area_turno_nombre} />}
            {doc.fecha_limite && <InfoRow label="Fecha Límite" value={doc.fecha_limite} />}
            {doc.nombre_archivo && (
              <InfoRow label="Archivo" value={doc.nombre_archivo} />
            )}
          </div>

          {/* Panel derecho: previsualización */}
          <div className="flex-1 bg-gray-50 flex items-center justify-center overflow-hidden">
            {!hasFile ? (
              <div className="text-center text-gray-400 p-8">
                <FileText className="w-16 h-16 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Sin archivo adjunto</p>
              </div>
            ) : previewLoading ? (
              <div className="text-center text-gray-400">
                <Loader2 className="w-8 h-8 mx-auto animate-spin mb-2" />
                <p className="text-sm">Cargando previsualización...</p>
              </div>
            ) : previewError ? (
              <div className="text-center text-gray-400 p-8">
                <FileText className="w-16 h-16 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No se pudo cargar la previsualización</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-1.5" />
                  Descargar archivo
                </Button>
              </div>
            ) : previewUrl && isPdf ? (
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title="Previsualización del oficio"
              />
            ) : previewUrl && isImage ? (
              <img
                src={previewUrl}
                alt="Previsualización del oficio"
                className="max-w-full max-h-full object-contain p-4"
              />
            ) : previewUrl ? (
              <div className="text-center text-gray-400 p-8">
                <FileText className="w-16 h-16 mx-auto mb-3 opacity-40" />
                <p className="text-sm mb-1">{doc.nombre_archivo}</p>
                <p className="text-xs text-gray-300 mb-3">Formato no previsualizable</p>
                <Button variant="secondary" size="sm" onClick={handleDownload}>
                  <Download className="w-4 h-4 mr-1.5" />
                  Descargar archivo
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-3 border-t flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-medium text-gray-500 w-36 shrink-0">{label}:</span>
      <span className="text-gray-800">{value}</span>
    </div>
  )
}

// ── Página principal ────────────────────────────────────────────────────────

export default function ControlOficios() {
  // Filtros
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [dependencia, setDependencia] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaActiva, setBusquedaActiva] = useState('')
  const [skip, setSkip] = useState(0)

  // Modal
  const [detalle, setDetalle] = useState<{ doc: DocumentoListItem; folio: number } | null>(null)
  const [exportError, setExportError] = useState('')

  // Query documentos recibidos
  const { data: docs, isLoading } = useQuery({
    queryKey: ['oficios-control', fechaDesde, fechaHasta, dependencia, busquedaActiva, skip],
    queryFn: () =>
      documentosApi.list({
        flujo: 'recibido',
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
        busqueda: busquedaActiva || undefined,
        skip,
        limit: PAGE_SIZE,
      }),
  })

  // Total estimado y paginación
  const items = docs ?? []
  const hasMore = items.length === PAGE_SIZE
  const currentPage = Math.floor(skip / PAGE_SIZE) + 1

  const handleSearch = () => {
    setBusquedaActiva(busqueda)
    setSkip(0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleExport = async () => {
    setExportError('')
    try {
      await exportarExcelRecibidos({
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
        dependencia: dependencia || undefined,
        busqueda: busquedaActiva || undefined,
      })
    } catch (e: any) {
      setExportError(e.message ?? 'Error al exportar Excel')
    }
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-4">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={handleExport} disabled={items.length === 0}>
          <Download className="w-4 h-4 mr-1.5" />
          Exportar Excel
        </Button>
        <div className="flex-1" />
        <Badge variant="default">
          {items.length} oficio{items.length !== 1 ? 's' : ''} en vista
        </Badge>
      </div>

      {/* Filtros */}
      <Card>
        <div className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Desde</span>
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => { setFechaDesde(e.target.value); setSkip(0) }}
                className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-rose-800 focus:ring-1 focus:ring-rose-800 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Hasta</span>
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => { setFechaHasta(e.target.value); setSkip(0) }}
                className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-rose-800 focus:ring-1 focus:ring-rose-800 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Dependencia</span>
              <input
                type="text"
                value={dependencia}
                onChange={(e) => { setDependencia(e.target.value); setSkip(0) }}
                placeholder="Filtrar dependencia..."
                className="mt-1 block rounded-lg border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-rose-800 focus:ring-1 focus:ring-rose-800 outline-none"
              />
            </label>
            <div className="flex items-end gap-1">
              <label className="block">
                <span className="text-xs font-medium text-gray-500">Búsqueda</span>
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="No. oficio, remitente, asunto..."
                  className="mt-1 block w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-rose-800 focus:ring-1 focus:ring-rose-800 outline-none"
                />
              </label>
              <button
                onClick={handleSearch}
                className="p-2 rounded-lg text-white hover:opacity-90"
                style={{ backgroundColor: GUINDA }}
              >
                <Search className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </Card>

      {/* Error de exportación */}
      {exportError && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm border border-red-200 flex items-center justify-between">
          <span>{exportError}</span>
          <button onClick={() => setExportError('')} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Tabla */}
      {items.length === 0 ? (
        <Card>
          <div className="p-12 text-center">
            <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">
              No se encontraron oficios recibidos. Registra uno desde la pestaña "Correspondencia recibida" o ajusta los filtros.
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-white" style={{ backgroundColor: GUINDA }}>
                  <th className="px-3 py-2.5 text-left font-semibold">Folio</th>
                  <th className="px-3 py-2.5 text-left font-semibold">No. Oficio</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Asunto</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Remitente</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Dependencia</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Estado</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Fecha</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((doc, idx) => {
                  const folio = skip + idx + 1
                  const estadoCfg = ESTADO_RECIBIDO_CONFIG[doc.estado as EstadoRecibido]
                  return (
                    <tr
                      key={doc.id}
                      className={`hover:bg-rose-50/50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                    >
                      <td className="px-3 py-2 font-mono font-bold" style={{ color: GUINDA }}>
                        {folio}
                      </td>
                      <td className="px-3 py-2 font-medium text-xs">
                        {doc.numero_oficio_origen ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-xs truncate" title={doc.asunto}>
                        {doc.asunto}
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{doc.remitente_nombre ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs max-w-[160px] truncate">
                        {doc.remitente_dependencia ?? doc.dependencia_origen ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {estadoCfg && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                            style={{ backgroundColor: estadoCfg.bg, color: estadoCfg.color }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: estadoCfg.dot }} />
                            {estadoCfg.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                        {doc.fecha_recibido ?? doc.fecha_documento ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setDetalle({ doc, folio })}
                          title="Ver detalle"
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-500">
            <span>Página {currentPage}</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={skip <= 0}
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasMore}
                onClick={() => setSkip(skip + PAGE_SIZE)}
              >
                Siguiente <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Modal detalle */}
      {detalle && (
        <ModalDetalle doc={detalle.doc} folio={detalle.folio} onClose={() => setDetalle(null)} />
      )}
    </div>
  )
}
