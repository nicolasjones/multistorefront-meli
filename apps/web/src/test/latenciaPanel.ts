// Presupuestos de latencia percibida para toda ruta principal del panel
// (spec 018-kit-panel-operable) — feedback visual (skeleton, vacío o error,
// nunca una pantalla en blanco) antes de LATENCIA_FEEDBACK_MS, y contenido,
// vacío o error definitivo antes de LATENCIA_CONTENIDO_MS. El iframe externo
// de Superset (Analítica) queda afuera: su tiempo de carga lo controla
// Superset, no esta aplicación.
export const LATENCIA_FEEDBACK_MS = 300
export const LATENCIA_CONTENIDO_MS = 2000

export const RUTA_EXCLUIDA_DE_LATENCIA = '/analitica'

// Envuelve un valor en una promesa con demora controlada, para simular en
// pruebas o en una verificación manual (throttling del navegador) una
// respuesta lenta del backend sin depender de un backend real.
export function conLatencia<T>(valor: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(valor), ms)
  })
}
