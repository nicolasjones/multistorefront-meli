// Opiniones de productos, moderación en el panel (MSF-467, fase 2). El esquema, las reglas y las RPC viven en las
// migraciones 20270341000000_opiniones_producto.sql y 20270341000200_opiniones_moderacion_rpc.sql; acá solo se espeja lo
// necesario para la pantalla (la autoridad es la base: solo el Administrador lista y modera).
import { supabaseClient } from './supabase'

export type EstadoOpinion = 'pendiente' | 'aceptada' | 'rechazada'
export type FiltroEstadoOpinion = EstadoOpinion | 'todas'

export const MAX_MOTIVO_RECHAZO = 200
export const TAMANO_TANDA_OPINIONES = 20

// El servidor rechaza saltos de línea y mide el motivo ya recortado en caracteres de Postgres (puntos de código, no UTF-16).
// El cliente lo deja listo antes de enviar: cualquier racha de espacios o saltos pasa a un solo espacio y se recorta.
export function normalizarMotivo(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

export function largoMotivo(texto: string): number {
  return [...normalizarMotivo(texto)].length
}

export type OpinionPanel = {
  id: string
  empresa_id: string
  empresa_nombre: string
  cliente_id: string
  cliente_nombre: string
  producto_id: string
  producto_nombre: string
  puntuacion: number
  comentario: string
  estado: EstadoOpinion
  motivo_rechazo: string | null
  creada_en: string
  // Bloqueo optimista: se devuelve tal cual a `moderar_opinion`.
  actualizada_en: string
}

export type ContadoresOpiniones = { pendientes: number; aceptadas: number; rechazadas: number }
export type CursorOpiniones = { creada: string; id: string }

export type TandaOpiniones = {
  contadores: ContadoresOpiniones
  filas: OpinionPanel[]
  siguiente: CursorOpiniones | null
}

export const CONTADORES_VACIOS: ContadoresOpiniones = { pendientes: 0, aceptadas: 0, rechazadas: 0 }

type ErrorBase = { code?: string }

export async function listarOpiniones(params: {
  estado: FiltroEstadoOpinion
  empresaId: string | null
  desde?: CursorOpiniones | null
  limite?: number
}): Promise<TandaOpiniones> {
  const { data, error } = await supabaseClient.rpc('listar_opiniones', {
    p_estado: params.estado,
    p_empresa_id: params.empresaId,
    p_desde_creada: params.desde?.creada ?? null,
    p_desde_id: params.desde?.id ?? null,
    p_limite: params.limite ?? TAMANO_TANDA_OPINIONES,
  })
  if (error) throw error
  const d = (data ?? {}) as Partial<TandaOpiniones>
  return {
    contadores: { ...CONTADORES_VACIOS, ...(d.contadores ?? {}) },
    filas: Array.isArray(d.filas) ? d.filas : [],
    siguiente: d.siguiente ?? null,
  }
}

export type ResultadoModeracion = { estado: 'ok' | 'no_encontrada' }

export async function moderarOpinion(params: {
  id: string
  decision: 'aceptar' | 'rechazar'
  motivo?: string | null
  actualizadaEn: string
}): Promise<ResultadoModeracion> {
  const { data, error } = await supabaseClient.rpc('moderar_opinion', {
    p_id: params.id,
    p_decision: params.decision,
    p_motivo: params.motivo ?? null,
    p_actualizada_en_esperada: params.actualizadaEn,
  })
  if (error) throw error
  return { estado: (data as { estado?: string } | null)?.estado === 'no_encontrada' ? 'no_encontrada' : 'ok' }
}

// Bandera `tienda_opiniones` (`public.banderas_plataforma`, lectura para usuarios autenticados). Falla cerrada: si no se
// puede leer, se trata como apagada y la pantalla solo permite rechazar.
export async function leerBanderaOpiniones(): Promise<boolean> {
  try {
    const { data, error } = await supabaseClient
      .from('banderas_plataforma')
      .select('activa')
      .eq('clave', 'tienda_opiniones')
      .maybeSingle()
    if (error) return false
    return (data as { activa?: boolean } | null)?.activa === true
  } catch {
    return false
  }
}

export const MENSAJE_CONFLICTO_OPINION = 'La opinión cambió mientras la mirabas. Recargamos la lista: revisala y volvé a decidir.'
export const MENSAJE_SIN_PERMISO_OPINIONES = 'Solo un Administrador puede moderar opiniones. Puede que tu rol haya cambiado: recargá la página.'

export function esConflictoOpinion(error: unknown): boolean {
  return (error as ErrorBase)?.code === '40001'
}

export function esSinPermisoOpiniones(error: unknown): boolean {
  return (error as ErrorBase)?.code === '42501'
}

export function mensajeDeErrorOpiniones(error: unknown, porDefecto: string): string {
  const code = (error as ErrorBase)?.code
  console.error(porDefecto, code ?? 'sin código')
  if (code === '40001') return MENSAJE_CONFLICTO_OPINION
  if (code === '42501') return MENSAJE_SIN_PERMISO_OPINIONES
  if (code === '55000') return 'Las opiniones están desactivadas en este entorno: por ahora solo se pueden rechazar.'
  if (code === '22023') {
    const mensaje = (error as { message?: string })?.message ?? ''
    return /no permitidos/i.test(mensaje)
      ? 'El motivo tiene caracteres no permitidos: sin enlaces, saltos de línea ni marcas ocultas.'
      : `El motivo no es válido: admite hasta ${MAX_MOTIVO_RECHAZO} caracteres.`
  }
  return porDefecto
}

export function textoPuntuacion(puntuacion: number): string {
  return `${puntuacion} sobre 5`
}

export const ETIQUETA_ESTADO_OPINION: Readonly<Record<EstadoOpinion, string>> = {
  pendiente: 'Pendiente',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
}
