import { supabaseClient } from './supabase'
import type { LineaPedido } from './listaPedido'
import { esContactoValido } from '../pages/tienda-publica/contacto/validacion'

// Lista de pedido de la tienda (MSF-176, historia B1; contrato `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`).
// Qué productos están disponibles, el precio de referencia, la validación definitiva, el límite y la entrega a Consultas los decide la base
// (`publico.lista_pedido_por_dominio` y `publico.enviar_lista_pedido`, ejecutables por `anon`): acá solo se llama y se traduce a estados de pantalla.
// La lista que se manda lleva SOLO `producto_id` y `cantidad`; nunca precios.

export const MAX_NOMBRE_PEDIDO = 100
export const MAX_NOTA_PEDIDO = 500

export type EscalaPedido = 'x1' | 'x5' | 'x10' | 'x50'

export type LineaRevalidada = {
  productoId: string
  nombre: string
  sku: string | null
  // Ruta del bucket (se firma con `urlsImagenesProducto`), no una URL.
  imagen: string | null
  cantidad: number
  disponible: boolean
  precioUnitario: number | null
  precioAnterior: number | null
  escala: EscalaPedido
  subtotal: number | null
}

export type ListaRevalidada = {
  conCuenta: boolean
  tipo: 'minorista' | 'mayorista' | null
  lineas: LineaRevalidada[]
  noDisponibles: string[]
  totalReferencia: number | null
}

// `error` = falla de red o de la base (o la función apagada); `limite` = demasiadas lecturas seguidas; `invalido` = la lista no se aceptó.
export class ErrorListaPedido extends Error {
  readonly codigo: 'error' | 'limite' | 'invalido'
  readonly esperaSegundos: number
  constructor(codigo: 'error' | 'limite' | 'invalido', esperaSegundos = 0) {
    super(codigo === 'limite' ? 'Demasiadas lecturas seguidas' : 'No pudimos revisar tu lista')
    this.name = 'ErrorListaPedido'
    this.codigo = codigo
    this.esperaSegundos = esperaSegundos
  }
}

type Cruda = Record<string, unknown>
const comoObjeto = (valor: unknown): Cruda | null => (valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Cruda) : null)
const comoTextoONulo = (valor: unknown): string | null => (typeof valor === 'string' && valor.trim() !== '' ? valor : null)
// Un importe que falta o no es numérico NO se vuelve 0: sería una cifra inventada. Un `null` del servidor es «precio a confirmar».
function comoImporteONulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN
  if (!Number.isFinite(numero)) throw new ErrorListaPedido('error')
  return numero
}
const ESCALAS: readonly EscalaPedido[] = ['x1', 'x5', 'x10', 'x50']

function aLinea(valor: unknown): LineaRevalidada {
  const fila = comoObjeto(valor)
  if (!fila || typeof fila.producto_id !== 'string' || typeof fila.nombre !== 'string') throw new ErrorListaPedido('error')
  const cantidad = Number(fila.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new ErrorListaPedido('error')
  const escala = ESCALAS.find((e) => e === fila.escala) ?? 'x1'
  return {
    productoId: fila.producto_id,
    nombre: fila.nombre,
    sku: comoTextoONulo(fila.sku),
    imagen: comoTextoONulo(fila.imagen),
    cantidad,
    disponible: fila.disponible === true,
    precioUnitario: comoImporteONulo(fila.precio_unitario),
    precioAnterior: comoImporteONulo(fila.precio_anterior),
    escala,
    subtotal: comoImporteONulo(fila.subtotal),
  }
}

// Lo que el servidor manda y la pantalla necesita; cualquier forma inesperada es un error (reintentable), nunca datos inventados.
export function traducirListaRevalidada(data: unknown): ListaRevalidada {
  const respuesta = comoObjeto(data)
  if (!respuesta) throw new ErrorListaPedido('error')
  if (respuesta.estado === 'limite') throw new ErrorListaPedido('limite', Math.max(1, Math.round(Number(respuesta.espera_segundos) || 60)))
  if (respuesta.estado === 'invalido') throw new ErrorListaPedido('invalido')
  if (respuesta.estado !== 'ok' || !Array.isArray(respuesta.lineas) || !Array.isArray(respuesta.no_disponibles)) throw new ErrorListaPedido('error')
  const tipo = respuesta.tipo === 'mayorista' || respuesta.tipo === 'minorista' ? respuesta.tipo : null
  return {
    conCuenta: respuesta.con_cuenta === true,
    tipo,
    lineas: respuesta.lineas.map(aLinea),
    noDisponibles: respuesta.no_disponibles.filter((id): id is string => typeof id === 'string'),
    totalReferencia: comoImporteONulo(respuesta.total_referencia),
  }
}

const aItems = (lineas: readonly LineaPedido[]) => lineas.map((linea) => ({ producto_id: linea.productoId, cantidad: linea.cantidad }))

// FR-023: revalida la lista (se llama al abrirla y antes de enviar).
export async function revalidarLista(host: string, lineas: readonly LineaPedido[]): Promise<ListaRevalidada> {
  const { data, error } = await supabaseClient.schema('publico').rpc('lista_pedido_por_dominio', { host, items: aItems(lineas) })
  if (error) {
    console.error('No se pudo revalidar la lista de pedido', error.message)
    throw new ErrorListaPedido('error')
  }
  return traducirListaRevalidada(data)
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Datos del visitante (FR-025): espejo EXACTO de `publico.enviar_lista_pedido`. El servidor vuelve a validar siempre.
// ---------------------------------------------------------------------------------------------------------------------------------
export type DatosPedido = { nombre: string; contacto: string; nota: string }
export type CampoPedido = 'nombre' | 'contacto' | 'nota'
export type ErroresPedido = Partial<Record<CampoPedido, string>>
export const ORDEN_CAMPOS_PEDIDO: readonly CampoPedido[] = ['nombre', 'contacto', 'nota']

export const MENSAJES_PEDIDO: Record<CampoPedido, string> = {
  nombre: 'Ingresá tu nombre.',
  contacto: 'Ingresá un correo o un teléfono válido (de 8 a 15 números).',
  nota: 'La nota admite hasta 500 caracteres.',
}
export const MENSAJE_CARACTERES = 'Hay caracteres que no podemos aceptar.'

// De control, separadores de línea Unicode y marcas de dirección del texto (mismos que el servidor); en la nota se acepta el salto de línea.
// eslint-disable-next-line no-control-regex
const PROHIBIDOS_LINEA = /[\u0001-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/
// eslint-disable-next-line no-control-regex
const PROHIBIDOS_NOTA = /[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/

// Con cuenta activa no se piden nombre ni contacto (`conCuenta`): solo se valida la nota.
export function validarPedido(datos: DatosPedido, conCuenta: boolean): ErroresPedido {
  const errores: ErroresPedido = {}
  if (!conCuenta) {
    const nombre = datos.nombre.trim()
    const contacto = datos.contacto.trim()
    if (nombre === '') errores.nombre = MENSAJES_PEDIDO.nombre
    else if (nombre.length > MAX_NOMBRE_PEDIDO) errores.nombre = `El nombre admite hasta ${MAX_NOMBRE_PEDIDO} caracteres.`
    else if (PROHIBIDOS_LINEA.test(nombre)) errores.nombre = MENSAJE_CARACTERES
    if (contacto === '' || contacto.length > 120 || !esContactoValido(contacto)) errores.contacto = MENSAJES_PEDIDO.contacto
    else if (PROHIBIDOS_LINEA.test(contacto)) errores.contacto = MENSAJE_CARACTERES
  }
  const nota = datos.nota.replace(/\r\n/g, '\n').trim()
  if (nota.length > MAX_NOTA_PEDIDO) errores.nota = MENSAJES_PEDIDO.nota
  else if (PROHIBIDOS_NOTA.test(nota)) errores.nota = MENSAJE_CARACTERES
  return errores
}

// Una `clave_envio` por intento (idempotencia, FR-027): se genera al abrir el envío y «Reintentar» reutiliza la misma.
export function nuevaClavePedido(): string {
  return crypto.randomUUID()
}

export type ResultadoPedido =
  | { estado: 'exito' }
  | { estado: 'invalido'; campos: Array<CampoPedido | 'items'>; noDisponibles: string[] }
  | { estado: 'espera'; esperaSegundos: number }
  | { estado: 'falla' }

type RespuestaEnvio = { estado?: string; campos?: unknown; no_disponibles?: unknown; espera_segundos?: unknown } | null | undefined

export function traducirRespuestaPedido(respuesta: RespuestaEnvio): ResultadoPedido {
  switch (respuesta?.estado) {
    case 'ok':
      return { estado: 'exito' }
    case 'invalido': {
      const campos = Array.isArray(respuesta.campos) ? respuesta.campos : []
      const conocidos: Array<CampoPedido | 'items'> = ['nombre', 'contacto', 'nota', 'items']
      return {
        estado: 'invalido',
        campos: conocidos.filter((campo) => campos.includes(campo)),
        noDisponibles: Array.isArray(respuesta.no_disponibles) ? respuesta.no_disponibles.filter((id): id is string => typeof id === 'string') : [],
      }
    }
    case 'limite':
      return { estado: 'espera', esperaSegundos: Math.max(1, Math.round(Number(respuesta.espera_segundos) || 60)) }
    default:
      return { estado: 'falla' }
  }
}

// Un corte de red o un error del servidor se traducen a `falla`: nunca se muestra el detalle técnico. Los datos viajan recortados;
// con cuenta activa el servidor ignora nombre y contacto y usa los de la ficha del cliente.
export async function enviarListaPedido(host: string, datos: DatosPedido, lineas: readonly LineaPedido[], claveEnvio: string): Promise<ResultadoPedido> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('enviar_lista_pedido', {
      host,
      nombre: datos.nombre.trim(),
      contacto: datos.contacto.trim(),
      nota: datos.nota.replace(/\r\n/g, '\n').trim() || null,
      items: aItems(lineas),
      clave_envio: claveEnvio,
    })
    if (error) {
      console.error('No se pudo enviar la lista de pedido', error.message)
      return { estado: 'falla' }
    }
    return traducirRespuestaPedido(data as RespuestaEnvio)
  } catch (excepcion) {
    console.error('No se pudo enviar la lista de pedido', excepcion instanceof Error ? excepcion.message : excepcion)
    return { estado: 'falla' }
  }
}

