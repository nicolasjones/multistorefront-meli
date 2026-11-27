// Regla de proceso MSF-644: todo PR que cambia una pantalla del panel rehace las capturas del manual
// (`pnpm docs:capturas`, imágenes en docs/producto/img/<página>/). Lógica pura, sin efectos al importarse, que usa
// verificar-documentacion-cambios.mjs. Es un aviso: el script no ve la descripción del PR, donde se puede declarar
// que no corresponde, así que solo falla en modo estricto (CAPTURAS_MANUAL_ESTRICTO=1 o --capturas-estricto).
// Pantalla = `.tsx` bajo apps/web/src/pages/. No se distingue una pantalla de un componente auxiliar de esa carpeta
// sin analizar código (limitación declarada en docs/documentacion-cambios.md).
const PANTALLA = /^apps\/web\/src\/pages\/.+\.tsx$/s; // flag s: un nombre con salto de línea también es una pantalla
// Fuera: tests (.test/.spec), stories y carpetas de pruebas (__tests__, __snapshots__, test, tests, e2e).
const NO_PANTALLA = /(\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__snapshots__|test|tests|e2e)\/)/;
const CAPTURA = /^docs\/producto\/img\/.+\.(png|jpe?g|webp)$/is; // flag s: igual que PANTALLA, un nombre con salto de línea cuenta

export const pantallasCambiadas = (changed) => changed.filter((ruta) => PANTALLA.test(ruta) && !NO_PANTALLA.test(ruta));

export const hayCapturasCambiadas = (changed) => changed.some((ruta) => CAPTURA.test(ruta));

// Devuelve las pantallas que cambiaron sin que cambie ninguna captura del manual (lista vacía = cumple).
export const pantallasSinCaptura = (changed) => (hayCapturasCambiadas(changed) ? [] : pantallasCambiadas(changed));
