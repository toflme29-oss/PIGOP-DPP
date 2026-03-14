import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { Alert } from '../components/ui/Alert'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Credenciales incorrectas. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #6B1029 0%, #911A3A 45%, #7B1535 100%)' }}>
      {/* Panel izquierdo — identidad institucional */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 p-10" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}>
        {/* Logos */}
        <div className="space-y-6">
          <img
            src="https://michoacan.gob.mx/cdn/img/logo-blanco.svg"
            alt="Gobierno del Estado de Michoacán"
            className="h-14 object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div className="w-12 h-px bg-white/30" />
          <img
            src="https://michoacan.gob.mx/cdn/img/logos/dependencias/finanzas.svg"
            alt="Secretaría de Finanzas y Administración"
            className="h-16 object-contain brightness-0 invert"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>

        {/* Texto institucional */}
        <div>
          <h2 className="text-3xl font-bold text-white leading-tight mb-3">
            Plataforma Integral<br />de Gestión y<br />Optimización<br />Presupuestaria
          </h2>
          <p className="text-white/70 text-sm leading-relaxed">
            Herramienta de validación normativa, gestión documental y
            apoyo operativo para la Dirección de Programación y Presupuesto.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white/40" />
            <div className="w-2 h-2 rounded-full bg-white/40" />
            <div className="w-8 h-2 rounded-full bg-white" />
          </div>
        </div>

        {/* Pie */}
        <p className="text-white/40 text-xs">
          © 2026 Gobierno del Estado de Michoacán de Ocampo
        </p>
      </div>

      {/* Panel derecho — formulario */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-gray-50">
        <div className="w-full max-w-sm">
          {/* Logo mobile */}
          <div className="flex lg:hidden justify-center mb-8">
            <img
              src="https://michoacan.gob.mx/cdn/img/logo.svg"
              alt="Gobierno del Estado de Michoacán"
              className="h-12 object-contain"
            />
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Iniciar sesión</h1>
            <p className="text-sm text-gray-500 mt-1">
              PIGOP · Secretaría de Finanzas y Administración
            </p>
          </div>

          {error && (
            <Alert variant="error" className="mb-5">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="usuario@michoacan.gob.mx"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition"
                  style={{ '--tw-ring-color': '#911A3A' } as React.CSSProperties}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:border-transparent transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              style={{ backgroundColor: loading ? '#7B1535' : '#911A3A' }}
              onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = '#7B1535' }}
              onMouseLeave={e => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = '#911A3A' }}
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verificando...
                </>
              ) : 'Entrar al sistema'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-400 text-center leading-relaxed">
              Dirección de Programación y Presupuesto<br />
              <span className="text-gray-300">v1.0.0 · Ejercicio Fiscal 2026</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
