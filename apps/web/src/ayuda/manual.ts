// Enlace de la ayuda al manual de producto (F-CFG-02, MSF-385).
//
// LA DIRECCIÓN DEL MANUAL VIVE SOLO EN ESTE ARCHIVO. Si el manual cambia de lugar se cambia `MANUAL_URL_POR_DEFECTO` o, sin
// tocar código, se define `VITE_MANUAL_URL` al construir la imagen. Las pantallas nunca llevan una dirección: solo dicen qué
// PÁGINA del manual les corresponde (`manualPorDestino.ts`).
//
// La dirección es una plantilla con `{pagina}`, que se reemplaza por el nombre de la página sin extensión (p. ej.
// `catalogo-productos`). Así sirve igual para el sitio publicado (`https://…/producto/{pagina}/`, MkDocs con URLs de
// directorio) que para otro sitio o para los archivos de GitHub (`…/producto/{pagina}.md`). El ÍNDICE del manual es todo lo
// que está antes de `{pagina}` (la carpeta del manual), así que tampoco hay que configurarlo aparte.
//
// Por defecto, el sitio de documentación publicado hoy (MkDocs Material, `infra/docs`); lo sirve Traefik con autenticación básica.
export const MANUAL_URL_POR_DEFECTO = 'https://docs.212-90-120-53.sslip.io/producto/{pagina}/'

const MARCA_PAGINA = '{pagina}'

/** Una plantilla es válida si es `http(s)` y `{pagina}` está en la ruta (no en la consulta ni en el ancla): una variable mal puesta no puede generar un `javascript:` ni un enlace roto. */
export function plantillaManualValida(plantilla: unknown): plantilla is string {
  return typeof plantilla === 'string' && /^https?:\/\/[^?#]*\{pagina\}/i.test(plantilla.trim())
}

/** La plantilla vigente: `VITE_MANUAL_URL` si es válida; si no, la de por defecto (se avisa en consola para que se corrija). */
export function plantillaManual(configurada: string | undefined = import.meta.env.VITE_MANUAL_URL): string {
  const valor = typeof configurada === 'string' ? configurada.trim() : ''
  if (valor === '') return MANUAL_URL_POR_DEFECTO
  if (plantillaManualValida(valor)) return valor
  console.warn('VITE_MANUAL_URL no es válida (tiene que empezar con http(s):// y llevar {pagina} en la ruta); se usa la dirección por defecto del manual.')
  return MANUAL_URL_POR_DEFECTO
}

/** Dirección de una página del manual (`pagina` sin extensión); sin página, el índice (la carpeta del manual). */
export function urlManual(pagina?: string | null, plantilla: string = plantillaManual()): string {
  const nombre = pagina?.trim() ?? ''
  if (nombre === '') return plantilla.slice(0, plantilla.indexOf(MARCA_PAGINA))
  return plantilla.split(MARCA_PAGINA).join(encodeURIComponent(nombre))
}
