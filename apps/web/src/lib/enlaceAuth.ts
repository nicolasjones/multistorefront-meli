// ¿Esta carga de la página llegó desde un enlace de Auth (invitación o restablecimiento)? Se evalúa al importar,
// antes de que el cliente de Auth consuma y borre los parámetros de la URL, y se recuerda en `sessionStorage`
// para sobrevivir a una recarga. Sirve para que `/definir-contrasena` no acepte cualquier sesión abierta.
const CLAVE = 'msf:enlace-auth'

function leerUrl(): boolean {
  if (typeof window === 'undefined') return false
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const consulta = new URLSearchParams(window.location.search)
  return hash.has('access_token') || hash.has('type') || consulta.has('code') || consulta.has('token_hash')
}

function almacen(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

if (leerUrl()) almacen()?.setItem(CLAVE, '1')

export function llegoPorEnlace(): boolean {
  return almacen()?.getItem(CLAVE) === '1'
}

export function olvidarEnlace(): void {
  almacen()?.removeItem(CLAVE)
}
