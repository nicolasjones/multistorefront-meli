// Umbral «Días sin comprar» de Clientes inactivos (F-CLI-16): entero de 1 a 3650, como la RPC.

export const DIAS_MINIMO = 1
export const DIAS_MAXIMO = 3650

// Valida el umbral: entero de 1 a 3650. Devuelve el número o el mensaje de error.
export const validarDias = (texto: string): { dias: number } | { error: string } => {
  const limpio = texto.trim()
  if (!/^\d+$/.test(limpio)) return { error: `Ingresá un número entero de ${DIAS_MINIMO} a ${DIAS_MAXIMO}.` }
  const dias = Number(limpio)
  if (dias < DIAS_MINIMO || dias > DIAS_MAXIMO) return { error: `Ingresá un número entero de ${DIAS_MINIMO} a ${DIAS_MAXIMO}.` }
  return { dias }
}
