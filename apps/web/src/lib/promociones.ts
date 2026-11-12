import type { SupabaseClient } from '@supabase/supabase-js'
import { parsearImporte } from './productos'

// Promociones de precio por empresa (F-PRE-11, MSF-439). La autoridad es la base
// (migraciones 20270221100001…202004): el estado se deriva de `desde`/`hasta` al consultar
// (vista `public.promociones_precio_estado`), el solape lo impide un disparador y las RPC
// `guardar_promocion_precio` / `anular_promocion_precio` validan permisos. Acá solo se lee,
// se valida lo mínimo para avisar antes de enviar y se traducen los errores.

export type EstadoPromocion = 'programada' | 'vigente' | 'vencida' | 'anulada'

export const ETIQUETA_ESTADO: Record<EstadoPromocion, string> = {
  programada: 'Programada',
  vigente: 'Vigente',
  vencida: 'Vencida',
  anulada: 'Anulada',
}

export const AVISO_ELEGIR_EMPRESA = 'Elegí una empresa en la barra superior'
export const NOTA_PRECIO_SIN_IVA = 'El precio promocional es fijo en pesos y se carga sin IVA.'

export type Promocion = {
  id: string
  empresaId: string
  empresaNombre: string
  productoId: string
  productoNombre: string
  productoSku: string | null
  // Pesos sin IVA, tal como se cargó.
  precioPromocional: number
  // Instantes ISO (timestamptz).
  desde: string
  hasta: string
  estado: EstadoPromocion
  // Como lo ve el cliente (con la regla de la empresa y su interruptor de IVA); null si no es calculable.
  precioNormal: number | null
  precioVigente: number | null
  // Texto exacto que devolvió la base: es el control de concurrencia, no se reconstruye desde un Date
  // (JavaScript pierde los microsegundos).
  actualizadoEn: string
}

type FilaEstado = {
  id: string
  empresa_id: string
  empresa_nombre: string
  producto_id: string
  producto_nombre: string
  producto_sku: string | null
  precio_promocional: number | string
  desde: string
  hasta: string
  estado: EstadoPromocion
  precio_normal: number | string | null
  precio_vigente: number | string | null
  updated_at: string
}

const COLUMNAS =
  'id, empresa_id, empresa_nombre, producto_id, producto_nombre, producto_sku, precio_promocional, desde, hasta, estado, precio_normal, precio_vigente, updated_at'

const aNumero = (valor: number | string | null) => (valor === null ? null : Number(valor))

export function mapearPromocion(fila: FilaEstado): Promocion {
  return {
    id: fila.id,
    empresaId: fila.empresa_id,
    empresaNombre: fila.empresa_nombre,
    productoId: fila.producto_id,
    productoNombre: fila.producto_nombre,
    productoSku: fila.producto_sku,
    precioPromocional: Number(fila.precio_promocional),
    desde: fila.desde,
    hasta: fila.hasta,
    estado: fila.estado,
    precioNormal: aNumero(fila.precio_normal),
    precioVigente: aNumero(fila.precio_vigente),
    actualizadoEn: fila.updated_at,
  }
}

// Orden de la lista: lo que rige o va a regir primero, lo cerrado al final; dentro del grupo, por fecha.
const PESO_ESTADO: Record<EstadoPromocion, number> = { vigente: 0, programada: 1, vencida: 2, anulada: 3 }

export function ordenarPromociones(promociones: Promocion[]): Promocion[] {
  return [...promociones].sort(
    (a, b) =>
      PESO_ESTADO[a.estado] - PESO_ESTADO[b.estado] ||
      new Date(a.desde).getTime() - new Date(b.desde).getTime() ||
      a.productoNombre.localeCompare(b.productoNombre, 'es') ||
      a.id.localeCompare(b.id),
  )
}

// PostgREST recorta cada respuesta a `max_rows` (1000 en supabase/config.toml) sin avisar: un `.limit()` mayor
// no sirve. Se pide por tandas con `.range()` (menores a ese tope) hasta que una vuelve corta.
export const TAMANO_TANDA_PROMOCIONES = 500

// `empresaId` null = «Todas mis empresas» (todas las que la persona ve, RLS mediante).
export async function leerPromociones(cliente: SupabaseClient, empresaId: string | null): Promise<Promocion[]> {
  const filas: FilaEstado[] = []
  for (let desde = 0; ; desde += TAMANO_TANDA_PROMOCIONES) {
    let consulta = cliente.from('promociones_precio_estado').select(COLUMNAS)
    if (empresaId) consulta = consulta.eq('empresa_id', empresaId)
    const { data, error } = await consulta
      .order('desde', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, desde + TAMANO_TANDA_PROMOCIONES - 1)
      .returns<FilaEstado[]>()
    if (error) throw error
    const tanda = data ?? []
    filas.push(...tanda)
    if (tanda.length < TAMANO_TANDA_PROMOCIONES) break
  }
  return ordenarPromociones(filas.map(mapearPromocion))
}

export type ProductoPromocionable = { id: string; nombre: string; sku: string | null }

export type DatosPromocion = {
  // null = alta.
  id: string | null
  empresaId: string
  productoId: string
  precioTexto: string
  // Valores de <input type="datetime-local"> («2026-11-10T09:00»), en hora local.
  desdeTexto: string
  hastaTexto: string
  // updated_at tal como lo devolvió la base (edición).
  actualizadoEn: string | null
}

// «2026-11-10T09:00» (hora local del navegador) → instante. Texto vacío o inválido → null.
export function parsearFechaHora(texto: string): Date | null {
  if (!texto) return null
  const fecha = new Date(texto)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

// Instante ISO → valor de <input type="datetime-local"> en hora local.
export function aFechaHoraLocal(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
}

export type ErroresPromocion = Partial<Record<'producto' | 'precio' | 'desde' | 'hasta', string>>

export function validarPromocion(
  datos: Pick<DatosPromocion, 'productoId' | 'precioTexto' | 'desdeTexto' | 'hastaTexto'>,
  ahora: Date = new Date(),
): ErroresPromocion {
  const errores: ErroresPromocion = {}
  if (!datos.productoId) errores.producto = 'Elegí un producto'
  const precio = parsearImporte(datos.precioTexto)
  if (precio === null || precio <= 0) errores.precio = 'Ingresá un precio mayor a 0'
  else if (precio >= 1e12) errores.precio = 'El precio es demasiado grande'
  const desde = parsearFechaHora(datos.desdeTexto)
  const hasta = parsearFechaHora(datos.hastaTexto)
  if (!desde) errores.desde = 'Indicá desde cuándo rige'
  if (!hasta) errores.hasta = 'Indicá hasta cuándo rige'
  else if (hasta.getTime() <= ahora.getTime()) errores.hasta = 'La fecha de fin tiene que ser futura'
  if (desde && hasta && hasta.getTime() <= desde.getTime()) errores.hasta = 'La fecha de fin tiene que ser posterior a la de inicio'
  return errores
}

// Devuelve la promoción guardada. Lanza el error de la base (usar `mensajeErrorPromocion`).
export async function guardarPromocion(cliente: SupabaseClient, datos: DatosPromocion): Promise<void> {
  const precio = parsearImporte(datos.precioTexto)
  const desde = parsearFechaHora(datos.desdeTexto)
  const hasta = parsearFechaHora(datos.hastaTexto)
  if (precio === null || !desde || !hasta) throw new Error('Los datos de la promoción no son válidos')
  const { error } = await cliente.rpc('guardar_promocion_precio', {
    p_id: datos.id,
    p_empresa: datos.empresaId,
    p_producto: datos.productoId,
    p_precio: precio,
    p_desde: desde.toISOString(),
    p_hasta: hasta.toISOString(),
    p_actualizado: datos.actualizadoEn,
  })
  if (error) throw error
}

export async function anularPromocion(cliente: SupabaseClient, promocion: Pick<Promocion, 'id' | 'actualizadoEn'>): Promise<void> {
  const { error } = await cliente.rpc('anular_promocion_precio', {
    p_id: promocion.id,
    p_actualizado: promocion.actualizadoEn,
  })
  if (error) throw error
}

// Traduce el código de la base (contrato en specs/…/contracts) a un texto para la persona.
export function mensajeErrorPromocion(error: unknown, porDefecto: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  switch (e.code) {
    case '42501':
      return 'Tu rol no puede editar promociones.'
    case '23P01':
      return 'Ya hay otra promoción de este producto en esta empresa que se solapa con esas fechas. Cambiá las fechas o anulá la otra.'
    case '40001':
      return 'Otra persona modificó esta promoción. Recargá la lista y probá de nuevo.'
    case 'P0002':
      return 'La empresa, el producto o la promoción ya no existe.'
    case '22003':
      return 'El precio es demasiado grande.'
    case '22023':
      return e.message && e.message.length < 200 ? e.message : porDefecto
    default:
      return porDefecto
  }
}

const formatoPesos = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const formatearPesosPromocion = (valor: number | null) => (valor === null ? '—' : `$ ${formatoPesos.format(valor)}`)

const formatoFechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})
export function formatearFechaHoraPromocion(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? '' : formatoFechaHora.format(fecha)
}
