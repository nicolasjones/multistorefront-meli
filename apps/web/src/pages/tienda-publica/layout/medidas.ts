// Medidas del contenedor de la tienda (prototipo `MJC_*`/`SJ_*`): el contenido mide 1200 px a escritorio, centrado, y a
// celular los márgenes laterales son de 14 px. El máximo suma el margen lateral de 16 px de cada lado (`md` en adelante)
// para que, desde 1232 px de ancho, el contenido sea justo de 1200 px.
export const ANCHO_MAXIMO_TIENDA = 1232
export const MARGEN_LATERAL_TIENDA = { xs: '14px', md: 2 } as const // estilos-sueltos: ok

// Bordes del prototipo repetidos en toda la tienda: línea suave (separadores, tarjetas), borde de campo (1,5 px) y borde de
// paneles flotantes (sugerencias, menús).
export const LINEA_SUAVE = '1px solid rgba(0,0,0,.08)' // estilos-sueltos: ok
export const BORDE_CAMPO = '1.5px solid rgba(0,0,0,.18)' // estilos-sueltos: ok
export const BORDE_PANEL = '1px solid rgba(0,0,0,.12)' // estilos-sueltos: ok
