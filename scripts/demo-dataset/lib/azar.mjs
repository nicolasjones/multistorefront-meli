// Generador pseudoaleatorio con semilla fija: el dataset sale igual en cada corrida.
export function crearAzar(semilla = 20261031) {
  let a = semilla >>> 0
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    siguiente,
    entero: (min, max) => Math.floor(siguiente() * (max - min + 1)) + min,
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)],
    // Elige según pesos [[valor, peso], ...].
    ponderado(pares) {
      const total = pares.reduce((s, [, p]) => s + p, 0)
      let r = siguiente() * total
      for (const [valor, peso] of pares) { r -= peso; if (r < 0) return valor }
      return pares[pares.length - 1][0]
    },
    probabilidad: (p) => siguiente() < p,
    mezclar(lista) {
      const copia = [...lista]
      for (let i = copia.length - 1; i > 0; i--) { const j = Math.floor(siguiente() * (i + 1)); [copia[i], copia[j]] = [copia[j], copia[i]] }
      return copia
    },
  }
}
