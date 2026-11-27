// Regla de proceso MSF-644: todo PR que cambia una pantalla del panel rehace las capturas del manual
// (`pnpm docs:capturas`, imágenes en docs/producto/img/<página>/). Lógica pura que usa
// verificar-documentacion-cambios.mjs. Es un aviso: el script no ve la descripción del PR, donde se puede declarar
// que no corresponde, así que solo falla en modo estricto (CAPTURAS_MANUAL_ESTRICTO=1 o --capturas-estricto).
const PANTALLA = /^apps\/web\/src\/pages\/.+\.tsx$/;
const NO_PANTALLA = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__snapshots__|test|tests|e2e)\/)/;
const CAPTURA = /^docs\/producto\/img\/.+\.(png|jpe?g|webp)$/;

export const pantallasCambiadas = (changed) => changed.filter((ruta) => PANTALLA.test(ruta) && !NO_PANTALLA.test(ruta));

export const hayCapturasCambiadas = (changed) => changed.some((ruta) => CAPTURA.test(ruta));

// Devuelve las pantallas que cambiaron sin que cambie ninguna captura del manual (lista vacía = cumple).
export const pantallasSinCaptura = (changed) => (hayCapturasCambiadas(changed) ? [] : pantallasCambiadas(changed));
