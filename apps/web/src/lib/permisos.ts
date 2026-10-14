import { supabaseClient } from './supabase'

export type NivelSeccion = 'edicion' | 'lectura' | 'ninguno'
export type AccionPermiso = 'eliminar' | 'exportar' | 'ver_costos'

export type PermisoSeccion = {
  seccion: string
  nivel: NivelSeccion
  eliminar: boolean
  exportar: boolean
  ver_costos: boolean
}

// Recurso de Refine → sección de la matriz de permisos (F-ROL-01, FR-005).
// Solo los recursos ya existentes que corresponden a una sección del
// prototipo; cada épica de dominio agrega los suyos al crear su pantalla.
// Los recursos de plataforma (ejecuciones, conexiones, ...) no están en la
// matriz y conservan su control actual.
export const SECCION_POR_RECURSO: Readonly<Record<string, string>> = {
  clientes: 'clientes',
  usuarios: 'usuarios_permisos',
  roles: 'usuarios_permisos',
}

// Etiqueta visible de cada rol básico (roles_organizacion, migración
// 20261013130000). Fuente única para la UI: un rol nuevo se agrega acá y el
// test de permisos.test.ts falla si falta alguno de los sembrados.
export const ETIQUETA_ROL: Readonly<Record<string, string>> = {
  administrador: 'Administrador',
  miembro: 'Miembro',
  operador: 'Operador',
  consulta: 'Consulta',
  mostrador: 'Mostrador',
  deposito: 'Depósito',
  administracion: 'Administración',
}

// Recursos cuya RLS de escritura sigue en private.puede_escribir() (solo
// administrador) porque la tabla aún no migró al contrato de permisos. La
// matriz no puede prometer en la UI más de lo que la base acepta: hasta que
// migren, crear/editar/eliminar además exigen administrador.
export const RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR: readonly string[] = ['clientes']

// Espejo, solo para gatear la UI, de private.nivel_seccion/puede_accion: la
// autorización real la hace RLS en la base de datos (FR-003 de la spec).
export async function obtenerPermisosActuales(): Promise<PermisoSeccion[]> {
  const { data, error } = await supabaseClient.rpc('permisos_actuales')
  if (error) {
    throw new Error(error.message)
  }
  return (data ?? []) as PermisoSeccion[]
}

// Una sección sin fila es «ninguno»: nunca acceso total por omisión.
export function nivelDe(permisos: readonly PermisoSeccion[], seccion: string): NivelSeccion {
  return permisos.find((permiso) => permiso.seccion === seccion)?.nivel ?? 'ninguno'
}

export function puedeAccionEn(permisos: readonly PermisoSeccion[], seccion: string, accion: AccionPermiso): boolean {
  return Boolean(permisos.find((permiso) => permiso.seccion === seccion)?.[accion])
}

// list/show piden al menos lectura; cualquier otra acción de Refine
// (create, edit, delete, personalizadas) pide edición.
export function nivelPermiteAccionRefine(nivel: NivelSeccion, action: string | undefined): boolean {
  if (nivel === 'ninguno') {
    return false
  }
  return action === 'list' || action === 'show' ? true : nivel === 'edicion'
}

// `can` de Refine se evalúa por ítem de menú, recurso y acción: se comparte
// una única consulta por usuario (promesa en vuelo + TTL corto) en vez de una
// RPC por evaluación. Los fallos no se cachean.
const TTL_PERMISOS_MS = 5000
let cachePermisos: { userId: string; expira: number; promesa: Promise<PermisoSeccion[]> } | null = null

export function obtenerPermisosActualesCacheado(userId: string): Promise<PermisoSeccion[]> {
  const ahora = Date.now()
  if (cachePermisos && cachePermisos.userId === userId && cachePermisos.expira > ahora) {
    return cachePermisos.promesa
  }
  const promesa = obtenerPermisosActuales()
  const entrada = { userId, expira: ahora + TTL_PERMISOS_MS, promesa }
  cachePermisos = entrada
  promesa.catch(() => {
    if (cachePermisos === entrada) {
      cachePermisos = null
    }
  })
  return promesa
}

export function invalidarCachePermisos(): void {
  cachePermisos = null
}

// --- Edición de la matriz por rol (F-ROL-02, FR-013…FR-015) ---------------

export const ROLES_MATRIZ = ['administrador', 'operador', 'consulta', 'mostrador', 'deposito', 'administracion'] as const
export type RolMatriz = (typeof ROLES_MATRIZ)[number]

export const ETIQUETAS_ROL: Readonly<Record<RolMatriz, string>> = {
  administrador: 'Administrador',
  operador: 'Operador',
  consulta: 'Consulta',
  mostrador: 'Mostrador',
  deposito: 'Depósito',
  administracion: 'Administración',
}

// Orden de Roles.dc.html. La clave es la de private.matriz_inicial().
export const SECCIONES_MATRIZ: ReadonlyArray<{ clave: string; etiqueta: string }> = [
  { clave: 'inicio', etiqueta: 'Inicio' },
  { clave: 'productos', etiqueta: 'Productos' },
  { clave: 'categorias', etiqueta: 'Categorías' },
  { clave: 'stock', etiqueta: 'Stock' },
  { clave: 'cotizacion_dolar', etiqueta: 'Cotización del dólar' },
  { clave: 'empresas', etiqueta: 'Empresas' },
  { clave: 'mercado_libre', etiqueta: 'Mercado Libre' },
  { clave: 'rentabilidad', etiqueta: 'Rentabilidad' },
  { clave: 'usuarios_permisos', etiqueta: 'Usuarios y permisos' },
  { clave: 'actividad', etiqueta: 'Actividad' },
  { clave: 'consultas', etiqueta: 'Consultas' },
  { clave: 'ventas', etiqueta: 'Ventas' },
  { clave: 'clientes', etiqueta: 'Clientes' },
  { clave: 'proveedores', etiqueta: 'Proveedores' },
  { clave: 'reportes', etiqueta: 'Reportes' },
  { clave: 'service_tecnico', etiqueta: 'Service técnico' },
]

export const ACCIONES_MATRIZ: ReadonlyArray<{ clave: AccionPermiso; etiqueta: string }> = [
  { clave: 'eliminar', etiqueta: 'Eliminar' },
  { clave: 'exportar', etiqueta: 'Exportar' },
  { clave: 'ver_costos', etiqueta: 'Ver costos' },
]

export const ETIQUETAS_NIVEL: Readonly<Record<NivelSeccion, string>> = {
  edicion: 'Edición',
  lectura: 'Solo lectura',
  ninguno: 'Sin acceso',
}

// Rotación de la celda: Edición → Solo lectura → Sin acceso → Edición.
export function siguienteNivel(nivel: NivelSeccion): NivelSeccion {
  return nivel === 'edicion' ? 'lectura' : nivel === 'lectura' ? 'ninguno' : 'edicion'
}

export type CambioNivel = { rol_id: string; seccion: string; nivel: NivelSeccion }
export type CambioAccion = { rol_id: string; seccion: string; accion: AccionPermiso; permitido: boolean }

// Solo el Administrador de la organización puede llamarlas: la verificación
// real está en las RPC (la UI únicamente las oculta). Invalidan la caché para
// que el menú y las rutas lean la matriz nueva.
export async function guardarMatrizPermisos(niveles: CambioNivel[], acciones: CambioAccion[]): Promise<void> {
  const { error } = await supabaseClient.rpc('guardar_matriz_permisos', { p_niveles: niveles, p_acciones: acciones })
  invalidarCachePermisos()
  if (error) {
    throw new Error(error.message)
  }
}

export async function restablecerMatrizPermisos(): Promise<void> {
  const { error } = await supabaseClient.rpc('restablecer_matriz_permisos')
  invalidarCachePermisos()
  if (error) {
    throw new Error(error.message)
  }
}
