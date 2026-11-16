// Bandeja de consultas (F-CON-01, MSF-186, épica MSF-122). El esquema, la vista y las RPC viven en
// las migraciones 20261205100000…100300; acá se espejan los valores y se traducen sus errores.
// La autoridad es la base: RLS decide qué consultas ve cada persona y `actualizar_consulta` valida.
import { supabaseClient } from './supabase'

export const ESTADOS_CONSULTA = ['nueva', 'en_curso', 'resuelta'] as const
export type EstadoConsulta = (typeof ESTADOS_CONSULTA)[number]

export const ETIQUETA_ESTADO_CONSULTA: Readonly<Record<EstadoConsulta, string>> = {
  nueva: 'Nueva',
  en_curso: 'En curso',
  resuelta: 'Resuelta',
}

// Color del chip de estado (Nueva = azul, En curso = ámbar, Resuelta = verde, como el prototipo).
export const COLOR_ESTADO_CONSULTA: Readonly<Record<EstadoConsulta, 'primary' | 'warning' | 'success'>> = {
  nueva: 'primary',
  en_curso: 'warning',
  resuelta: 'success',
}

export type OrigenConsulta = 'formulario' | 'whatsapp' | 'pedido'

export const ETIQUETA_ORIGEN_CONSULTA: Readonly<Record<OrigenConsulta, string>> = {
  formulario: 'Formulario',
  whatsapp: 'WhatsApp',
  pedido: 'Pedido',
}

export const NOTA_MAXIMA = 2000
export const TAMANO_PAGINA_CONSULTAS = 25
const SIN_PRODUCTO = 'Sin producto'

// Fila de `public.consultas_bandeja`.
export type Consulta = {
  id: string
  empresa_id: string
  empresa_nombre: string
  origen: OrigenConsulta
  nombre: string
  contacto: string
  mensaje: string | null
  producto_id: string | null
  producto_nombre: string | null
  estado: EstadoConsulta
  responsable_id: string | null
  responsable_nombre: string | null
  nota_interna: string | null
  created_at: string
  updated_at: string
  /** Contacto de la libreta vinculado (F-CON-05); null si no tiene. */
  contacto_id?: string | null
  /** MSF-176 (B1): cliente de la cuenta web que envió el pedido (la fija el servidor); null en consultas de visitantes. */
  cliente_id?: string | null
  /** Cantidad de ítems de un pedido (0 si la consulta no es un pedido). */
  items_cantidad?: number
  cliente_numero?: number | null
  cliente_nombre?: string | null
}

export const COLUMNAS_CONSULTA =
  'id, empresa_id, empresa_nombre, origen, nombre, contacto, mensaje, producto_id, producto_nombre, estado, responsable_id, responsable_nombre, nota_interna, created_at, updated_at, contacto_id, cliente_id, items_cantidad, cliente_numero, cliente_nombre'

export type Responsable = { user_id: string; nombre: string }

export type FiltrosConsultas = {
  /** Empresa por la que se filtra (la activa de la barra superior o el chip); null = todas las accesibles. */
  empresaId: string | null
  estado: EstadoConsulta | null
  texto: string
  /** Fechas `YYYY-MM-DD` (día local) o vacío. */
  desde: string
  hasta: string
  pagina: number
  tamano: number
}

export function nombreProducto(consulta: Pick<Consulta, 'producto_nombre'>): string {
  return consulta.producto_nombre ?? SIN_PRODUCTO
}

// Columna «Producto» de la bandeja (MSF-176, B1, P-6): un pedido no tiene UN producto, tiene varios: «Pedido de n productos» («1 producto»).
export function textoProductoConsulta(consulta: Pick<Consulta, 'origen' | 'producto_nombre' | 'items_cantidad'>): string {
  if (consulta.origen !== 'pedido') return nombreProducto(consulta)
  const n = consulta.items_cantidad ?? 0
  return `Pedido de ${n} ${n === 1 ? 'producto' : 'productos'}`
}

// Una línea de un pedido (`public.consulta_items_bandeja`, MSF-176 B1). Todo es texto de la tienda: se muestra como texto, nunca como HTML.
export type ItemConsulta = {
  orden: number
  producto_id: string | null
  descripcion: string
  sku: string | null
  cantidad: number
  /** Precio unitario de REFERENCIA calculado por el servidor al enviar (no firme); null si el producto no tenía precio. */
  precio_referencia: number | null
}

const COLUMNAS_ITEM = 'orden, producto_id, descripcion, sku, cantidad, precio_referencia'

// Ítems del pedido de una consulta, en el orden de la lista. La RLS de las líneas es la de la consulta: sin acceso, la lista viene vacía.
export async function listarItemsConsulta(consultaId: string): Promise<ItemConsulta[]> {
  const { data, error } = await supabaseClient
    .from('consulta_items_bandeja')
    .select(COLUMNAS_ITEM)
    .eq('consulta_id', consultaId)
    .order('orden', { ascending: true })
  if (error) throw aError(error)
  return ((data ?? []) as Array<Record<string, unknown>>).map((fila) => ({
    orden: Number(fila.orden),
    producto_id: typeof fila.producto_id === 'string' ? fila.producto_id : null,
    descripcion: String(fila.descripcion ?? ''),
    sku: typeof fila.sku === 'string' && fila.sku !== '' ? fila.sku : null,
    cantidad: Number(fila.cantidad),
    precio_referencia: fila.precio_referencia === null || fila.precio_referencia === undefined ? null : Number(fila.precio_referencia),
  }))
}

// Total de referencia del pedido: suma de precio de referencia × cantidad de las líneas que lo tienen (null si ninguna).
export function totalReferenciaPedido(items: readonly ItemConsulta[]): number | null {
  const conPrecio = items.filter((item) => item.precio_referencia !== null && Number.isFinite(item.precio_referencia))
  if (conPrecio.length === 0) return null
  return Math.round(conPrecio.reduce((suma, item) => suma + (item.precio_referencia ?? 0) * item.cantidad, 0) * 100) / 100
}

// El texto viaja dentro de un filtro `or=(…)` de PostgREST: las comas, paréntesis y comillas
// romperían su sintaxis y `%`, `*` y `_` actuarían como comodines. Se tratan como separadores
// (la búsqueda es aproximada) y se compacta el espacio. Devuelve '' si no queda nada que buscar.
export function textoParaBusqueda(texto: string): string {
  return texto.replace(/[,()"\\%*_]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Límites del rango de fechas como instantes ISO: desde las 00:00 locales del primer día hasta
// las 00:00 del día siguiente al último (exclusivo). Una fecha mal formada se ignora.
export function limitesDeFecha(desde: string, hasta: string): { desde: string | null; hastaExclusivo: string | null } {
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(desde) ? new Date(`${desde}T00:00:00`) : null
  let fin: Date | null = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    fin = new Date(`${hasta}T00:00:00`)
    fin.setDate(fin.getDate() + 1)
  }
  return {
    desde: inicio && !Number.isNaN(inicio.getTime()) ? inicio.toISOString() : null,
    hastaExclusivo: fin && !Number.isNaN(fin.getTime()) ? fin.toISOString() : null,
  }
}

export class ErrorConsulta extends Error {
  readonly codigo: string | null
  constructor(mensaje: string, codigo: string | null) {
    super(mensaje)
    this.name = 'ErrorConsulta'
    this.codigo = codigo
  }
}

type ErrorPostgrest = { message?: string; code?: string }

function aError(error: ErrorPostgrest): ErrorConsulta {
  return new ErrorConsulta(error.message ?? 'Error desconocido', error.code ?? null)
}

export function esConflicto(error: unknown): boolean {
  return error instanceof ErrorConsulta && error.codigo === '40001'
}

// Mensaje para la persona: nunca el texto crudo de la base (puede traer detalles técnicos).
export function mensajeDeError(error: unknown, porDefecto: string): string {
  if (error instanceof ErrorConsulta) {
    if (error.codigo === '40001') return 'Otra persona modificó esta consulta mientras la editabas. Recargala para ver sus cambios.'
    if (error.codigo === '42501') return 'No tenés permiso para editar esta consulta.'
    if (error.codigo === '22023') return 'Revisá los datos: el responsable o el estado elegido ya no son válidos.'
  }
  return porDefecto
}

export async function listarConsultas(filtros: FiltrosConsultas): Promise<{ filas: Consulta[]; total: number }> {
  let consulta = supabaseClient
    .from('consultas_bandeja')
    .select(COLUMNAS_CONSULTA, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  if (filtros.empresaId) consulta = consulta.eq('empresa_id', filtros.empresaId)
  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado)
  const texto = textoParaBusqueda(filtros.texto)
  if (texto) {
    const patron = `"%${texto}%"`
    consulta = consulta.or(`nombre.ilike.${patron},producto_nombre.ilike.${patron},mensaje.ilike.${patron}`)
  }
  const { desde, hastaExclusivo } = limitesDeFecha(filtros.desde, filtros.hasta)
  if (desde) consulta = consulta.gte('created_at', desde)
  if (hastaExclusivo) consulta = consulta.lt('created_at', hastaExclusivo)

  const primera = (filtros.pagina - 1) * filtros.tamano
  const { data, error, count } = await consulta.range(primera, primera + filtros.tamano - 1)
  if (error) throw aError(error)
  return { filas: (data ?? []) as Consulta[], total: count ?? 0 }
}

// Una consulta por id (enlace `?consulta=<id>` del correo). null si no existe o la RLS no la deja
// ver: la pantalla no distingue los dos casos para no revelar su existencia.
export async function leerConsulta(id: string): Promise<Consulta | null> {
  const { data, error } = await supabaseClient
    .from('consultas_bandeja')
    .select(COLUMNAS_CONSULTA)
    .eq('id', id)
    .maybeSingle()
  if (error) throw aError(error)
  return (data as Consulta | null) ?? null
}

export async function contarConsultasNuevas(empresaId: string | null): Promise<number> {
  const { data, error } = await supabaseClient.rpc('contar_consultas_nuevas', { p_empresa_id: empresaId })
  if (error) throw aError(error)
  return Number(data ?? 0)
}

export async function listarResponsables(empresaId: string): Promise<Responsable[]> {
  const { data, error } = await supabaseClient.rpc('responsables_consultas', { p_empresa_id: empresaId })
  if (error) throw aError(error)
  return (data ?? []) as Responsable[]
}

export type CambiosConsulta = {
  id: string
  estado: EstadoConsulta
  responsableId: string | null
  nota: string
  /** `updated_at` con el que se leyó la consulta (bloqueo optimista). */
  actualizadoEn: string
}

// Devuelve el nuevo `updated_at`. 40001 = alguien la modificó antes (ver `esConflicto`).
export async function actualizarConsulta(cambios: CambiosConsulta): Promise<string> {
  const { data, error } = await supabaseClient.rpc('actualizar_consulta', {
    p_id: cambios.id,
    p_estado: cambios.estado,
    p_responsable_id: cambios.responsableId,
    p_nota_interna: cambios.nota.trim() === '' ? null : cambios.nota,
    p_updated_at: cambios.actualizadoEn,
  })
  if (error) throw aError(error)
  notificarCambioConsultas()
  return data as string
}

// «Hoy 11:48», «Ayer 19:30», «26/09 16:40» (con el año si no es el actual), en hora local.
export function formatearCuando(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  const dos = (n: number) => String(n).padStart(2, '0')
  const hora = `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dias = Math.round((inicioDia(ahora) - inicioDia(fecha)) / 86_400_000)
  if (dias === 0) return `Hoy ${hora}`
  if (dias === 1) return `Ayer ${hora}`
  const dia = `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}`
  return fecha.getFullYear() === ahora.getFullYear() ? `${dia} ${hora}` : `${dia}/${fecha.getFullYear()} ${hora}`
}

// Señal de «cambió una consulta» para que el contador del menú y la bandeja se relean tras
// guardar. Store mínimo para `useSyncExternalStore`, como `empresaActivaRevision`.
let revision = 0
const suscriptores = new Set<() => void>()

export function notificarCambioConsultas(): void {
  revision += 1
  for (const suscriptor of suscriptores) suscriptor()
}

export function suscribirCambioConsultas(suscriptor: () => void): () => void {
  suscriptores.add(suscriptor)
  return () => {
    suscriptores.delete(suscriptor)
  }
}

export function revisionConsultas(): number {
  return revision
}
