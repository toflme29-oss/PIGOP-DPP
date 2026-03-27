import { useState, useRef, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, FolderOpen, Stamp, ClipboardList,
  LogOut, User, ChevronDown, Lock, Home,
  FileSpreadsheet, Inbox, Settings, Menu, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../hooks/useAuth'

// ── Tipos de navegación ────────────────────────────────────────────────────────
interface SubModule {
  to: string
  icon: typeof ShieldCheck
  label: string
  fullLabel: string
  match: (path: string) => boolean
  active: boolean
}

interface NavModule {
  to?: string
  icon: typeof ShieldCheck
  label: string
  fullLabel: string
  match: (path: string) => boolean
  active: boolean
  adminOnly: boolean
  moduleId: string
  submodules?: SubModule[]
}

// ── Definición de módulos (arquitectura raíz — inamovible) ─────────────────────
const NAV_MODULES: NavModule[] = [
  {
    icon: ShieldCheck,
    label: 'Validación del Gasto Público',
    fullLabel: 'Validación del Gasto Público',
    to: '/depps',
    match: (path: string) =>
      path.startsWith('/depps') || path.startsWith('/gasto') ||
      path.startsWith('/sap-import') || path.startsWith('/bandejas'),
    active: true,
    adminOnly: false,
    moduleId: 'validacion_depp',
    submodules: [
      {
        to: '/depps',
        icon: ShieldCheck,
        label: 'DEPPs',
        fullLabel: 'Documentos de Ejecución Presupuestaria',
        match: (path: string) => path.startsWith('/depps') || path.startsWith('/gasto'),
        active: true,
      },
      {
        to: '/sap-import',
        icon: FileSpreadsheet,
        label: 'Importación SAP',
        fullLabel: 'Carga masiva desde SAP',
        match: (path: string) => path.startsWith('/sap-import'),
        active: true,
      },
      {
        to: '/bandejas',
        icon: Inbox,
        label: 'Bandeja de Validación',
        fullLabel: 'Revisión de DEPPs en lotes',
        match: (path: string) => path.startsWith('/bandejas'),
        active: true,
      },
    ],
  },
  {
    to: '/gestion-documental',
    icon: FolderOpen,
    label: 'Gestión Documental',
    fullLabel: 'Gestión Documental',
    match: (path: string) => path.startsWith('/gestion-documental'),
    active: true,
    adminOnly: false,
    moduleId: 'gestion_documental',
  },
  {
    to: '/certificaciones',
    icon: Stamp,
    label: 'Certificaciones Presupuestales',
    fullLabel: 'Certificaciones Presupuestales',
    match: (path: string) => path.startsWith('/certificaciones'),
    active: false,
    adminOnly: false,
    moduleId: 'certificaciones',
  },
  {
    to: '/minutas',
    icon: ClipboardList,
    label: 'Minutas de Conciliación',
    fullLabel: 'Minutas de Conciliación Presupuestal',
    match: (path: string) => path.startsWith('/minutas'),
    active: false,
    adminOnly: false,
    moduleId: 'minutas',
  },
]


// Guinda institucional
const GUINDA = '#911A3A'
const GUINDA_DARK = '#6B1029'

// ── Topbar dinamica segun ruta ─────────────────────────────────────────────────
function getPageMeta(path: string): { title: string; subtitle: string } {
  if (path === '/')
    return { title: 'PIGOP', subtitle: 'Plataforma Integral de Gestión y Operación Presupuestal' }
  if (path.startsWith('/depps') || path.startsWith('/gasto'))
    return { title: 'Validación del Gasto Público', subtitle: 'Documentos de Ejecución Presupuestaria y Pago · Ejercicio Fiscal 2026' }
  if (path.startsWith('/sap-import'))
    return { title: 'Importación SAP', subtitle: 'Carga masiva de DEPPs desde archivo Excel/CSV exportado de SAP GRP' }
  if (path.startsWith('/bandejas'))
    return { title: 'Bandejas de Revisión', subtitle: 'Revisión de DEPPs en lotes · Dictámenes en bloque con atajos de teclado' }
  if (path.startsWith('/gestion-documental'))
    return { title: 'Gestión Documental', subtitle: 'Control y archivo de documentos institucionales' }
  if (path.startsWith('/certificaciones'))
    return { title: 'Certificaciones Presupuestales', subtitle: 'Gestión de afectaciones y certificaciones al presupuesto' }
  if (path.startsWith('/minutas'))
    return { title: 'Minutas de Conciliación Presupuestal', subtitle: 'Control y seguimiento de reuniones entre áreas' }
  if (path.startsWith('/admin'))
    return { title: 'Administración del Sistema', subtitle: 'Gestión de usuarios, roles y dependencias registradas en PIGOP' }
  return { title: 'PIGOP', subtitle: 'Secretaría de Finanzas y Administración' }
}

// ── User Dropdown ──────────────────────────────────────────────────────────────
function UserDropdown({ user, onLogout }: { user: { nombre_completo?: string; email?: string } | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: GUINDA }}>
          <User size={13} className="text-white" />
        </div>
        <span className="text-white text-xs font-medium hidden sm:block max-w-[140px] truncate">
          {user?.nombre_completo ?? 'Usuario'}
        </span>
        <ChevronDown size={12} className={clsx('text-white/60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
          <div className="px-3.5 py-2.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-800 truncate">{user?.nombre_completo ?? 'Usuario'}</p>
            <p className="text-[10px] text-gray-400 truncate">{user?.email}</p>
          </div>
          <button
            onClick={() => { setOpen(false); onLogout() }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-red-600 transition-colors"
          >
            <LogOut size={13} />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}

// ── Dropdown de módulo con submódulos ──────────────────────────────────────────
function ModuleDropdown({ mod, pathname }: { mod: NavModule; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const isActive = mod.match(pathname)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleEnter = () => {
    clearTimeout(timeoutRef.current)
    setOpen(true)
  }
  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <div ref={ref} className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap text-sm font-medium',
          isActive
            ? 'bg-white/20 text-white'
            : 'text-white/70 hover:bg-white/10 hover:text-white'
        )}
      >
        <mod.icon size={15} />
        <span>{mod.label}</span>
        <ChevronDown size={12} className={clsx('transition-transform ml-0.5', open && 'rotate-180')} />
      </button>

      {open && mod.submodules && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
          {mod.submodules.map(sub => {
            const subActive = sub.match(pathname)
            if (!sub.active) {
              return (
                <div key={sub.to} className="flex items-center gap-3 px-4 py-2.5 opacity-40 cursor-not-allowed">
                  <sub.icon size={15} className="text-gray-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-400">{sub.label}</p>
                    <p className="text-xs text-gray-300">{sub.fullLabel}</p>
                  </div>
                  <Lock size={10} className="text-gray-300" />
                </div>
              )
            }
            return (
              <Link
                key={sub.to}
                to={sub.to}
                onClick={() => setOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-4 py-2.5 transition-colors',
                  subActive
                    ? 'bg-red-50 text-[#7B1628]'
                    : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                <sub.icon size={15} className={subActive ? 'text-[#7B1628]' : 'text-gray-400'} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{sub.label}</p>
                  <p className="text-xs text-gray-400">{sub.fullLabel}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Componente Layout ─────────────────────────────────────────────────────────
export default function Layout() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { user, logout } = useAuth()
  const meta = getPageMeta(location.pathname)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isAdmin = user?.rol === 'superadmin' || user?.rol === 'admin_cliente'

  // Módulos visibles según rol del usuario
  const MODULOS_POR_ROL: Record<string, string[]> = {
    superadmin:    ['validacion_depp', 'gestion_documental', 'certificaciones', 'minutas'],
    admin_cliente: ['validacion_depp', 'gestion_documental', 'certificaciones', 'minutas'],
    secretaria:    ['gestion_documental'],
    asesor:        ['gestion_documental'],
    subdirector:   ['gestion_documental'],
    jefe_depto:    ['gestion_documental'],
    analista:      ['gestion_documental', 'validacion_depp'],
    auditor:       ['gestion_documental'],
    consulta:      ['gestion_documental'],
  }
  const permitidos = MODULOS_POR_ROL[user?.rol || ''] || []
  const visibleModules = NAV_MODULES.filter(mod => isAdmin || permitidos.includes(mod.moduleId))

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Cerrar menu movil al navegar
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* ── Barra superior institucional ────────────────────────────────────── */}
      <header className="flex-shrink-0 shadow-md z-30" style={{ backgroundColor: GUINDA_DARK }}>
        {/* Fila superior: Logo + branding + API + Admin + usuario */}
        <div className="flex items-center justify-between px-4 lg:px-6 h-12">
          {/* Izquierda: Hamburguesa (movil) + Logo + Nombre */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden text-white/80 hover:text-white p-1"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <img
              src="https://michoacan.gob.mx/cdn/img/logo-blanco.svg"
              alt="Gobierno del Estado de Michoacán"
              className="h-7 object-contain flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="hidden sm:block h-5 w-px bg-white/20" />
            <Link to="/" className="hidden sm:block hover:opacity-80 transition-opacity">
              <p className="text-white text-[10px] font-bold leading-tight tracking-wide">
                PIGOP
              </p>
              <p className="text-white/50 text-[9px] leading-tight">
                Secretaría de Finanzas
              </p>
            </Link>
          </div>

          {/* Centro: API status */}
          <div className="hidden md:flex items-center">
            <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              API conectada
            </span>
          </div>

          {/* Derecha: Admin + Usuario */}
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link
                to="/admin"
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all text-sm font-medium',
                  location.pathname.startsWith('/admin')
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                )}
              >
                <Settings size={14} />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}
            <UserDropdown user={user} onLogout={handleLogout} />
          </div>
        </div>

        {/* Fila de navegacion — desktop: Home + 4 módulos principales */}
        <nav className="hidden lg:flex items-center gap-1 px-4 lg:px-6 pb-1.5 overflow-visible">
          <Link
            to="/"
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap text-sm font-medium',
              location.pathname === '/'
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            )}
          >
            <Home size={15} />
            <span>Inicio</span>
          </Link>
          <div className="h-4 w-px bg-white/15 mx-1" />
          {visibleModules.map(mod => {
            // Módulo con submódulos → dropdown
            if (mod.submodules && mod.submodules.length > 0) {
              return <ModuleDropdown key={mod.label} mod={mod} pathname={location.pathname} />
            }
            // Módulo inactivo (próximamente)
            if (!mod.active) {
              return (
                <div
                  key={mod.label}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-not-allowed opacity-40"
                  title="Próximamente"
                >
                  <mod.icon size={15} className="text-white/50" />
                  <span className="text-sm font-medium text-white/50 whitespace-nowrap">{mod.label}</span>
                  <Lock size={10} className="text-white/30" />
                </div>
              )
            }
            // Módulo activo sin submódulos → enlace directo
            const isActive = mod.match(location.pathname)
            return (
              <Link
                key={mod.label}
                to={mod.to!}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap text-sm font-medium',
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                )}
              >
                <mod.icon size={15} />
                <span>{mod.label}</span>
              </Link>
            )
          })}
        </nav>
      </header>

      {/* ── Menu movil overlay ─────────────────────────────────────────────── */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed top-12 left-0 right-0 z-50 lg:hidden shadow-xl"
               style={{ backgroundColor: GUINDA_DARK }}>
            <nav className="px-3 py-3 space-y-1 max-h-[70vh] overflow-y-auto">
              <Link
                to="/"
                onClick={() => setMobileMenuOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                  location.pathname === '/' ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10'
                )}
              >
                <Home size={15} className={location.pathname === '/' ? 'text-white' : 'text-white/60'} />
                <p className="text-sm font-medium">Inicio</p>
              </Link>
              <div className="h-px bg-white/10 my-1" />
              {visibleModules.map(mod => (
                <div key={mod.label}>
                  {/* Título del módulo */}
                  {mod.submodules ? (
                    <>
                      <p className="text-[10px] font-semibold uppercase tracking-widest px-3 pt-2 pb-1"
                         style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {mod.label}
                      </p>
                      {mod.submodules.map(sub => {
                        const subActive = sub.match(location.pathname)
                        if (!sub.active) {
                          return (
                            <div key={sub.to} className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-40">
                              <sub.icon size={15} className="text-white/50" />
                              <p className="text-sm text-white/60">{sub.label}</p>
                              <Lock size={10} className="text-white/30 ml-auto" />
                            </div>
                          )
                        }
                        return (
                          <Link
                            key={sub.to}
                            to={sub.to}
                            onClick={() => setMobileMenuOpen(false)}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                              subActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10'
                            )}
                          >
                            <sub.icon size={15} className={subActive ? 'text-white' : 'text-white/60'} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{sub.label}</p>
                              <p className="text-xs text-white/40">{sub.fullLabel}</p>
                            </div>
                          </Link>
                        )
                      })}
                    </>
                  ) : (
                    (() => {
                      const isActive = mod.match(location.pathname)
                      if (!mod.active) {
                        return (
                          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-40">
                            <mod.icon size={15} className="text-white/50" />
                            <p className="text-sm text-white/60">{mod.label}</p>
                            <Lock size={10} className="text-white/30 ml-auto" />
                          </div>
                        )
                      }
                      return (
                        <Link
                          to={mod.to!}
                          onClick={() => setMobileMenuOpen(false)}
                          className={clsx(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                            isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10'
                          )}
                        >
                          <mod.icon size={15} className={isActive ? 'text-white' : 'text-white/60'} />
                          <p className="text-sm font-medium">{mod.label}</p>
                        </Link>
                      )
                    })()
                  )}
                </div>
              ))}

              {/* Admin en menú móvil */}
              {isAdmin && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest px-3 pt-2 pb-1"
                     style={{ color: 'rgba(255,255,255,0.35)' }}>
                    Sistema
                  </p>
                  <Link
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                      location.pathname.startsWith('/admin') ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10'
                    )}
                  >
                    <Settings size={15} className={location.pathname.startsWith('/admin') ? 'text-white' : 'text-white/60'} />
                    <p className="text-sm font-medium">Administración</p>
                  </Link>
                </div>
              )}
            </nav>
            {/* Logout en menu movil */}
            <div className="px-3 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
              <button
                onClick={() => { setMobileMenuOpen(false); handleLogout() }}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <LogOut size={14} />
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Page header breadcrumb ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 lg:px-6 py-2.5 shadow-sm">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-gray-900">{meta.title}</h1>
            <p className="text-[11px] text-gray-500 mt-0.5 hidden sm:block">{meta.subtitle}</p>
          </div>
          <img
            src="https://michoacan.gob.mx/cdn/img/logo.svg"
            alt="Michoacan"
            className="h-5 object-contain opacity-40 hidden sm:block"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      </div>

      {/* ── Contenido principal ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-screen-2xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
