// PARCHE TEMPORAL: dos botones los dibuja `@refinedev/mui` 8.0.2 sin nombre accesible o con un nombre en inglés, y no
// ofrece props para cambiarlos. QUITAR al actualizar la librería si ya traen nombre en español.
//  - «contraer» del encabezado de `ThemedSider` (dist/index.mjs:1022): IconButton fijo sin `aria-label` (axe: `button-name`).
//  - hamburguesa de `HamburgerMenu`: `aria-label="open drawer"`.
// Se aplican desde un hijo de cada componente propio (`SiderPanel`, `EncabezadoPanel`), así que se repiten solos si el
// componente se remonta. Sin observador: un efecto por montaje y por cambio de `collapsed`.
const ETIQUETA_CONTRAER = 'Contraer el menú lateral'
const ETIQUETA_ABRIR = 'Abrir el menú lateral'

export function etiquetarBotonContraer(raiz: ParentNode = document): void {
  try {
    raiz.querySelectorAll('[data-testid="ChevronLeftIcon"]').forEach((icono) => {
      icono.closest('button:not([aria-label]):not([aria-labelledby])')?.setAttribute('aria-label', ETIQUETA_CONTRAER)
    })
  } catch {
    // Un navegador sin esos selectores solo se queda sin la etiqueta: nunca tumba el panel.
  }
}

export function etiquetarHamburguesa(raiz: ParentNode = document): void {
  try {
    raiz.querySelectorAll('button[aria-label="open drawer"]').forEach((boton) => boton.setAttribute('aria-label', ETIQUETA_ABRIR))
  } catch {
    // Silencioso: ver arriba.
  }
}
