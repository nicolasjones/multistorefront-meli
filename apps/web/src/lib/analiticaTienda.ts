import { supabaseClient } from './supabase'

// F-TDA-24 (MSF-315, FR-012, FR-014…FR-016): medición de la tienda pública. Consulta los IDs de la tienda por su
// `Host` y, SOLO si hay consentimiento, carga los scripts oficiales de Google y de Meta. Los IDs se pasan siempre
// como datos (argumentos de `gtag`/`fbq` y parámetro codificado de la URL): jamás se arma código con ellos.
// Una falla de carga no afecta a la tienda ni se muestra. No incluye datos del visitante: los eventos llevan
// solo su nombre.

export type IdsMedicion = { ga4_id: string | null; meta_pixel_id: string | null }
export type EventoTienda = 'clic_whatsapp' | 'envio_contacto'

export const URL_GTAG = 'https://www.googletagmanager.com/gtag/js'
export const URL_PIXEL = 'https://connect.facebook.net/en_US/fbevents.js'

const idsVacios = (ids: IdsMedicion | null): boolean => !ids || (!ids.ga4_id && !ids.meta_pixel_id)

// `publico.analitica_por_dominio` es ejecutable por anon. `null` cubre host desconocido y empresa desactivada.
// Una falla se traga: sin IDs, la tienda sigue sin medición y sin ningún aviso.
export async function leerAnaliticaPublica(host: string): Promise<IdsMedicion | null> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('analitica_por_dominio', { host })
    if (error || !data) return null
    const ids = data as IdsMedicion
    return { ga4_id: ids.ga4_id ?? null, meta_pixel_id: ids.meta_pixel_id ?? null }
  } catch {
    return null
  }
}

// ¿Corresponde medir? Todas las condiciones juntas (FR-014): hay al menos un ID y la persona aceptó las cookies.
// «Tienda publicada» y «no es la vista previa» las garantiza dónde se monta el componente (solo el front público).
export function debeMedir(ids: IdsMedicion | null, consentimiento: 'aceptadas' | 'rechazadas' | null): boolean {
  return consentimiento === 'aceptadas' && !idsVacios(ids)
}

type VentanaMedicion = Window & {
  dataLayer?: unknown[]
  gtag?: (...args: unknown[]) => void
  fbq?: FbqPila
}
type FbqPila = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push: unknown
  loaded: boolean
  version: string
}

const ventana = (): VentanaMedicion => window as VentanaMedicion

let ga4Cargado: string | null = null
let pixelCargado: string | null = null

function agregarScript(src: string): void {
  try {
    const nodo = document.createElement('script')
    nodo.async = true
    nodo.src = src
    nodo.onerror = () => undefined // una falla de red no afecta a la tienda ni se muestra
    document.head.appendChild(nodo)
  } catch {
    // Sin DOM o bloqueado: no se mide y nada se rompe.
  }
}

function cargarGa4(id: string): void {
  if (ga4Cargado) return
  ga4Cargado = id
  const w = ventana()
  w.dataLayer = w.dataLayer ?? []
  // gtag.js exige empujar el objeto `arguments` (no un arreglo): es el contrato oficial de Google.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments)
  }
  w.gtag('js', new Date())
  // La visita se registra a mano en cada navegación (FR-015): se evita el page_view automático duplicado.
  w.gtag('config', id, { send_page_view: false })
  agregarScript(`${URL_GTAG}?id=${encodeURIComponent(id)}`)
}

function cargarPixel(id: string): void {
  if (pixelCargado) return
  pixelCargado = id
  const w = ventana()
  if (!w.fbq) {
    const pila = function fbq() {
      // eslint-disable-next-line prefer-rest-params
      if (pila.callMethod) pila.callMethod.apply(pila, arguments as unknown as unknown[])
      // eslint-disable-next-line prefer-rest-params
      else pila.queue.push(arguments)
    } as FbqPila
    pila.push = pila
    pila.loaded = true
    pila.version = '2.0'
    pila.queue = []
    w.fbq = pila
  }
  w.fbq('init', id)
  agregarScript(URL_PIXEL)
}

// Carga las herramientas que la empresa configuró (idempotente: una sola vez por visita).
export function cargarMedicion(ids: IdsMedicion): void {
  try {
    if (ids.ga4_id) cargarGa4(ids.ga4_id)
    if (ids.meta_pixel_id) cargarPixel(ids.meta_pixel_id)
  } catch {
    // Nunca rompe la tienda.
  }
}

export function hayMedicionCargada(): boolean {
  return ga4Cargado !== null || pixelCargado !== null
}

// Una visita de página (FR-015): se llama en cada cambio de ruta de la SPA. Sin medición cargada no hace nada.
export function registrarVisita(ruta: string): void {
  try {
    const w = ventana()
    if (ga4Cargado && w.gtag) w.gtag('event', 'page_view', { page_path: ruta })
    if (pixelCargado && w.fbq) w.fbq('track', 'PageView')
  } catch {
    // Silencioso.
  }
}

// Evento de la tienda (FR-016): solo el nombre, sin datos del visitante ni del mensaje. Nunca bloquea ni
// lanza; sin medición cargada es un no-op.
export function registrarEventoTienda(nombre: EventoTienda): void {
  try {
    const w = ventana()
    if (ga4Cargado && w.gtag) w.gtag('event', nombre)
    if (pixelCargado && w.fbq) w.fbq('trackCustom', nombre)
  } catch {
    // Silencioso.
  }
}

// Solo para pruebas: olvida lo cargado y limpia las globales y los scripts agregados.
export function reiniciarMedicionParaPruebas(): void {
  ga4Cargado = null
  pixelCargado = null
  const w = ventana()
  delete w.dataLayer
  delete w.gtag
  delete w.fbq
  document.querySelectorAll(`script[src^="${URL_GTAG}"], script[src="${URL_PIXEL}"]`).forEach((nodo) => nodo.remove())
}
