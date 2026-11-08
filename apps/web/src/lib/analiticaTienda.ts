import { consentimientoActual } from './consentimientoCookies'
import { supabaseClient } from './supabase'

// F-TDA-24 (MSF-315, FR-012, FR-014…FR-016): medición de la tienda pública. Consulta los IDs de la tienda por su
// `Host` y, SOLO si hay consentimiento, carga los scripts oficiales de Google y de Meta. Los IDs se pasan siempre
// como datos (argumentos de `gtag`/`fbq` y parámetro codificado de la URL): jamás se arma código con ellos.
// Una falla de carga no afecta a la tienda ni se muestra. No incluye datos del visitante: los eventos llevan
// solo su nombre.

export type IdsMedicion = { ga4_id: string | null; meta_pixel_id: string | null }
// RF-TDA-24-2: vista de producto, búsqueda, clic en WhatsApp y envío de contacto. Solo el nombre, nunca datos
// del visitante (tampoco el texto buscado).
export type EventoTienda = 'vista_producto' | 'busqueda' | 'clic_whatsapp' | 'envio_contacto'

export const URL_GTAG = 'https://www.googletagmanager.com/gtag/js'
export const URL_PIXEL = 'https://connect.facebook.net/en_US/fbevents.js'

// Mismos formatos que los CHECK de `tienda_analitica` (defensa en profundidad): un ID que no los cumpla nunca llega a
// una URL ni a `gtag`/`fbq`.
export const FORMATO_GA4 = /^G-[A-Z0-9]{4,20}$/
export const FORMATO_PIXEL = /^[0-9]{8,20}$/

const idsVacios = (ids: IdsMedicion | null): boolean => !ids || (!ids.ga4_id && !ids.meta_pixel_id)

// `publico.analitica_por_dominio` es ejecutable por anon. `null` cubre host desconocido y empresa desactivada.
// Una falla se traga: sin IDs, la tienda sigue sin medición y sin ningún aviso.
export async function leerAnaliticaPublica(host: string): Promise<IdsMedicion | null> {
  try {
    const { data, error } = await supabaseClient.schema('publico').rpc('analitica_por_dominio', { host })
    if (error || !data) return null
    const ids = data as Partial<Record<keyof IdsMedicion, unknown>>
    const ga4 = typeof ids.ga4_id === 'string' && FORMATO_GA4.test(ids.ga4_id) ? ids.ga4_id : null
    const pixel = typeof ids.meta_pixel_id === 'string' && FORMATO_PIXEL.test(ids.meta_pixel_id) ? ids.meta_pixel_id : null
    return { ga4_id: ga4, meta_pixel_id: pixel }
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

// IDs con los que se configuró la herramienta en esta visita; `*Activo` dice si hoy puede enviar.
let ga4Cargado: string | null = null
let pixelCargado: string | null = null
let ga4Activo = false
let pixelActivo = false

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

const consentimientoAceptado = (): boolean => consentimientoActual() === 'aceptadas'

function cargarGa4(id: string): void {
  const w = ventana()
  if (ga4Cargado === id) {
    // Ya configurado (p. ej. aceptó, revocó y volvió a aceptar): se reactiva sin descargar nada otra vez.
    delete (w as unknown as Record<string, unknown>)[`ga-disable-${id}`]
    w.gtag?.('consent', 'update', { analytics_storage: 'granted' })
    ga4Activo = true
    return
  }
  const hayScript = document.querySelector(`script[src^="${URL_GTAG}"]`) !== null
  if (ga4Cargado) (w as unknown as Record<string, unknown>)[`ga-disable-${ga4Cargado}`] = true // el ID anterior no sigue activo
  ga4Cargado = id
  ga4Activo = true
  w.dataLayer = w.dataLayer ?? []
  // gtag.js exige empujar el objeto `arguments` (no un arreglo): es el contrato oficial de Google.
  w.gtag =
    w.gtag ??
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments)
    }
  w.gtag('js', new Date())
  // La visita se registra a mano en cada navegación (FR-015): se evita el page_view automático duplicado.
  w.gtag('config', id, { send_page_view: false })
  if (!hayScript) agregarScript(`${URL_GTAG}?id=${encodeURIComponent(id)}`)
}

function cargarPixel(id: string): void {
  const w = ventana()
  if (pixelCargado === id) {
    w.fbq?.('consent', 'grant')
    pixelActivo = true
    return
  }
  const hayScript = document.querySelector(`script[src="${URL_PIXEL}"]`) !== null
  pixelCargado = id
  pixelActivo = true
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
  if (!hayScript) agregarScript(URL_PIXEL)
}

// Apaga la medición sin descargar los scripts (no se puede): GA4 con su interruptor oficial `ga-disable-ID` y el
// consentimiento denegado; Meta con `consent revoke`. Idempotente. Se vuelve a activar con `cargarMedicion`.
export function retirarMedicion(): void {
  try {
    const w = ventana()
    if (ga4Cargado && ga4Activo) {
      ;(w as unknown as Record<string, unknown>)[`ga-disable-${ga4Cargado}`] = true
      w.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' })
    }
    if (pixelCargado && pixelActivo) w.fbq?.('consent', 'revoke')
    ga4Activo = false
    pixelActivo = false
    pendientes.length = 0
  } catch {
    // Nunca rompe la tienda.
  }
}

// Sincroniza la medición con los IDs actuales (idempotente). Un ID nuevo reemplaza al anterior; un ID que ya no
// está (o inválido) se apaga. Sin consentimiento aceptado en este instante no carga nada.
export function cargarMedicion(ids: IdsMedicion): void {
  try {
    if (!consentimientoAceptado()) {
      retirarMedicion()
      return
    }
    const w = ventana()
    const ga4 = ids.ga4_id && FORMATO_GA4.test(ids.ga4_id) ? ids.ga4_id : null
    const pixel = ids.meta_pixel_id && FORMATO_PIXEL.test(ids.meta_pixel_id) ? ids.meta_pixel_id : null
    if (ga4) cargarGa4(ga4)
    else if (ga4Cargado && ga4Activo) {
      ;(w as unknown as Record<string, unknown>)[`ga-disable-${ga4Cargado}`] = true
      ga4Activo = false
    }
    if (pixel) cargarPixel(pixel)
    else if (pixelCargado && pixelActivo) {
      w.fbq?.('consent', 'revoke')
      pixelActivo = false
    }
    if (ga4Activo || pixelActivo) pendientes.splice(0).forEach(emitir)
  } catch {
    // Nunca rompe la tienda.
  }
}

export function hayMedicionCargada(): boolean {
  return ga4Activo || pixelActivo
}

// Una visita de página (FR-015): se llama en cada cambio de ruta de la SPA. Revisa el consentimiento ACTUAL en cada
// emisión; si se revocó apaga la medición. Sin medición cargada no hace nada.
export function registrarVisita(ruta: string): void {
  try {
    if (!consentimientoAceptado()) return retirarMedicion()
    const w = ventana()
    if (ga4Activo && w.gtag) w.gtag('event', 'page_view', { page_path: ruta })
    if (pixelActivo && pixelCargado && w.fbq) w.fbq('trackSingle', pixelCargado, 'PageView')
  } catch {
    // Silencioso.
  }
}

const pendientes: EventoTienda[] = []

function emitir(nombre: EventoTienda): void {
  const w = ventana()
  if (ga4Activo && w.gtag) w.gtag('event', nombre)
  if (pixelActivo && pixelCargado && w.fbq) w.fbq('trackSingleCustom', pixelCargado, nombre)
}

// Evento de la tienda (FR-016): solo el nombre, sin datos del visitante ni del mensaje. Nunca bloquea ni
// lanza; sin consentimiento vigente o sin medición cargada es un no-op.
export function registrarEventoTienda(nombre: EventoTienda): void {
  try {
    if (!consentimientoAceptado()) return retirarMedicion()
    if (!ga4Activo && !pixelActivo) {
      // La medición aún se está cargando (la ficha puede resolver antes que los IDs): el evento espera su turno.
      if (pendientes.length < 5) pendientes.push(nombre)
      return
    }
    emitir(nombre)
  } catch {
    // Silencioso.
  }
}

// Solo para pruebas: olvida lo cargado y limpia las globales y los scripts agregados.
export function reiniciarMedicionParaPruebas(): void {
  ga4Cargado = null
  pixelCargado = null
  ga4Activo = false
  pixelActivo = false
  pendientes.length = 0
  const w = ventana()
  for (const clave of Object.keys(w)) if (clave.startsWith('ga-disable-')) delete (w as unknown as Record<string, unknown>)[clave]
  delete w.dataLayer
  delete w.gtag
  delete w.fbq
  document.querySelectorAll(`script[src^="${URL_GTAG}"], script[src="${URL_PIXEL}"]`).forEach((nodo) => nodo.remove())
}
