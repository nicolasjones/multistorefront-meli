// Medidas del contenedor de la tienda (prototipo `MJC_*`/`SJ_*`): el contenido mide 1200 px a escritorio, centrado, y a
// celular los márgenes laterales son de 14 px. El máximo suma el margen lateral de 16 px de cada lado (`md` en adelante)
// para que, desde 1232 px de ancho, el contenido sea justo de 1200 px.
export const ANCHO_MAXIMO_TIENDA = 1232
export const MARGEN_LATERAL_TIENDA = { xs: '14px', md: 2 } as const // estilos-sueltos: ok
