// Destino tras el ingreso (MSF-700): `CatchAllNavigate` arma `/login?to=<ruta>` y el
// login debe volver ahí. Solo se acepta una ruta relativa interna: empieza con una
// sola `/`, sin esquema/host (`//host`, `/\host`, `https:`) ni caracteres de control.
export function destinoInternoSeguro(destino: unknown): string | null {
  if (typeof destino !== 'string' || destino === '') return null
  if (!destino.startsWith('/') || destino.startsWith('//') || destino.startsWith('/\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(destino)) return null
  if (destino === '/login' || destino.startsWith('/login?') || destino.startsWith('/login/')) return null
  return destino
}
