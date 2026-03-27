import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck, FolderOpen, Stamp, ClipboardList,
  ArrowRight, FileSignature, Clock, CheckCircle2,
  AlertTriangle, FileText, BarChart3, Lock,
  TrendingUp, Inbox, CalendarDays,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../hooks/useAuth'
import { documentosApi, type DocumentoListItem } from '../api/documentos'
import { deppsApi } from '../api/depps'
import { ROL_LABELS } from '../api/usuarios'
import { PageSpinner } from '../components/ui/Spinner'

const GUINDA = '#911A3A'

// ── Módulos del sistema ─────────────────────────────────────────────────────────
interface ModuleDef {
  id: string
  label: string
  description: string
  icon: typeof ShieldCheck
  path: string
  color: string
  bgColor: string
  active: boolean
}

const ALL_MODULES: ModuleDef[] = [
  {
    id: 'validacion_depp',
    label: 'Validación del Gasto Público',
    description: 'Revisión y dictamen de DEPPs, importación SAP y bandejas de validación',
    icon: ShieldCheck,
    path: '/depps',
    color: '#911A3A',
    bgColor: '#fdf2f8',
    active: true,
  },
  {
    id: 'gestion_documental',
    label: 'Gestión Documental',
    description: 'Control de correspondencia, turnado, elaboración de oficios y firma digital',
    icon: FolderOpen,
    path: '/gestion-documental',
    color: '#1d4ed8',
    bgColor: '#eff6ff',
    active: true,
  },
  {
    id: 'certificaciones',
    label: 'Certificaciones Presupuestales',
    description: 'Gestión de afectaciones y certificaciones al presupuesto',
    icon: Stamp,
    path: '/certificaciones',
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    active: false,
  },
  {
    id: 'minutas',
    label: 'Minutas de Conciliación',
    description: 'Control y seguimiento de reuniones entre áreas',
    icon: ClipboardList,
    path: '/minutas',
    color: '#0d9488',
    bgColor: '#f0fdfa',
    active: false,
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────────
function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function getPrimerNombre(nombreCompleto: string | undefined | null): string {
  if (!nombreCompleto) return 'Usuario'
  // Quitar títulos/prefijos comunes
  const sinTitulo = nombreCompleto
    .replace(/^(Mtro\.?|Mtra\.?|Lic\.?|Ing\.?|Dr\.?|Dra\.?|C\.P\.?|L\.A\.E\.?|C\.)\s+/i, '')
    .trim()
  // Retornar solo el primer nombre
  return sinTitulo.split(' ')[0] || 'Usuario'
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

// ── Componente principal ────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const isDirector = user?.rol === 'admin_cliente'
  const isSecretaria = user?.rol === 'secretaria'
  const isSuperadmin = user?.rol === 'superadmin'
  const canBypass = isSuperadmin || isDirector

  // Módulos accesibles según rol del usuario
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
  const userModules = useMemo(() => {
    if (!user) return []
    const permitidos = MODULOS_POR_ROL[user.rol] || []
    return ALL_MODULES.filter(mod => {
      if (!mod.active) return false
      if (canBypass) return true
      // Revisar modulos_acceso: "todos" da acceso a todo, si no, verificar por rol
      const acceso = user.modulos_acceso || []
      if (acceso.includes('todos')) return permitidos.includes(mod.id)
      if (acceso.length > 0) return acceso.includes(mod.id)
      return permitidos.includes(mod.id)
    })
  }, [user, canBypass])

  // Si el usuario solo tiene acceso a un módulo, redirigir directamente
  useEffect(() => {
    if (userModules.length === 1 && !canBypass) {
      navigate(userModules[0].path, { replace: true })
    }
  }, [userModules, canBypass, navigate])

  // Módulos próximamente — solo visibles para director y superadmin
  const inactiveModules = canBypass ? ALL_MODULES.filter(m => !m.active) : []

  // ── Data fetching ───────────────────────────────────────────────────────────
  const hasDocModule = canBypass || (user?.modulos_acceso || []).includes('gestion_documental')
  const hasDeppModule = canBypass || (user?.modulos_acceso || []).includes('validacion_depp')

  const { data: docsRecibidos, isLoading: loadingDocs } = useQuery({
    queryKey: ['home-docs-recibidos'],
    queryFn: () => documentosApi.list({ flujo: 'recibido', limit: 200 }),
    enabled: hasDocModule,
    staleTime: 30_000,
  })

  const { data: docsEmitidos } = useQuery({
    queryKey: ['home-docs-emitidos'],
    queryFn: () => documentosApi.list({ flujo: 'emitido', limit: 200 }),
    enabled: hasDocModule,
    staleTime: 30_000,
  })

  const { data: depps, isLoading: loadingDepps } = useQuery({
    queryKey: ['home-depps'],
    queryFn: () => deppsApi.list({ limit: 200 }),
    enabled: hasDeppModule,
    staleTime: 30_000,
  })

  // ── Métricas de documentos ──────────────────────────────────────────────────
  const docMetrics = useMemo(() => {
    if (!docsRecibidos) return null
    const byEstado = (e: string) => docsRecibidos.filter(d => d.estado === e).length
    const hoy = docsRecibidos.filter(d => isToday(d.creado_en)).length
    const urgentes = docsRecibidos.filter(d =>
      d.prioridad === 'urgente' || d.prioridad === 'muy_urgente'
    ).filter(d => d.estado !== 'firmado' && d.estado !== 'archivado').length
    const vencidos = docsRecibidos.filter(d =>
      d.fecha_limite && new Date(d.fecha_limite) < new Date() &&
      d.estado !== 'firmado' && d.estado !== 'archivado'
    ).length

    return {
      recibidos: byEstado('recibido'),
      turnados: byEstado('turnado'),
      enAtencion: byEstado('en_atencion'),
      respondidos: byEstado('respondido'),
      firmados: byEstado('firmado'),
      devueltos: byEstado('devuelto'),
      hoy,
      urgentes,
      vencidos,
      totalEmitidos: docsEmitidos?.length ?? 0,
      borradores: docsEmitidos?.filter(d => d.estado === 'borrador').length ?? 0,
    }
  }, [docsRecibidos, docsEmitidos])

  // ── Métricas DEPP ───────────────────────────────────────────────────────────
  const deppMetrics = useMemo(() => {
    if (!depps) return null
    const enRevision = depps.filter(d => d.estado === 'en_revision').length
    const aprobados = depps.filter(d => d.estado === 'aprobado').length
    const rechazados = depps.filter(d => d.estado === 'rechazado').length
    const hoy = depps.filter(d => isToday(d.creado_en)).length
    return { enRevision, aprobados, rechazados, total: depps.length, hoy }
  }, [depps])

  // ── Alertas por rol ─────────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    const items: { icon: typeof Clock; color: string; bg: string; border: string; text: string; action: () => void }[] = []

    if (docMetrics && hasDocModule) {
      // Director: docs por firmar
      if (isDirector && docMetrics.respondidos > 0) {
        items.push({
          icon: FileSignature,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          text: `${docMetrics.respondidos} documento${docMetrics.respondidos !== 1 ? 's' : ''} pendiente${docMetrics.respondidos !== 1 ? 's' : ''} de firma`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Secretaria: docs firmados para despacho
      if (isSecretaria && docMetrics.firmados > 0) {
        items.push({
          icon: CheckCircle2,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          text: `${docMetrics.firmados} documento${docMetrics.firmados !== 1 ? 's' : ''} firmado${docMetrics.firmados !== 1 ? 's' : ''} listo${docMetrics.firmados !== 1 ? 's' : ''} para despacho`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Áreas: docs para atender
      if (!isDirector && !isSecretaria && !isSuperadmin && docMetrics.enAtencion > 0) {
        items.push({
          icon: Clock,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          border: 'border-purple-200',
          text: `${docMetrics.enAtencion} documento${docMetrics.enAtencion !== 1 ? 's' : ''} para atender`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Todos: docs urgentes
      if (docMetrics.urgentes > 0) {
        items.push({
          icon: AlertTriangle,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
          text: `${docMetrics.urgentes} documento${docMetrics.urgentes !== 1 ? 's' : ''} urgente${docMetrics.urgentes !== 1 ? 's' : ''}`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Docs vencidos
      if (docMetrics.vencidos > 0) {
        items.push({
          icon: AlertTriangle,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
          text: `${docMetrics.vencidos} documento${docMetrics.vencidos !== 1 ? 's' : ''} con plazo vencido`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Docs devueltos
      if (docMetrics.devueltos > 0) {
        items.push({
          icon: AlertTriangle,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-200',
          text: `${docMetrics.devueltos} documento${docMetrics.devueltos !== 1 ? 's' : ''} devuelto${docMetrics.devueltos !== 1 ? 's' : ''}`,
          action: () => navigate('/gestion-documental'),
        })
      }
    }

    if (deppMetrics && hasDeppModule) {
      if (deppMetrics.enRevision > 0) {
        items.push({
          icon: ShieldCheck,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          text: `${deppMetrics.enRevision} DEPP${deppMetrics.enRevision !== 1 ? 's' : ''} en revisión`,
          action: () => navigate('/depps'),
        })
      }
    }

    return items
  }, [docMetrics, deppMetrics, isDirector, isSecretaria, isSuperadmin, hasDocModule, hasDeppModule, navigate])

  // ── Actividad reciente (últimos 5 docs recibidos hoy) ───────────────────────
  const recentDocs = useMemo(() => {
    if (!docsRecibidos) return []
    return [...docsRecibidos]
      .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime())
      .slice(0, 5)
  }, [docsRecibidos])

  if (!user) return null

  const isLoading = (hasDocModule && loadingDocs) || (hasDeppModule && loadingDepps)

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* ── Header de bienvenida ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {getGreeting()}, {getPrimerNombre(user.nombre_completo)}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {ROL_LABELS[user.rol] ?? user.rol} · {new Date().toLocaleDateString('es-MX', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
             style={{ backgroundColor: `${GUINDA}10`, color: GUINDA }}>
          <CalendarDays size={14} />
          Ejercicio 2026
        </div>
      </div>

      {/* ── Alertas prioritarias ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-8"><PageSpinner /></div>
      ) : alerts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Atención requerida
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {alerts.map((alert, i) => (
              <button
                key={i}
                onClick={alert.action}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all hover:shadow-sm',
                  alert.bg, alert.border,
                )}
              >
                <alert.icon size={18} className={clsx(alert.color, 'flex-shrink-0')} />
                <span className={clsx('text-sm font-medium', alert.color.replace('text-', 'text-').replace('-600', '-800'))}>
                  {alert.text}
                </span>
                <ArrowRight size={14} className={clsx(alert.color, 'ml-auto flex-shrink-0 opacity-50')} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Módulos disponibles ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Tus módulos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {userModules.map(mod => (
            <button
              key={mod.id}
              onClick={() => navigate(mod.path)}
              className="group flex items-start gap-4 p-5 bg-white rounded-xl border border-gray-200 text-left transition-all hover:shadow-md hover:border-gray-300 hover:-translate-y-0.5"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105"
                   style={{ backgroundColor: mod.bgColor }}>
                <mod.icon size={22} style={{ color: mod.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900 group-hover:text-gray-700 truncate">
                    {mod.label}
                  </h3>
                  <ArrowRight size={14} className="text-gray-300 group-hover:text-gray-500 transition-colors flex-shrink-0" />
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  {mod.description}
                </p>
                {/* Mini-métricas inline */}
                {mod.id === 'gestion_documental' && docMetrics && (
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <Inbox size={10} /> {docMetrics.hoy} hoy
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <FileText size={10} /> {(docsRecibidos?.length ?? 0) + (docsEmitidos?.length ?? 0)} total
                    </span>
                    {docMetrics.borradores > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                        <Clock size={10} /> {docMetrics.borradores} borrador{docMetrics.borradores !== 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>
                )}
                {mod.id === 'validacion_depp' && deppMetrics && (
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <TrendingUp size={10} /> {deppMetrics.hoy} hoy
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <BarChart3 size={10} /> {deppMetrics.total} total
                    </span>
                    {deppMetrics.enRevision > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                        <Clock size={10} /> {deppMetrics.enRevision} pendientes
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          ))}

          {/* Módulos próximamente */}
          {inactiveModules.map(mod => (
            <div
              key={mod.id}
              className="flex items-start gap-4 p-5 bg-gray-50 rounded-xl border border-dashed border-gray-200 opacity-60"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100">
                <mod.icon size={22} className="text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-gray-500 truncate">{mod.label}</h3>
                  <Lock size={12} className="text-gray-400 flex-shrink-0" />
                </div>
                <p className="text-xs text-gray-400 mt-1">{mod.description}</p>
                <span className="inline-block mt-2 text-[10px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  Próximamente
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Resumen rápido ───────────────────────────────────────────────────── */}
      {!isLoading && (docMetrics || deppMetrics) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Gestión Documental metrics */}
          {docMetrics && hasDocModule && (
            <>
              <MetricCard
                label="Recibidos hoy"
                value={docMetrics.hoy}
                icon={Inbox}
                color="#1d4ed8"
                bgColor="#eff6ff"
              />
              {isDirector && (
                <MetricCard
                  label="Por firmar"
                  value={docMetrics.respondidos}
                  icon={FileSignature}
                  color="#d97706"
                  bgColor="#fef3c7"
                  highlight={docMetrics.respondidos > 0}
                />
              )}
              {isSecretaria && (
                <MetricCard
                  label="Firmados para despacho"
                  value={docMetrics.firmados}
                  icon={CheckCircle2}
                  color="#059669"
                  bgColor="#d1fae5"
                  highlight={docMetrics.firmados > 0}
                />
              )}
              {!isDirector && !isSecretaria && (
                <MetricCard
                  label="En atención"
                  value={docMetrics.enAtencion}
                  icon={Clock}
                  color="#7c3aed"
                  bgColor="#f3e8ff"
                  highlight={docMetrics.enAtencion > 0}
                />
              )}
            </>
          )}
          {/* DEPP metrics */}
          {deppMetrics && hasDeppModule && (
            <>
              <MetricCard
                label="DEPPs en revisión"
                value={deppMetrics.enRevision}
                icon={ShieldCheck}
                color={GUINDA}
                bgColor="#fdf2f8"
                highlight={deppMetrics.enRevision > 0}
              />
              <MetricCard
                label="DEPPs aprobados"
                value={deppMetrics.aprobados}
                icon={CheckCircle2}
                color="#059669"
                bgColor="#d1fae5"
              />
            </>
          )}
        </div>
      )}

      {/* ── Actividad reciente ───────────────────────────────────────────────── */}
      {hasDocModule && recentDocs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Documentos recientes
            </h2>
            <button
              onClick={() => navigate('/gestion-documental')}
              className="text-xs font-medium hover:underline"
              style={{ color: GUINDA }}
            >
              Ver todos
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
            {recentDocs.map(doc => (
              <RecentDocRow key={doc.id} doc={doc} />
            ))}
          </div>
        </div>
      )}

      {/* ── Sin módulos ──────────────────────────────────────────────────────── */}
      {userModules.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <Lock size={40} className="text-gray-300 mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-gray-600">Sin módulos asignados</h3>
          <p className="text-xs text-gray-400 mt-1">
            Contacta al administrador para que te asigne acceso a los módulos del sistema.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Componentes auxiliares ───────────────────────────────────────────────────────
function MetricCard({
  label, value, icon: Icon, color, bgColor, highlight,
}: {
  label: string
  value: number
  icon: typeof Clock
  color: string
  bgColor: string
  highlight?: boolean
}) {
  return (
    <div className={clsx(
      'flex items-center gap-3.5 p-4 bg-white rounded-xl border transition-all',
      highlight ? 'border-amber-200 shadow-sm' : 'border-gray-200',
    )}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
           style={{ backgroundColor: bgColor }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-[11px] text-gray-500 font-medium">{label}</p>
      </div>
    </div>
  )
}

const ESTADO_DOT_COLOR: Record<string, string> = {
  recibido: '#3b82f6',
  turnado: '#f59e0b',
  en_atencion: '#a855f7',
  devuelto: '#dc2626',
  respondido: '#0ea5e9',
  firmado: '#10b981',
  borrador: '#d97706',
  en_revision: '#a855f7',
  vigente: '#10b981',
}

function RecentDocRow({ doc }: { doc: DocumentoListItem }) {
  const dotColor = ESTADO_DOT_COLOR[doc.estado] ?? '#9ca3af'

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      <div className="w-2 h-2 rounded-full flex-shrink-0"
           style={{ backgroundColor: dotColor }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {doc.asunto || 'Sin asunto'}
        </p>
        <p className="text-[11px] text-gray-400 truncate">
          {doc.numero_oficio_origen ?? doc.numero_control ?? '—'} · {doc.remitente_nombre ?? doc.dependencia_destino ?? '—'}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {doc.area_turno_nombre && (
          <span className="text-[10px] text-gray-400 font-medium max-w-[80px] truncate hidden sm:block">
            {doc.area_turno_nombre}
          </span>
        )}
        <span className="text-[10px] text-gray-400">
          {formatDateShort(doc.creado_en)}
        </span>
      </div>
    </div>
  )
}
