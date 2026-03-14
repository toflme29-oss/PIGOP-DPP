/**
 * SAPImport — Wizard de 3 pasos para importar DEPPs desde archivo Excel/CSV exportado de SAP GRP.
 *
 * Paso 1 · Cargar   → seleccionar archivo + parámetros → preview
 * Paso 2 · Revisar  → mostrar filas detectadas y errores → confirmar
 * Paso 3 · Resultado → resumen de DEPPs creados / omitidos / con error
 */
import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
  ArrowRight, ArrowLeft, RotateCcw, ExternalLink,
  Download, Info, Wifi, WifiOff, ChevronRight,
  FileCheck, XCircle, Loader2,
} from 'lucide-react'
import { sapApi, type SAPPreviewResponse, type SAPConfirmarResponse } from '../api/sap'
import { formatCurrency } from '../utils'

// ── Constantes ─────────────────────────────────────────────────────────────────

const GUINDA = '#911A3A'

const MESES = [
  { v: 1, l: 'Enero' }, { v: 2, l: 'Febrero' }, { v: 3, l: 'Marzo' },
  { v: 4, l: 'Abril' }, { v: 5, l: 'Mayo' }, { v: 6, l: 'Junio' },
  { v: 7, l: 'Julio' }, { v: 8, l: 'Agosto' }, { v: 9, l: 'Septiembre' },
  { v: 10, l: 'Octubre' }, { v: 11, l: 'Noviembre' }, { v: 12, l: 'Diciembre' },
]

type Step = 1 | 2 | 3

// ── Componente principal ───────────────────────────────────────────────────────

export default function SAPImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // ── Estado wizard ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [ejercicio, setEjercicio] = useState(2026)
  const [mes, setMes] = useState<number | ''>('')
  const [uppFiltro, setUppFiltro] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [previewData, setPreviewData] = useState<SAPPreviewResponse | null>(null)
  const [resultado, setResultado] = useState<SAPConfirmarResponse | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── SAP status ─────────────────────────────────────────────────────────────
  const { data: sapStatus } = useQuery({
    queryKey: ['sap-status'],
    queryFn: sapApi.status,
    staleTime: 60_000,
  })

  // ── Historial ──────────────────────────────────────────────────────────────
  const { data: historial } = useQuery({
    queryKey: ['sap-logs'],
    queryFn: () => sapApi.logs(10),
    staleTime: 30_000,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const previewMutation = useMutation({
    mutationFn: () =>
      sapApi.preview(file!, ejercicio, mes || null, uppFiltro || null),
    onSuccess: (data) => {
      setPreviewData(data)
      setStep(2)
    },
  })

  const confirmarMutation = useMutation({
    mutationFn: () =>
      sapApi.confirmar(previewData!.log_id, file!),
    onSuccess: (data) => {
      setResultado(data)
      setStep(3)
      qc.invalidateQueries({ queryKey: ['depps'] })
      qc.invalidateQueries({ queryKey: ['sap-logs'] })
    },
  })

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv'))) {
      setFile(f)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0])
  }

  const resetWizard = () => {
    setStep(1)
    setFile(null)
    setPreviewData(null)
    setResultado(null)
    setMes('')
    setUppFiltro('')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-gray-50 p-6">
      {/* ── Encabezado ───────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <FileSpreadsheet size={20} style={{ color: GUINDA }} />
              Importación desde SAP GRP
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Carga masiva de DEPPs desde archivo Excel/CSV exportado de SAP
            </p>
          </div>

          {/* Estado SAP */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-white text-xs">
            {sapStatus?.disponible
              ? <Wifi size={13} className="text-green-500" />
              : <WifiOff size={13} className="text-gray-400" />
            }
            <span className="text-gray-600">
              Modo SAP: <span className="font-semibold capitalize">{sapStatus?.modo ?? '—'}</span>
            </span>
          </div>
        </div>

        {/* ── Stepper ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-0 mt-5">
          {(['Cargar Archivo', 'Previsualizar', 'Resultado'] as const).map((label, i) => {
            const n = (i + 1) as Step
            const done = step > n
            const active = step === n
            return (
              <div key={n} className="flex items-center flex-1">
                <div className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all
                  ${active ? 'text-white' : done ? 'text-white' : 'text-gray-400 bg-gray-100'}
                `}
                  style={{ backgroundColor: active ? GUINDA : done ? '#6B7280' : undefined }}>
                  {done
                    ? <CheckCircle2 size={13} />
                    : <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px]
                        ${active ? 'bg-white/20' : 'bg-gray-200 text-gray-500'}`}>{n}</span>
                  }
                  {label}
                </div>
                {n < 3 && <ChevronRight size={14} className="text-gray-300 mx-1 flex-shrink-0" />}
              </div>
            )
          })}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/*  PASO 1 — CARGAR ARCHIVO                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="max-w-5xl mx-auto grid grid-cols-3 gap-5">
          {/* Panel izquierdo: dropzone + parámetros */}
          <div className="col-span-2 space-y-4">
            {/* Dropzone */}
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${dragOver ? 'border-[#911A3A] bg-[#911A3A]/5' : 'border-gray-200 bg-white hover:border-gray-300'}
                ${file ? 'border-green-300 bg-green-50' : ''}
              `}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileCheck size={36} className="text-green-500" />
                  <p className="font-semibold text-green-800 text-sm">{file.name}</p>
                  <p className="text-xs text-green-600">
                    {(file.size / 1024).toFixed(1)} KB · Click para cambiar
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload size={36} className="text-gray-300" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      Arrastra tu archivo aquí o haz click para seleccionar
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Excel (.xlsx, .xls) o CSV · Máx 10 MB</p>
                  </div>
                </div>
              )}
            </div>

            {/* Parámetros */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-800">Parámetros de importación</h3>
              <div className="grid grid-cols-3 gap-4">
                {/* Ejercicio */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Ejercicio fiscal *
                  </label>
                  <select
                    value={ejercicio}
                    onChange={(e) => setEjercicio(+e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
                  >
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {/* Mes */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Mes (opcional)
                  </label>
                  <select
                    value={mes}
                    onChange={(e) => setMes(e.target.value ? +e.target.value : '')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30"
                  >
                    <option value="">Todos los meses</option>
                    {MESES.map((m) => (
                      <option key={m.v} value={m.v}>{m.l}</option>
                    ))}
                  </select>
                </div>

                {/* UPP filtro */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Filtrar UPP (opcional)
                  </label>
                  <input
                    type="text"
                    value={uppFiltro}
                    onChange={(e) => setUppFiltro(e.target.value.toUpperCase())}
                    placeholder="ej: 007"
                    maxLength={10}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#911A3A]/30 uppercase"
                  />
                </div>
              </div>
            </div>

            {/* Error de preview */}
            {previewMutation.isError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                <XCircle size={15} className="flex-shrink-0 mt-0.5" />
                {(previewMutation.error as Error)?.message ?? 'Error al procesar el archivo'}
              </div>
            )}

            {/* Botón siguiente */}
            <button
              onClick={() => previewMutation.mutate()}
              disabled={!file || previewMutation.isPending}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: GUINDA }}
            >
              {previewMutation.isPending
                ? <><Loader2 size={15} className="animate-spin" />Procesando archivo...</>
                : <><ArrowRight size={15} />Vista Previa del Archivo</>
              }
            </button>
          </div>

          {/* Panel derecho: instrucciones + historial */}
          <div className="space-y-4">
            {/* Instrucciones */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Info size={13} className="text-amber-600" />
                <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wide">Instrucciones</h4>
              </div>
              <ol className="text-xs text-amber-700 space-y-2">
                <li className="flex gap-2"><span className="font-bold">1.</span> Exporta los DEPPs de SAP GRP (FBL1N u otra transacción)</li>
                <li className="flex gap-2"><span className="font-bold">2.</span> Descarga la plantilla para ver las columnas requeridas</li>
                <li className="flex gap-2"><span className="font-bold">3.</span> Sube el archivo Excel o CSV</li>
                <li className="flex gap-2"><span className="font-bold">4.</span> Revisa la vista previa y confirma la importación</li>
              </ol>
              <button
                onClick={sapApi.downloadTemplate}
                className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-medium text-amber-800 border border-amber-300 bg-white rounded-lg px-3 py-2 hover:bg-amber-100 transition-colors"
              >
                <Download size={12} />
                Descargar Plantilla Excel
              </button>
            </div>

            {/* Historial */}
            {historial && historial.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-3">
                  Últimas importaciones
                </h4>
                <div className="space-y-2">
                  {historial.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center justify-between text-xs border-b border-gray-100 pb-2">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-700 truncate">{log.nombre_archivo ?? 'Sin nombre'}</p>
                        <p className="text-gray-400">
                          {log.ejercicio} · {log.depps_creados ?? 0} creados
                        </p>
                      </div>
                      <LogEstadoBadge estado={log.estado} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/*  PASO 2 — PREVISUALIZAR                                               */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === 2 && previewData && (
        <div className="max-w-5xl mx-auto space-y-5">
          {/* Resumen del análisis */}
          <div className="grid grid-cols-4 gap-4">
            <MetricCard
              label="Filas detectadas"
              value={previewData.total_filas}
              icon={<FileSpreadsheet size={16} className="text-blue-500" />}
              color="blue"
            />
            <MetricCard
              label="Archivo"
              value={previewData.nombre_archivo}
              icon={<FileCheck size={16} className="text-green-500" />}
              color="green"
              small
            />
            <MetricCard
              label="Estado"
              value={previewData.estado === 'pendiente' ? 'Listo para importar' : previewData.estado}
              icon={<CheckCircle2 size={16} className="text-emerald-500" />}
              color="emerald"
              small
            />
            <MetricCard
              label="Errores detectados"
              value={previewData.errores?.length ?? 0}
              icon={<AlertTriangle size={16} className={previewData.errores?.length ? 'text-amber-500' : 'text-gray-300'} />}
              color={previewData.errores?.length ? 'amber' : 'gray'}
            />
          </div>

          {/* Tabla de preview */}
          {previewData.preview && previewData.preview.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800">
                  Vista previa — primeras {previewData.preview.length} filas
                </h3>
                <span className="text-xs text-gray-400">
                  Los DEPPs con folio duplicado serán omitidos automáticamente
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Folio</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">UPP</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Ejercicio</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Mes</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Monto Total</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Beneficiario</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Clasificador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewData.preview.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono font-medium text-gray-900">{row.folio ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-700">{row.upp ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{row.ejercicio ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{row.mes ? MESES.find(m => m.v === row.mes)?.l : '—'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {row.monto_total != null ? formatCurrency(row.monto_total) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate">{row.beneficiario ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {row.clasificador
                            ? <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                                {row.clasificador as string}
                              </span>
                            : <span className="text-gray-400">—</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Errores */}
          {previewData.errores && previewData.errores.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} className="text-amber-600" />
                <h4 className="text-sm font-semibold text-amber-800">
                  {previewData.errores.length} advertencia(s) detectada(s)
                </h4>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {previewData.errores.map((err, i) => (
                  <div key={i} className="text-xs text-amber-700 bg-white border border-amber-100 rounded-lg px-3 py-2">
                    {err.fila && <span className="font-medium">Fila {err.fila}: </span>}
                    {err.folio && <span className="font-mono font-medium">{err.folio} — </span>}
                    {err.error}
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-600 mt-2">
                Las filas con errores serán omitidas. Las demás se importarán normalmente.
              </p>
            </div>
          )}

          {/* Error de confirmar */}
          {confirmarMutation.isError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              <XCircle size={15} className="flex-shrink-0 mt-0.5" />
              {(confirmarMutation.error as Error)?.message ?? 'Error al confirmar la importación'}
            </div>
          )}

          {/* Botones */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft size={14} />
              Volver a cargar
            </button>
            <button
              onClick={() => confirmarMutation.mutate()}
              disabled={confirmarMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: GUINDA }}
            >
              {confirmarMutation.isPending
                ? <><Loader2 size={14} className="animate-spin" />Importando DEPPs...</>
                : <><CheckCircle2 size={14} />Confirmar Importación — {previewData.total_filas} filas</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/*  PASO 3 — RESULTADO                                                   */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === 3 && resultado && (
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            {/* Ícono */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4
              ${resultado.depps_error === resultado.total_filas ? 'bg-red-100' : 'bg-green-100'}`}>
              {resultado.depps_error === resultado.total_filas
                ? <XCircle size={32} className="text-red-500" />
                : <CheckCircle2 size={32} className="text-green-500" />
              }
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {resultado.depps_creados > 0 ? 'Importación completada' : 'Sin registros nuevos'}
            </h2>
            <p className="text-sm text-gray-500 mb-6">{resultado.mensaje}</p>

            {/* Métricas resultado */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="text-3xl font-bold text-green-700">{resultado.depps_creados}</p>
                <p className="text-xs text-green-600 font-medium mt-1">DEPPs creados</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-3xl font-bold text-gray-600">{resultado.depps_omitidos}</p>
                <p className="text-xs text-gray-500 font-medium mt-1">Ya existían (omitidos)</p>
              </div>
              <div className={`border rounded-xl p-4 ${resultado.depps_error > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-3xl font-bold ${resultado.depps_error > 0 ? 'text-red-600' : 'text-gray-400'}`}>{resultado.depps_error}</p>
                <p className={`text-xs font-medium mt-1 ${resultado.depps_error > 0 ? 'text-red-500' : 'text-gray-400'}`}>Con error</p>
              </div>
            </div>

            {/* Errores del resultado */}
            {resultado.errores && resultado.errores.length > 0 && (
              <div className="text-left bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <p className="text-xs font-semibold text-amber-700 mb-2">Filas con error:</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {resultado.errores.map((err, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      {err.fila && `Fila ${err.fila}: `}{err.folio && `${err.folio} — `}{err.error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Acciones */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={resetWizard}
                className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RotateCcw size={14} />
                Importar otro archivo
              </button>
              <button
                onClick={() => navigate('/depps')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: GUINDA }}
              >
                <ExternalLink size={14} />
                Ver DEPPs en Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon, color, small,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  small?: boolean
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-100',
    green: 'bg-green-50 border-green-100',
    emerald: 'bg-emerald-50 border-emerald-100',
    amber: 'bg-amber-50 border-amber-100',
    gray: 'bg-gray-50 border-gray-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] ?? 'bg-gray-50 border-gray-100'}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-gray-500 font-medium">{label}</span></div>
      <p className={`font-bold text-gray-900 truncate ${small ? 'text-sm' : 'text-2xl'}`}>{value}</p>
    </div>
  )
}

function LogEstadoBadge({ estado }: { estado: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    completado:    { label: 'OK', cls: 'bg-green-100 text-green-700' },
    error_parcial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-700' },
    fallido:       { label: 'Error', cls: 'bg-red-100 text-red-700' },
    pendiente:     { label: 'Vista previa', cls: 'bg-blue-100 text-blue-700' },
    procesando:    { label: 'Procesando', cls: 'bg-purple-100 text-purple-700' },
  }
  const cfg = map[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0 ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
