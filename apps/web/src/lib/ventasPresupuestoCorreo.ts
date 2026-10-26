import { supabaseClient } from './supabase'
import {
  ErrorDocumento,
  MENSAJE_ERROR_IMPRESION,
  esperarDocumento,
  solicitarDocumento,
  urlFirmadaDocumento,
  type DocumentoComprobante,
} from './ventasImpresion'
import { registrarImpresion } from './ventasImpresiones'

// Presupuesto en PDF y envío por correo (F-VTA-20, MSF-245). La autoridad es la base: `solicitar_documento_comprobante`
// (tipo `presupuesto`) y `enviar_presupuesto_correo` validan permiso, estado y cliente; el envío lo hace el flow
// `comprobantes-correo` de Kestra. Acá solo se decide qué se ofrece, se consulta el avance y se abre el PDF.
// Contrato en docs/ventas-impresion.md.

export type EstadoEnvioCorreo = 'pendiente' | 'enviado' | 'fallido'

export type EnvioCorreoPresupuesto = {
  id: string
  comprobante_id: string
  empresa_id: string
  documento_id: string
  destinatario: string
  estado: EstadoEnvioCorreo
  error: string | null
  solicitado_en: string
  enviado_en: string | null
}

// Consulta del avance del envío: cada 2 s y hasta 3 min (el PDF puede estar generándose y después sale el correo).
// Pasado el tope se avisa y se ofrece «Reintentar» (pedir de nuevo devuelve el mismo envío pendiente: es idempotente).
export const INTERVALO_ENVIO_MS = 2000
export const TOPE_ENVIO_MS = 180_000

export const ETIQUETA_ENVIAR_CORREO = 'Enviar por correo'
export const MENSAJE_ENVIANDO = 'Enviando por correo…'
export const MENSAJE_ERROR_ENVIO = 'No pudimos enviar el presupuesto por correo. Probá de nuevo.'
export const MENSAJE_ENVIO_TARDA = 'El envío está tardando más de lo esperado. Reintentá en un momento.'
export const MENSAJE_ERROR_MARCA_ENVIO = 'No pudimos cargar los envíos por correo.'

export const mensajeEnviadoAImprimir = (numero: string) => `Enviado a imprimir · ${numero}`
export const mensajeEnviadoPorCorreo = (numero: string) => `Presupuesto ${numero} enviado por correo`

const formatoMarca = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
})

// «Presupuesto enviado por correo · 07/10 11:42» (hora de Buenos Aires); sin envío, solo el texto (casilla vacía).
export function textoMarcaEnvio(envio: Pick<EnvioCorreoPresupuesto, 'enviado_en'> | undefined): string {
  const base = 'Presupuesto enviado por correo'
  const fecha = envio?.enviado_en ? new Date(envio.enviado_en) : null
  if (!fecha || Number.isNaN(fecha.getTime())) return base
  const partes = formatoMarca.formatToParts(fecha)
  const buscar = (tipo: string) => (partes.find((parte) => parte.type === tipo)?.value ?? '').padStart(2, '0')
  return `${base} · ${buscar('day')}/${buscar('month')} ${buscar('hour')}:${buscar('minute')}`
}

type ErrorDeBase = { code?: string; message?: string; hint?: string } | null

// Mensajes de la base (ya en castellano y sin nombres técnicos) o uno genérico; el detalle va a la consola.
export function mensajeDeErrorEnvio(error: unknown): string {
  if (error instanceof ErrorDocumento) return error.message
  console.error(MENSAJE_ERROR_ENVIO, error)
  const e = error as ErrorDeBase
  if (e?.code === '42501') return 'No tenés permiso para enviar presupuestos de esta tienda. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === 'P0002') return 'Ese presupuesto no existe o no pertenece a tu organización.'
  if ((e?.code === '22023' || (e?.code === 'P0001' && e.hint === 'sin_conexion')) && e.message) return e.message
  return MENSAJE_ERROR_ENVIO
}

function aEnvio(dato: unknown): EnvioCorreoPresupuesto {
  if (typeof dato !== 'object' || dato === null) throw new Error('La base no devolvió el envío')
  return dato as EnvioCorreoPresupuesto
}

export async function enviarPresupuestoCorreo(comprobanteId: string): Promise<EnvioCorreoPresupuesto> {
  const { data, error } = await supabaseClient.rpc('enviar_presupuesto_correo', { p_comprobante_id: comprobanteId })
  if (error) throw error
  return aEnvio(data)
}

export async function listarEnviosCorreo(comprobanteId: string): Promise<EnvioCorreoPresupuesto[]> {
  const { data, error } = await supabaseClient.rpc('listar_envios_correo_presupuesto', { p_comprobante_id: comprobanteId })
  if (error) throw error
  return Array.isArray(data) ? (data as EnvioCorreoPresupuesto[]) : []
}

// El último envío realmente enviado (la lista viene del más reciente al más viejo).
export const ultimoEnvioEnviado = (envios: ReadonlyArray<EnvioCorreoPresupuesto>) => envios.find((e) => e.estado === 'enviado')

function dormir(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    if (signal?.aborted) return rechazar(new DOMException('Cancelado', 'AbortError'))
    const temporizador = setTimeout(() => {
      signal?.removeEventListener('abort', alAbortar)
      resolver()
    }, ms)
    const alAbortar = () => {
      clearTimeout(temporizador)
      rechazar(new DOMException('Cancelado', 'AbortError'))
    }
    signal?.addEventListener('abort', alAbortar, { once: true })
  })
}

type OpcionesEspera = {
  intervaloMs?: number
  topeMs?: number
  signal?: AbortSignal
  // Inyectable para probar el avance sin esperar de verdad.
  esperar?: (ms: number, signal?: AbortSignal) => Promise<void>
}

// Pide el envío y consulta hasta que quede `enviado` (lo devuelve) o `fallido` (lanza con el motivo sanitizado).
// Pasado el tope lanza «tarda más de lo esperado». Cancelable: cambiar de empresa o salir de la pantalla aborta.
export async function enviarYEsperar(comprobanteId: string, opciones: OpcionesEspera = {}): Promise<EnvioCorreoPresupuesto> {
  const { intervaloMs = INTERVALO_ENVIO_MS, topeMs = TOPE_ENVIO_MS, signal, esperar = dormir } = opciones
  let envio = await enviarPresupuestoCorreo(comprobanteId)
  const consultas = Math.max(1, Math.ceil(topeMs / intervaloMs))
  for (let consulta = 1; consulta <= consultas; consulta++) {
    if (envio.estado === 'enviado') return envio
    if (envio.estado === 'fallido') throw new ErrorDocumento(envio.error || MENSAJE_ERROR_ENVIO)
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
    if (consulta === consultas) break
    await esperar(intervaloMs, signal)
    const actual = (await listarEnviosCorreo(comprobanteId)).find((e) => e.id === envio.id)
    if (actual) envio = actual
  }
  throw new ErrorDocumento(MENSAJE_ENVIO_TARDA)
}

// Imprimir desde una fila de Presupuestos (FR-022): pide el PDF, espera que esté, lo firma y registra la impresión
// (F-VTA-21, FR-034: solo con el documento ya disponible). Devuelve la URL para abrirlo.
export async function prepararImpresionPresupuesto(
  comprobanteId: string,
  signal?: AbortSignal,
): Promise<{ documento: DocumentoComprobante; url: string }> {
  let documento = await solicitarDocumento(comprobanteId, 'presupuesto')
  if (documento.estado !== 'generado') documento = await esperarDocumento(documento.id, { signal })
  if (!documento.ruta) throw new ErrorDocumento(MENSAJE_ERROR_IMPRESION)
  const url = await urlFirmadaDocumento(documento.ruta)
  await registrarImpresion(documento.id)
  return { documento, url }
}
