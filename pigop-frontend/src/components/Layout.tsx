import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, FolderOpen, Stamp, ClipboardList,
  LogOut, User, ChevronRight, Lock,
  FileSpreadsheet, Inbox, Settings,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../hooks/useAuth'

// ── Definición de módulos ──────────────────────────────────────────────────────
const MODULES = [
  {
    section: 'Principal',
    items: [
      {
        to: '/',
        icon: ShieldCheck,
        label: 'Validación del Gasto Público',
        sublabel: 'DEPPs · Revisión normativa IA',
        match: (path: string) => path === '/' || path.startsWith('/depps') || path.startsWith('/gasto'),
        active: true,
        adminOnly: false,
      },
      {
        to: '/sap-import',
        icon: FileSpreadsheet,
        label: 'Importación SAP',
        sublabel: 'Carga masiva desde Excel/CSV',
        match: (path: string) => path.startsWith('/sap-import'),
        active: true,
        adminOnly: false,
      },
      {
        to: '/bandejas',
        icon: Inbox,
        label: 'Bandejas de Revisión',
        sublabel: 'Revisión en lotes · 5, 10 ó 15 DEPPs',
        match: (path: string) => path.startsWith('/bandejas'),
        active: true,
        adminOnly: false,
      },
    ],
  },
  {
    section: 'Módulos',
    items: [
      {
        to: '/gestion-documental',
        icon: FolderOpen,
        label: 'Gestión Documental',
        sublabel: 'Archivo y control de documentos',
        match: (path: string) => path.startsWith('/gestion-documental'),
        active: true,
        adminOnly: false,
      },
      {
        to: '/certificaciones',
        icon: Stamp,
        label: 'Certificaciones Presupuestarias',
        sublabel: 'Afectaciones y certificaciones',
        match: (path: string) => path.startsWith('/certificaciones'),
        active: false,
        adminOnly: false,
      },
      {
        to: '/minutas',
        icon: ClipboardList,
        label: 'Minutas de Conciliación',
        sublabel: 'Seguimiento entre áreas',
        match: (path: string) => path.startsWith('/minutas'),
        active: false,
        adminOnly: false,
      },
    ],
  },
  {
    section: 'Sistema',
    items: [
      {
        to: '/admin',
        icon: Settings,
        label: 'Administración',
        sublabel: 'Usuarios · Dependencias',
        match: (path: string) => path.startsWith('/admin'),
        active: true,
        adminOnly: true,  // Solo visible para superadmin y admin_cliente
      },
    ],
  },
]

// Guinda institucional
const GUINDA = '#911A3A'
const GUINDA_DARK = '#6B1029'
const GUINDA_LIGHT = 'rgba(255,255,255,0.08)'
const GUINDA_ACTIVE = 'rgba(255,255,255,0.15)'

// ── Topbar dinámica según ruta ─────────────────────────────────────────────────
function getPageMeta(path: string): { title: string; subtitle: string } {
  if (path === '/' || path.startsWith('/depps') || path.startsWith('/gasto'))
    return { title: 'Validación del Gasto Público', subtitle: 'Documentos de Ejecución Presupuestaria y Pago · Ejercicio Fiscal 2026' }
  if (path.startsWith('/sap-import'))
    return { title: 'Importación SAP', subtitle: 'Carga masiva de DEPPs desde archivo Excel/CSV exportado de SAP GRP' }
  if (path.startsWith('/bandejas'))
    return { title: 'Bandejas de Revisión', subtitle: 'Revisión de DEPPs en lotes · Dictámenes en bloque con atajos de teclado' }
  if (path.startsWith('/gestion-documental'))
    return { title: 'Gestión Documental', subtitle: 'Control y archivo de documentos institucionales' }
  if (path.startsWith('/certificaciones'))
    return { title: 'Certificaciones Presupuestarias', subtitle: 'Gestión de afectaciones y certificaciones al presupuesto' }
  if (path.startsWith('/minutas'))
    return { title: 'Minutas de Conciliación', subtitle: 'Control y seguimiento de reuniones entre áreas' }
  if (path.startsWith('/admin'))
    return { title: 'Administración del Sistema', subtitle: 'Gestión de usuarios, roles y dependencias registradas en PIGOP' }
  return { title: 'PIGOP', subtitle: 'Secretaría de Finanzas y Administración' }
}

// ── Componente Layout ─────────────────────────────────────────────────────────
export default function Layout() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { user, logout } = useAuth()
  const meta = getPageMeta(location.pathname)

  const isAdmin = user?.rol === 'superadmin' || user?.rol === 'admin_cliente'

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside
        className="w-64 flex-shrink-0 flex flex-col shadow-xl"
        style={{ backgroundColor: GUINDA_DARK }}
      >
        {/* Logo + identidad */}
        <div className="px-5 py-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
          <div className="flex items-center gap-3 mb-3">
            <img
              src="https://michoacan.gob.mx/cdn/img/logo-blanco.svg"
              alt="Gobierno del Estado de Michoacán"
              className="h-8 object-contain flex-shrink-0"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <div>
            <p className="text-white font-bold text-xs leading-tight">
              SECRETARÍA DE FINANZAS<br />Y ADMINISTRACIÓN
            </p>
            <p className="text-white/50 text-[10px] mt-0.5">Gobierno del Estado de Michoacán</p>
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
            <span className="text-white/40 text-[10px] uppercase tracking-widest font-medium">PIGOP</span>
          </div>
        </div>

        {/* Navegación */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {MODULES.map(({ section, items }) => {
            // Filtrar items según el rol del usuario
            const visibleItems = items.filter(item => !item.adminOnly || isAdmin)
            if (visibleItems.length === 0) return null

            return (
              <div key={section}>
                <p className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-2"
                   style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {section}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map(({ to, icon: Icon, label, sublabel, match, active }) => {
                    const isActive = match(location.pathname)
                    if (!active) {
                      // Módulo próximamente
                      return (
                        <div
                          key={to}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-not-allowed opacity-50"
                          title="Próximamente disponible"
                        >
                          <Icon size={15} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                                {label}
                              </p>
                              <span className="flex-shrink-0 text-[8px] px-1.5 py-0.5 rounded-full font-medium"
                                    style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)' }}>
                                PRONTO
                              </span>
                            </div>
                            <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.3)' }}>
                              {sublabel}
                            </p>
                          </div>
                          <Lock size={10} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                        </div>
                      )
                    }
                    return (
                      <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all"
                        style={{
                          backgroundColor: isActive ? GUINDA_ACTIVE : 'transparent',
                        }}
                        onMouseEnter={e => {
                          if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = GUINDA_LIGHT
                        }}
                        onMouseLeave={e => {
                          if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                        }}
                      >
                        <Icon
                          size={15}
                          style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.6)', flexShrink: 0 }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={clsx('text-xs font-medium truncate', isActive ? 'text-white' : 'text-white/70')}>
                            {label}
                          </p>
                          <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {sublabel}
                          </p>
                        </div>
                        {isActive && <ChevronRight size={12} className="text-white/50 flex-shrink-0" />}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* Usuario */}
        <div className="px-4 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: GUINDA }}>
              <User size={14} className="text-white/80" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">
                {user?.nombre_completo ?? 'Usuario'}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {user?.email}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.5)' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = '#fff'
              ;(e.currentTarget as HTMLElement).style.backgroundColor = GUINDA_LIGHT
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'
              ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
            }}
          >
            <LogOut size={13} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── Contenido principal ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between shadow-sm">
          <div>
            <h1 className="text-sm font-bold text-gray-900">{meta.title}</h1>
            <p className="text-xs text-gray-500 mt-0.5">{meta.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border"
                  style={{ backgroundColor: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              API conectada
            </span>
            <div className="h-4 w-px bg-gray-200" />
            <img
              src="https://michoacan.gob.mx/cdn/img/logo.svg"
              alt="Michoacán"
              className="h-6 object-contain opacity-60"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        </header>

        {/* Página */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
