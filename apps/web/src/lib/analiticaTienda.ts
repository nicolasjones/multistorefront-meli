import { consentimientoActual } from './consentimientoCookies'
import { supabaseClient } from './supabase'

// F-TDA-24 (MSF-315, FR-012, FR-014…FR-016): medición de la tienda pública. Consulta los IDs de la tienda por su
// `Host` y, SOLO si hay consentimiento, carga los scripts oficiales de Google y de Meta. Los IDs se pasan siempre
// como datos (argumentos de `gtag`/`fbq` y parámetro codificado de la URL): jamás se arma código con ellos.
// Una falla de carga (p. ej. un bloqueador de anuncios) no afecta a la tienda ni se muestra, y deja la herramienta
// apagada sin acumular eventos.
//
// Datos del visitante: los eventos propios llevan solo su nombre. Además se apagan las funciones AUTOMÁTICAS de
// Meta Pixel que leen la página por su cuenta (`autoConfig` = coincidencia avanzada automática, clics de botón y
// metadatos de microdatos): sin eso el píxel hashea y envía email/teléfono/nombre de los formularios de contacto
// aunque este código no los pase. Google Analytics 4 con «Mediciones mejoradas» activa en la propiedad envía
// por su cuenta page_view en cambios del historial y eventos de formularios/clics: eso se apaga en la propiedad
// de GA4 (ver docs/producto/tienda-contenido-y-analitica.md), no se puede forzar desde la tienda.
//
// Revocar el consentimiento: se apaga el envío, se borran las cookies de medición (dominio actual y dominios
// padre), se quitan los scripts y las globales (`dataLayer`, `gtag`, `fbq`, `_fbq`) y, si no se pierde nada de lo que
// la persona está haciendo, se recarga la página para descargar de memoria los scripts de terceros.

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
// Herramienta cuyo script no pudo descargarse (bloqueador de anuncios, red): no se reintenta en esta visita.
let ga4Bloqueado: string | null = null
let pixelBloqueado: string | null = null
// Hubo scripts de terceros evaluados en esta página que siguen en memoria hasta recargar.
let scriptsEnMemoria = false
// Scripts pedidos que aún no cargaron ni fallaron. Quitar su nodo no cancela la descarga: si llegan después de una
// revocación se evalúan igual, así que al revocar cuentan como «en memoria» (se recarga o se deja apagado).
let enVuelo = 0
// IDs de la última sincronización pedida y recarga/reanudación diferida hasta que sea seguro.
let ultimosIds: IdsMedicion | null = null
let reintentoArmado = false
// Cada herramienta pidió su script en esta página (en vuelo o evaluado): solo recargar lo descarga de memoria.
let pixelEnMemoria = false
// Reintento pendiente (lo arma `armarReintento`): lo llaman los eventos, el temporizador y los cambios de ruta.
let reintentarAhora: (() => void) | null = null
let desarmarReintento: (() => void) | null = null
const INTERVALO_REINTENTO_MS = 5000

// Acciones del navegador que las pruebas reemplazan (jsdom no navega).
export const accionesPagina = { recargar: (): void => window.location.reload() }

function agregarScript(src: string, alFallar: () => void, alLlegarTarde: () => void = () => undefined): void {
  try {
    enVuelo++
    let resuelto = false
    const resolver = () => {
      if (!resuelto) enVuelo = Math.max(0, enVuelo - 1)
      resuelto = true
    }
    const nodo = document.createElement('script')
    nodo.async = true
    nodo.src = src
    // Solo un script que se descargó y evaluó queda en memoria (y justifica una recarga al revocar).
    nodo.onload = () => {
      resolver()
      scriptsEnMemoria = true
      try {
        if (!consentimientoAceptado()) {
          // Se evaluó tras una revocación: no corresponde. Se deja inerte y, si es seguro, se recarga.
          quitarGlobales('dataLayer', 'gtag', 'fbq', '_fbq', 'google_tag_manager', 'google_tag_data')
          borrarCookies(COOKIES_GOOGLE)
          borrarCookies(COOKIES_META)
          borrarAlmacenamiento(ALMACENAMIENTO_GOOGLE)
          borrarAlmacenamiento(ALMACENAMIENTO_META)
        } else {
          // Con consentimiento vigente pero de un ID que ya no es el vigente (reemplazado en la misma visita).
          alLlegarTarde()
        }
      } catch {
        // Un fallo al limpiar no puede perder el reintento de abajo.
      }
      if (!consentimientoAceptado() && !recargarSiSeguro()) armarReintento()
    }
    nodo.onerror = () => {
      resolver()
      // Una falla de red o un bloqueador no afecta a la tienda ni se muestra: la herramienta queda apagada.
      try {
        alFallar()
      } catch {
        // Silencioso.
      }
    }
    document.head.appendChild(nodo)
  } catch {
    // Sin DOM o bloqueado: no se mide y nada se rompe.
  }
}

const COOKIES_GOOGLE = /^(_ga|_ga_[A-Za-z0-9]+|_gid|_gat(_.+)?|_gcl_[a-z]+)$/
const COOKIES_META = /^(_fbp|_fbc)$/

// Dominios donde pudo haberse escrito una cookie: el host actual y cada dominio padre con al menos dos etiquetas.
// Sufijos públicos de dos niveles frecuentes (el navegador rechaza cookies con `domain=` igual a uno de ellos).
const SUFIJOS_PUBLICOS = new Set([
  'com.ar', 'net.ar', 'org.ar', 'gob.ar', 'gov.ar', 'edu.ar', 'int.ar', 'mil.ar', 'tur.ar',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.br', 'net.br', 'org.br', 'com.mx', 'org.mx', 'com.uy', 'com.co',
  'com.pe', 'com.cl', 'com.py', 'com.bo', 'com.ec', 'com.ve', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp',
])

export function dominiosCookie(host: string = window.location.hostname): Array<string | null> {
  const dominios: Array<string | null> = [null]
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return dominios
  const partes = host.split('.')
  for (let i = 0; i <= partes.length - 2; i++) {
    const candidato = partes.slice(i).join('.')
    if (!SUFIJOS_PUBLICOS.has(candidato)) dominios.push(candidato)
  }
  return dominios
}

function borrarCookies(patron: RegExp): void {
  const nombres = document.cookie
    .split(';')
    .map((trozo) => trozo.split('=')[0].trim())
    .filter((nombre) => patron.test(nombre))
  for (const nombre of nombres) {
    for (const dominio of dominiosCookie()) {
      document.cookie = `${nombre}=; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${dominio ? `; domain=${dominio}` : ''}`
    }
  }
}

const quitarGlobales = (...claves: string[]): void => {
  const w = ventana() as unknown as Record<string, unknown>
  for (const clave of claves) delete w[clave]
}

const quitarScripts = (selector: string): void => {
  document.querySelectorAll(selector).forEach((nodo) => nodo.remove())
}

// Claves de `localStorage` / `sessionStorage` que dejan Google y Meta, por proveedor y ancladas al final (nunca la
// decisión de cookies de la tienda ni claves de la app como `_galeria` o `fbqueue`).
const ALMACENAMIENTO_GOOGLE = /^(_ga(_|$)|_gid$|_gat(_|$)|_gcl_|__gads$|__gpi$|__eoi$|google_experiment_mod$)/
const ALMACENAMIENTO_META = /^(_fbp$|_fbc$|_fbq$|fbevents$|fbq$)/

function borrarAlmacenamiento(patron: RegExp): void {
  for (const almacen of ['localStorage', 'sessionStorage'] as const) {
    try {
      const memoria = window[almacen]
      for (const clave of Object.keys(memoria)) if (patron.test(clave)) memoria.removeItem(clave)
    } catch {
      // Almacenamiento bloqueado: nada que limpiar.
    }
  }
}

// Apaga Google Analytics: el interruptor oficial `ga-disable-ID` queda puesto (aunque el script ya evaluado siga en
// memoria no envía), consentimiento denegado, cookies fuera, script y globales quitados.
function apagarGa4(): void {
  const w = ventana()
  if (ga4Cargado) {
    ;(w as unknown as Record<string, unknown>)[`ga-disable-${ga4Cargado}`] = true
    if (ga4Activo) w.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' })
  }
  borrarCookies(COOKIES_GOOGLE)
  borrarAlmacenamiento(ALMACENAMIENTO_GOOGLE)
  quitarScripts(`script[src^="${URL_GTAG}"]`)
  quitarGlobales('dataLayer', 'gtag', 'google_tag_manager', 'google_tag_data')
  ga4Cargado = null
  ga4Activo = false
}

// Apaga Meta Pixel: `consent revoke`, cookies fuera, script y globales quitados.
function apagarPixel(): void {
  if (pixelCargado && pixelActivo) ventana().fbq?.('consent', 'revoke')
  borrarCookies(COOKIES_META)
  borrarAlmacenamiento(ALMACENAMIENTO_META)
  quitarScripts(`script[src="${URL_PIXEL}"]`)
  quitarGlobales('fbq', '_fbq')
  pixelCargado = null
  pixelActivo = false
}

// ¿Se puede recargar sin que la persona pierda algo? No si la pestaña está en segundo plano (se difiere hasta que vuelva),
// hay un campo de texto con contenido, un `select` cambiado respecto de lo inicial (variante, filtro), un campo
// `contenteditable`, el foco dentro de un campo o de un diálogo, o un diálogo abierto.
function recargaSegura(): boolean {
  if (document.hidden) return false
  const campos = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea',
  )
  for (const campo of Array.from(campos)) if (campo.value.trim() !== '') return false
  for (const lista of Array.from(document.querySelectorAll('select'))) {
    if (Array.from(lista.options).some((opcion) => opcion.selected !== opcion.defaultSelected)) return false
  }
  for (const marca of Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]'))) {
    if (marca.checked !== marca.defaultChecked) return false
  }
  if (document.querySelector('[contenteditable=""], [contenteditable="true"]') !== null) return false
  const enfocado = document.activeElement
  if (enfocado && enfocado !== document.body && enfocado.matches('input, textarea, select, [contenteditable], [role="dialog"] *')) return false
  return document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]') === null
}

// Descarta de memoria los scripts de terceros ya evaluados recargando la página, solo si no hay nada que perder.
function recargarSiSeguro(): boolean {
  if (!(scriptsEnMemoria || pixelEnMemoria) || !recargaSegura()) return false
  scriptsEnMemoria = false
  pixelEnMemoria = false
  enVuelo = 0
  accionesPagina.recargar()
  return true
}

// Si no era seguro recargar, se reintenta cuando la persona suelta un campo hacia algo que no es otro campo
// (`focusout`), vuelve a la pestaña (`visibilitychange`), cambia de ruta de la SPA o, como red de seguridad, cada 5 s
// mientras la pestaña esté visible (por ejemplo, un diálogo que se cierra sin mover el foco). Con consentimiento
// vigente retoma la carga; sin él, recarga para soltar los scripts. Se cancela al recargar o al resolverse.
function armarReintento(): void {
  if (reintentoArmado || typeof document === 'undefined') return
  reintentoArmado = true
  const reintentar = (evento?: Event) => {
    if (evento?.type === 'focusout') {
      // Pasar de un campo a otro (o dentro de un formulario o diálogo) no es soltar el foco.
      const destino = (evento as FocusEvent).relatedTarget as Element | null
      if (destino?.closest?.('input, textarea, select, [contenteditable], form, [role="dialog"], [role="alertdialog"], dialog')) return
    }
    if (document.hidden && evento?.type !== 'visibilitychange') return
    if (!scriptsEnMemoria && !pixelEnMemoria) return desarmar()
    if (consentimientoAceptado()) {
      if (ultimosIds) cargarMedicion(ultimosIds)
    } else {
      recargarSiSeguro()
    }
    if (!scriptsEnMemoria && !pixelEnMemoria) desarmar()
  }
  const temporizador = window.setInterval(() => reintentar(), INTERVALO_REINTENTO_MS)
  const desarmar = () => {
    document.removeEventListener('visibilitychange', reintentar)
    document.removeEventListener('focusout', reintentar)
    window.clearInterval(temporizador)
    reintentarAhora = null
    desarmarReintento = null
    reintentoArmado = false
  }
  desarmarReintento = desarmar
  reintentarAhora = () => reintentar()
  document.addEventListener('visibilitychange', reintentar)
  document.addEventListener('focusout', reintentar)
}

const consentimientoAceptado = (): boolean => consentimientoActual() === 'aceptadas'

function cargarGa4(id: string): void {
  const w = ventana()
  if (ga4Bloqueado === id) return // su script no se pudo descargar: no se reintenta ni se acumulan eventos
  if (ga4Cargado === id) {
    // Ya configurado y vigente: se reactiva sin descargar nada otra vez.
    delete (w as unknown as Record<string, unknown>)[`ga-disable-${id}`]
    w.gtag?.('consent', 'update', { analytics_storage: 'granted' })
    ga4Activo = true
    return
  }
  // Otro ID en la misma visita: el script `gtag/js?id=` ya cargado es el del ID anterior, así que se descarga junto
  // con su `dataLayer` y se empieza de cero con el ID nuevo.
  if (ga4Cargado) apagarGa4()
  delete (w as unknown as Record<string, unknown>)[`ga-disable-${id}`]
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
  if (document.querySelector(`script[src^="${URL_GTAG}"]`) === null) {
    agregarScript(
      `${URL_GTAG}?id=${encodeURIComponent(id)}`,
      () => {
        if (ga4Cargado !== id) return
        ga4Bloqueado = id
        apagarGa4()
      },
      () => {
        // Llegó tarde un script de un ID que ya no es el vigente: queda inerte (sin tocar las globales del ID nuevo).
        if (ga4Cargado === id) return
        ;(ventana() as unknown as Record<string, unknown>)[`ga-disable-${id}`] = true
        borrarCookies(new RegExp(`^_ga_${id.slice(2)}$`))
      },
    )
  }
}

function cargarPixel(id: string): void {
  const w = ventana()
  if (pixelBloqueado === id) return
  if (pixelCargado === id) {
    w.fbq?.('consent', 'grant')
    pixelActivo = true
    return
  }
  // `fbevents.js` ya se pidió en esta página y no se puede descargar de memoria (se quitó y se volvió a agregar el ID):
  // no se inyecta otra copia, se espera a poder recargar.
  if (pixelEnMemoria && !pixelCargado) {
    if (!recargarSiSeguro()) armarReintento()
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
  // Sin funciones automáticas (coincidencia avanzada, clics de botón, metadatos): ANTES de `init`, y `init` sin
  // datos del visitante. Meta solo recibe los eventos que este código emite, con su nombre.
  w.fbq('set', 'autoConfig', false, id)
  w.fbq('init', id, {})
  if (!hayScript) {
    pixelEnMemoria = true
    agregarScript(URL_PIXEL, () => {
      pixelEnMemoria = false // nunca se evaluó
      if (pixelCargado !== id) return
      pixelBloqueado = id
      apagarPixel()
    })
  }
}

// Apaga la medición y borra sus huellas: GA4 con su interruptor oficial `ga-disable-ID` y el consentimiento
// denegado; Meta con `consent revoke`; cookies de medición fuera (dominio actual y padres); scripts y globales
// quitados. Los scripts ya evaluados siguen en memoria (no hay forma de descargarlos): quedan inertes y, si no hay
// nada que perder (formularios con texto, diálogos abiertos), la página se recarga para soltarlos. Idempotente. Se
// vuelve a activar con `cargarMedicion`.
export function retirarMedicion(): void {
  try {
    apagarGa4()
    apagarPixel()
    pendientes.length = 0
    if (enVuelo > 0) scriptsEnMemoria = true
    if (scriptsEnMemoria && !recargarSiSeguro()) armarReintento()
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
    // Se aceptó de nuevo tras una revocación que no pudo recargar la página: se recarga para empezar sin scripts viejos.
    ultimosIds = ids
    if (!ga4Cargado && !pixelCargado && scriptsEnMemoria) {
      if (recargarSiSeguro()) return
      // Hay scripts viejos evaluados y no se puede recargar todavía: no se carga nada encima (podría haber doble envío).
      // La medición queda apagada y se reintenta cuando sea seguro.
      armarReintento()
      return
    }
    const ga4 = ids.ga4_id && FORMATO_GA4.test(ids.ga4_id) ? ids.ga4_id : null
    const pixel = ids.meta_pixel_id && FORMATO_PIXEL.test(ids.meta_pixel_id) ? ids.meta_pixel_id : null
    if (ga4) cargarGa4(ga4)
    else if (ga4Cargado) apagarGa4()
    if (pixel) cargarPixel(pixel)
    else if (pixelCargado) apagarPixel()
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
    reintentarAhora?.() // cambio de ruta de la SPA: oportunidad de completar una recarga pendiente
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
  ga4Bloqueado = null
  pixelBloqueado = null
  scriptsEnMemoria = false
  enVuelo = 0
  ultimosIds = null
  pixelEnMemoria = false
  desarmarReintento?.()
  reintentoArmado = false
  accionesPagina.recargar = (): void => window.location.reload()
  pendientes.length = 0
  const w = ventana()
  for (const clave of Object.keys(w)) if (clave.startsWith('ga-disable-')) delete (w as unknown as Record<string, unknown>)[clave]
  delete w.dataLayer
  delete w.gtag
  delete w.fbq
  quitarGlobales('_fbq', 'google_tag_manager', 'google_tag_data')
  document.querySelectorAll(`script[src^="${URL_GTAG}"], script[src="${URL_PIXEL}"]`).forEach((nodo) => nodo.remove())
}
