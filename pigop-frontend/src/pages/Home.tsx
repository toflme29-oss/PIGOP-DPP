import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadPermissionOverrides } from '../utils/rolePermissions'
import { usePermissionsVersion } from '../hooks/usePermissionsVersion'
import { useQuery } from '@tanstack/react-query'
import {
  ShieldCheck, FolderOpen, Stamp,
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
  subtitle: string
  description: string
  icon: typeof ShieldCheck
  path: string
  color: string
  bgColor: string
  active: boolean
}

const ALL_MODULES: ModuleDef[] = [
  {
    id: 'gestion_documental',
    label: 'Gestión Documental',
    subtitle: 'CAPTURA Y SEGUIMIENTO DE OFICIOS',
    description: 'Captura, análisis y relación general de oficios recibidos. Generación y seguimiento de oficios de respuesta.',
    icon: FolderOpen,
    path: '/gestion-documental',
    color: '#911A3A',
    bgColor: '#fdf2f8',
    active: true,
  },
  {
    id: 'validacion_depp',
    label: 'Validación de Gasto Público',
    subtitle: 'REVISIÓN DOCUMENTAL CON IA',
    description: 'Validación automatizada de DEPPs y expedientes digitales. Análisis con Inteligencia Artificial conforme a normatividad vigente.',
    icon: ShieldCheck,
    path: '/revision-documental',
    color: '#1d4ed8',
    bgColor: '#eff6ff',
    active: true,
  },
  {
    id: 'certificaciones',
    label: 'Certificaciones y Validaciones',
    subtitle: 'EMISIÓN DE DOCUMENTOS CERTIFICADOS',
    description: 'Generación de certificaciones presupuestales, constancias de suficiencia y validaciones normativas para dependencias.',
    icon: Stamp,
    path: '/certificaciones',
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    active: false,
  },
  {
    id: 'minutas',
    label: 'Conciliación Presupuestal',
    subtitle: 'ANÁLISIS Y SEGUIMIENTO DE PROGRAMAS',
    description: 'Conciliación de cifras presupuestales, seguimiento al ejercicio del gasto y generación de reportes de avance programático.',
    icon: BarChart3,
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
  const sinTitulo = nombreCompleto
    .replace(/^(Mtro\.?|Mtra\.?|Lic\.?|Ing\.?|Dr\.?|Dra\.?|C\.P\.?|L\.A\.E\.?|C\.)\s+/i, '')
    .trim()
  return sinTitulo.split(' ')[0] || 'Usuario'
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

// ── Tipo de alerta con módulo ────────────────────────────────────────────────────
interface AlertItem {
  icon: typeof Clock
  color: string
  bg: string
  border: string
  text: string
  action: () => void
  moduleId: string
}

// ── Componente principal ────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const permissionsVersion = usePermissionsVersion()

  const [selectedModuleId, setSelectedModuleId] = useState<string>('gestion_documental')

  const isDirector   = user?.rol === 'admin_cliente'
  const isSecretaria = user?.rol === 'secretaria'
  const isSuperadmin = user?.rol === 'superadmin'
  const canBypass    = isSuperadmin || isDirector

  // Módulos accesibles según rol
  const MODULOS_POR_ROL: Record<string, string[]> = {
    superadmin:    ['validacion_depp', 'gestion_documental', 'certificaciones', 'minutas'],
    admin_cliente: ['validacion_depp', 'gestion_documental', 'certificaciones', 'minutas'],
    secretaria:    ['gestion_documental'],
    asesor:        ['gestion_documental'],
    subdirector:   ['gestion_documental'],
    jefe_depto:    ['gestion_documental'],
    analista:      ['gestion_documental'],
    auditor:       ['gestion_documental'],
    consulta:      ['gestion_documental'],
  }

  const moduleAccess = useMemo(() => {
    if (!user) return { accessible: [] as typeof ALL_MODULES, blocked: [] as typeof ALL_MODULES }
    const overrides   = loadPermissionOverrides()
    const permitidos  = MODULOS_POR_ROL[user.rol] || []
    const accessible: typeof ALL_MODULES = []
    const blocked:    typeof ALL_MODULES = []
    ALL_MODULES.filter(m => m.active).forEach(mod => {
      if (canBypass) { accessible.push(mod); return }
      const overrideKey = `mod_${mod.id}.${user.rol}`
      if (overrideKey in overrides) {
        overrides[overrideKey] ? accessible.push(mod) : blocked.push(mod)
        return
      }
      const acceso  = user.modulos_acceso || []
      const allowed = acceso.includes('todos')
        ? permitidos.includes(mod.id)
        : acceso.length > 0 ? acceso.includes(mod.id) : permitidos.includes(mod.id)
      allowed ? accessible.push(mod) : blocked.push(mod)
    })
    return { accessible, blocked }
  }, [user, canBypass, permissionsVersion])

  const userModules    = moduleAccess.accessible
  const blockedModules = moduleAccess.blocked
  const inactiveModules = ALL_MODULES.filter(m => !m.active)

  // Orden del carrusel: accesibles → bloqueados → inactivos
  const allModulesDisplay = useMemo(() => [
    ...userModules,
    ...blockedModules,
    ...inactiveModules,
  ], [userModules, blockedModules, inactiveModules])


  useEffect(() => {
    if (false) { navigate('/', { replace: true }) }
  }, [userModules, canBypass, navigate])

  // ── Data fetching ───────────────────────────────────────────────────────────
  const hasDocModule  = userModules.some(m => m.id === 'gestion_documental') || canBypass
  const hasDeppModule = userModules.some(m => m.id === 'validacion_depp')   || canBypass

  const { data: docsRecibidosResult, isLoading: loadingDocs } = useQuery({
    queryKey: ['documentos', 'home-recibidos'],
    queryFn:  () => documentosApi.list({ flujo: 'recibido', limit: 500 }),
    enabled:  hasDocModule,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const docsRecibidos = docsRecibidosResult?.items

  const { data: docsEmitidosResult } = useQuery({
    queryKey: ['documentos', 'home-emitidos'],
    queryFn:  () => documentosApi.list({ flujo: 'emitido', limit: 500 }),
    enabled:  hasDocModule,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const docsEmitidos = docsEmitidosResult?.items

  const { data: depps, isLoading: loadingDepps } = useQuery({
    queryKey: ['home-depps'],
    queryFn:  () => deppsApi.list({ limit: 200 }),
    enabled:  hasDeppModule,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  // ── Métricas de documentos ──────────────────────────────────────────────────
  const docMetrics = useMemo(() => {
    if (!docsRecibidos) return null
    const byEstado = (e: string) => docsRecibidos.filter(d => d.estado === e).length
    const hoy      = docsRecibidos.filter(d => isToday(d.creado_en)).length
    const urgentes = docsRecibidos.filter(d =>
      d.prioridad === 'urgente' || d.prioridad === 'muy_urgente'
    ).filter(d => d.estado !== 'firmado' && d.estado !== 'archivado').length
    const vencidos = docsRecibidos.filter(d =>
      d.fecha_limite && new Date(d.fecha_limite) < new Date() &&
      d.estado !== 'firmado' && d.estado !== 'archivado'
    ).length
    const firmadosSinDespachar       = docsRecibidos.filter(d => d.estado === 'firmado' && !d.despachado).length
    const pendientesVB               = docsRecibidos.filter(d => d.estado === 'respondido' && !d.visto_bueno_subdirector).length
    const memosPendientes            = docsRecibidos.filter(d =>
      d.tipo === 'memorandum' && d.tipo_memorandum === 'requiere_atencion' &&
      !['firmado', 'archivado'].includes(d.estado)
    ).length
    const turnadosADireccion         = docsRecibidos.filter(d =>
      d.area_turno === 'DIR' && ['turnado', 'en_atencion'].includes(d.estado)
    ).length
    const conocimientoDireccion      = docsRecibidos.filter(d =>
      d.estado === 'de_conocimiento' && d.area_turno === 'DIR'
    ).length
    const instruidosASecretaria      = docsRecibidos.filter(d =>
      d.area_turno === 'SEC' && ['turnado', 'en_atencion'].includes(d.estado)
    ).length
    const emitidosEnRevisionDirector = docsEmitidos?.filter(d =>
      d.estado === 'en_revision' && !d.firmado_digitalmente
    ).length ?? 0

    return {
      recibidos: byEstado('recibido'),
      turnados: byEstado('turnado'),
      enAtencion: byEstado('en_atencion'),
      respondidos: byEstado('respondido'),
      firmados: byEstado('firmado'),
      firmadosSinDespachar,
      devueltos: byEstado('devuelto'),
      pendientesVB,
      memosPendientes,
      turnadosADireccion,
      conocimientoDireccion,
      instruidosASecretaria,
      emitidosEnRevisionDirector,
      hoy,
      urgentes,
      vencidos,
      totalEmitidos: docsEmitidos?.length ?? 0,
      borradores: docsEmitidos?.filter(d => d.estado === 'borrador').length ?? 0,
      emitidosPendientesFirma: docsEmitidos?.filter(d => ['respondido', 'en_revision'].includes(d.estado) && !d.firmado_digitalmente).length ?? 0,
    }
  }, [docsRecibidos, docsEmitidos])

  // ── Métricas DEPP ───────────────────────────────────────────────────────────
  const deppMetrics = useMemo(() => {
    if (!depps) return null
    const enRevision = depps.filter(d => d.estado === 'en_revision').length
    const aprobados  = depps.filter(d => d.estado === 'aprobado').length
    const rechazados = depps.filter(d => d.estado === 'rechazado').length
    const hoy        = depps.filter(d => isToday(d.creado_en)).length
    return { enRevision, aprobados, rechazados, total: depps.length, hoy }
  }, [depps])

  // ── Alertas con moduleId ────────────────────────────────────────────────────
  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = []

    if (docMetrics && hasDocModule) {
      if ((isDirector || isSuperadmin) && docMetrics.turnadosADireccion > 0) {
        items.push({
          icon: Inbox, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
          text: `Secretaría: ${docMetrics.turnadosADireccion} oficio${docMetrics.turnadosADireccion !== 1 ? 's' : ''} turnado${docMetrics.turnadosADireccion !== 1 ? 's' : ''} para tu revisión`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if ((isDirector || isSuperadmin) && docMetrics.conocimientoDireccion > 0) {
        items.push({
          icon: FileText, color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-200',
          text: `${docMetrics.conocimientoDireccion} oficio${docMetrics.conocimientoDireccion !== 1 ? 's' : ''} para conocimiento de Dirección`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (isDirector && docMetrics.respondidos > 0) {
        items.push({
          icon: FileSignature, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
          text: `${docMetrics.respondidos} oficio${docMetrics.respondidos !== 1 ? 's' : ''} respondido${docMetrics.respondidos !== 1 ? 's' : ''} pendiente${docMetrics.respondidos !== 1 ? 's' : ''} de tu firma`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if ((isDirector || isSuperadmin) && docMetrics.emitidosEnRevisionDirector > 0) {
        items.push({
          icon: FileSignature, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
          text: `${docMetrics.emitidosEnRevisionDirector} oficio${docMetrics.emitidosEnRevisionDirector !== 1 ? 's' : ''} emitido${docMetrics.emitidosEnRevisionDirector !== 1 ? 's' : ''} en revisión — pendiente${docMetrics.emitidosEnRevisionDirector !== 1 ? 's' : ''} de tu firma`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (isSecretaria && docMetrics.instruidosASecretaria > 0) {
        items.push({
          icon: Inbox, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-300',
          text: `Director: ${docMetrics.instruidosASecretaria} oficio${docMetrics.instruidosASecretaria !== 1 ? 's' : ''} asignado${docMetrics.instruidosASecretaria !== 1 ? 's' : ''} para que contestes`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (isSecretaria && docMetrics.firmadosSinDespachar > 0) {
        items.push({
          icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
          text: `${docMetrics.firmadosSinDespachar} documento${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} firmado${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} pendiente${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} de despacho`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (user?.rol === 'subdirector' && docMetrics.pendientesVB > 0) {
        items.push({
          icon: CheckCircle2, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
          text: `${docMetrics.pendientesVB} documento${docMetrics.pendientesVB !== 1 ? 's' : ''} pendiente${docMetrics.pendientesVB !== 1 ? 's' : ''} de visto bueno`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (docMetrics.memosPendientes > 0) {
        items.push({
          icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200',
          text: `${docMetrics.memosPendientes} memorándum${docMetrics.memosPendientes !== 1 ? 's' : ''} pendiente${docMetrics.memosPendientes !== 1 ? 's' : ''} de atención`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (!isDirector && !isSecretaria && !isSuperadmin && docMetrics.enAtencion > 0) {
        items.push({
          icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
          text: `${docMetrics.enAtencion} documento${docMetrics.enAtencion !== 1 ? 's' : ''} para atender`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (docMetrics.urgentes > 0) {
        items.push({
          icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200',
          text: `${docMetrics.urgentes} documento${docMetrics.urgentes !== 1 ? 's' : ''} urgente${docMetrics.urgentes !== 1 ? 's' : ''}`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (docMetrics.vencidos > 0) {
        items.push({
          icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200',
          text: `${docMetrics.vencidos} documento${docMetrics.vencidos !== 1 ? 's' : ''} con plazo vencido`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
      if (docMetrics.devueltos > 0) {
        items.push({
          icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200',
          text: `${docMetrics.devueltos} documento${docMetrics.devueltos !== 1 ? 's' : ''} devuelto${docMetrics.devueltos !== 1 ? 's' : ''}`,
          action: () => navigate('/gestion-documental'), moduleId: 'gestion_documental',
        })
      }
    }

    if (deppMetrics && hasDeppModule && deppMetrics.enRevision > 0) {
      items.push({
        icon: ShieldCheck, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
        text: `${deppMetrics.enRevision} DEPP${deppMetrics.enRevision !== 1 ? 's' : ''} en revisión`,
        action: () => navigate('/depps'), moduleId: 'validacion_depp',
      })
    }

    return items
  }, [docMetrics, deppMetrics, isDirector, isSecretaria, isSuperadmin, hasDocModule, hasDeppModule, navigate, user])

  // ── Actividad reciente ──────────────────────────────────────────────────────
  const recentDocs = useMemo(() => {
    if (!docsRecibidos) return []
    return [...docsRecibidos]
      .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime())
      .slice(0, 5)
  }, [docsRecibidos])

  if (!user) return null

  const isLoading = (hasDocModule && loadingDocs) || (hasDeppModule && loadingDepps)

  // Módulo seleccionado
  const selectedModule     = allModulesDisplay.find(m => m.id === selectedModuleId)
  const selectedIsActive   = userModules.some(m => m.id === selectedModuleId)
  const selectedIsInactive = !selectedIsActive

  // Alertas del módulo seleccionado
  const moduleAlerts = alerts.filter(a => a.moduleId === selectedModuleId)


  return (
    <div className="flex flex-col h-full min-h-0">

    {/* ══ SECCIÓN FIJA: saludo + módulos ══════════════════════════════════════ */}
    <div className="flex-shrink-0 px-4 lg:px-6 pt-4 lg:pt-6 pb-4 space-y-4 bg-gray-100 border-b border-gray-200">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
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

      {/* ── Módulos ──────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Tus módulos</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {allModulesDisplay.map(mod => {
            const isAccessible = userModules.some(m => m.id === mod.id)
            const isSelected   = selectedModuleId === mod.id

            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModuleId(mod.id)}
                onDoubleClick={() => isAccessible && navigate(mod.path)}
                className={clsx(
                  'flex flex-col p-5 rounded-xl border text-left transition-all duration-200',
                  isSelected
                    ? 'shadow-md -translate-y-0.5'
                    : 'bg-white hover:shadow-md hover:-translate-y-0.5',
                  !isAccessible && 'opacity-60',
                )}
                style={isSelected
                  ? { borderColor: mod.color, backgroundColor: mod.bgColor }
                  : { borderColor: '#e5e7eb', backgroundColor: '#ffffff' }
                }
              >
                {/* Badge próximamente */}
                {!isAccessible && (
                  <span className={clsx(
                    'self-end inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mb-1',
                    mod.active
                      ? 'text-gray-500 bg-gray-100 border border-gray-200'
                      : 'text-amber-600 bg-amber-50 border border-amber-200',
                  )}>
                    <Clock size={9} /> Próximamente
                  </span>
                )}

                {/* Ícono */}
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 mb-4 transition-transform group-hover:scale-105"
                     style={{ backgroundColor: isAccessible ? mod.color : '#e5e7eb' }}>
                  <mod.icon size={24} className="text-white" />
                </div>

                {/* Nombre y subtítulo */}
                <h3 className={clsx('text-base font-bold', isSelected ? 'text-gray-900' : 'text-gray-700')}>
                  {mod.label}
                </h3>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
                  {mod.subtitle}
                </p>

                {/* Descripción */}
                <p className="text-xs text-gray-500 mt-2 flex-1">
                  {mod.description}
                </p>

                {/* Mini métricas */}
                {isAccessible && mod.id === 'gestion_documental' && docMetrics && (
                  <div className="flex items-center gap-3 mt-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <Inbox size={10} /> {docMetrics.hoy} hoy
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
                      <FileText size={10} /> {(docsRecibidos?.length ?? 0) + (docsEmitidos?.length ?? 0)} total
                    </span>
                    {docMetrics.borradores > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                        <Clock size={10} /> {docMetrics.borradores} borradores
                      </span>
                    )}
                  </div>
                )}
                {isAccessible && mod.id === 'validacion_depp' && deppMetrics && (
                  <div className="flex items-center gap-3 mt-2">
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

                {/* Link inferior */}
                {isAccessible ? (
                  <div
                    onClick={e => { e.stopPropagation(); navigate(mod.path) }}
                    className="flex items-center gap-1 mt-4 text-xs font-semibold hover:underline cursor-pointer"
                    style={{ color: mod.color }}
                  >
                    Acceder al módulo <ArrowRight size={13} />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-4 font-medium">Módulo en desarrollo</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>{/* fin sección fija */}

    {/* ══ SECCIÓN SCROLLABLE: alertas + métricas + docs recientes ════════════ */}
    <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-4 space-y-4">

      {/* ── Contenido del módulo seleccionado ────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-10"><PageSpinner /></div>
      ) : selectedModule && (
        <div className="space-y-4">

          {/* Módulo activo: mostrar alertas + métricas + docs recientes */}
          {selectedIsActive ? (
            <>
              {/* Métricas — Gestión Documental */}
              {selectedModuleId === 'gestion_documental' && docMetrics && (
                <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Atención requerida
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard
                    label="Recibidos hoy"
                    value={docMetrics.hoy}
                    icon={Inbox}
                    color="#1d4ed8"
                    bgColor="#eff6ff"
                    onClick={() => navigate('/gestion-documental', { state: { filtro: 'hoy' } })}
                  />
                  {isDirector && (
                    <MetricCard
                      label="Por firmar"
                      value={docMetrics.respondidos}
                      icon={FileSignature}
                      color="#d97706"
                      bgColor="#fef3c7"
                      highlight={docMetrics.respondidos > 0}
                      onClick={() => navigate('/gestion-documental', { state: { filtro: 'por_firmar' } })}
                    />
                  )}
                  {isSecretaria && (
                    <MetricCard
                      label="Pendientes despacho"
                      value={docMetrics.firmadosSinDespachar}
                      icon={CheckCircle2}
                      color="#059669"
                      bgColor="#d1fae5"
                      highlight={docMetrics.firmadosSinDespachar > 0}
                      onClick={() => navigate('/gestion-documental', { state: { filtro: 'firmados' } })}
                    />
                  )}
                  {user?.rol === 'subdirector' && (
                    <MetricCard
                      label="Pendientes V.B."
                      value={docMetrics.pendientesVB}
                      icon={CheckCircle2}
                      color="#d97706"
                      bgColor="#fef3c7"
                      highlight={docMetrics.pendientesVB > 0}
                      onClick={() => navigate('/gestion-documental', { state: { filtro: 'pendientes_vb' } })}
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
                      onClick={() => navigate('/gestion-documental', { state: { filtro: 'en_atencion' } })}
                    />
                  )}
                  <MetricCard
                    label="Urgentes"
                    value={docMetrics.urgentes}
                    icon={AlertTriangle}
                    color="#dc2626"
                    bgColor="#fee2e2"
                    highlight={docMetrics.urgentes > 0}
                    onClick={() => navigate('/gestion-documental', { state: { filtro: 'urgentes' } })}
                  />
                  <MetricCard
                    label="Plazo vencido"
                    value={docMetrics.vencidos}
                    icon={AlertTriangle}
                    color="#ea580c"
                    bgColor="#fff7ed"
                    highlight={docMetrics.vencidos > 0}
                    onClick={() => navigate('/gestion-documental', { state: { filtro: 'vencidos' } })}
                  />
                </div>
                </div>
              )}

              {/* Métricas — Validación DEPP */}
              {selectedModuleId === 'validacion_depp' && deppMetrics && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <MetricCard
                    label="DEPPs rechazados"
                    value={deppMetrics.rechazados}
                    icon={AlertTriangle}
                    color="#dc2626"
                    bgColor="#fee2e2"
                    highlight={deppMetrics.rechazados > 0}
                  />
                  <MetricCard
                    label="Total DEPPs"
                    value={deppMetrics.total}
                    icon={BarChart3}
                    color="#6b7280"
                    bgColor="#f3f4f6"
                  />
                </div>
              )}

              {/* Documentos recientes — Gestión Documental */}
              {selectedModuleId === 'gestion_documental' && recentDocs.length > 0 && (
                <div className="space-y-2">
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

              {/* CTA para ir al módulo */}
              <div className="flex justify-end">
                <button
                  onClick={() => navigate(selectedModule.path)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 hover:shadow-md active:scale-95"
                  style={{ backgroundColor: selectedModule.color }}
                >
                  Ir a {selectedModule.label}
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : (
            /* Módulo próximamente / bloqueado */
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <selectedModule.icon size={30} className="text-gray-400" />
              </div>
              <h3 className="text-base font-bold text-gray-600">{selectedModule.label}</h3>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full mt-3">
                <Clock size={11} /> Próximamente
              </span>
              <p className="text-sm text-gray-400 mt-4 max-w-sm mx-auto leading-relaxed">
                {selectedModule.description}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Este módulo está en desarrollo. Estará disponible próximamente.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Sin módulos asignados ─────────────────────────────────────────────── */}
      {userModules.length === 0 && !isLoading && (
        <div className="text-center py-16">
          <Lock size={40} className="text-gray-300 mx-auto mb-4" />
          <h3 className="text-sm font-semibold text-gray-600">Sin módulos asignados</h3>
          <p className="text-xs text-gray-400 mt-1">
            Contacta al administrador para que te asigne acceso a los módulos del sistema.
          </p>
        </div>
      )}
    </div>{/* fin sección scrollable */}

    </div>
  )
}

// ── Componentes auxiliares ───────────────────────────────────────────────────────
function MetricCard({
  label, value, icon: Icon, color, bgColor, highlight, onClick,
}: {
  label: string
  value: number
  icon: typeof Clock
  color: string
  bgColor: string
  highlight?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3.5 p-4 bg-white rounded-xl border transition-all text-left w-full',
        highlight ? 'border-amber-200 shadow-sm' : 'border-gray-200',
        onClick && 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-95',
      )}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
           style={{ backgroundColor: bgColor }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-[11px] text-gray-500 font-medium">{label}</p>
      </div>
    </button>
  )
}

const ESTADO_DOT_COLOR: Record<string, string> = {
  recibido:   '#3b82f6',
  turnado:    '#f59e0b',
  en_atencion:'#a855f7',
  devuelto:   '#dc2626',
  respondido: '#0ea5e9',
  firmado:    '#10b981',
  borrador:   '#d97706',
  en_revision:'#a855f7',
  vigente:    '#10b981',
}

function RecentDocRow({ doc }: { doc: DocumentoListItem }) {
  const dotColor = ESTADO_DOT_COLOR[doc.estado] ?? '#9ca3af'

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
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
