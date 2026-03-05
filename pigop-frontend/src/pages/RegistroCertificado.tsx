/**
 * RegistroCertificado — Modal/Componente para registrar e.firma (FIEL) del SAT.
 *
 * Permite al Director:
 *   - Subir .cer y .key una sola vez
 *   - Se almacenan cifrados con AES-256-GCM en la bóveda
 *   - Ver metadata del certificado vigente
 *   - Renovar o revocar el certificado
 *
 * Usado como modal dentro de GestionDocumental.tsx
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Upload, X, CheckCircle2, AlertTriangle, Key,
  RotateCcw, Eye, EyeOff, RefreshCw, Trash2,
} from 'lucide-react'
import { certificadosApi, type CertificadoInfo, type CertificadoRegistro } from '../api/documentos'

const GUINDA = '#911A3A'

interface Props {
  open: boolean
  onClose: () => void
}

export default function RegistroCertificado({ open, onClose }: Props) {
  const qc = useQueryClient()

  // ── Estado del formulario ──────────────────────────────────────────────
  const [cerFile, setCerFile] = useState<File | null>(null)
  const [keyFile, setKeyFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<CertificadoRegistro | null>(null)
  const [mode, setMode] = useState<'view' | 'register' | 'renew'>('view')

  // ── Query: certificado actual ──────────────────────────────────────────
  const { data: certInfo, isLoading } = useQuery<CertificadoInfo>({
    queryKey: ['mi-certificado'],
    queryFn: certificadosApi.miCertificado,
    enabled: open,
  })

  // ── Mutation: registrar ────────────────────────────────────────────────
  const registrarMut = useMutation({
    mutationFn: () => {
      if (!cerFile || !keyFile || !password) throw new Error('Faltan datos')
      return certificadosApi.registrar(cerFile, keyFile, password)
    },
    onSuccess: (data) => {
      setSuccess(data)
      setError('')
      setCerFile(null)
      setKeyFile(null)
      setPassword('')
      qc.invalidateQueries({ queryKey: ['mi-certificado'] })
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Error al registrar el certificado.')
    },
  })

  // ── Mutation: renovar ──────────────────────────────────────────────────
  const renovarMut = useMutation({
    mutationFn: () => {
      if (!cerFile || !keyFile || !password) throw new Error('Faltan datos')
      return certificadosApi.renovar(cerFile, keyFile, password)
    },
    onSuccess: (data) => {
      setSuccess(data)
      setError('')
      setMode('view')
      setCerFile(null)
      setKeyFile(null)
      setPassword('')
      qc.invalidateQueries({ queryKey: ['mi-certificado'] })
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Error al renovar el certificado.')
    },
  })

  // ── Mutation: revocar ──────────────────────────────────────────────────
  const revocarMut = useMutation({
    mutationFn: certificadosApi.revocar,
    onSuccess: () => {
      setMode('register')
      qc.invalidateQueries({ queryKey: ['mi-certificado'] })
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || 'Error al revocar el certificado.')
    },
  })

  if (!open) return null

  const loading = registrarMut.isPending || renovarMut.isPending || revocarMut.isPending
  const hasCert = certInfo?.tiene_certificado && certInfo.activo
  const showForm = mode === 'register' || mode === 'renew'

  // Si tiene certificado y no hay success reciente, mostrar vista
  const showView = hasCert && mode === 'view' && !success

  // Calcular días restantes
  let diasRestantes: number | null = null
  if (certInfo?.valido_hasta) {
    const diff = new Date(certInfo.valido_hasta).getTime() - Date.now()
    diasRestantes = Math.floor(diff / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[420px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100"
          style={{ backgroundColor: `${GUINDA}08` }}>
          <div className="flex items-center gap-2">
            <Key size={16} style={{ color: GUINDA }} />
            <h3 className="text-sm font-semibold text-gray-900">
              {mode === 'renew' ? 'Renovar e.firma' : 'Certificado e.firma'}
            </h3>
          </div>
          <button onClick={() => { onClose(); setSuccess(null); setError(''); setMode('view') }}
            className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* ── Vista: certificado registrado ── */}
          {showView && certInfo && (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield size={16} className="text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-800">Certificado registrado</span>
                </div>

                <div className="space-y-1.5">
                  {[
                    ['RFC', certInfo.rfc],
                    ['Titular', certInfo.nombre_titular],
                    ['No. Serie', certInfo.numero_serie?.slice(0, 30)],
                    ['Emisor', certInfo.emisor],
                    ['Vigencia', certInfo.valido_desde && certInfo.valido_hasta
                      ? `${new Date(certInfo.valido_desde).toLocaleDateString('es-MX')} — ${new Date(certInfo.valido_hasta).toLocaleDateString('es-MX')}`
                      : '—'],
                    ['Firmas realizadas', String(certInfo.total_firmas)],
                  ].map(([label, val]) => (
                    <div key={label} className="flex gap-2 text-[10px]">
                      <span className="text-emerald-700 font-medium w-28 flex-shrink-0">{label}</span>
                      <span className="text-gray-700">{val || '—'}</span>
                    </div>
                  ))}
                </div>

                {diasRestantes !== null && diasRestantes < 30 && (
                  <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                    <AlertTriangle size={11} className="text-amber-600" />
                    <span className="text-[10px] font-medium text-amber-700">
                      Vence en {diasRestantes} días — considere renovar
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setMode('renew'); setCerFile(null); setKeyFile(null); setPassword(''); setError('') }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
                  <RefreshCw size={11} /> Renovar
                </button>
                <button onClick={() => revocarMut.mutate()}
                  disabled={revocarMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg font-medium border border-red-300 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50">
                  <Trash2 size={11} /> Revocar
                </button>
              </div>

              <p className="text-[10px] text-gray-400 text-center leading-relaxed">
                La clave privada está cifrada con AES-256-GCM. La contraseña se solicita
                únicamente al momento de firmar.
              </p>
            </>
          )}

          {/* ── Success después de registrar/renovar ── */}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <span className="text-xs font-bold text-emerald-800">
                  {mode === 'renew' ? 'Certificado renovado' : 'Certificado registrado'}
                </span>
              </div>
              <div className="space-y-1.5 text-[10px]">
                <p><strong className="text-emerald-700">RFC:</strong> {success.rfc}</p>
                <p><strong className="text-emerald-700">Titular:</strong> {success.nombre_titular}</p>
                <p><strong className="text-emerald-700">No. Serie:</strong> {success.numero_serie.slice(0, 30)}</p>
                {success.valido_hasta && (
                  <p><strong className="text-emerald-700">Vigente hasta:</strong> {new Date(success.valido_hasta).toLocaleDateString('es-MX')}</p>
                )}
              </div>
              <button onClick={() => { setSuccess(null); setMode('view') }}
                className="w-full py-2 text-xs rounded-lg font-medium text-white transition-colors"
                style={{ backgroundColor: GUINDA }}>
                Entendido
              </button>
            </div>
          )}

          {/* ── Formulario: registrar o renovar ── */}
          {showForm && !success && (
            <>
              <div className="space-y-3">
                {/* .cer */}
                <div>
                  <label className="text-[10px] font-medium text-gray-600 block mb-1">
                    Certificado (.cer)
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <Upload size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-500">
                      {cerFile ? cerFile.name : 'Seleccionar archivo .cer'}
                    </span>
                    <input type="file" accept=".cer" className="hidden"
                      onChange={e => { setCerFile(e.target.files?.[0] || null); setError('') }} />
                  </label>
                </div>

                {/* .key */}
                <div>
                  <label className="text-[10px] font-medium text-gray-600 block mb-1">
                    Clave privada (.key)
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                    <Upload size={14} className="text-gray-400" />
                    <span className="text-xs text-gray-500">
                      {keyFile ? keyFile.name : 'Seleccionar archivo .key'}
                    </span>
                    <input type="file" accept=".key" className="hidden"
                      onChange={e => { setKeyFile(e.target.files?.[0] || null); setError('') }} />
                  </label>
                </div>

                {/* Password */}
                <div>
                  <label className="text-[10px] font-medium text-gray-600 block mb-1">
                    Contraseña de la clave privada
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs pr-8 focus:ring-1 focus:ring-[#911A3A]/40 focus:border-[#911A3A] focus:outline-none"
                      placeholder="Contraseña FIEL..."
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError('') }}
                    />
                    <button onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-700">{error}</p>
                </div>
              )}

              {/* Botones */}
              <div className="flex gap-2">
                <button onClick={() => { setMode(hasCert ? 'view' : 'register'); setError(''); setCerFile(null); setKeyFile(null); setPassword('') }}
                  className="flex-1 py-2.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
                  Cancelar
                </button>
                <button
                  onClick={() => mode === 'renew' ? renovarMut.mutate() : registrarMut.mutate()}
                  disabled={!cerFile || !keyFile || !password || loading}
                  className="flex-1 py-2.5 text-xs rounded-lg text-white font-medium disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: GUINDA }}>
                  {loading
                    ? <span className="flex items-center justify-center gap-1"><RotateCcw size={11} className="animate-spin" /> Procesando...</span>
                    : <span className="flex items-center justify-center gap-1"><Shield size={11} /> {mode === 'renew' ? 'Renovar' : 'Registrar'} certificado</span>}
                </button>
              </div>

              {/* Info seguridad */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 space-y-1">
                <p className="text-[10px] text-blue-800 font-medium">Seguridad del almacenamiento</p>
                <ul className="text-[10px] text-blue-700 space-y-0.5 list-disc pl-3">
                  <li>La clave privada se cifra con AES-256-GCM</li>
                  <li>La contraseña NO se almacena en el sistema</li>
                  <li>Solo se solicita al momento de firmar</li>
                </ul>
              </div>
            </>
          )}

          {/* Si no tiene certificado y estamos en modo view, mostrar botón para registrar */}
          {!hasCert && mode === 'view' && !success && !isLoading && (
            <div className="text-center py-4 space-y-3">
              <div className="inline-flex p-3 rounded-full bg-gray-100">
                <Key size={24} className="text-gray-400" />
              </div>
              <p className="text-xs text-gray-600">No tiene certificado e.firma registrado</p>
              <p className="text-[10px] text-gray-400">
                Registre su certificado (.cer) y clave privada (.key) para firmar documentos
                con solo ingresar su contraseña.
              </p>
              <button onClick={() => { setMode('register'); setError('') }}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs rounded-lg text-white font-medium transition-colors"
                style={{ backgroundColor: GUINDA }}>
                <Shield size={13} /> Registrar e.firma
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
