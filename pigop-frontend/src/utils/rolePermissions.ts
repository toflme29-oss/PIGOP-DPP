/**
 * rolePermissions — Permisos por rol con overrides persistidos en backend.
 *
 * Fuente de verdad:
 *   - Defaults: PERMISSION_DEFAULTS (en este archivo)
 *   - Overrides: API /permisos/ (cliente-scoped, persistente)
 *
 * El acceso síncrono se mantiene vía cache en memoria, hidratada desde
 * el backend por usePermissionsBootstrap y refrescada por usePermissionsVersion.
 */

import { permisosApi } from '../api/permisos'

// Permisos predeterminados: actionId → rolKey → boolean
export const PERMISSION_DEFAULTS: Record<string, Partial<Record<string, boolean>>> = {
  crear_oficio:        { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  eliminar:            { superadmin: true, secretaria: true },
  subir_archivo:       { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  ver_pdf:             { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: true, analista: true },
  descargar_docx:      { superadmin: true, admin_cliente: true },
  generar_resp:        { superadmin: true, admin_cliente: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  cargar_ref_ia:       { superadmin: true, admin_cliente: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  editar_borrador:     { superadmin: true, admin_cliente: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  subir_tabla:         { superadmin: true, admin_cliente: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  turnar:              { superadmin: true, admin_cliente: true, secretaria: true, subdirector: true, jefe_depto: true },
  reasignar:           { superadmin: true, admin_cliente: true, secretaria: true, subdirector: true, jefe_depto: true },
  instrucciones_turno: { admin_cliente: true },
  cambiar_tipo:        { superadmin: true, admin_cliente: true, secretaria: true },
  enviar_firma:        { superadmin: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  devolver:            { superadmin: true, admin_cliente: true, subdirector: true },
  devolver_firma:      { superadmin: true, admin_cliente: true },
  visto_bueno:         { subdirector: true, admin_cliente: true, superadmin: true },
  subir_acuse:         { superadmin: true, secretaria: true },
  eliminar_acuse:      { superadmin: true, secretaria: true },
  registrar_cert:      { superadmin: true, admin_cliente: true },
  renovar_cert:        { superadmin: true, admin_cliente: true },
  revocar_cert:        { superadmin: true, admin_cliente: true },
  firmar:              { admin_cliente: true },
  firmar_lote:         { admin_cliente: true },
  validar_cert:        { superadmin: true, admin_cliente: true },
  // ── Permisos v2 ──────────────────────────────────────────────────────────────
  ver_visor_flotante:  { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, auditor: true, analista: true },
  cambiar_estado:      { superadmin: true, admin_cliente: true, secretaria: true, asesor: true, subdirector: true, jefe_depto: true, analista: true },
  registrar_memo:      { superadmin: true, admin_cliente: true, secretaria: true },
}

export type PermissionOverrides = Record<string, boolean>

// ── Cache en memoria ──────────────────────────────────────────────────────────

let _overridesCache: PermissionOverrides = {}
let _versionCache = 0
let _hydrated = false

/** Llamar una vez al inicio (bootstrap) o cuando la versión cambia. */
export function setPermissionOverrides(overrides: PermissionOverrides, version: number): void {
  _overridesCache = { ...overrides }
  _versionCache = version
  _hydrated = true
  window.dispatchEvent(new CustomEvent(PERMISOS_UPDATED_EVENT))
}

/** Acceso síncrono al cache (usado por los checkers de consumidores). */
export function loadPermissionOverrides(): PermissionOverrides {
  return _overridesCache
}

export function getCachedVersion(): number {
  return _versionCache
}

export function isPermissionsHydrated(): boolean {
  return _hydrated
}

/** Evento de actualización: listeners re-memoizan checkers. */
export const PERMISOS_UPDATED_EVENT = 'pigop:permisos-updated'

// ── Persistencia backend ──────────────────────────────────────────────────────

/**
 * Guarda overrides en el backend y actualiza el cache local al instante.
 * Solo admin_cliente/superadmin puede llamar (backend valida).
 */
export async function savePermissionOverrides(overrides: PermissionOverrides): Promise<void> {
  const res = await permisosApi.update(overrides)
  setPermissionOverrides(res.overrides, res.version)
}

// ── Checker ───────────────────────────────────────────────────────────────────

export function getPermission(
  actionId: string,
  rol: string,
  overrides?: PermissionOverrides,
): boolean {
  const resolved = overrides ?? _overridesCache
  const key = `${actionId}.${rol}`
  if (key in resolved) return resolved[key]
  return PERMISSION_DEFAULTS[actionId]?.[rol] ?? false
}

/** Carga overrides una sola vez y devuelve una función checker para un rol fijo. */
export function makePermissionChecker(rol: string): (actionId: string) => boolean {
  const overrides = _overridesCache
  return (actionId: string) => getPermission(actionId, rol, overrides)
}
