import { supabaseClient } from './supabase'
import { LARGO_MAXIMO_NOTA, TITULO_STOCK_INSUFICIENTE, esStockInsuficiente, fechaDeHoy, mensajeDeErrorStock, parsearCantidad } from './stock'

// Traslado entre depósitos (F-STK-15, MSF-353). Las reglas viven en la RPC `trasladar_stock`
// (migración 20261023130000_stock_traslado.sql); acá se espejan solo para validar y rotular
// (la autoridad es la base: RLS, nivel de la sección Stock y el disponible del origen).

export const MENSAJE_TRASLADO_REGISTRADO = 'Traslado registrado'

export type FormularioTraslado = {
  origen_id: string
  destino_id: string
  // Unidades tal como las escribe la persona.
  cantidad: string
  nota: string
  fecha: string
}

export type ErroresTraslado = Partial<Record<keyof FormularioTraslado, string>>

export function formularioTrasladoVacio(origenId = ''): FormularioTraslado {
  return { origen_id: origenId, destino_id: '', cantidad: '', nota: '', fecha: fechaDeHoy() }
}

const unidades = (n: number) => `${n} ${n === 1 ? 'unidad' : 'unidades'}`

// Aviso previo a enviar: null mientras la cantidad no pase el disponible del origen.
export function avisoTrasladoInsuficiente(disponible: number, cantidad: string): string | null {
  const valor = parsearCantidad(cantidad)
  if (valor === null || valor <= disponible) return null
  return `Hay ${unidades(disponible)} disponibles en el origen y el traslado es de ${valor}. Reducí la cantidad para continuar.`
}

export function validarTraslado(formulario: FormularioTraslado, hoy: string = fechaDeHoy()): ErroresTraslado {
  const errores: ErroresTraslado = {}
  if (formulario.origen_id === '') errores.origen_id = 'Elegí el depósito de origen.'
  if (formulario.destino_id === '') errores.destino_id = 'Elegí el depósito de destino.'
  else if (formulario.destino_id === formulario.origen_id) errores.destino_id = 'El destino debe ser distinto del origen.'
  const cantidad = parsearCantidad(formulario.cantidad)
  if (cantidad === null || cantidad <= 0) errores.cantidad = 'Ingresá una cantidad entera mayor a cero.'
  if (formulario.fecha === '') errores.fecha = 'Ingresá la fecha del traslado.'
  else if (formulario.fecha > hoy) errores.fecha = 'La fecha no puede ser futura.'
  if (formulario.nota.trim().length > LARGO_MAXIMO_NOTA) errores.nota = `Máximo ${LARGO_MAXIMO_NOTA} caracteres.`
  return errores
}

// Rechazos de la RPC que vienen en castellano y son seguros de mostrar tal cual. Cualquier otro
// texto crudo de Postgres va solo a consola.
const MENSAJES_DE_LA_BASE: ReadonlySet<string> = new Set([
  'Tu rol no puede trasladar stock',
  'Elegí el depósito de origen y el de destino',
  'El depósito de origen y el de destino deben ser distintos',
  'La cantidad debe ser un entero mayor a cero',
  'La fecha no puede ser futura',
  'La nota admite hasta 500 caracteres',
  'No encontramos ese producto',
  'No encontramos el depósito de origen',
  'No encontramos el depósito de destino',
  'El depósito de origen está inactivo: elegí otro',
  'El depósito de destino está inactivo: elegí otro',
])

export function mensajeDeErrorTraslado(error: unknown, porDefecto: string): string {
  if (esStockInsuficiente(error)) {
    console.error(porDefecto, error)
    return `${TITULO_STOCK_INSUFICIENTE}. El stock cambió mientras cargabas el traslado: revisá la cantidad e intentá de nuevo.`
  }
  const mensaje = (error as { message?: string } | null)?.message
  if (mensaje && MENSAJES_DE_LA_BASE.has(mensaje)) {
    console.error(porDefecto, error)
    return mensaje
  }
  return mensajeDeErrorStock(error, porDefecto)
}

export type ResultadoTraslado = {
  traslado_id: string
  origen_cantidad: number
  origen_disponible: number
  destino_cantidad: number
  destino_disponible: number
}

export async function trasladarStock(entrada: {
  productoId: string
  formulario: FormularioTraslado
}): Promise<ResultadoTraslado> {
  const { productoId, formulario } = entrada
  const { data, error } = await supabaseClient.rpc('trasladar_stock', {
    p_producto: productoId,
    p_origen: formulario.origen_id,
    p_destino: formulario.destino_id,
    p_cantidad: Number(formulario.cantidad.trim()),
    p_nota: formulario.nota.trim() === '' ? null : formulario.nota.trim(),
    p_fecha: formulario.fecha,
  })
  if (error) throw error
  const fila = (Array.isArray(data) ? data[0] : data) as ResultadoTraslado | null | undefined
  if (!fila) throw new Error('trasladar_stock no devolvió el resultado')
  return {
    traslado_id: fila.traslado_id,
    origen_cantidad: Number(fila.origen_cantidad),
    origen_disponible: Number(fila.origen_disponible),
    destino_cantidad: Number(fila.destino_cantidad),
    destino_disponible: Number(fila.destino_disponible),
  }
}
