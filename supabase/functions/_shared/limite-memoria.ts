// Límite de uso por clave (usuario) en una ventana deslizante, en memoria del isolate. Sin imports de Deno: se prueba
// con `node --test` (limite-memoria.test.ts).
//
// MEJOR ESFUERZO: cada isolate de la Edge Function tiene su propio contador y se reinicia al reciclarse, así que NO es
// una cuota global. Frena el abuso trivial (un bucle contra una función que gasta crédito o manda correo) hasta que
// exista un contador persistente (propuesta con migración en docs/funciones-edge-limites-y-registro.md).
export type Limitador = { consumir(clave: string): boolean }

export function crearLimitador({ max, ventanaMs, ahora = Date.now, maxClaves = 5000 }: { max: number; ventanaMs: number; ahora?: () => number; maxClaves?: number }): Limitador {
  const usos = new Map<string, number[]>()
  return {
    consumir(clave) {
      const t = ahora()
      const vigentes = (usos.get(clave) ?? []).filter((u) => t - u < ventanaMs)
      if (vigentes.length >= max) {
        usos.set(clave, vigentes)
        return false
      }
      vigentes.push(t)
      usos.delete(clave) // reinsertar al final: el más viejo queda primero para el recorte
      usos.set(clave, vigentes)
      if (usos.size > maxClaves) {
        for (const [k, v] of usos) {
          if (v.every((u) => t - u >= ventanaMs) || usos.size > maxClaves) usos.delete(k)
          if (usos.size <= maxClaves) break
        }
      }
      return true
    },
  }
}

export function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : porDefecto
}
