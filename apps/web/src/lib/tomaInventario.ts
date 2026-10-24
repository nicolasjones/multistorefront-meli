import { supabaseClient } from './supabase'
import { listarDepositosActivos, listarStockPorDepositoDe } from './depositos'
import { fechaDeHoy, mensajeDeErrorStock, parsearCantidad } from './stock'

// Toma de inventario (F-STK-11, MSF-415). La regla vive en la RPC `confirmar_toma_inventario`
// (migración 20261202130100_stock_confirmar_toma.sql); acá se espejan solo la validación y el
// rotulado (la autoridad es la base: RLS, nivel de la sección Stock y el depósito por defecto).

export const MAXIMO_PRODUCTOS_TOMA = 1000
export const MENSAJE_TOMA_CONFIRMADA = 'Toma de inventario confirmada'

export type FilaToma = {
  producto_id: string
  nombre: string
  sku: string | null
  // Stock del depósito por defecto: sobre él opera la toma (D4c de la spec).
  sistema: number
}

export type ItemToma = { producto: string; contado: number }

export type AjusteToma = { producto: string; diferencia: number; saldo: number; movimiento_id: string }

export type EstadoContado = { estado: 'vacio' } | { estado: 'invalido' } | { estado: 'ok'; valor: number }

// Campo vacío = no se toca el producto; entero de cero o más = contado; cualquier otra cosa es inválida.
export function leerContado(texto: string | undefined): EstadoContado {
  const limpio = (texto ?? '').trim()
  if (limpio === '') return { estado: 'vacio' }
  const valor = parsearCantidad(limpio)
  return valor === null ? { estado: 'invalido' } : { estado: 'ok', valor }
}

// Diferencia (contado − sistema) con la que se rotula la fila; null mientras no haya un contado válido.
export function diferenciaToma(sistema: number, texto: string | undefined): number | null {
  const contado = leerContado(texto)
  return contado.estado === 'ok' ? contado.valor - sistema : null
}

export function rotularDiferencia(diferencia: number): string {
  return diferencia > 0 ? `+${diferencia}` : String(diferencia)
}

export const ERROR_CONTADO = 'Ingresá un entero de cero o más.'

// Errores por producto (id → mensaje) de los contados con un valor inválido.
export function validarToma(contados: Readonly<Record<string, string>>): Record<string, string> {
  const errores: Record<string, string> = {}
  for (const [producto, texto] of Object.entries(contados)) {
    if (leerContado(texto).estado === 'invalido') errores[producto] = ERROR_CONTADO
  }
  return errores
}

// Ítems a enviar: solo los productos de la tabla con un contado válido (los vacíos no se tocan).
export function armarItemsToma(filas: readonly FilaToma[], contados: Readonly<Record<string, string>>): ItemToma[] {
  return filas.flatMap((fila) => {
    const contado = leerContado(contados[fila.producto_id])
    return contado.estado === 'ok' ? [{ producto: fila.producto_id, contado: contado.valor }] : []
  })
}

type FilaProducto = { id: string; nombre: string; sku: string | null }

// Productos activos de las categorías indicadas con su stock en el depósito por defecto. Lanza si la
// categoría supera el máximo que admite una confirmación (la RPC rechaza más de 1000).
export async function cargarFilasToma(categoriaIds: readonly string[]): Promise<FilaToma[]> {
  const { data, error } = await supabaseClient
    .from('v_productos_listado')
    .select('id, nombre, sku')
    .eq('activo', true)
    .in('categoria_id', [...categoriaIds])
    .order('nombre', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAXIMO_PRODUCTOS_TOMA + 1)
    .returns<FilaProducto[]>()
  if (error) throw error
  const productos = data ?? []
  if (productos.length > MAXIMO_PRODUCTOS_TOMA) {
    throw new Error(`La categoría tiene más de ${MAXIMO_PRODUCTOS_TOMA} productos: elegí una subcategoría.`)
  }
  if (productos.length === 0) return []
  const depositos = await listarDepositosActivos()
  const porDefecto = depositos.find((deposito) => deposito.por_defecto)
  if (!porDefecto) throw new Error('No hay un depósito por defecto activo para contar.')
  const stock = await listarStockPorDepositoDe(productos.map((producto) => producto.id), porDefecto.id)
  return productos.map((producto) => ({
    producto_id: producto.id,
    nombre: producto.nombre,
    sku: producto.sku,
    sistema: stock[producto.id]?.cantidad ?? 0,
  }))
}

export async function confirmarToma(items: readonly ItemToma[]): Promise<AjusteToma[]> {
  const { data, error } = await supabaseClient.rpc('confirmar_toma_inventario', {
    p_items: items,
    p_fecha: fechaDeHoy(),
  })
  if (error) throw error
  return ((data ?? []) as AjusteToma[]).map((fila) => ({
    producto: fila.producto,
    diferencia: Number(fila.diferencia),
    saldo: Number(fila.saldo),
    movimiento_id: fila.movimiento_id,
  }))
}

// Rechazos de la RPC que vienen en castellano y son seguros de mostrar tal cual.
const MENSAJES_DE_LA_BASE: ReadonlySet<string> = new Set([
  'El motivo «Toma de inventario» no está disponible: activalo desde Motivos',
  'No encontramos ese producto',
  'La toma admite hasta 1000 productos por confirmación',
])

export function mensajeDeErrorToma(error: unknown, porDefecto: string): string {
  const mensaje = (error as { message?: string } | null)?.message
  if (mensaje && MENSAJES_DE_LA_BASE.has(mensaje)) {
    console.error(porDefecto, error)
    return mensaje
  }
  return mensajeDeErrorStock(error, porDefecto)
}
