import { supabaseClient } from './supabase'
import { esIdValido } from './tiendaListado'
import { limpiarTextoPublico } from './tiendaTextos'

// F-CLI-20 (MSF-452, contrato `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`, historia A):
// «Mi cuenta» de la tienda. Qué comprobantes y favoritos ve la persona, de qué cuenta y de qué tienda lo decide el servidor
// (`private.cuenta_de_tienda(host)`): ninguna llamada manda cliente, cuenta ni empresa. Acá solo se pide y se acomoda la
// forma, con una lista blanca de campos: lo que el contrato no nombra (costos, márgenes, descuentos, operador, cobros)
// no llega a la pantalla aunque la respuesta lo trajera.

// `sin_acceso` = la sesión no es de una cuenta activa y habilitada en esta tienda (sin sesión, suspendida, de otra tienda,
// usuario del panel…): el servidor responde lo mismo en todos los casos. `error` = falla de red o de la base.
export class ErrorCuentaTienda extends Error {
  readonly codigo: 'sin_acceso' | 'error'
  constructor(codigo: 'sin_acceso' | 'error') {
    super(codigo === 'sin_acceso' ? MENSAJE_SIN_ACCESO : MENSAJE_ERROR)
    this.name = 'ErrorCuentaTienda'
    this.codigo = codigo
  }
}

export const MENSAJE_SIN_ACCESO = 'Tu cuenta no está activa en esta tienda'
export const MENSAJE_ERROR = 'No pudimos completar la operación. Probá de nuevo.'

export const esSinAcceso = (error: unknown): boolean => error instanceof ErrorCuentaTienda && error.codigo === 'sin_acceso'

export type TipoComprobantePublico = 'compra' | 'presupuesto' | 'nota_credito'
export type EstadoPublico = 'pendiente' | 'aceptado' | 'vencido' | 'anulado' | 'confirmada' | 'anulada' | 'nota_credito'
export type EscalaCuenta = 'x1' | 'x5' | 'x10' | 'x50'

export type CompraResumen = {
  id: string
  numero: string
  // aaaa-mm-dd (día de Buenos Aires tal como lo da el servidor): no se pasa por `Date` para no correrlo de día.
  fecha: string
  tipo: TipoComprobantePublico
  estado: EstadoPublico
  totalConIva: number
}

export type CursorCompras = { fecha: string; id: string }
export type PaginaCompras = { total: number; filas: CompraResumen[]; siguiente: CursorCompras | null }

export type LineaCompra = { descripcion: string; codigo: string | null; cantidad: number; precioUnitario: number; subtotal: number }

export type DetalleCompra = {
  numero: string
  fecha: string
  tipo: TipoComprobantePublico
  estado: EstadoPublico
  validoHasta: string | null
  totalSinIva: number
  iva: number
  totalConIva: number
  lineas: LineaCompra[]
}

export type FavoritoCuenta = {
  productoId: string
  nombre: string
  sku: string | null
  // Ruta del bucket (se firma con `urlsImagenesProducto`), no una URL.
  imagen: string | null
  disponible: boolean
  precioFinal: number | null
  escala: EscalaCuenta
}

export type CursorFavoritos = { creado: string; id: string }
export type PaginaFavoritos = { total: number; filas: FavoritoCuenta[]; siguiente: CursorFavoritos | null }

export const TAMANO_TANDA_CUENTA = 20
// Tope del servidor por llamada (spec FR-003); también lo de `favoritos_entre_por_dominio`.
export const TOPE_POR_LLAMADA = 50

type Cruda = Record<string, unknown>

const comoObjeto = (valor: unknown): Cruda | null => (valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Cruda) : null)
// Un importe o una cantidad que falta o no es numérico NO se vuelve 0: sería una cifra inventada. La respuesta entera se
// trata como inválida (error con reintento) en vez de mostrar «$ 0,00» donde el servidor no dijo nada.
const comoNumero = (valor: unknown): number => {
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : Number.NaN
  if (!Number.isFinite(numero)) throw new ErrorCuentaTienda('error')
  return numero
}
const comoTextoOpcional = (valor: unknown): string | null => (typeof valor === 'string' && valor.trim() !== '' ? valor : null)

const TIPOS: readonly TipoComprobantePublico[] = ['compra', 'presupuesto', 'nota_credito']
const ESTADOS: readonly EstadoPublico[] = ['pendiente', 'aceptado', 'vencido', 'anulado', 'confirmada', 'anulada', 'nota_credito']
const ESCALAS: readonly EscalaCuenta[] = ['x1', 'x5', 'x10', 'x50']

function comoTipo(valor: unknown): TipoComprobantePublico {
  return TIPOS.includes(valor as TipoComprobantePublico) ? (valor as TipoComprobantePublico) : 'compra'
}
// Un estado desconocido se trata como el más neutro: nunca se muestra el texto interno del servidor.
function comoEstado(valor: unknown, tipo: TipoComprobantePublico): EstadoPublico {
  if (ESTADOS.includes(valor as EstadoPublico)) return valor as EstadoPublico
  return tipo === 'nota_credito' ? 'nota_credito' : tipo === 'presupuesto' ? 'pendiente' : 'confirmada'
}

// Una llamada a una RPC de cuenta: `sin_acceso` y cualquier falla se vuelven un `ErrorCuentaTienda`; el resto vuelve tal cual.
async function llamar(funcion: string, argumentos: Record<string, unknown>): Promise<Cruda> {
  const { data, error } = await supabaseClient.schema('publico').rpc(funcion, argumentos)
  if (error) {
    console.error(`tiendaCuentaDatos: falló ${funcion}`, error.message)
    throw new ErrorCuentaTienda('error')
  }
  const respuesta = comoObjeto(data)
  if (!respuesta) throw new ErrorCuentaTienda('error')
  if (respuesta.estado === 'sin_acceso') throw new ErrorCuentaTienda('sin_acceso')
  return respuesta
}

function filaCompra(cruda: unknown): CompraResumen | null {
  const fila = comoObjeto(cruda)
  if (!fila || !esIdValido(fila.id as string)) return null
  const tipo = comoTipo(fila.tipo)
  return {
    id: fila.id as string,
    numero: String(fila.numero ?? ''),
    fecha: typeof fila.fecha === 'string' ? fila.fecha.slice(0, 10) : '',
    tipo,
    estado: comoEstado(fila.estado_publico, tipo),
    totalConIva: comoNumero(fila.total_con_iva),
  }
}

// Historial del cliente en ESTA tienda, de a `limite` (1 a 50), nuevos primero. El cursor `(fecha, id)` solo ordena.
export async function leerMisCompras(host: string, cursor: CursorCompras | null = null, limite: number = TAMANO_TANDA_CUENTA): Promise<PaginaCompras> {
  const respuesta = await llamar('mis_compras_por_dominio', {
    host,
    desde_fecha: cursor?.fecha ?? null,
    desde_id: cursor?.id ?? null,
    limite: Math.min(Math.max(Math.trunc(limite), 1), TOPE_POR_LLAMADA),
  })
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  const filas = (Array.isArray(respuesta.filas) ? respuesta.filas : []).flatMap((cruda) => filaCompra(cruda) ?? [])
  const siguiente = comoObjeto(respuesta.siguiente)
  return {
    total: comoNumero(respuesta.total),
    filas,
    siguiente: siguiente && typeof siguiente.fecha === 'string' && esIdValido(siguiente.id as string) ? { fecha: siguiente.fecha.slice(0, 10), id: siguiente.id as string } : null,
  }
}

// Detalle de un comprobante propio. `null` = no existe o no es de esta cuenta (el servidor responde lo mismo: FR-006);
// un id que no es uuid ni se pide.
export async function leerMiCompra(host: string, comprobanteId: string): Promise<DetalleCompra | null> {
  if (!esIdValido(comprobanteId)) return null
  const respuesta = await llamar('mi_compra_por_dominio', { host, comprobante_id: comprobanteId })
  if (respuesta.estado === 'no_encontrada') return null
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  const tipo = comoTipo(respuesta.tipo)
  const lineas: LineaCompra[] = (Array.isArray(respuesta.lineas) ? respuesta.lineas : []).flatMap((cruda) => {
    const linea = comoObjeto(cruda)
    if (!linea) return []
    return [{
      descripcion: limpiarTextoPublico(String(linea.descripcion ?? '')),
      codigo: comoTextoOpcional(linea.codigo),
      cantidad: comoNumero(linea.cantidad),
      precioUnitario: comoNumero(linea.precio_unitario),
      subtotal: comoNumero(linea.subtotal),
    }]
  })
  return {
    numero: String(respuesta.numero ?? ''),
    fecha: typeof respuesta.fecha === 'string' ? respuesta.fecha.slice(0, 10) : '',
    tipo,
    estado: comoEstado(respuesta.estado_publico, tipo),
    validoHasta: typeof respuesta.valido_hasta === 'string' ? respuesta.valido_hasta.slice(0, 10) : null,
    totalSinIva: comoNumero(respuesta.total_sin_iva),
    iva: comoNumero(respuesta.iva),
    totalConIva: comoNumero(respuesta.total_con_iva),
    lineas,
  }
}

function filaFavorito(cruda: unknown): FavoritoCuenta | null {
  const fila = comoObjeto(cruda)
  // Un id que no es uuid no llega a la pantalla (arma el enlace a la ficha): se descarta la fila.
  if (!fila || !esIdValido(fila.producto_id as string)) return null
  return {
    productoId: fila.producto_id as string,
    nombre: limpiarTextoPublico(String(fila.nombre ?? '')),
    sku: comoTextoOpcional(fila.sku),
    imagen: comoTextoOpcional(fila.imagen),
    disponible: fila.disponible === true,
    // `precio_final` nulo es «sin precio» (el contrato lo permite); un valor presente que no es número invalida la respuesta.
    precioFinal: fila.precio_final === null ? null : comoNumero(fila.precio_final),
    escala: ESCALAS.includes(fila.escala as EscalaCuenta) ? (fila.escala as EscalaCuenta) : 'x1',
  }
}

// Favoritos de la cuenta en ESTA tienda, de a `limite` (1 a 50), el último guardado primero. Solo productos visibles hoy.
export async function leerMisFavoritos(host: string, cursor: CursorFavoritos | null = null, limite: number = TAMANO_TANDA_CUENTA): Promise<PaginaFavoritos> {
  const respuesta = await llamar('mis_favoritos_por_dominio', {
    host,
    desde_creado: cursor?.creado ?? null,
    desde_id: cursor?.id ?? null,
    limite: Math.min(Math.max(Math.trunc(limite), 1), TOPE_POR_LLAMADA),
  })
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  const filas = (Array.isArray(respuesta.filas) ? respuesta.filas : []).flatMap((cruda) => filaFavorito(cruda) ?? [])
  const siguiente = comoObjeto(respuesta.siguiente)
  // `siguiente` = `{creado, id}` (contrato de `mis_favoritos_por_dominio`); se devuelve tal cual en `desde_creado` y `desde_id`.
  const creado = siguiente ? siguiente.creado : null
  return {
    total: comoNumero(respuesta.total),
    filas,
    siguiente: siguiente && typeof creado === 'string' && esIdValido(siguiente.id as string) ? { creado, id: siguiente.id as string } : null,
  }
}

export type ResultadoFavorito =
  | { estado: 'ok'; favorito: boolean }
  | { estado: 'limite_favoritos' }
  // El producto ya no está visible en la tienda (o no existe): indistinguible para quien llama.
  | { estado: 'no_encontrado' }

// Guardar (`favorito = true`) o quitar (`false`) un favorito: idempotente. `sin_acceso` y las fallas lanzan `ErrorCuentaTienda`.
export async function cambiarFavorito(host: string, productoId: string, favorito: boolean): Promise<ResultadoFavorito> {
  if (!esIdValido(productoId)) return { estado: 'no_encontrado' }
  const respuesta = await llamar('cambiar_favorito_por_dominio', { host, producto_id: productoId, favorito })
  if (respuesta.estado === 'ok') return { estado: 'ok', favorito: respuesta.favorito === true }
  if (respuesta.estado === 'limite_favoritos') return { estado: 'limite_favoritos' }
  if (respuesta.estado === 'no_encontrado') return { estado: 'no_encontrado' }
  throw new ErrorCuentaTienda('error')
}

// De los productos pedidos (hasta 50), los que son favoritos de la cuenta: pinta el corazón de una pantalla con UNA llamada.
export async function leerFavoritosEntre(host: string, productos: readonly string[]): Promise<string[]> {
  const ids = [...new Set(productos.filter(esIdValido))].slice(0, TOPE_POR_LLAMADA)
  if (ids.length === 0) return []
  const respuesta = await llamar('favoritos_entre_por_dominio', { host, productos: ids })
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  return (Array.isArray(respuesta.favoritos) ? respuesta.favoritos : []).filter((id): id is string => typeof id === 'string')
}

// «$ 12.500,00»: importes de comprobantes con centavos (es-AR), con signo menos delante en una nota de crédito. Se agrupa a
// mano por lo mismo que `formatearPrecioArs`: Intl `es-AR` no agrupa los números de 4 dígitos.
export function formatearImporteArs(importe: number): string {
  const [entero, decimales] = Math.abs(importe).toFixed(2).split('.')
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${importe < 0 && Math.abs(importe) >= 0.005 ? '-' : ''}$ ${miles},${decimales}`
}

// Cantidad de una línea con coma decimal (es-AR): «1,5», no «1.5»; las enteras quedan como están.
export function formatearCantidad(cantidad: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(cantidad)
}

// «12/11/2026» desde «2026-11-12» sin pasar por `Date`.
export function formatearFechaCuenta(fecha: string): string {
  const coincide = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha)
  return coincide ? `${coincide[3]}/${coincide[2]}/${coincide[1]}` : fecha
}

// «Nº 00000012»: con ceros hasta 8 cifras como en el panel (un número que ya los trae no cambia).
export function formatearNumeroComprobante(numero: string): string {
  return `Nº ${/^\d+$/.test(numero) ? numero.padStart(8, '0') : numero}`
}

export const ETIQUETA_TIPO: Record<TipoComprobantePublico, string> = {
  compra: 'Compra',
  presupuesto: 'Presupuesto',
  nota_credito: 'Nota de crédito',
}

export const ETIQUETA_ESTADO: Record<EstadoPublico, string> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado',
  vencido: 'Vencido',
  anulado: 'Anulado',
  confirmada: 'Confirmada',
  anulada: 'Anulada',
  nota_credito: 'Nota de crédito',
}

// Dirección del detalle de un comprobante dentro de «Mi cuenta» (el `?compra=` hace que «atrás» y los enlaces funcionen).
export const enlaceCompra = (id: string) => `/mi-cuenta?seccion=compras&compra=${encodeURIComponent(id)}`
