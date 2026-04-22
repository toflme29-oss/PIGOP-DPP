/**
 * AdminPermisos — Matriz editable de Roles y Permisos del Sistema PIGOP
 * Grupos contraíbles · Celdas activables/desactivables · Persistencia en backend
 */
import { useState, useMemo, useEffect } from 'react'
import {
  ChevronRight, CheckCircle2, XCircle, AlertCircle,
  FileText, Eye, ArrowRightLeft, PenLine, Bell,
  LayoutGrid, Shield, Users, Building2, Save, RotateCcw,
} from 'lucide-react'
import {
  PERMISSION_DEFAULTS,
  loadPermissionOverrides,
  savePermissionOverrides,
  PERMISOS_UPDATED_EVENT,
  type PermissionOverrides,
} from '../utils/rolePermissions'

// ── Tipos ──────────────────────────────────────────────────────────────────────
type Cell = boolean | 'parcial'

type Fila = {
  id?: string        // si existe, conecta con rolePermissions.ts
  accion: string
  nota?: string
  roles: Partial<Record<string, Cell>>
}

type Grupo = {
  id: string
  titulo: string
  subtitulo: string
  icono: React.ReactNode
  color: string
  bg: string
  filas: Fila[]
}

// ── Columnas de roles ──────────────────────────────────────────────────────────
const ROLES_COLS = [
  { key: 'superadmin',    label: 'Superadmin',  short: 'SA',  color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'admin_cliente', label: 'Director',    short: 'DIR', color: '#911A3A', bg: '#FDF2F4' },
  { key: 'secretaria',    label: 'Secretaria',  short: 'SEC', color: '#b45309', bg: '#fffbeb' },
  { key: 'asesor',        label: 'Asesor',      short: 'ASE', color: '#0369a1', bg: '#eff6ff' },
  { key: 'subdirector',   label: 'Subdirector', short: 'SUB', color: '#047857', bg: '#f0fdf4' },
  { key: 'jefe_depto',    label: 'Jefe Depto',  short: 'JD',  color: '#6d28d9', bg: '#f5f3ff' },
  { key: 'auditor',       label: 'Auditor',     short: 'AUD', color: '#6b7280', bg: '#f9fafb' },
  { key: 'analista',      label: 'Analista',    short: 'ANL', color: '#475569', bg: '#f8fafc' },
]

// ── Datos de permisos ──────────────────────────────────────────────────────────
const GRUPOS: Grupo[] = [
  {
    id: 'modulos',
    titulo: 'Módulos del Sistema',
    subtitulo: 'Secciones del menú accesibles por cada rol',
    icono: <LayoutGrid size={14} />,
    color: '#1d4ed8', bg: '#eff6ff',
    filas: [
      { id: 'mod_gestion_documental', accion: 'Gestión Documental',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: true, analista: true } },
      { id: 'mod_validacion_depp', accion: 'Validación del Gasto Público (DEPP)',
        nota: 'Incluye Revisión Documental con IA (mismo módulo)',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
      { id: 'mod_certificaciones', accion: 'Certificaciones Presupuestarias', nota: 'En desarrollo — Q3 2026',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'mod_minutas', accion: 'Minutas de Conciliación', nota: 'En desarrollo — Q3 2026',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'mod_admin', accion: 'Panel de Administración',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
    ],
  },
  {
    id: 'visibilidad',
    titulo: 'Visibilidad de Documentos',
    subtitulo: 'Alcance de lectura en Gestión Documental',
    icono: <Eye size={14} />,
    color: '#0369a1', bg: '#eff6ff',
    filas: [
      { accion: 'Ver todos los documentos (sin filtro)',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: false, jefe_depto: false, auditor: true, analista: false } },
      { accion: 'Ver documentos de su área + subordinadas', nota: 'SCG → SCG, DREP, DCP  ·  SPF → SPF, DASP, DFNP',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: false, subdirector: true, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Ver documentos solo de su área',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: true } },
    ],
  },
  {
    id: 'documentos',
    titulo: 'Acciones sobre Documentos',
    subtitulo: 'Operaciones de creación, edición y eliminación',
    icono: <FileText size={14} />,
    color: '#047857', bg: '#f0fdf4',
    filas: [
      { id: 'crear_oficio', accion: 'Crear / registrar oficio',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'eliminar', accion: 'Eliminar documento',
        roles: { superadmin: true, admin_cliente: false, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'subir_archivo', accion: 'Subir archivos adjuntos al documento',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'ver_pdf', accion: 'Ver / descargar PDF del documento',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: true, analista: true } },
      { id: 'descargar_docx', accion: 'Descargar DOCX del oficio de respuesta',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'generar_resp', accion: 'Generar respuesta con IA (borrador)',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'cargar_ref_ia', accion: 'Cargar documento de referencia para IA',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'editar_borrador', accion: 'Editar borrador de respuesta',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'subir_tabla', accion: 'Subir tabla / cuadro para oficio',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'ver_visor_flotante', accion: 'Abrir visor flotante de documento (92 vw)',
        nota: 'Permite abrir el panel detalle / Turnar / Respuesta desde la tabla de recibidos',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: true, analista: true } },
      { id: 'registrar_memo', accion: 'Registrar nuevo memorándum',
        nota: 'Flujo especializado de registro con detección automática por IA',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
    ],
  },
  {
    id: 'flujo',
    titulo: 'Turno y Gestión de Flujo',
    subtitulo: 'Control del ciclo de vida y enrutamiento de documentos',
    icono: <ArrowRightLeft size={14} />,
    color: '#b45309', bg: '#fffbeb',
    filas: [
      { id: 'turnar', accion: 'Turnar documento a área',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: true, jefe_depto: true, auditor: false, analista: false } },
      { id: 'reasignar', accion: 'Reasignar / cambiar área de turno',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: true, jefe_depto: true, auditor: false, analista: false } },
      { id: 'instrucciones_turno', accion: 'Agregar instrucciones al turnar', nota: 'Solo el Director puede agregar instrucciones en el turno',
        roles: { superadmin: false, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'cambiar_tipo', accion: 'Cambiar tipo: Requiere Respuesta / Solo Conocimiento',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'enviar_firma', accion: 'Enviar documento para firma del Director',
        roles: { superadmin: true, admin_cliente: false, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
      { id: 'devolver', accion: 'Devolver documento para correcciones',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'devolver_firma', accion: 'Devolver desde modal de firma',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'visto_bueno', accion: 'Registrar Visto Bueno (V°B°)', nota: 'Acción exclusiva del Subdirector',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: false, subdirector: true, jefe_depto: false, auditor: false, analista: false } },
      { id: 'subir_acuse', accion: 'Subir acuse de recibido',
        roles: { superadmin: true, admin_cliente: false, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'eliminar_acuse', accion: 'Eliminar acuse de recibido',
        roles: { superadmin: true, admin_cliente: false, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'cambiar_estado', accion: 'Cambiar estado del trámite (En atención / Respondido)',
        nota: 'Controla los botones del widget "Estado del trámite" en los tabs Turnar y Respuesta',
        roles: { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: false, analista: true } },
    ],
  },
  {
    id: 'firma',
    titulo: 'Firma Electrónica (e.firma)',
    subtitulo: 'Gestión de certificados y firma digital de documentos',
    icono: <PenLine size={14} />,
    color: '#6d28d9', bg: '#f5f3ff',
    filas: [
      { id: 'registrar_cert', accion: 'Registrar certificado e.firma (.cer + .key)',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'renovar_cert', accion: 'Renovar certificado e.firma',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'revocar_cert', accion: 'Revocar certificado e.firma',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'firmar', accion: 'Firmar documento individualmente',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'firmar_lote', accion: 'Firmar documentos por lote',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { id: 'validar_cert', accion: 'Validar certificado digital',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
    ],
  },
  {
    id: 'alertas',
    titulo: 'Alertas y Bandejas (Dashboard)',
    subtitulo: 'Notificaciones y métricas visibles en la pantalla de inicio',
    icono: <Bell size={14} />,
    color: '#b45309', bg: '#fffbeb',
    filas: [
      { accion: 'Oficios turnados a Dirección para revisión',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Oficios para conocimiento de Dirección',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Documentos respondidos esperando firma',
        roles: { superadmin: false, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Emitidos en revisión pendientes de firma',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Instruidos / asignados por Director a Secretaría',
        roles: { superadmin: false, admin_cliente: false, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Firmados pendientes de despacho',
        roles: { superadmin: false, admin_cliente: false, secretaria: true, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Pendientes de Visto Bueno',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: false, subdirector: true, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Documentos en atención (área propia)',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: true, subdirector: false, jefe_depto: true, auditor: false, analista: true } },
    ],
  },
  {
    id: 'depp',
    titulo: 'Validación DEPP',
    subtitulo: 'Expedientes de gasto público y validación normativa con IA',
    icono: <Shield size={14} />,
    color: '#047857', bg: '#f0fdf4',
    filas: [
      { accion: 'Ver expedientes DEPP',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
      { accion: 'Crear / editar expediente DEPP', nota: 'Solo en estado borrador o en_trámite',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
      { accion: 'Subir / eliminar documentos del expediente', nota: 'Solo en estado borrador o en_trámite',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
      { accion: 'Validar DEPP con IA (Gemini)',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
      { accion: 'Consultar base normativa',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: true, auditor: false, analista: false } },
    ],
  },
  {
    id: 'admin',
    titulo: 'Panel de Administración',
    subtitulo: 'Gestión de usuarios, roles y dependencias del sistema',
    icono: <Users size={14} />,
    color: '#911A3A', bg: '#FDF2F4',
    filas: [
      { accion: 'Ver usuarios de su dependencia',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Ver usuarios de TODAS las dependencias',
        roles: { superadmin: true, admin_cliente: false, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Crear nuevo usuario',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Crear usuario con rol Superadmin', nota: 'Exclusivo Superadmin',
        roles: { superadmin: true, admin_cliente: false, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Cambiar rol de usuario',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Activar / desactivar usuario',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Asignar módulos de acceso al usuario',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Registrar nueva dependencia (UPP)', nota: 'Exclusivo Superadmin',
        roles: { superadmin: true, admin_cliente: false, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Ver listado de dependencias',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
    ],
  },
  {
    id: 'ia',
    titulo: 'Revisión Documental con IA',
    subtitulo: 'Análisis automático de documentos con Gemini',
    icono: <Building2 size={14} />,
    color: '#0891b2', bg: '#ecfeff',
    filas: [
      { accion: 'Subir archivos para análisis IA',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Ver reporte de análisis',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Usar asistente Gemini (chat)',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Crear lotes de revisión',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Asignar revisores a lotes',
        roles: { superadmin: true, admin_cliente: true, secretaria: false, asesor: false, subdirector: false, jefe_depto: false, auditor: false, analista: false } },
      { accion: 'Trabajar en revisión asignada', nota: 'Revisores con lotes asignados en su bandeja',
        roles: { superadmin: false, admin_cliente: false, secretaria: false, asesor: true, subdirector: false, jefe_depto: true, auditor: false, analista: true } },
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Devuelve el valor efectivo de una celda: pending > override > default */
function resolveCell(
  fila: Fila,
  grupoId: string,
  filaIdx: number,
  rolKey: string,
  overrides: PermissionOverrides,
  pending: PermissionOverrides,
): boolean {
  // Si la fila tiene id propio, usarlo como clave; si no, usar grupo+índice
  const baseKey = fila.id ? `${fila.id}.${rolKey}` : `${grupoId}.${filaIdx}.${rolKey}`

  if (baseKey in pending) return pending[baseKey]
  if (baseKey in overrides) return overrides[baseKey]

  // Fallback: valor por defecto del GRUPOS data (solo booleanos)
  const def = fila.roles[rolKey]
  return def === true
}

function pendingKey(fila: Fila, grupoId: string, filaIdx: number, rolKey: string): string {
  return fila.id ? `${fila.id}.${rolKey}` : `${grupoId}.${filaIdx}.${rolKey}`
}

// ── Celda interactiva ──────────────────────────────────────────────────────────
function CeldaPermiso({
  value,
  isPending,
  onClick,
}: {
  value: boolean
  isPending: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={value ? 'Clic para desactivar' : 'Clic para activar'}
      className={`
        w-7 h-7 rounded-full flex items-center justify-center mx-auto
        transition-all duration-150 cursor-pointer
        ${isPending ? 'ring-2 ring-offset-1 ring-amber-400' : ''}
        ${value
          ? 'bg-green-100 hover:bg-green-200'
          : 'bg-gray-100 hover:bg-gray-200'}
      `}
    >
      {value
        ? <CheckCircle2 size={14} className="text-green-600" />
        : <XCircle      size={14} className="text-gray-300 hover:text-gray-400" />
      }
    </button>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────
export function TablaPermisos() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [overrides, setOverrides] = useState<PermissionOverrides>(() => loadPermissionOverrides())
  const [pending,   setPending]   = useState<PermissionOverrides>({})
  const [saved,     setSaved]     = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Re-sincroniza desde cache cuando otro tab o el polling trae cambios nuevos
  useEffect(() => {
    const handler = () => setOverrides(loadPermissionOverrides())
    window.addEventListener(PERMISOS_UPDATED_EVENT, handler)
    return () => window.removeEventListener(PERMISOS_UPDATED_EVENT, handler)
  }, [])

  const hasChanges = Object.keys(pending).length > 0

  const toggle = (fila: Fila, grupoId: string, filaIdx: number, rolKey: string) => {
    const key     = pendingKey(fila, grupoId, filaIdx, rolKey)
    const current = resolveCell(fila, grupoId, filaIdx, rolKey, overrides, pending)
    setPending(prev => ({ ...prev, [key]: !current }))
    setSaved(false)
    setSaveError(null)
  }

  const guardar = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    const next = { ...overrides, ...pending }
    try {
      await savePermissionOverrides(next)
      setOverrides(next)
      setPending({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveError(detail || 'No se pudieron guardar los cambios. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const descartar = () => {
    setPending({})
    setSaved(false)
    setSaveError(null)
  }

  const restablecerTodo = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await savePermissionOverrides({})
      setOverrides({})
      setPending({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSaveError(detail || 'No se pudo restablecer. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const contarActivos = (grupo: Grupo) =>
    grupo.filas.reduce(
      (acc, f, fi) =>
        acc + ROLES_COLS.filter(r =>
          resolveCell(f, grupo.id, fi, r.key, overrides, pending)
        ).length,
      0
    )

  // Cuenta cambios pendientes en un grupo
  const pendingEnGrupo = (grupo: Grupo) =>
    grupo.filas.reduce(
      (acc, f, fi) =>
        acc + ROLES_COLS.filter(r => pendingKey(f, grupo.id, fi, r.key) in pending).length,
      0
    )

  // Resuelve si una celda tiene override guardado (distinto al default)
  const isOverridden = (fila: Fila, grupoId: string, filaIdx: number, rolKey: string) => {
    const key = pendingKey(fila, grupoId, filaIdx, rolKey)
    if (key in pending) return true
    if (key in overrides) return true
    return false
  }

  // Total de celdas con override activo
  const totalOverrides = useMemo(
    () => Object.keys(overrides).length + Object.keys(pending).length,
    [overrides, pending]
  )

  return (
    <div className="space-y-2.5">

      {/* Barra de acciones flotante (aparece cuando hay cambios) */}
      {hasChanges && (
        <div className="sticky top-[62px] z-30 flex items-center justify-between bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 shadow-md">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-600" />
            <span className="text-xs font-semibold text-amber-800">
              {Object.keys(pending).length} cambio{Object.keys(pending).length !== 1 ? 's' : ''} pendiente{Object.keys(pending).length !== 1 ? 's' : ''} sin guardar
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={descartar}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <RotateCcw size={11} />
              Descartar
            </button>
            <button
              onClick={guardar}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#911A3A' }}
            >
              <Save size={11} />
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      )}

      {/* Confirmación de guardado */}
      {saved && !hasChanges && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
          <CheckCircle2 size={14} className="text-green-600" />
          <span className="text-xs font-semibold text-green-700">
            Permisos guardados en el servidor. Los cambios aplican de inmediato para todos los usuarios.
          </span>
        </div>
      )}

      {/* Error de guardado */}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <AlertCircle size={14} className="text-red-600" />
          <span className="text-xs font-semibold text-red-700">{saveError}</span>
        </div>
      )}

      {/* Cabecera fija de roles */}
      <div className="sticky top-[62px] z-20 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-64 min-w-[256px]">
                  Acción / Funcionalidad
                </th>
                {ROLES_COLS.map(rol => (
                  <th key={rol.key} className="px-2 py-3 min-w-[82px]">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                           style={{ backgroundColor: rol.color }}>
                        {rol.short}
                      </div>
                      <span className="text-[9px] font-semibold text-gray-600 text-center leading-tight">
                        {rol.label}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-5 px-1 pb-0.5">
        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Leyenda:</span>
        {[
          { comp: <CheckCircle2 size={11} className="text-green-600" />, label: 'Permitido',     bg: 'bg-green-100' },
          { comp: <XCircle      size={11} className="text-gray-300"  />, label: 'No permitido', bg: 'bg-gray-100'  },
        ].map(({ comp, label, bg }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded-full ${bg} flex items-center justify-center`}>{comp}</div>
            <span className="text-[10px] text-gray-500">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-green-100 ring-2 ring-amber-400 ring-offset-1 flex items-center justify-center">
            <CheckCircle2 size={11} className="text-green-600" />
          </div>
          <span className="text-[10px] text-gray-500">Modificado (sin guardar)</span>
        </div>
        {totalOverrides > 0 && (
          <button
            onClick={restablecerTodo}
            className="ml-auto flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 underline"
          >
            <RotateCcw size={10} />
            Restablecer todo a valores predeterminados
          </button>
        )}
      </div>

      {/* Grupos */}
      {GRUPOS.map(grupo => {
        const isOpen   = !collapsed[grupo.id]
        const activos  = contarActivos(grupo)
        const total    = grupo.filas.length * ROLES_COLS.length
        const nPending = pendingEnGrupo(grupo)

        return (
          <div key={grupo.id} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">

            {/* Header del grupo */}
            <button
              onClick={() => setCollapsed(prev => ({ ...prev, [grupo.id]: !prev[grupo.id] }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50/70 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                     style={{ backgroundColor: grupo.bg, color: grupo.color }}>
                  {grupo.icono}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-900">{grupo.titulo}</p>
                    {nPending > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {nPending} cambio{nPending !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{grupo.subtitulo}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="hidden sm:flex items-center gap-1.5">
                  <div className="h-1.5 rounded-full bg-gray-100 w-20 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                         style={{ width: `${(activos / total) * 100}%`, backgroundColor: grupo.color }} />
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{activos}/{total}</span>
                </div>
                <ChevronRight size={15} className="text-gray-400 transition-transform duration-200 flex-shrink-0"
                              style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
              </div>
            </button>

            {/* Tabla del grupo */}
            {isOpen && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full">
                  <tbody className="divide-y divide-gray-50">
                    {grupo.filas.map((fila, fi) => (
                      <tr key={fi}
                          className={fi % 2 === 0 ? 'bg-white hover:bg-gray-50/40' : 'bg-gray-50/30 hover:bg-gray-50/70'}>
                        {/* Nombre de la acción */}
                        <td className="px-4 py-2.5 w-64 min-w-[256px]">
                          <p className="text-[11px] font-semibold text-gray-800 leading-snug">{fila.accion}</p>
                          {fila.nota && (
                            <p className="text-[9px] text-amber-600 mt-0.5 flex items-center gap-1">
                              <AlertCircle size={9} className="flex-shrink-0" />
                              {fila.nota}
                            </p>
                          )}
                        </td>

                        {/* Celdas por rol */}
                        {ROLES_COLS.map(rol => {
                          const val       = resolveCell(fila, grupo.id, fi, rol.key, overrides, pending)
                          const isPending = pendingKey(fila, grupo.id, fi, rol.key) in pending
                          const isOvr     = isOverridden(fila, grupo.id, fi, rol.key) && !isPending
                          return (
                            <td key={rol.key} className="px-2 py-2.5 min-w-[82px]">
                              <div className="relative">
                                <CeldaPermiso
                                  value={val}
                                  isPending={isPending}
                                  onClick={() => toggle(fila, grupo.id, fi, rol.key)}
                                />
                                {/* Punto indicador de override guardado */}
                                {isOvr && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 border border-white" title="Permiso modificado" />
                                )}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Footer del grupo */}
                <div className="px-4 py-2 border-t flex items-center justify-between"
                     style={{ backgroundColor: grupo.bg, borderColor: `${grupo.color}20` }}>
                  <span className="text-[10px] font-medium" style={{ color: grupo.color }}>
                    {grupo.filas.length} funcionalidad{grupo.filas.length !== 1 ? 'es' : ''}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {activos} de {total} permisos activos
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Nota informativa */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mt-2">
        <AlertCircle size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-[11px] text-blue-700 leading-relaxed space-y-1">
          <p>Los permisos marcados con <strong>punto azul</strong> han sido modificados respecto a los valores predeterminados.</p>
          <p><strong>¿Cómo verificar los cambios?</strong> Inicia sesión con una cuenta del rol modificado y abre cualquier documento en Gestión Documental haciendo clic en su fila — los botones de acción (Eliminar, Turnar, Firmar, etc.) respetarán los permisos guardados.</p>
          <p>Para asignar módulos por usuario individual, usa la pestaña <strong>Usuarios</strong>.</p>
        </div>
      </div>
    </div>
  )
}
