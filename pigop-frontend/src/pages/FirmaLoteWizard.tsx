/**
 * FirmaLoteWizard — Wizard de 4 pasos para firma electrónica por lote.
 *
 * Paso 1: Revisión de documentos seleccionados
 * Paso 2: Carga y validación de certificado (.cer + .key + password)
 * Paso 3: Progreso de firma (polling)
 * Paso 4: Resultados finales
 */
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, FileSignature, Upload, CheckCircle2, AlertTriangle,
  RotateCcw, Shield, Lock, Eye, EyeOff, ChevronRight,
  FileText, QrCode,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  firmaLoteApi,
  certificadosApi,
  TIPO_ICONS,
  type DocumentoListItem,
  type CertificadoValidation,
  type CertificadoInfo,
  type LoteFirma,
  type LoteFirmaItem,
} from '../api/documentos'

const GUINDA = '#911A3A'

type WizardStep = 1 | 2 | 3 | 4

interface Props {
  documentos: DocumentoListItem[]
  onClose: () => void
  onComplete: () => void
}

export default function FirmaLoteWizard({ documentos, onClose, onComplete }: Props) {
  const [step, setStep] = useState<WizardStep>(1)

  // Paso 2: Certificado
  const [cerFile, setCerFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [validando, setValidando] = useState(false)
  const [certInfo, setCertInfo] = useState<CertificadoValidation | null>(null)
  const [certError, setCertError] = useState('')
  const cerRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  // Paso 3: Ejecución
  const [loteId, setLoteId] = useState<string | null>(null)
  const [ejecutando, setEjecutando] = useState(false)
  const [ejecutarError, setEjecutarError] = useState('')

  // Paso 4: Resultado
  const [resultado, setResultado] = useState<LoteFirma | null>(null)
  const [resultMessage, setResultMessage] = useState('')

  // Certificado registrado en bóveda
  const { data: certBoveda } = useQuery<CertificadoInfo>({
    queryKey: ['mi-certificado'],
    queryFn: certificadosApi.miCertificado,
  })
  const tieneCertBoveda = certBoveda?.tiene_certificado && certBoveda?.vigente

  // Polling para progreso (paso 3)
  const { data: lotePolling } = useQuery({
    queryKey: ['lote-firma', loteId],
    queryFn: () => loteId ? firmaLoteApi.get(loteId) : null,
    enabled: !!loteId && step === 3 && ejecutando,
    refetchInterval: 2000,
  })

  // ── Paso 2: Validar certificado ──
  const handleValidarCertificado = async () => {
    if (!cerFile || !keyFile || !password) return
    setValidando(true)
    setCertError('')
    try {
      const result = await firmaLoteApi.validarCertificado(cerFile, keyFile, password)
      if (result.valido) {
        setCertInfo(result)
      } else {
        setCertError(result.message || 'Certificado inválido.')
      }
    } catch (e: unknown) {
      setCertError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error al validar el certificado.')
    } finally {
      setValidando(false)
    }
  }

  // ── Paso 3: Crear lote y ejecutar firma ──
  const handleEjecutarFirma = async () => {
    // Si hay cert en bóveda, solo necesita password; si no, necesita archivos
    if (tieneCertBoveda) {
      if (!password) return
    } else {
      if (!cerFile || !keyFile || !password || !certInfo) return
    }
    setEjecutando(true)
    setEjecutarError('')
    setStep(3)
    try {
      // Crear el lote
      const lote = await firmaLoteApi.crear(documentos.map(d => d.id))
      setLoteId(lote.id)

      // Ejecutar firma (con archivos opcionales si hay bóveda)
      const result = await firmaLoteApi.ejecutar(
        lote.id,
        password,
        tieneCertBoveda ? undefined : cerFile ?? undefined,
        tieneCertBoveda ? undefined : keyFile ?? undefined,
      )
      setResultado(result.lote_firma)
      setResultMessage(result.message)
      setStep(4)
    } catch (e: unknown) {
      setEjecutarError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error al ejecutar la firma por lote.')
      setStep(4)
    } finally {
      setEjecutando(false)
    }
  }

  // ── Stepper visual ──
  const stepLabels = ['Revisión', 'Certificado', 'Firmando', 'Resultado']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#FDF2F4' }}>
              <FileSignature size={14} style={{ color: GUINDA }} />
            </div>
            <h2 className="text-sm font-semibold text-gray-900">Firma por lote</h2>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{documentos.length} documentos</span>
          </div>
          {step !== 3 && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          )}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 px-5 py-2 bg-gray-50 border-b border-gray-100">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as WizardStep
            const active = n === step
            const done = n < step
            return (
              <div key={label} className="flex items-center gap-1 flex-1">
                <div className={clsx(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                  done ? 'bg-green-500 text-white' :
                  active ? 'text-white' : 'bg-gray-200 text-gray-500',
                )}
                style={active ? { backgroundColor: GUINDA } : {}}>
                  {done ? '✓' : n}
                </div>
                <span className={clsx('text-[10px]', active ? 'font-semibold text-gray-900' : 'text-gray-400')}>
                  {label}
                </span>
                {i < 3 && <div className={clsx('flex-1 h-px ml-1', done ? 'bg-green-300' : 'bg-gray-200')} />}
              </div>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* ── Paso 1: Revisión ─── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-600">
                Revisa los documentos seleccionados para firma. Todos deben estar en estado <strong>"En atención"</strong> con borrador de respuesta.
              </p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {documentos.map((doc, i) => (
                  <div key={doc.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-[10px] font-mono text-gray-400 w-5">{i + 1}.</span>
                    <span className="text-sm">{TIPO_ICONS[doc.tipo]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{doc.asunto}</p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {doc.numero_oficio_origen || 'Sin número'} • {doc.area_turno_nombre || '—'}
                      </p>
                    </div>
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                <p className="text-[10px] text-blue-700">
                  <Shield size={10} className="inline mr-1" />
                  Se aplicará firma electrónica con sello digital SHA-256 y QR de verificación individual.
                </p>
              </div>
            </div>
          )}

          {/* ── Paso 2: Certificado ─── */}
          {step === 2 && (
            <div className="space-y-4">
              {tieneCertBoveda ? (
                /* ── Flujo simplificado: certificado ya en bóveda ── */
                <>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Shield size={14} className="text-green-600" />
                      <p className="text-xs font-semibold text-green-800">Certificado registrado en bóveda</p>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <div><span className="text-green-600">RFC:</span> <strong className="text-green-900">{certBoveda?.rfc}</strong></div>
                      <div><span className="text-green-600">Serial:</span> <strong className="text-green-900">{certBoveda?.numero_serie?.slice(0, 16)}...</strong></div>
                      <div className="col-span-2"><span className="text-green-600">Titular:</span> <strong className="text-green-900">{certBoveda?.nombre_titular}</strong></div>
                      {certBoveda?.valido_hasta && (
                        <div className="col-span-2"><span className="text-green-600">Vigencia:</span> <strong className="text-green-900">{certBoveda.valido_desde?.slice(0, 10)} — {certBoveda.valido_hasta?.slice(0, 10)}</strong></div>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-gray-600">
                    Ingresa tu contraseña FIEL para abrir una sesión de firma segura de 5 minutos.
                  </p>

                  {/* Solo password */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-700 mb-1 block">Contraseña de la clave privada</label>
                    <div className="relative">
                      <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="w-full pl-8 pr-10 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1"
                        style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                        placeholder="Contraseña FIEL"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <p className="text-[10px] text-blue-700">
                      <Lock size={10} className="inline mr-1" />
                      Se abrirá sesión segura de 5 minutos para firmar los {documentos.length} documentos seleccionados.
                      La contraseña no se almacena.
                    </p>
                  </div>
                </>
              ) : (
                /* ── Flujo tradicional: subir archivos ── */
                <>
                  <p className="text-xs text-gray-600">
                    Carga tu certificado de firma electrónica para autenticarte una sola vez.
                  </p>

                  {/* Archivo .cer */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-700 mb-1 block">Certificado (.cer)</label>
                    <input ref={cerRef} type="file" accept=".cer" className="hidden"
                      onChange={e => { setCerFile(e.target.files?.[0] || null); setCertInfo(null) }} />
                    <button onClick={() => cerRef.current?.click()}
                      className={clsx(
                        'w-full flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2.5 text-xs transition-colors',
                        cerFile ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-400',
                      )}>
                      {cerFile ? (
                        <><CheckCircle2 size={14} className="text-green-500" /><span className="text-green-700 truncate">{cerFile.name}</span></>
                      ) : (
                        <><Upload size={14} className="text-gray-400" /><span className="text-gray-500">Seleccionar archivo .cer</span></>
                      )}
                    </button>
                  </div>

                  {/* Archivo .key */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-700 mb-1 block">Clave privada (.key)</label>
                    <input ref={keyRef} type="file" accept=".key" className="hidden"
                      onChange={e => { setKeyFile(e.target.files?.[0] || null); setCertInfo(null) }} />
                    <button onClick={() => keyRef.current?.click()}
                      className={clsx(
                        'w-full flex items-center gap-2 border-2 border-dashed rounded-lg px-3 py-2.5 text-xs transition-colors',
                        keyFile ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-400',
                      )}>
                      {keyFile ? (
                        <><CheckCircle2 size={14} className="text-green-500" /><span className="text-green-700 truncate">{keyFile.name}</span></>
                      ) : (
                        <><Upload size={14} className="text-gray-400" /><span className="text-gray-500">Seleccionar archivo .key</span></>
                      )}
                    </button>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-700 mb-1 block">Contraseña de la clave privada</label>
                    <div className="relative">
                      <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="w-full pl-8 pr-10 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1"
                        style={{ '--tw-ring-color': GUINDA } as React.CSSProperties}
                        placeholder="Contraseña FIEL"
                        value={password}
                        onChange={e => { setPassword(e.target.value); setCertInfo(null) }}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Validar button */}
                  <button
                    onClick={handleValidarCertificado}
                    disabled={!cerFile || !keyFile || !password || validando}
                    className="w-full py-2.5 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                    style={{ backgroundColor: GUINDA }}>
                    {validando
                      ? <span className="flex items-center justify-center gap-1"><RotateCcw size={12} className="animate-spin" /> Validando...</span>
                      : <span className="flex items-center justify-center gap-1"><Shield size={12} /> Validar certificado</span>}
                  </button>

                  {certError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                      <AlertTriangle size={12} className="inline mr-1" /> {certError}
                    </div>
                  )}

                  {/* Resultado de validación */}
                  {certInfo && certInfo.valido && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-green-600" />
                        <p className="text-xs font-semibold text-green-800">Certificado válido</p>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div><span className="text-green-600">RFC:</span> <strong className="text-green-900">{certInfo.rfc}</strong></div>
                        <div><span className="text-green-600">Serial:</span> <strong className="text-green-900">{certInfo.serial?.slice(0, 12)}...</strong></div>
                        <div className="col-span-2"><span className="text-green-600">Titular:</span> <strong className="text-green-900">{certInfo.nombre}</strong></div>
                        {certInfo.valido_desde && (
                          <div className="col-span-2"><span className="text-green-600">Vigencia:</span> <strong className="text-green-900">{certInfo.valido_desde} — {certInfo.valido_hasta}</strong></div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Paso 3: Firmando ─── */}
          {step === 3 && (
            <div className="space-y-4 py-4">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#FDF2F4' }}>
                  <RotateCcw size={28} className="animate-spin" style={{ color: GUINDA }} />
                </div>
                <p className="text-sm font-semibold text-gray-800">Firmando documentos...</p>
                <p className="text-xs text-gray-500 mt-1">No cierres esta ventana</p>
              </div>

              {/* Progress bar */}
              {lotePolling && (
                <div className="space-y-2">
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div className="h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${lotePolling.progreso_pct}%`, backgroundColor: GUINDA }} />
                  </div>
                  <p className="text-center text-xs text-gray-600">
                    {lotePolling.total_firmados + lotePolling.total_errores} / {lotePolling.total_documentos} procesados
                    ({lotePolling.progreso_pct}%)
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Paso 4: Resultado ─── */}
          {step === 4 && (
            <div className="space-y-4">
              {ejecutarError ? (
                <div className="text-center py-4">
                  <AlertTriangle size={32} className="text-red-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-red-800">Error en firma por lote</p>
                  <p className="text-xs text-red-600 mt-1">{ejecutarError}</p>
                </div>
              ) : resultado ? (
                <>
                  <div className="text-center py-2">
                    <CheckCircle2 size={32} className="text-green-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-900">Firma completada</p>
                    <p className="text-xs text-gray-500 mt-1">{resultMessage}</p>
                  </div>

                  {/* Resumen */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center bg-green-50 rounded-lg py-2">
                      <p className="text-lg font-bold text-green-600">{resultado.total_firmados}</p>
                      <p className="text-[9px] text-green-700">Firmados</p>
                    </div>
                    <div className="text-center bg-red-50 rounded-lg py-2">
                      <p className="text-lg font-bold text-red-600">{resultado.total_errores}</p>
                      <p className="text-[9px] text-red-700">Errores</p>
                    </div>
                    <div className="text-center bg-gray-50 rounded-lg py-2">
                      <p className="text-lg font-bold text-gray-600">{resultado.total_documentos}</p>
                      <p className="text-[9px] text-gray-700">Total</p>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {resultado.items.map((item: LoteFirmaItem) => (
                      <div key={item.id}
                        className={clsx(
                          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                          item.estado === 'firmado' ? 'bg-green-50' : 'bg-red-50',
                        )}>
                        {item.estado === 'firmado' ? (
                          <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                        ) : (
                          <AlertTriangle size={14} className="text-red-500 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate">{item.asunto || 'Documento'}</p>
                          {item.error_mensaje && <p className="text-[10px] text-red-600 truncate">{item.error_mensaje}</p>}
                        </div>
                        {item.estado === 'firmado' && item.qr_data && (
                          <QrCode size={14} className="text-green-600 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>

                  {resultado.certificado_rfc && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 text-[10px] text-gray-500">
                      Firmado con certificado <strong>{resultado.certificado_serial?.slice(0, 12)}...</strong>
                      {' '}• RFC: <strong>{resultado.certificado_rfc}</strong>
                      {' '}• {resultado.certificado_nombre}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-gray-100 bg-gray-50">
          {step === 1 && (
            <>
              <button onClick={onClose}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => setStep(2)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg text-white font-medium"
                style={{ backgroundColor: GUINDA }}>
                Continuar <ChevronRight size={12} />
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)}
                className="px-4 py-2 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Atrás
              </button>
              <button onClick={handleEjecutarFirma}
                disabled={tieneCertBoveda ? !password : !certInfo?.valido}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg text-white font-medium disabled:opacity-50 transition-colors"
                style={{ backgroundColor: GUINDA }}>
                <FileSignature size={12} /> Firmar {documentos.length} documentos
              </button>
            </>
          )}
          {step === 3 && (
            <p className="text-[10px] text-gray-400 mx-auto">Procesando... no cierres esta ventana.</p>
          )}
          {step === 4 && (
            <button onClick={() => { onComplete(); onClose() }}
              className="ml-auto px-4 py-2 text-xs rounded-lg text-white font-medium"
              style={{ backgroundColor: GUINDA }}>
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
