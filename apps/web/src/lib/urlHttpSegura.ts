// Un enlace que viene del servidor (p. ej. la política de privacidad de la tienda) solo se usa como `href` si es http: o https:.
// `javascript:`, `data:`, `vbscript:` y cualquier otro esquema devuelven null (defensa en profundidad: el servidor ya filtra, pero el
// front no confía en lo que recibe). Una ruta relativa se resuelve contra el origen de la página, así que también es http(s).
export function urlHttpSegura(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const texto = url.trim()
  if (texto === '' || /[\u0000-\u001f\u007f]/.test(texto)) return null
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://tienda.invalid'
    const resuelta = new URL(texto, base)
    return resuelta.protocol === 'http:' || resuelta.protocol === 'https:' ? texto : null
  } catch {
    return null
  }
}
