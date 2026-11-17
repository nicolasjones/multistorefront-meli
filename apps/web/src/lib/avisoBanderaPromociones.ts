// MSF-937 (S6 de MSF-816): aviso en el mostrador cuando la bandera `promociones_precio` cambió con una venta abierta.
// Es solo de interfaz: la base ya rechaza una vez con `precios_cambiaron` al confirmar (ver docs/ventas-comprobantes.md).

export const MENSAJE_PROMOCIONES_ACTIVADAS =
  'Las promociones de precio se activaron mientras esta venta estaba abierta. Revisá los precios y volvé a guardar las líneas; si al confirmar aparece «los precios cambiaron», es lo esperado.'
export const MENSAJE_PROMOCIONES_DESACTIVADAS =
  'Las promociones de precio se desactivaron mientras esta venta estaba abierta. Las líneas conservan su precio promocional hasta que se vuelvan a guardar: revisá los precios antes de cobrar.'

// `alAbrir`: valor de la bandera visto cuando se abrió la venta; `actual`: la última lectura. `null` = sin lectura
// (no se avisa por una lectura que falló: ante la duda no se inventa un cambio).
export function avisoCambioBandera(alAbrir: boolean | null, actual: boolean | null): string | null {
  if (alAbrir === null || actual === null || alAbrir === actual) return null
  return actual ? MENSAJE_PROMOCIONES_ACTIVADAS : MENSAJE_PROMOCIONES_DESACTIVADAS
}
