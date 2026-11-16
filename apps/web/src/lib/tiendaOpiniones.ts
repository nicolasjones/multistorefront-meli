import { supabaseClient } from './supabase'
import { esEstadoOpinion, type EstadoOpinion } from './estadoOpinion'
import { ErrorCuentaTienda } from './tiendaCuentaDatos'
import { esIdValido } from './tiendaListado'

// MSF-467 (contrato `specs/20270328-100000-opiniones-de-productos/contracts/opiniones.md`): opiniones de productos en la tienda.
// Quién opina y en qué tienda lo decide el servidor (`private.cuenta_de_tienda(host)`): ninguna llamada manda cliente, cuenta ni
// empresa. La bandera `tienda_opiniones` la impone el servidor; acá `capacidades` solo decide si se dibuja el bloque. El texto
// de las opiniones es NO confiable: se devuelve tal cual y la interfaz lo pinta siempre como texto (nunca como HTML).

export type OpinionPublica = {
  id: string
  nombrePila: string
  puntuacion: number
  comentario: string
  // aaaa-mm-dd (día de Buenos Aires tal como lo da el servidor): no se pasa por `Date` para no correrlo de día.
  fecha: string
  esMia: boolean
}
export type CursorOpiniones = { creada: string; id: string }
export type ResumenOpiniones = { promedio: number | null; cantidad: number }
export type PaginaOpiniones = { resumen: ResumenOpiniones; filas: OpinionPublica[]; siguiente: CursorOpiniones | null }

export type MiOpinion = {
  id: string
  productoId: string
  productoNombre: string
  puntuacion: number
  comentario: string
  estado: EstadoOpinion
  motivoRechazo: string | null
  creadaEn: string
  actualizadaEn: string
}
export type PaginaMisOpiniones = { total: number; filas: MiOpinion[]; siguiente: CursorOpiniones | null }

export type ResultadoGuardar =
  | { estado: 'ok'; opinion: { id: string; estado: EstadoOpinion; puntuacion: number; comentario: string } }
  | { estado: 'invalido'; campos: Array<'puntuacion' | 'comentario'> }
  | { estado: 'limite_opiniones' | 'limite_pendientes' | 'no_encontrado' }
  | { estado: 'limite'; esperaSegundos: number }

export const TAMANO_TANDA_FICHA = 10
export const TAMANO_TANDA_MIS_OPINIONES = 20

type Cruda = Record<string, unknown>
const comoObjeto = (valor: unknown): Cruda | null => (valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Cruda) : null)
const comoTexto = (valor: unknown): string => (typeof valor === 'string' ? valor : '')
const comoEstado = (valor: unknown): EstadoOpinion => (esEstadoOpinion(valor) ? valor : 'pendiente')
const comoPuntuacion = (valor: unknown): number | null => (typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 5 ? valor : null)

// Una llamada: `sin_acceso` y cualquier falla se vuelven un `ErrorCuentaTienda`; el resto vuelve tal cual.
async function llamar(funcion: string, argumentos: Record<string, unknown>, conSinAcceso = true): Promise<Cruda> {
  const { data, error } = await supabaseClient.schema('publico').rpc(funcion, argumentos)
  if (error) {
    console.error(`tiendaOpiniones: falló ${funcion}`, error.message)
    throw new ErrorCuentaTienda('error')
  }
  const respuesta = comoObjeto(data)
  if (!respuesta) throw new ErrorCuentaTienda('error')
  if (conSinAcceso && respuesta.estado === 'sin_acceso') throw new ErrorCuentaTienda('sin_acceso')
  return respuesta
}

function cursorDe(valor: unknown): CursorOpiniones | null {
  const cursor = comoObjeto(valor)
  return cursor && typeof cursor.creada === 'string' && esIdValido(cursor.id as string) ? { creada: cursor.creada, id: cursor.id as string } : null
}

// --- Capacidades: ¿se dibuja el bloque? Una sola llamada por host y carga de página (como `tiendaCapacidades`). ---
const porHost = new Map<string, Promise<boolean>>()

// `false` = host desconocido, tienda pausada o bandera apagada. Lanza si la llamada falla.
export function leerCapacidadOpiniones(host: string): Promise<boolean> {
  const guardada = porHost.get(host)
  if (guardada) return guardada
  const pedido = (async () => {
    const { data, error } = await supabaseClient.schema('publico').rpc('capacidades_opiniones_por_dominio', { host })
    if (error) throw new Error(error.message)
    const respuesta = comoObjeto(data)
    return respuesta?.estado === 'ok' && respuesta.opiniones === true
  })()
  porHost.set(host, pedido)
  pedido.catch(() => { if (porHost.get(host) === pedido) porHost.delete(host) })
  return pedido
}

// Solo para los tests: olvida lo leído.
export function reiniciarCapacidadOpiniones(): void {
  porHost.clear()
}

// --- Lectura pública (anon y authenticated) ---
export async function leerOpinionesProducto(host: string, productoId: string, cursor: CursorOpiniones | null = null, limite: number = TAMANO_TANDA_FICHA): Promise<PaginaOpiniones> {
  const respuesta = await llamar('opiniones_producto_por_dominio', {
    host,
    producto_id: productoId,
    desde_creada: cursor?.creada ?? null,
    desde_id: cursor?.id ?? null,
    limite: Math.min(Math.max(Math.trunc(limite), 1), 50),
  }, false)
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  const resumen = comoObjeto(respuesta.resumen)
  const cantidad = typeof resumen?.cantidad === 'number' ? resumen.cantidad : 0
  const promedio = typeof resumen?.promedio === 'number' ? resumen.promedio : null
  const filas = (Array.isArray(respuesta.filas) ? respuesta.filas : []).flatMap((cruda): OpinionPublica[] => {
    const fila = comoObjeto(cruda)
    const puntuacion = comoPuntuacion(fila?.puntuacion)
    if (!fila || !esIdValido(fila.id as string) || puntuacion === null) return []
    return [{
      id: fila.id as string,
      nombrePila: comoTexto(fila.nombre_pila) || 'Cliente',
      puntuacion,
      comentario: comoTexto(fila.comentario),
      fecha: comoTexto(fila.fecha).slice(0, 10),
      esMia: fila.es_mia === true,
    }]
  })
  return { resumen: { promedio, cantidad }, filas, siguiente: cursorDe(respuesta.siguiente) }
}

// --- Cuenta (authenticated) ---
export async function guardarOpinion(host: string, productoId: string, puntuacion: number, comentario: string): Promise<ResultadoGuardar> {
  const respuesta = await llamar('guardar_opinion_por_dominio', { host, producto_id: productoId, puntuacion, comentario })
  switch (respuesta.estado) {
    case 'ok': {
      const opinion = comoObjeto(respuesta.opinion)
      const guardada = comoPuntuacion(opinion?.puntuacion)
      if (!opinion || !esIdValido(opinion.id as string) || guardada === null) throw new ErrorCuentaTienda('error')
      return { estado: 'ok', opinion: { id: opinion.id as string, estado: comoEstado(opinion.estado), puntuacion: guardada, comentario: comoTexto(opinion.comentario) } }
    }
    case 'invalido': {
      const campos = (Array.isArray(respuesta.campos) ? respuesta.campos : []).filter((campo): campo is 'puntuacion' | 'comentario' => campo === 'puntuacion' || campo === 'comentario')
      return { estado: 'invalido', campos }
    }
    case 'limite_opiniones':
    case 'limite_pendientes':
    case 'no_encontrado':
      return { estado: respuesta.estado }
    case 'limite':
      return { estado: 'limite', esperaSegundos: typeof respuesta.espera_segundos === 'number' ? respuesta.espera_segundos : 60 }
    default:
      throw new ErrorCuentaTienda('error')
  }
}

// Borrar es idempotente: `ok` aunque no hubiera nada. `limite` = demasiadas llamadas.
export async function borrarOpinion(host: string, productoId: string): Promise<{ estado: 'ok' } | { estado: 'limite'; esperaSegundos: number }> {
  const respuesta = await llamar('borrar_opinion_por_dominio', { host, producto_id: productoId })
  if (respuesta.estado === 'ok') return { estado: 'ok' }
  if (respuesta.estado === 'limite') return { estado: 'limite', esperaSegundos: typeof respuesta.espera_segundos === 'number' ? respuesta.espera_segundos : 60 }
  throw new ErrorCuentaTienda('error')
}

export async function leerMisOpiniones(host: string, cursor: CursorOpiniones | null = null, limite: number = TAMANO_TANDA_MIS_OPINIONES): Promise<PaginaMisOpiniones> {
  const respuesta = await llamar('mis_opiniones_por_dominio', {
    host,
    desde_creada: cursor?.creada ?? null,
    desde_id: cursor?.id ?? null,
    limite: Math.min(Math.max(Math.trunc(limite), 1), 50),
  })
  if (respuesta.estado !== 'ok') throw new ErrorCuentaTienda('error')
  const filas = (Array.isArray(respuesta.filas) ? respuesta.filas : []).flatMap((cruda): MiOpinion[] => {
    const fila = comoObjeto(cruda)
    const puntuacion = comoPuntuacion(fila?.puntuacion)
    if (!fila || !esIdValido(fila.id as string) || !esIdValido(fila.producto_id as string) || puntuacion === null) return []
    return [{
      id: fila.id as string,
      productoId: fila.producto_id as string,
      productoNombre: comoTexto(fila.producto_nombre),
      puntuacion,
      comentario: comoTexto(fila.comentario),
      estado: comoEstado(fila.estado),
      motivoRechazo: typeof fila.motivo_rechazo === 'string' && fila.motivo_rechazo.trim() !== '' ? fila.motivo_rechazo : null,
      creadaEn: comoTexto(fila.creada_en),
      actualizadaEn: comoTexto(fila.actualizada_en),
    }]
  })
  return { total: typeof respuesta.total === 'number' ? respuesta.total : filas.length, filas, siguiente: cursorDe(respuesta.siguiente) }
}
