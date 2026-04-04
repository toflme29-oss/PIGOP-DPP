import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
    subtitle: 'CONTROL Y VALIDACIÓN NORMATIVA',
    description: 'Validación de afectaciones presupuestales, revisión de CLC y documentos soporte conforme a normatividad vigente.',
    icon: ShieldCheck,
    path: '/depps',
    color: '#1d4ed8',
    bgColor: '#eff6ff',
    active: false,
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

  // Siempre mostrar dashboard con saludo — no redirigir automáticamente
  useEffect(() => {
    if (false) {  // Deshabilitado: siempre mostrar Home
      navigate('/', { replace: true })
    }
  }, [userModules, canBypass, navigate])

  // Módulos próximamente — visibles para todos los usuarios
  const inactiveModules = ALL_MODULES.filter(m => !m.active)

  // ── Data fetching ───────────────────────────────────────────────────────────
  const hasDocModule = userModules.some(m => m.id === 'gestion_documental') || canBypass
  const hasDeppModule = userModules.some(m => m.id === 'validacion_depp') || canBypass

  const { data: docsRecibidosResult, isLoading: loadingDocs } = useQuery({
    queryKey: ['documentos', 'home-recibidos'],
    queryFn: () => documentosApi.list({ flujo: 'recibido', limit: 500 }),
    enabled: hasDocModule,
    staleTime: 10_000,
    refetchInterval: 30_000,        // auto-refresh cada 30s
    refetchOnWindowFocus: true,     // refresh al volver a la pestaña
  })
  const docsRecibidos = docsRecibidosResult?.items

  const { data: docsEmitidosResult } = useQuery({
    queryKey: ['documentos', 'home-emitidos'],
    queryFn: () => documentosApi.list({ flujo: 'emitido', limit: 500 }),
    enabled: hasDocModule,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const docsEmitidos = docsEmitidosResult?.items

  const { data: depps, isLoading: loadingDepps } = useQuery({
    queryKey: ['home-depps'],
    queryFn: () => deppsApi.list({ limit: 200 }),
    enabled: hasDeppModule,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
    // Firmados pendientes de despacho (excluir ya despachados)
    const firmadosSinDespachar = docsRecibidos.filter(d => d.estado === 'firmado' && !d.despachado).length
    // Pendientes de visto bueno (subdirector)
    const pendientesVB = docsRecibidos.filter(d => d.estado === 'respondido' && !d.visto_bueno_subdirector).length
    // Memorándums pendientes
    const memosPendientes = docsRecibidos.filter(d =>
      d.tipo === 'memorandum' && d.tipo_memorandum === 'requiere_atencion' &&
      !['firmado', 'archivado'].includes(d.estado)
    ).length

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

      // Director: emitidos pendientes de firma
      if ((isDirector || isSuperadmin) && docMetrics.emitidosPendientesFirma > 0) {
        items.push({
          icon: FileSignature,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          text: `${docMetrics.emitidosPendientesFirma} oficio${docMetrics.emitidosPendientesFirma !== 1 ? 's' : ''} emitido${docMetrics.emitidosPendientesFirma !== 1 ? 's' : ''} pendiente${docMetrics.emitidosPendientesFirma !== 1 ? 's' : ''} de firma`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Secretaria: docs firmados pendientes de despacho (excluye ya despachados)
      if (isSecretaria && docMetrics.firmadosSinDespachar > 0) {
        items.push({
          icon: CheckCircle2,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          text: `${docMetrics.firmadosSinDespachar} documento${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} firmado${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} pendiente${docMetrics.firmadosSinDespachar !== 1 ? 's' : ''} de despacho`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Subdirector: docs pendientes de visto bueno
      if (user?.rol === 'subdirector' && docMetrics.pendientesVB > 0) {
        items.push({
          icon: CheckCircle2,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          text: `${docMetrics.pendientesVB} documento${docMetrics.pendientesVB !== 1 ? 's' : ''} pendiente${docMetrics.pendientesVB !== 1 ? 's' : ''} de visto bueno`,
          action: () => navigate('/gestion-documental'),
        })
      }

      // Memorándums pendientes de atención
      if (docMetrics.memosPendientes > 0) {
        items.push({
          icon: FileText,
          color: 'text-indigo-600',
          bg: 'bg-indigo-50',
          border: 'border-indigo-200',
          text: `${docMetrics.memosPendientes} memorándum${docMetrics.memosPendientes !== 1 ? 's' : ''} pendiente${docMetrics.memosPendientes !== 1 ? 's' : ''} de atención`,
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {userModules.map(mod => (
            <button
              key={mod.id}
              onClick={() => navigate(mod.path)}
              className="group flex flex-col p-5 bg-white rounded-xl border border-gray-200 text-left transition-all hover:shadow-md hover:border-gray-300 hover:-translate-y-0.5"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 mb-4"
                   style={{ backgroundColor: mod.color }}>
                <mod.icon size={24} className="text-white" />
              </div>
              <h3 className="text-base font-bold text-gray-900 group-hover:text-gray-700">
                {mod.label}
              </h3>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
                {mod.subtitle}
              </p>
              <p className="text-xs text-gray-500 mt-2 flex-1">
                {mod.description}
              </p>
              {/* Mini-métricas inline */}
              {mod.id === 'gestion_documental' && docMetrics && (
                <div className="flex items-center gap-3 mt-2">
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
              <div className="flex items-center gap-1 mt-4 text-xs font-semibold" style={{ color: mod.color }}>
                Acceder al módulo <ArrowRight size={13} />
              </div>
            </button>
          ))}

          {/* Módulos próximamente */}
          {inactiveModules.map(mod => (
            <div
              key={mod.id}
              className="relative flex flex-col p-5 bg-white rounded-xl border border-gray-200"
            >
              <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                <Clock size={9} /> Próximamente
              </span>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-gray-100 mb-4">
                <mod.icon size={24} className="text-gray-400" />
              </div>
              <h3 className="text-base font-bold text-gray-500">{mod.label}</h3>
              <p className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider mt-0.5">
                {mod.subtitle}
              </p>
              <p className="text-xs text-gray-400 mt-2 flex-1">{mod.description}</p>
              <p className="text-xs text-gray-400 mt-4 font-medium">Módulo en desarrollo</p>
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
                  label="Pendientes despacho"
                  value={docMetrics.firmadosSinDespachar}
                  icon={CheckCircle2}
                  color="#059669"
                  bgColor="#d1fae5"
                  highlight={docMetrics.firmadosSinDespachar > 0}
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
