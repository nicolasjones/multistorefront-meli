import type { Reparacion } from './reparaciones'
import { formatearFechaDocumento, type DatosTienda } from './documentosReparacion'
import { ZONA_QUIETA } from './qr/svg'

// Etiqueta con código QR del equipo (F-SVC-32, MSF-190). La URL que lleva el QR se arma SOLO acá, con una lista blanca
// de forma (FR-042, amenaza 3.1): nunca datos de cliente, serie, falla ni el token público de seguimiento (D-17).
// Todo lo demás de este archivo son medidas y preferencias de impresión.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Origen `http(s)://host[:puerto]` con host en ASCII (el navegador ya entrega el punycode), sin credenciales, ruta
// (salvo una barra final), query ni fragmento.
// El host es un nombre (`panel.example`, `mundojc.localhost`) o una dirección IPv6 entre corchetes (`[::1]`), como la
// entrega `window.location.origin`.
const ORIGEN = /^https?:\/\/([a-z0-9]([a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]{2,39}\])(:\d{1,5})?\/?$/i

export const RUTA_REPARACION = '/service-tecnico/reparaciones'

export function urlEtiquetaReparacion(origen: string, id: string): string {
  if (typeof origen !== 'string' || !ORIGEN.test(origen)) throw new Error('El origen de la etiqueta no es válido.')
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('El identificador de la reparación no es válido.')
  return `${origen.replace(/\/$/, '')}${RUTA_REPARACION}/${id}`
}

// Entorno de prueba (FR-049): el QR apuntaría a una dirección que otros equipos no alcanzan: `localhost`, cualquier
// `*.localhost`, `127.0.0.1` y el loopback IPv6 (`::1`, con o sin corchetes).
export function esEntornoDePrueba(nombreDeHost: string): boolean {
  const host = nombreDeHost.toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

export type ClaveTamano = 'chica' | 'mediana' | 'grande' | 'personalizada'

export type TamanoEtiqueta = { clave: ClaveTamano; nombre: string; ancho: number; alto: number }

export const TAMANOS_ETIQUETA: readonly TamanoEtiqueta[] = [
  { clave: 'chica', nombre: 'Chica · 40 × 25 mm', ancho: 40, alto: 25 },
  { clave: 'mediana', nombre: 'Mediana · 50 × 30 mm', ancho: 50, alto: 30 },
  { clave: 'grande', nombre: 'Grande · 70 × 40 mm', ancho: 70, alto: 40 },
  { clave: 'personalizada', nombre: 'Personalizada', ancho: 50, alto: 30 },
]

export const ANCHO_MINIMO_MM = 25
export const ANCHO_MAXIMO_MM = 100
export const ALTO_MINIMO_MM = 15
export const ALTO_MAXIMO_MM = 100
export const COPIAS_MINIMAS = 1
export const COPIAS_MAXIMAS = 10
export const CLAVE_PREFERENCIA = 'msf.service.etiqueta'

export const ERROR_ANCHO = 'Ingresá un ancho entre 25 y 100 mm.'
export const ERROR_ALTO = 'Ingresá un alto entre 15 y 100 mm.'
export const ERROR_COPIAS = 'Ingresá una cantidad entre 1 y 10.'

// `ancho` y `alto` son las medidas de «Personalizada» (se conservan aunque se elija otro tamaño).
export type PreferenciaEtiqueta = { tamano: ClaveTamano; ancho: number; alto: number }

export const PREFERENCIA_PREDETERMINADA: PreferenciaEtiqueta = { tamano: 'mediana', ancho: 50, alto: 30 }

const entero = (valor: unknown, minimo: number, maximo: number): number | null =>
  typeof valor === 'number' && Number.isInteger(valor) && valor >= minimo && valor <= maximo ? valor : null

export const anchoValido = (valor: number) => entero(valor, ANCHO_MINIMO_MM, ANCHO_MAXIMO_MM) !== null
export const altoValido = (valor: number) => entero(valor, ALTO_MINIMO_MM, ALTO_MAXIMO_MM) !== null
export const copiasValidas = (valor: number) => entero(valor, COPIAS_MINIMAS, COPIAS_MAXIMAS) !== null

const recortar = (valor: number, minimo: number, maximo: number) => Math.min(maximo, Math.max(minimo, Math.round(valor)))

// Medidas de un tamaño: los predefinidos llevan las suyas; «Personalizada», las de la preferencia.
export function medidasDeTamano(clave: ClaveTamano, personalizadas: { ancho: number; alto: number }): { ancho: number; alto: number } {
  if (clave === 'personalizada') return { ancho: personalizadas.ancho, alto: personalizadas.alto }
  const tamano = TAMANOS_ETIQUETA.find((t) => t.clave === clave) ?? TAMANOS_ETIQUETA[1]
  return { ancho: tamano.ancho, alto: tamano.alto }
}

// Lee la preferencia del navegador (FR-045, amenaza 3.8). Sin `localStorage`, bloqueado, corrupto o con un tamaño
// desconocido cae al predeterminado; las medidas personalizadas se recortan a los rangos permitidos.
export function leerPreferencia(almacen: Pick<Storage, 'getItem'> | null = almacenDelNavegador()): PreferenciaEtiqueta {
  try {
    const crudo = almacen?.getItem(CLAVE_PREFERENCIA)
    if (!crudo) return PREFERENCIA_PREDETERMINADA
    const dato: unknown = JSON.parse(crudo)
    if (typeof dato !== 'object' || dato === null) return PREFERENCIA_PREDETERMINADA
    const { tamano, ancho, alto } = dato as Record<string, unknown>
    if (!TAMANOS_ETIQUETA.some((t) => t.clave === tamano)) return PREFERENCIA_PREDETERMINADA
    if (typeof ancho !== 'number' || typeof alto !== 'number' || !Number.isFinite(ancho) || !Number.isFinite(alto)) return PREFERENCIA_PREDETERMINADA
    return { tamano: tamano as ClaveTamano, ancho: recortar(ancho, ANCHO_MINIMO_MM, ANCHO_MAXIMO_MM), alto: recortar(alto, ALTO_MINIMO_MM, ALTO_MAXIMO_MM) }
  } catch {
    return PREFERENCIA_PREDETERMINADA
  }
}

// Guarda la preferencia (solo tamaño y medidas, nunca la cantidad). Un fallo del almacén no rompe la pantalla.
export function guardarPreferencia(preferencia: PreferenciaEtiqueta, almacen: Pick<Storage, 'setItem'> | null = almacenDelNavegador()): void {
  try {
    almacen?.setItem(CLAVE_PREFERENCIA, JSON.stringify({ tamano: preferencia.tamano, ancho: preferencia.ancho, alto: preferencia.alto }))
  } catch {
    // Sin almacenamiento (modo privado, bloqueado o lleno): la etiqueta se imprime igual, solo no recuerda la elección.
  }
}

function almacenDelNavegador(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

// Disposición (P-4): horizontal (QR a la izquierda) si el ancho es al menos 1,25 veces el alto; si no, vertical.
export type Disposicion = 'horizontal' | 'vertical'

export function disposicionDe(ancho: number, alto: number): Disposicion {
  return ancho >= 1.25 * alto ? 'horizontal' : 'vertical'
}

export const MARGEN_MM = 1.5
// El QR nunca ocupa más del 60 % de la dimensión que comparte con el texto.
export const FRACCION_MAXIMA_QR = 0.6
export const MODULO_MINIMO_MM = 0.4

// Lado, en mm, del mayor cuadrado donde entra el QR (con su zona quieta) dejando un margen de 1,5 mm y lugar al texto.
export function ladoDelQrMm(ancho: number, alto: number): number {
  const libreAncho = ancho - 2 * MARGEN_MM
  const libreAlto = alto - 2 * MARGEN_MM
  return disposicionDe(ancho, alto) === 'horizontal' ? Math.min(libreAlto, libreAncho * FRACCION_MAXIMA_QR) : Math.min(libreAncho, libreAlto * FRACCION_MAXIMA_QR)
}

// Milímetros por módulo del símbolo (con zona quieta de 4 módulos por lado) en una etiqueta de `ancho` × `alto`.
export function mmPorModulo(ancho: number, alto: number, tamanoDelSimbolo: number): number {
  return ladoDelQrMm(ancho, alto) / (tamanoDelSimbolo + 2 * ZONA_QUIETA)
}

// FR-047: por debajo de 0,4 mm por módulo el QR no se lee de forma confiable. 0,4 exacto sí se permite.
export function etiquetaDemasiadoChica(ancho: number, alto: number, tamanoDelSimbolo: number): boolean {
  return mmPorModulo(ancho, alto, tamanoDelSimbolo) < MODULO_MINIMO_MM - 1e-9
}

export const TEXTO_DEMASIADO_CHICA = 'Con este tamaño el código QR queda demasiado chico para leerse. Probá con una etiqueta más grande.'
export const TEXTO_DIRECCION_LARGA = 'La dirección del panel es demasiado larga para el código QR.'
export const TEXTO_ENTORNO_DE_PRUEBA = 'Estás en un entorno de prueba: el QR apunta a esta dirección y no va a funcionar en otros equipos.'
export const TEXTO_ANULADA = 'La reparación está anulada: no se imprime etiqueta.'

// Lo único que lleva la etiqueta impresa (FR-044): código, tienda, equipo e ingreso. Se arma acá, con campos
// nombrados, para que ningún otro dato de la reparación (cliente, contacto, falla, serie, accesorios, técnico,
// importes) llegue a la hoja.
export type TextosEtiqueta = { codigo: string; tienda: string; equipo: string; ingreso: string }

export function textosDeEtiqueta(reparacion: Pick<Reparacion, 'codigo' | 'equipo' | 'modelo' | 'ingreso_en'>, tienda: Pick<DatosTienda, 'nombre'>): TextosEtiqueta {
  return {
    codigo: reparacion.codigo,
    tienda: tienda.nombre,
    equipo: `${reparacion.equipo} ${reparacion.modelo}`.trim(),
    ingreso: `Ingreso ${formatearFechaDocumento(reparacion.ingreso_en)}`,
  }
}

// Medidas (en mm) con las que se dibuja la hoja de la etiqueta. El componente las convierte a unidades de contenedor
// (`cqw`) para que la vista previa en pantalla y la impresión (donde la etiqueta mide exactamente ancho × alto) se vean igual.
export type DistribucionEtiqueta = {
  disposicion: Disposicion
  margen: number
  separacion: number
  lado: number
  fuenteCodigo: number
  fuenteTexto: number
}

const SEPARACION_MM = 1.5

export function distribucionDeEtiqueta(ancho: number, alto: number, longitudDelCodigo: number): DistribucionEtiqueta {
  const disposicion = disposicionDe(ancho, alto)
  const lado = ladoDelQrMm(ancho, alto)
  // Espacio que queda para el texto, a la derecha del QR (horizontal) o debajo de él (vertical).
  const anchoTexto = disposicion === 'horizontal' ? ancho - 2 * MARGEN_MM - lado - SEPARACION_MM : ancho - 2 * MARGEN_MM
  const altoTexto = disposicion === 'horizontal' ? alto - 2 * MARGEN_MM : alto - 2 * MARGEN_MM - lado - SEPARACION_MM
  // Cinco líneas de texto (código, tienda, dos de equipo, ingreso): la fuente base sale del espacio vertical libre.
  const fuenteTexto = Math.max(1, Math.min(alto * 0.095, altoTexto / 6.5, anchoTexto / 11))
  const fuenteCodigo = Math.max(fuenteTexto, Math.min(alto * 0.18, (altoTexto / 6.5) * 1.8, anchoTexto / (Math.max(longitudDelCodigo, 6) * 0.62)))
  return { disposicion, margen: MARGEN_MM, separacion: SEPARACION_MM, lado, fuenteCodigo, fuenteTexto }
}
