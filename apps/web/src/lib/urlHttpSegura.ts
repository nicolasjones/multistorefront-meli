// Un enlace que viene del servidor (política de privacidad, enlaces legales del pie) solo se usa como `href` si es seguro:
//   * absoluto con esquema explícito `http:` o `https:`, o
//   * una ruta del propio sitio: empieza con UNA sola `/` (no `//host`, que el navegador toma como otro sitio, ni `/\host`).
// `javascript:`, `data:`, `vbscript:`, `file:`, rutas sin esquema ni barra (`ejemplo.com/x`) y cualquier otro esquema devuelven null.
export function urlHttpSegura(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const texto = url.trim()
  if (texto === '' || /[\u0000-\u001f\u007f]/.test(texto)) return null
  if (texto.startsWith('/')) return texto.startsWith('//') || texto.startsWith('/\\') ? null : texto
  try {
    const resuelta = new URL(texto)
    return resuelta.protocol === 'http:' || resuelta.protocol === 'https:' ? texto : null
  } catch {
    return null
  }
}
