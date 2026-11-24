// Envuelve `vi.waitFor` para darle un piso de espera: el default de vitest es 1 s y bajo carga un test correcto falla por timeout.
// Un `timeout` propio (número o en el objeto de opciones) se respeta; ausente o `undefined` explícito, rige el piso.
export type OpcionesEspera = number | { timeout?: number; interval?: number }

export function conPisoDeEspera<A extends unknown[], R>(
  original: (callback: (...a: A) => unknown, opciones?: OpcionesEspera) => R,
  piso: number,
) {
  return (callback: (...a: A) => unknown, opciones?: OpcionesEspera): R => {
    const propias = typeof opciones === 'number' ? { timeout: opciones } : (opciones ?? {})
    return original(callback, { ...propias, timeout: propias.timeout ?? piso })
  }
}
