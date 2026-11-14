// Lector de QR SOLO PARA PRUEBAS (FR-041b, FR-041b): reconstruye el texto a partir de la matriz que devuelve
// `generarQr`, sin usar el código del generador salvo las tablas de bloques (`plantillas.ts`). Lee la información de
// formato y de versión, deshace la máscara, recorre el zigzag, desentrelaza los bloques, comprueba que los síndromes de
// Reed-Solomon de cada bloque sean cero y decodifica el modo byte. No lo importa ningún archivo de la app: queda fuera
// del bundle.
import { palabrasDeDatos, plantillaDeVersion, totalDeBloques, bitsDeCantidad } from './plantillas'

export class ErrorDeLectura extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeLectura'
  }
}

export type LecturaQr = { texto: string; bytes: number[]; version: number; mascara: number; sindromesNulos: number }

// GF(256) propio del lector (x^8 + x^4 + x^3 + x^2 + 1), por multiplicación "rusa": no comparte tablas con el generador.
function multiplicar(a: number, b: number): number {
  let producto = 0
  while (b > 0) {
    if (b & 1) producto ^= a
    a <<= 1
    if (a & 0x100) a ^= 0x11d
    b >>= 1
  }
  return producto
}

function potenciaDeAlfa(exponente: number): number {
  let valor = 1
  for (let i = 0; i < exponente; i++) valor = multiplicar(valor, 2)
  return valor
}

// Resto de dividir `valor` (de `bitsValor` bits) por el polinomio `generador`, bit a bit.
function restoBinario(valor: number, bitsValor: number, generador: number, gradoGenerador: number): number {
  let resto = valor
  for (let i = bitsValor - 1; i >= gradoGenerador; i--) {
    if ((resto >>> i) & 1) resto ^= generador << (i - gradoGenerador)
  }
  return resto
}

function formatoValido(datos5: number): number {
  const bruto = (datos5 << 10) | restoBinario(datos5 << 10, 15, 0x537, 10)
  return bruto ^ 0x5412
}

function versionValida(version: number): number {
  return (version << 12) | restoBinario(version << 12, 18, 0x1f25, 12)
}

function bitsDeFormatoLeidos(m: readonly (readonly boolean[])[], copia: 1 | 2): number {
  const n = m.length
  // Se lee el bit i (0 = menos significativo) de cada copia.
  const posiciones: [number, number][] = []
  if (copia === 1) {
    for (let i = 0; i <= 5; i++) posiciones.push([i, 8])
    posiciones.push([7, 8], [8, 8], [8, 7])
    for (let i = 9; i < 15; i++) posiciones.push([8, 14 - i])
  } else {
    for (let i = 0; i < 8; i++) posiciones.push([8, n - 1 - i])
    for (let i = 8; i < 15; i++) posiciones.push([n - 15 + i, 8])
  }
  let valor = 0
  posiciones.forEach(([fila, columna], i) => {
    if (m[fila][columna]) valor |= 1 << i
  })
  return valor
}

function bitsDeVersionLeidos(m: readonly (readonly boolean[])[], copia: 1 | 2): number {
  const n = m.length
  let valor = 0
  for (let i = 0; i < 18; i++) {
    const a = n - 11 + (i % 3)
    const b = Math.floor(i / 3)
    const oscuro = copia === 1 ? m[b][a] : m[a][b]
    if (oscuro) valor |= 1 << i
  }
  return valor
}

// Módulos que NO llevan datos, calculados por regiones del estándar (no por los patrones que dibuja el generador).
function mapaDeFuncion(n: number, version: number): boolean[][] {
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const marcar = (desdeFila: number, hastaFila: number, desdeCol: number, hastaCol: number) => {
    for (let fila = desdeFila; fila <= hastaFila; fila++) for (let col = desdeCol; col <= hastaCol; col++) f[fila][col] = true
  }
  marcar(0, 8, 0, 8) // buscador, separador y formato (arriba a la izquierda)
  marcar(0, 8, n - 8, n - 1) // arriba a la derecha
  marcar(n - 8, n - 1, 0, 8) // abajo a la izquierda (incluye el módulo oscuro)
  marcar(6, 6, 0, n - 1)
  marcar(0, n - 1, 6, 6) // temporización
  const centros = plantillaDeVersion(version).alineacion
  for (const fila of centros) {
    for (const col of centros) {
      const sobreBuscador = (fila < 9 && col < 9) || (fila < 9 && col > n - 10) || (fila > n - 10 && col < 9)
      if (!sobreBuscador) marcar(fila - 2, fila + 2, col - 2, col + 2)
    }
  }
  if (version >= 7) {
    marcar(0, 5, n - 11, n - 9)
    marcar(n - 11, n - 9, 0, 5)
  }
  return f
}

function mascaraInvierte(mascara: number, fila: number, col: number): boolean {
  const tabla = [
    (fila + col) % 2 === 0,
    fila % 2 === 0,
    col % 3 === 0,
    (fila + col) % 3 === 0,
    (Math.floor(fila / 2) + Math.floor(col / 3)) % 2 === 0,
    ((fila * col) % 2) + ((fila * col) % 3) === 0,
    ((((fila * col) % 2) + ((fila * col) % 3)) % 2) === 0,
    ((((fila + col) % 2) + ((fila * col) % 3)) % 2) === 0,
  ]
  return tabla[mascara]
}

export function leerQr(modulos: readonly (readonly boolean[])[]): LecturaQr {
  const n = modulos.length
  if ((n - 17) % 4 !== 0 || n < 21 || n > 57) throw new ErrorDeLectura(`Tamaño de símbolo inválido: ${n}.`)
  if (modulos.some((fila) => fila.length !== n)) throw new ErrorDeLectura('La matriz no es cuadrada.')
  const version = (n - 17) / 4

  // Formato: las dos copias deben coincidir entre sí y ser una palabra BCH válida con corrección M (00).
  const f1 = bitsDeFormatoLeidos(modulos, 1)
  const f2 = bitsDeFormatoLeidos(modulos, 2)
  if (f1 !== f2) throw new ErrorDeLectura('Las dos copias de la información de formato no coinciden.')
  let mascara = -1
  for (let candidata = 0; candidata < 8; candidata++) if (formatoValido((0b00 << 3) | candidata) === f1) mascara = candidata
  if (mascara < 0) throw new ErrorDeLectura('La información de formato no es válida para el nivel M.')

  if (version >= 7) {
    const v1 = bitsDeVersionLeidos(modulos, 1)
    const v2 = bitsDeVersionLeidos(modulos, 2)
    if (v1 !== v2 || v1 !== versionValida(version)) throw new ErrorDeLectura('La información de versión no es válida.')
  }

  // Zigzag, deshaciendo la máscara.
  const esFuncion = mapaDeFuncion(n, version)
  const bits: number[] = []
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5
    const haciaArriba = ((derecha + 1) & 2) === 0
    for (let paso = 0; paso < n; paso++) {
      const fila = haciaArriba ? n - 1 - paso : paso
      for (const col of [derecha, derecha - 1]) {
        if (esFuncion[fila][col]) continue
        bits.push(modulos[fila][col] !== mascaraInvierte(mascara, fila, col) ? 1 : 0)
      }
    }
  }
  const plantilla = plantillaDeVersion(version)
  const totalPalabras = totalDeBloques(plantilla) * plantilla.correccionPorBloque + palabrasDeDatos(plantilla)
  if (bits.length < totalPalabras * 8 || bits.length - totalPalabras * 8 > 7) {
    throw new ErrorDeLectura(`Cantidad de módulos de datos inesperada: ${bits.length}.`)
  }
  if (bits.slice(totalPalabras * 8).some((bit) => bit !== 0)) throw new ErrorDeLectura('Los bits remanentes no son cero.')
  const palabras: number[] = []
  for (let i = 0; i < totalPalabras; i++) {
    let palabra = 0
    for (let j = 0; j < 8; j++) palabra = (palabra << 1) | bits[i * 8 + j]
    palabras.push(palabra)
  }

  // Desentrelazado: datos de a una por bloque (los bloques del grupo 2 tienen una palabra más) y luego la corrección.
  const largos = [
    ...new Array<number>(plantilla.grupo1.bloques).fill(plantilla.grupo1.datos),
    ...new Array<number>(plantilla.grupo2.bloques).fill(plantilla.grupo2.datos),
  ]
  const bloques = largos.map(() => ({ datos: [] as number[], correccion: [] as number[] }))
  let cursor = 0
  for (let i = 0; i < Math.max(...largos); i++) {
    bloques.forEach((bloque, indice) => {
      if (i < largos[indice]) bloque.datos.push(palabras[cursor++])
    })
  }
  for (let i = 0; i < plantilla.correccionPorBloque; i++) bloques.forEach((bloque) => bloque.correccion.push(palabras[cursor++]))
  if (cursor !== totalPalabras) throw new ErrorDeLectura('El desentrelazado no consumió todas las palabras.')

  // Síndromes: el bloque completo (datos + corrección) evaluado en α^0 … α^(ec−1) debe dar cero.
  let sindromesNulos = 0
  for (const [indice, bloque] of bloques.entries()) {
    const completo = [...bloque.datos, ...bloque.correccion]
    for (let i = 0; i < plantilla.correccionPorBloque; i++) {
      const alfa = potenciaDeAlfa(i)
      let valor = 0
      for (const palabra of completo) valor = multiplicar(valor, alfa) ^ palabra
      if (valor !== 0) throw new ErrorDeLectura(`El resto de Reed-Solomon del bloque ${indice} no es cero (síndrome ${i}).`)
      sindromesNulos++
    }
  }

  // Decodificación del flujo de datos: modo byte (0100), cantidad, bytes, terminador y relleno 0xEC / 0x11.
  const datos = bloques.flatMap((bloque) => bloque.datos)
  const flujo = datos.flatMap((palabra) => Array.from({ length: 8 }, (_, i) => (palabra >>> (7 - i)) & 1))
  const leer = (desde: number, cantidad: number) => flujo.slice(desde, desde + cantidad).reduce((acc, bit) => (acc << 1) | bit, 0)
  if (leer(0, 4) !== 0b0100) throw new ErrorDeLectura('El modo no es byte.')
  const bitsCantidad = bitsDeCantidad(version)
  const cantidad = leer(4, bitsCantidad)
  const inicio = 4 + bitsCantidad
  if (inicio + cantidad * 8 > flujo.length) throw new ErrorDeLectura('La cantidad declarada no entra en los datos.')
  const bytes: number[] = []
  for (let i = 0; i < cantidad; i++) bytes.push(leer(inicio + i * 8, 8))
  let fin = inicio + cantidad * 8
  const terminador = Math.min(4, flujo.length - fin)
  if (leer(fin, terminador) !== 0) throw new ErrorDeLectura('El terminador no es cero.')
  fin += terminador
  while (fin % 8 !== 0) {
    if (flujo[fin] !== 0) throw new ErrorDeLectura('El relleno a byte no es cero.')
    fin++
  }
  for (let palabra = fin / 8, esperado = 0xec; palabra < datos.length; palabra++, esperado ^= 0xec ^ 0x11) {
    if (datos[palabra] !== esperado) throw new ErrorDeLectura('El relleno de palabras no alterna 0xEC / 0x11.')
  }
  const texto = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  return { texto, bytes, version, mascara, sindromesNulos }
}
