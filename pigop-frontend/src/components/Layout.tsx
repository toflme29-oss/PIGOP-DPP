import { useState, useRef, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, FolderOpen, Stamp, ClipboardList,
  LogOut, User, ChevronDown, Lock, Home,
  FileSpreadsheet, Inbox, Settings, Menu, X, ScanSearch, ArrowLeft,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../hooks/useAuth'
import { usePermissionsBootstrap } from '../hooks/usePermissionsBootstrap'

// ── Tipos de navegación ────────────────────────────────────────────────────────
interface SubModule {
  to: string
  icon: typeof ShieldCheck
  label: string
  fullLabel: string
  match: (path: string) => boolean
  active: boolean
  adminOnly?: boolean
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
      path.startsWith('/sap-import') || path.startsWith('/bandejas') ||
      path.startsWith('/revision-documental'),
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
      {
        to: '/revision-documental',
        icon: ScanSearch,
        label: 'Revisión Documental IA',
        fullLabel: 'Validación con IA — Solo Administrador',
        match: (path: string) => path.startsWith('/revision-documental'),
        active: true,
        adminOnly: true,
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
  if (path.startsWith('/revision-documental'))
    return { title: 'Revisión Documental con IA', subtitle: 'Validación automatizada de coherencia documental · Solo Administrador' }
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
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
             style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
          <User size={14} className="text-white" />
        </div>
        <div className="hidden lg:block text-left leading-none">
          <p className="text-white text-[11px] font-medium leading-tight max-w-[160px] truncate">
            {user?.nombre_completo ?? 'Usuario'}
          </p>
          <p className="text-white/45 text-[9px] leading-tight max-w-[160px] truncate mt-0.5">
            {user?.email}
          </p>
        </div>
        <ChevronDown size={12} className={clsx('text-white/60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-44 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
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

  // Hidrata overrides de permisos desde backend + polling de versión
  usePermissionsBootstrap()

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
  const visibleModules = NAV_MODULES
    .filter(mod => isAdmin || permitidos.includes(mod.moduleId))
    .map(mod => ({
      ...mod,
      submodules: mod.submodules?.filter(sub => !sub.adminOnly || isAdmin),
    }))

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Volver: solo en sub-páginas con ruta padre dentro del mismo módulo (ej. /depps/123 → /depps)
  const parentPath = (() => {
    const parts = location.pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? '/' + parts.slice(0, -1).join('/') : null
  })()


  // Cerrar menu movil al navegar
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
      {/* ── Barra superior institucional (fila única) ────────────────────────── */}
      <header className="flex-shrink-0 shadow-md z-30 sticky top-0" style={{ backgroundColor: GUINDA_DARK }}>
        <div className="grid items-center px-4 lg:px-6 h-[62px] gap-2" style={{ gridTemplateColumns: 'auto 1fr auto' }}>

          {/* ── Izquierda: Logo + Branding ─────────────────────────────────── */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Hamburguesa móvil */}
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
              className="h-9 object-contain flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="hidden sm:block h-8 w-px bg-white/20" />
            <Link to="/" className="hidden sm:block hover:opacity-80 transition-opacity leading-none">
              <p className="text-white text-[11px] leading-tight">
                SISTEMA INTEGRAL <strong>PIGOP</strong>
              </p>
              <p className="text-white/55 text-[9px] leading-tight mt-0.5">Secretaría de Finanzas y Administración</p>
              <p className="text-white/40 text-[9px] leading-tight">Dirección de Programación y Presupuesto</p>
            </Link>
          </div>

          {/* ── Centro: Navegación desktop — solo Inicio + módulo activo ──────── */}
          <nav className="hidden lg:flex items-center gap-1 justify-start min-w-0">
            {/* Volver (solo sub-páginas como /depps/123 → /depps) */}
            {parentPath && (
              <>
                <button
                  onClick={() => navigate(parentPath)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all whitespace-nowrap text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft size={14} />
                  <span>Volver</span>
                </button>
                <div className="h-4 w-px bg-white/15 mx-0.5" />
              </>
            )}
            {/* Inicio */}
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
            {/* Solo el módulo activo */}
            {(() => {
              const activeMod = visibleModules.find(mod => mod.match(location.pathname))
              if (!activeMod || location.pathname === '/') return null
              return (
                <>
                  <div className="h-4 w-px bg-white/15 mx-0.5" />
                  {activeMod.submodules && activeMod.submodules.length > 0
                    ? <ModuleDropdown mod={activeMod} pathname={location.pathname} />
                    : (
                      <Link
                        to={activeMod.to!}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/20 text-white whitespace-nowrap text-sm font-medium"
                      >
                        <activeMod.icon size={15} />
                        <span>{activeMod.label}</span>
                      </Link>
                    )
                  }
                </>
              )
            })()}
          </nav>

          {/* ── Derecha: Usuario (dropdown) + Admin ───────────────────────── */}
          <div className="flex items-center gap-2 justify-end">
            {/* Panel Admin */}
            {isAdmin && (
              <>
                <Link
                  to="/admin"
                  className={clsx(
                    'hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all text-sm font-medium whitespace-nowrap',
                    location.pathname.startsWith('/admin')
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Settings size={14} />
                  <span>Panel Admin</span>
                </Link>
                <div className="hidden lg:block h-6 w-px bg-white/20" />
              </>
            )}
            {/* Dropdown de usuario (todos los tamaños) */}
            <UserDropdown user={user} onLogout={handleLogout} />
          </div>

        </div>
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

      {/* ── Contenido principal ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden min-h-0 flex flex-col">
        <div className={clsx(
          'flex-1 min-h-0',
          // Páginas que manejan su propio scroll interno (flex layout)
          location.pathname.startsWith('/gestion-documental')
            ? 'flex flex-col overflow-hidden'
            : 'overflow-y-auto',
        )}>
          <div className={clsx(
            location.pathname.startsWith('/gestion-documental')
              ? 'h-full flex flex-col'
              : 'max-w-screen-2xl mx-auto',
          )}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
