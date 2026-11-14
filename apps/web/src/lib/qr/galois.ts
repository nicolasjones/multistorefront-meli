// Aritmética de Reed-Solomon para el generador de QR (F-SVC-32, FR-040). Cuerpo de Galois GF(256) con el polinomio
// primitivo x^8 + x^4 + x^3 + x^2 + 1 (0x11D), el que fija ISO/IEC 18004. Funciones puras: sin DOM, red, `eval` ni `Function`.

const POLINOMIO_PRIMITIVO = 0x11d

// exp[i] = α^i (se repite para no reducir el índice al multiplicar); log[x] = i tal que α^i = x (log[0] no existe).
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= POLINOMIO_PRIMITIVO
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

export function multiplicarGf(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

// Polinomio generador de grado `n`: (x − α^0)(x − α^1)…(x − α^(n−1)). Se devuelve SIN el coeficiente líder (que es 1),
// del término de mayor grado al independiente: n coeficientes.
export function generadorReedSolomon(n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new RangeError('Grado de Reed-Solomon fuera de rango.')
  let coeficientes = [1]
  for (let i = 0; i < n; i++) {
    const siguiente = new Array<number>(coeficientes.length + 1).fill(0)
    for (let j = 0; j < coeficientes.length; j++) {
      siguiente[j] ^= coeficientes[j]
      siguiente[j + 1] ^= multiplicarGf(coeficientes[j], EXP[i])
    }
    coeficientes = siguiente
  }
  return coeficientes.slice(1)
}

// Resto de dividir `datos(x) · x^n` por el generador de grado `n`: son las `n` palabras de corrección del bloque.
export function restoReedSolomon(datos: readonly number[], n: number): number[] {
  const generador = generadorReedSolomon(n)
  const resto = new Array<number>(n).fill(0)
  for (const palabra of datos) {
    const factor = palabra ^ resto[0]
    resto.shift()
    resto.push(0)
    for (let i = 0; i < n; i++) resto[i] ^= multiplicarGf(generador[i], factor)
  }
  return resto
}
