// Enlace de la ayuda al manual de producto (F-CFG-02, MSF-385).
//
// LA DIRECCIÓN DEL MANUAL VIVE SOLO EN ESTE ARCHIVO. Si el manual cambia de lugar se cambia `MANUAL_URL_POR_DEFECTO` o, sin
// tocar código, se define `VITE_MANUAL_URL` al construir la imagen. Las pantallas nunca llevan una dirección: solo dicen qué
// PÁGINA del manual les corresponde (`manualPorDestino.ts`).
//
// La dirección es una plantilla con `{pagina}`, que se reemplaza por el nombre de la página sin extensión (p. ej.
// `catalogo-productos`). Así sirve igual para archivos de GitHub (`…/{pagina}.md`) que para un sitio publicado
// (`https://manual.ejemplo.com/{pagina}/` o `…/{pagina}.html`).
export const MANUAL_URL_POR_DEFECTO = 'https://github.com/nicolasjones/multistorefront-meli/blob/main/docs/producto/{pagina}.md'

/** Página que se abre cuando la pantalla no tiene una propia: el índice del manual (`docs/producto/README.md`). */
export const PAGINA_INDICE_MANUAL = 'README'

const MARCA_PAGINA = '{pagina}'

/** Una plantilla es válida si es `http(s)` y trae `{pagina}`: una variable mal puesta no puede generar un `javascript:` ni un enlace roto. */
export function plantillaManualValida(plantilla: unknown): plantilla is string {
  return typeof plantilla === 'string' && /^https?:\/\//i.test(plantilla.trim()) && plantilla.includes(MARCA_PAGINA)
}

/** La plantilla vigente: `VITE_MANUAL_URL` si es válida; si no, la de por defecto (se avisa en consola para que se corrija). */
export function plantillaManual(configurada: string | undefined = import.meta.env.VITE_MANUAL_URL): string {
  const valor = typeof configurada === 'string' ? configurada.trim() : ''
  if (valor === '') return MANUAL_URL_POR_DEFECTO
  if (plantillaManualValida(valor)) return valor
  console.warn('VITE_MANUAL_URL no es válida (tiene que empezar con http(s):// y llevar {pagina}); se usa la dirección por defecto del manual.')
  return MANUAL_URL_POR_DEFECTO
}

/** Dirección de una página del manual (`pagina` sin extensión); sin página, el índice. */
export function urlManual(pagina?: string | null, plantilla: string = plantillaManual()): string {
  const nombre = pagina && pagina.trim() !== '' ? pagina.trim() : PAGINA_INDICE_MANUAL
  return plantilla.split(MARCA_PAGINA).join(encodeURIComponent(nombre))
}
