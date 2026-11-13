// Estilo ÚNICO para texto que solo leen los lectores de pantalla (anuncios `role="status"`, aclaraciones de un botón).
// Sirve en `sx` y en `style`. Las medidas van en `'1px'`: en `sx` de MUI un `1` suelto es 100 % del contenedor (no 1 px),
// y un elemento absoluto de ancho completo, aunque esté recortado con `clip`, ensancha el scroll horizontal de la página
// (a 320 px sobraban 16 px). El guardián `scripts/verificar-estilos-sueltos.mjs` prohíbe `width: 1` / `height: 1`.
export const SOLO_LECTORES = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const
