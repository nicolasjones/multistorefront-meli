import { supabaseClient } from './supabase'
import { filtroBusquedaStock } from './stock'
import { aReparacion, type ItemReparacion, type Reparacion, type TipoItemReparacion } from './reparaciones'

// Ítems de mano de obra y repuestos de una reparación (F-SVC-06). Se agregan y quitan solo por RPC
// (`agregar_item_reparacion`, `quitar_item_reparacion`); cada una devuelve la reparación completa con los totales
// ya recalculados en la misma transacción. La base es la autoridad: acá se valida solo para avisar antes de enviar.

export const LARGO_MAXIMO_DESCRIPCION_ITEM = 200
export const CANTIDAD_MAXIMA_ITEM = 9999
export const PRECIO_MAXIMO_ITEM = 99_999_999.99

export type CampoItem = 'descripcion' | 'cantidad' | 'precio' | 'producto_id'
export type ErroresItem = Partial<Record<CampoItem, string>>
export const CAMPOS_ITEM: ReadonlyArray<CampoItem> = ['descripcion', 'cantidad', 'precio', 'producto_id']

export type ProductoRepuesto = { id: string; nombre: string; sku: string | null }

export type FormularioItem = {
  descripcion: string
  cantidad: string
  precio: string
  producto: ProductoRepuesto | null
}

export function formularioItemVacio(): FormularioItem {
  return { descripcion: '', cantidad: '1', precio: '', producto: null }
}

export const MENSAJE_CANTIDAD = `Ingresá una cantidad entera de 1 a ${CANTIDAD_MAXIMA_ITEM}.`
export const MENSAJE_PRECIO = 'Ingresá un precio de cero o más, con hasta dos decimales (por ejemplo 25000 o 25000,50).'
export const MENSAJE_SOLO_LECTURA = 'La reparación ya fue entregada o está anulada: los ítems son de solo lectura.'

const PRECIO_VALIDO = /^\d{1,8}([.,]\d{1,2})?$/

export function parsearCantidad(texto: string): number | null {
  const limpio = texto.trim()
  if (!/^\d{1,4}$/.test(limpio)) return null
  const valor = Number(limpio)
  return valor >= 1 && valor <= CANTIDAD_MAXIMA_ITEM ? valor : null
}

export function parsearPrecio(texto: string): number | null {
  const limpio = texto.trim()
  if (!PRECIO_VALIDO.test(limpio)) return null
  const valor = Number(limpio.replace(',', '.'))
  return valor <= PRECIO_MAXIMO_ITEM ? valor : null
}

// Subtotal en vivo del diálogo: cantidad × precio con dos decimales; sin cantidad o precio válidos, cero.
export function calcularSubtotal(cantidad: string, precio: string): number {
  const c = parsearCantidad(cantidad)
  const p = parsearPrecio(precio)
  return c === null || p === null ? 0 : Math.round(c * p * 100) / 100
}

export function validarItem(formulario: FormularioItem, tipo: TipoItemReparacion): ErroresItem {
  const errores: ErroresItem = {}
  const descripcion = formulario.descripcion.trim()
  // Un repuesto vinculado al catálogo toma el nombre del producto si no se escribe otra descripción.
  if (descripcion === '' && !(tipo === 'repuesto' && formulario.producto)) {
    errores.descripcion = tipo === 'mano_obra' ? 'Ingresá el concepto.' : 'Elegí un producto o escribí el repuesto.'
  } else if (descripcion.length > LARGO_MAXIMO_DESCRIPCION_ITEM) {
    errores.descripcion = `Máximo ${LARGO_MAXIMO_DESCRIPCION_ITEM} caracteres.`
  }
  if (parsearCantidad(formulario.cantidad) === null) errores.cantidad = MENSAJE_CANTIDAD
  if (parsearPrecio(formulario.precio) === null) errores.precio = MENSAJE_PRECIO
  return errores
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// Campo del diálogo al que apunta un error de validación de la base (`hint`), con el mensaje que ella arma.
export function errorDeCampoItem(error: unknown): { campo: CampoItem; mensaje: string } | null {
  const e = error as ErrorDeBase
  if (e?.code !== '22023' || !e.hint || !e.message) return null
  const campo = CAMPOS_ITEM.find((candidato) => candidato === e.hint)
  return campo ? { campo, mensaje: e.message } : null
}

export function mensajeDeErrorItem(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para modificar los ítems. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '55000') return MENSAJE_SOLO_LECTURA
  if (e?.code === 'P0002') return 'La reparación o el ítem ya no existe. Recargá la página.'
  // Los mensajes de validación de la base ya están en castellano y no nombran tablas ni columnas.
  if (e?.code === '22023' && e.message) return e.message
  return porDefecto
}

function lanzarSiHayError(error: unknown): void {
  if (error) throw error
}

export async function agregarItem(
  reparacionId: string,
  tipo: TipoItemReparacion,
  formulario: FormularioItem,
): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('agregar_item_reparacion', {
    p_reparacion_id: reparacionId,
    p_tipo: tipo,
    p_descripcion: formulario.descripcion.trim(),
    p_producto_id: tipo === 'repuesto' ? (formulario.producto?.id ?? null) : null,
    p_cantidad: parsearCantidad(formulario.cantidad),
    p_precio: parsearPrecio(formulario.precio),
  })
  lanzarSiHayError(error)
  return aReparacion(data)
}

export async function quitarItem(item: ItemReparacion): Promise<Reparacion> {
  const { data, error } = await supabaseClient.rpc('quitar_item_reparacion', { p_item_id: item.id })
  lanzarSiHayError(error)
  return aReparacion(data)
}

const LIMITE_PRODUCTOS = 20

// Productos activos de la organización por Nombre o SKU (FR-025). La RLS del catálogo exige acceso a Productos:
// sin él la búsqueda vuelve vacía y el repuesto se carga como libre.
export async function buscarProductos(texto: string): Promise<ProductoRepuesto[]> {
  const patron = filtroBusquedaStock(texto)
  if (!patron) return []
  const { data, error } = await supabaseClient
    .schema('dominio')
    .from('productos')
    .select('id, nombre, sku')
    .eq('activo', true)
    .or(patron)
    .order('nombre', { ascending: true })
    .limit(LIMITE_PRODUCTOS)
    .returns<ProductoRepuesto[]>()
  lanzarSiHayError(error)
  return data ?? []
}
