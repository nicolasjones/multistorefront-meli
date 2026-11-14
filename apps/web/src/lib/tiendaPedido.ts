import { supabaseClient } from './supabase'
import type { LineaPedido } from './listaPedido'
import { esContactoValido } from '../pages/tienda-publica/contacto/validacion'

// Lista de pedido de la tienda (MSF-176, historia B1; contrato `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`).
// Qué productos están disponibles, el precio de referencia, la validación definitiva, el límite y la entrega a Consultas los decide la base
// (`publico.lista_pedido_por_dominio` y `publico.enviar_lista_pedido`, ejecutables por `anon`): acá solo se llama y se traduce a estados de pantalla.
// La lista que se manda lleva SOLO `producto_id` y `cantidad`; nunca precios.

export const MAX_NOMBRE_PEDIDO = 100
export const MAX_CONTACTO_PEDIDO = 120
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

// De control, separadores de línea Unicode, marcas de dirección del texto, U+061C y los ceros de ancho (U+200B a U+200D, U+2060 y U+FEFF): el MISMO conjunto que `enviar_lista_pedido` y
// `crear_presupuesto_tienda` (M-4 de la revisión). En la nota se acepta el salto de línea.
// eslint-disable-next-line no-control-regex
const PROHIBIDOS_LINEA = /[\u0001-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/
// eslint-disable-next-line no-control-regex
const PROHIBIDOS_NOTA = /[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/

// Con cuenta activa no se piden nombre ni contacto (`conCuenta`): solo se valida la nota.
export function validarPedido(datos: DatosPedido, conCuenta: boolean): ErroresPedido {
  const errores: ErroresPedido = {}
  if (!conCuenta) {
    const nombre = datos.nombre.trim()
    const contacto = datos.contacto.trim()
    if (nombre === '') errores.nombre = MENSAJES_PEDIDO.nombre
    else if (nombre.length > MAX_NOMBRE_PEDIDO) errores.nombre = `El nombre admite hasta ${MAX_NOMBRE_PEDIDO} caracteres.`
    else if (PROHIBIDOS_LINEA.test(nombre)) errores.nombre = MENSAJE_CARACTERES
    if (contacto === '' || contacto.length > MAX_CONTACTO_PEDIDO || !esContactoValido(contacto)) errores.contacto = MENSAJES_PEDIDO.contacto
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


// ---------------------------------------------------------------------------------------------------------------------------------
// Presupuesto desde la tienda (MSF-176, historia B2, FR-050 a FR-064; contrato `…/contracts/tienda-compra-y-cuentas.md › B2`).
// Solo con una cuenta ACTIVA: `publico.cotizar_presupuesto_tienda` y `publico.crear_presupuesto_tienda` son ejecutables solo por `authenticated` y la base saca la identidad,
// la tienda y el cliente de la sesión y del host (no se manda ninguno). Lo que se manda es SOLO `producto_id` y `cantidad` (y la nota y la clave de envío en la creación):
// nunca un precio, una escala, un descuento ni una fecha. El precio, la escala, el descuento de la ficha y la promoción los calcula el servidor; la cotización y la
// creación usan el mismo motor («lo que ves es lo que se crea»).
// ---------------------------------------------------------------------------------------------------------------------------------
export type LineaCotizada = {
  productoId: string
  descripcion: string
  codigo: string | null
  cantidad: number
  precioUnitario: number
  subtotalSinIva: number
  iva: number
  disponible: boolean
}

export type Cotizacion = {
  lineas: LineaCotizada[]
  totalSinIva: number
  iva: number
  totalConIva: number
  // Productos que ya no están disponibles o que no tienen precio calculable: la creación se NEGARÁ mientras haya alguno.
  noDisponibles: string[]
  sinPrecio: string[]
}

export type ResultadoCotizacion =
  | { estado: 'ok'; cotizacion: Cotizacion }
  | { estado: 'invalido' }
  | { estado: 'espera'; esperaSegundos: number }
  | { estado: 'sin_acceso' }
  | { estado: 'falla' }

// Un importe obligatorio que falta o no es numérico NO se vuelve 0 (sería una cifra inventada): toda la respuesta es una falla reintentable.
function comoImporte(valor: unknown): number {
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : NaN
  if (!Number.isFinite(numero)) throw new ErrorListaPedido('error')
  return numero
}
const comoListaDeIds = (valor: unknown): string[] => (Array.isArray(valor) ? valor.filter((id): id is string => typeof id === 'string') : [])

function aLineaCotizada(valor: unknown): LineaCotizada {
  const fila = comoObjeto(valor)
  if (!fila || typeof fila.producto_id !== 'string' || typeof fila.descripcion !== 'string') throw new ErrorListaPedido('error')
  const cantidad = Number(fila.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1) throw new ErrorListaPedido('error')
  return {
    productoId: fila.producto_id,
    descripcion: fila.descripcion,
    codigo: comoTextoONulo(fila.codigo),
    cantidad,
    precioUnitario: comoImporte(fila.precio_unitario),
    subtotalSinIva: comoImporte(fila.subtotal_sin_iva),
    iva: comoImporte(fila.iva),
    disponible: fila.disponible === true,
  }
}

const esperaDe = (valor: unknown) => Math.max(1, Math.round(Number(valor) || 60))

export function traducirCotizacion(data: unknown): ResultadoCotizacion {
  const respuesta = comoObjeto(data)
  switch (respuesta?.estado) {
    case 'ok': {
      if (!Array.isArray(respuesta.lineas)) return { estado: 'falla' }
      try {
        return {
          estado: 'ok',
          cotizacion: {
            lineas: respuesta.lineas.map(aLineaCotizada),
            totalSinIva: comoImporte(respuesta.total_sin_iva),
            iva: comoImporte(respuesta.iva),
            totalConIva: comoImporte(respuesta.total_con_iva),
            noDisponibles: comoListaDeIds(respuesta.no_disponibles),
            sinPrecio: comoListaDeIds(respuesta.sin_precio),
          },
        }
      } catch {
        return { estado: 'falla' }
      }
    }
    case 'invalido':
      return { estado: 'invalido' }
    case 'limite':
      return { estado: 'espera', esperaSegundos: esperaDe(respuesta.espera_segundos) }
    case 'sin_acceso':
      return { estado: 'sin_acceso' }
    default:
      return { estado: 'falla' }
  }
}

// «Calculando tu presupuesto»: una petición por apertura del diálogo. Un corte de red o un error del servidor son `falla` (reintentable); nunca el detalle técnico.
export async function cotizarPresupuesto(host: string, lineas: readonly LineaPedido[]): Promise<ResultadoCotizacion> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('cotizar_presupuesto_tienda', { host, items: aItems(lineas) })
    if (error) {
      console.error('No se pudo cotizar el presupuesto', error.message)
      return { estado: 'falla' }
    }
    return traducirCotizacion(data)
  } catch (excepcion) {
    console.error('No se pudo cotizar el presupuesto', excepcion instanceof Error ? excepcion.message : excepcion)
    return { estado: 'falla' }
  }
}

export type ResultadoPresupuesto =
  | { estado: 'exito'; numero: string; fecha: string; totalConIva: number }
  | { estado: 'invalido'; campos: Array<'nota' | 'items' | 'clave_envio'> }
  | { estado: 'sin_precio'; productoId: string | null }
  | { estado: 'no_disponible'; productoId: string | null }
  | { estado: 'espera'; esperaSegundos: number }
  | { estado: 'limite_cuenta' }
  | { estado: 'sin_acceso' }
  | { estado: 'falla' }

type RespuestaPresupuesto = { estado?: string; numero?: unknown; fecha?: unknown; total_con_iva?: unknown; campos?: unknown; producto_id?: unknown; espera_segundos?: unknown } | null | undefined

export function traducirRespuestaPresupuesto(respuesta: RespuestaPresupuesto): ResultadoPresupuesto {
  const productoId = typeof respuesta?.producto_id === 'string' ? respuesta.producto_id : null
  switch (respuesta?.estado) {
    case 'ok': {
      // Sin número o sin un total numérico no se afirma un presupuesto que no se pudo leer: es una falla.
      const total = typeof respuesta.total_con_iva === 'number' ? respuesta.total_con_iva : typeof respuesta.total_con_iva === 'string' ? Number(respuesta.total_con_iva) : NaN
      if (typeof respuesta.numero !== 'string' || respuesta.numero === '' || !Number.isFinite(total)) return { estado: 'falla' }
      return { estado: 'exito', numero: respuesta.numero, fecha: typeof respuesta.fecha === 'string' ? respuesta.fecha : '', totalConIva: total }
    }
    case 'invalido': {
      const campos = Array.isArray(respuesta.campos) ? respuesta.campos : []
      const conocidos: Array<'nota' | 'items' | 'clave_envio'> = ['nota', 'items', 'clave_envio']
      return { estado: 'invalido', campos: conocidos.filter((campo) => campos.includes(campo)) }
    }
    case 'sin_precio':
      return { estado: 'sin_precio', productoId }
    case 'no_disponible':
      return { estado: 'no_disponible', productoId }
    case 'limite':
      return { estado: 'espera', esperaSegundos: esperaDe(respuesta.espera_segundos) }
    case 'limite_cuenta':
      return { estado: 'limite_cuenta' }
    case 'sin_acceso':
      return { estado: 'sin_acceso' }
    default:
      return { estado: 'falla' }
  }
}

// Crea el presupuesto. La `clave_envio` es de ESTE intento (la genera quien abre la confirmación y la reutiliza en «Reintentar»): repetirla devuelve el MISMO presupuesto.
export async function crearPresupuesto(host: string, lineas: readonly LineaPedido[], nota: string, claveEnvio: string): Promise<ResultadoPresupuesto> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('crear_presupuesto_tienda', {
      host,
      items: aItems(lineas),
      nota: nota.replace(/\r\n/g, '\n').trim() || null,
      clave_envio: claveEnvio,
    })
    if (error) {
      console.error('No se pudo crear el presupuesto', error.message)
      return { estado: 'falla' }
    }
    return traducirRespuestaPresupuesto(data as RespuestaPresupuesto)
  } catch (excepcion) {
    console.error('No se pudo crear el presupuesto', excepcion instanceof Error ? excepcion.message : excepcion)
    return { estado: 'falla' }
  }
}
