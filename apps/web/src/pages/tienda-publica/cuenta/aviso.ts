export type AvisoCuenta = { clave: number; mensaje: string; error?: boolean; accion?: { etiqueta: string; alElegir: () => void } }

let ultimaClave = 0

// Aviso nuevo: la `clave` distinta hace que reemplace al anterior aunque tenga el mismo texto.
export function crearAviso(mensaje: string, error = false, accion?: AvisoCuenta['accion']): AvisoCuenta {
  ultimaClave += 1
  return { clave: ultimaClave, mensaje, error, accion }
}
