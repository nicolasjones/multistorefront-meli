// Generador de códigos QR propio y mínimo (F-SVC-32, FR-040, D-18): solo modo byte (UTF-8), corrección de errores M y
// versiones 1 a 10 (hasta 213 bytes), con las 8 máscaras y las cuatro reglas de penalización de ISO/IEC 18004.
// Funciones puras: sin DOM, red, `eval` ni `Function`. La corrección se verifica en tres capas (FR-041): vectores
// dorados, ida y vuelta con un lector de prueba y escaneo real; ver `docs/service-etiqueta-qr.md`.
import { restoReedSolomon } from './galois'
import {
  CAPACIDAD_MAXIMA_BYTES,
  VERSION_MAXIMA,
  VERSION_MINIMA,
  bitsDeCantidad,
  bitsRemanentes,
  capacidadEnBytes,
  palabrasDeDatos,
  plantillaDeVersion,
  type PlantillaVersion,
} from './plantillas'

export type ResultadoQr = {
  // Lado del símbolo en módulos: 17 + 4 × versión (sin zona quieta).
  tamano: number
  // `modulos[fila][columna]`: true = módulo oscuro.
  modulos: boolean[][]
  version: number
}

export class QrDemasiadoLargo extends Error {
  readonly bytes: number
  readonly maximo: number
  constructor(bytes: number) {
    super(`El texto ocupa ${bytes} bytes y el generador admite hasta ${CAPACIDAD_MAXIMA_BYTES}.`)
    this.name = 'QrDemasiadoLargo'
    this.bytes = bytes
    this.maximo = CAPACIDAD_MAXIMA_BYTES
  }
}

export const MASCARAS = 8

// UTF-8 propio (sin `TextEncoder`: no depende del entorno). Un sustituto suelto se codifica como U+FFFD, igual que
// `TextEncoder`.
export function bytesUtf8(texto: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < texto.length; i++) {
    let punto = texto.charCodeAt(i)
    if (punto >= 0xd800 && punto <= 0xdbff) {
      const siguiente = i + 1 < texto.length ? texto.charCodeAt(i + 1) : 0
      if (siguiente >= 0xdc00 && siguiente <= 0xdfff) {
        punto = 0x10000 + ((punto - 0xd800) << 10) + (siguiente - 0xdc00)
        i++
      } else {
        punto = 0xfffd
      }
    } else if (punto >= 0xdc00 && punto <= 0xdfff) {
      punto = 0xfffd
    }
    if (punto < 0x80) bytes.push(punto)
    else if (punto < 0x800) bytes.push(0xc0 | (punto >> 6), 0x80 | (punto & 0x3f))
    else if (punto < 0x10000) bytes.push(0xe0 | (punto >> 12), 0x80 | ((punto >> 6) & 0x3f), 0x80 | (punto & 0x3f))
    else bytes.push(0xf0 | (punto >> 18), 0x80 | ((punto >> 12) & 0x3f), 0x80 | ((punto >> 6) & 0x3f), 0x80 | (punto & 0x3f))
  }
  return bytes
}

// Versión mínima (1 a 10) en la que entran `cantidad` bytes; lanza `QrDemasiadoLargo` si no entran en la 10.
export function versionMinima(cantidad: number): number {
  for (let version = VERSION_MINIMA; version <= VERSION_MAXIMA; version++) {
    if (cantidad <= capacidadEnBytes(version)) return version
  }
  throw new QrDemasiadoLargo(cantidad)
}

// Palabras de datos: modo byte (0100), cantidad, bytes, terminador de hasta 4 ceros, relleno a byte y 0xEC / 0x11.
function palabrasDeDatosDe(bytes: readonly number[], version: number): number[] {
  const bits: number[] = []
  const agregar = (valor: number, cantidad: number) => {
    for (let i = cantidad - 1; i >= 0; i--) bits.push((valor >>> i) & 1)
  }
  agregar(0b0100, 4)
  agregar(bytes.length, bitsDeCantidad(version))
  for (const byte of bytes) agregar(byte, 8)
  const capacidadEnBits = palabrasDeDatos(plantillaDeVersion(version)) * 8
  agregar(0, Math.min(4, capacidadEnBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const palabras: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let palabra = 0
    for (let j = 0; j < 8; j++) palabra = (palabra << 1) | bits[i + j]
    palabras.push(palabra)
  }
  for (let relleno = 0xec; palabras.length < capacidadEnBits / 8; relleno ^= 0xec ^ 0x11) palabras.push(relleno)
  return palabras
}

// Parte las palabras de datos en bloques (los del grupo 1 primero), calcula la corrección de cada uno y entrelaza:
// primero las palabras de datos de a una por bloque, luego las de corrección.
function entrelazar(datos: readonly number[], plantilla: PlantillaVersion): number[] {
  const bloques: { datos: number[]; correccion: number[] }[] = []
  let desde = 0
  for (const grupo of [plantilla.grupo1, plantilla.grupo2]) {
    for (let i = 0; i < grupo.bloques; i++) {
      const trozo = datos.slice(desde, desde + grupo.datos)
      desde += grupo.datos
      bloques.push({ datos: trozo, correccion: restoReedSolomon(trozo, plantilla.correccionPorBloque) })
    }
  }
  const resultado: number[] = []
  const mayorDatos = Math.max(...bloques.map((bloque) => bloque.datos.length))
  for (let i = 0; i < mayorDatos; i++) {
    for (const bloque of bloques) if (i < bloque.datos.length) resultado.push(bloque.datos[i])
  }
  for (let i = 0; i < plantilla.correccionPorBloque; i++) {
    for (const bloque of bloques) resultado.push(bloque.correccion[i])
  }
  return resultado
}

// Información de formato (15 bits): corrección M (00) + máscara, con BCH(15,5) de generador 0x537 y XOR 0x5412.
export function bitsDeFormato(mascara: number): number {
  const datos = (0b00 << 3) | mascara
  let resto = datos
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537)
  return ((datos << 10) | resto) ^ 0x5412
}

// Información de versión (18 bits, solo desde la 7): versión + BCH(18,6) de generador 0x1F25.
export function bitsDeVersion(version: number): number {
  let resto = version
  for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25)
  return (version << 12) | resto
}

type Matriz = { tamano: number; modulos: boolean[][]; funcion: boolean[][] }

function crearMatriz(tamano: number): Matriz {
  const grilla = () => Array.from({ length: tamano }, () => new Array<boolean>(tamano).fill(false))
  return { tamano, modulos: grilla(), funcion: grilla() }
}

function fijarFuncion(matriz: Matriz, x: number, y: number, oscuro: boolean) {
  matriz.modulos[y][x] = oscuro
  matriz.funcion[y][x] = true
}

function dibujarBuscador(matriz: Matriz, cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= matriz.tamano || y >= matriz.tamano) continue
      const distancia = Math.max(Math.abs(dx), Math.abs(dy))
      fijarFuncion(matriz, x, y, distancia !== 2 && distancia !== 4)
    }
  }
}

function dibujarAlineacion(matriz: Matriz, cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) fijarFuncion(matriz, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
}

function dibujarFormato(matriz: Matriz, mascara: number) {
  const bits = bitsDeFormato(mascara)
  const bit = (i: number) => ((bits >>> i) & 1) !== 0
  const n = matriz.tamano
  // Primera copia, alrededor del buscador superior izquierdo.
  for (let i = 0; i <= 5; i++) fijarFuncion(matriz, 8, i, bit(i))
  fijarFuncion(matriz, 8, 7, bit(6))
  fijarFuncion(matriz, 8, 8, bit(7))
  fijarFuncion(matriz, 7, 8, bit(8))
  for (let i = 9; i < 15; i++) fijarFuncion(matriz, 14 - i, 8, bit(i))
  // Segunda copia, junto a los otros dos buscadores.
  for (let i = 0; i < 8; i++) fijarFuncion(matriz, n - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) fijarFuncion(matriz, 8, n - 15 + i, bit(i))
  fijarFuncion(matriz, 8, n - 8, true) // módulo oscuro
}

function dibujarPatronesFijos(version: number): Matriz {
  const n = 17 + 4 * version
  const matriz = crearMatriz(n)
  for (let i = 0; i < n; i++) {
    fijarFuncion(matriz, 6, i, i % 2 === 0)
    fijarFuncion(matriz, i, 6, i % 2 === 0)
  }
  dibujarBuscador(matriz, 3, 3)
  dibujarBuscador(matriz, n - 4, 3)
  dibujarBuscador(matriz, 3, n - 4)
  const centros = plantillaDeVersion(version).alineacion
  const ultimo = centros.length - 1
  for (let i = 0; i < centros.length; i++) {
    for (let j = 0; j < centros.length; j++) {
      // Las tres esquinas que chocan con los buscadores no llevan patrón de alineación.
      if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) continue
      dibujarAlineacion(matriz, centros[i], centros[j])
    }
  }
  dibujarFormato(matriz, 0) // reserva el lugar; se reescribe con la máscara elegida
  if (version >= 7) {
    const bits = bitsDeVersion(version)
    for (let i = 0; i < 18; i++) {
      const oscuro = ((bits >>> i) & 1) !== 0
      const a = n - 11 + (i % 3)
      const b = Math.floor(i / 3)
      fijarFuncion(matriz, a, b, oscuro)
      fijarFuncion(matriz, b, a, oscuro)
    }
  }
  return matriz
}

// Coloca las palabras de código en zigzag, de a dos columnas desde la derecha, saltando la columna de temporización.
function colocarDatos(matriz: Matriz, palabras: readonly number[]) {
  const n = matriz.tamano
  const totalBits = palabras.length * 8
  let indice = 0
  for (let derecha = n - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5
    for (let vertical = 0; vertical < n; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = derecha - j
        const haciaArriba = ((derecha + 1) & 2) === 0
        const y = haciaArriba ? n - 1 - vertical : vertical
        if (matriz.funcion[y][x]) continue
        // Los módulos que sobran tras el último bit quedan claros (bits remanentes).
        matriz.modulos[y][x] = indice < totalBits ? ((palabras[indice >>> 3] >>> (7 - (indice & 7))) & 1) !== 0 : false
        indice++
      }
    }
  }
}

function invierteMascara(mascara: number, x: number, y: number): boolean {
  switch (mascara) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
  }
}

function aplicarMascara(matriz: Matriz, mascara: number) {
  for (let y = 0; y < matriz.tamano; y++) {
    for (let x = 0; x < matriz.tamano; x++) {
      if (!matriz.funcion[y][x] && invierteMascara(mascara, x, y)) matriz.modulos[y][x] = !matriz.modulos[y][x]
    }
  }
}

const PATRON_BUSCADOR_A = [true, false, true, true, true, false, true, false, false, false, false]
const PATRON_BUSCADOR_B = [false, false, false, false, true, false, true, true, true, false, true]

function coincide(linea: readonly boolean[], desde: number, patron: readonly boolean[]): boolean {
  for (let i = 0; i < patron.length; i++) if (linea[desde + i] !== patron[i]) return false
  return true
}

// Penalización de la máscara (ISO/IEC 18004, 8.8.2): N1 = 3 por corrida de 5 o más (+1 por módulo extra), N2 = 3 por
// cada bloque de 2×2 del mismo color, N3 = 40 por cada patrón 1:1:3:1:1 con 4 claros a un lado y N4 = 10 por cada 5 %
// que el porcentaje de oscuros se aparta del 50 %.
export function penalizacion(modulos: readonly (readonly boolean[])[]): number {
  const n = modulos.length
  let total = 0
  const lineas: boolean[][] = []
  for (let i = 0; i < n; i++) {
    lineas.push([...modulos[i]])
    lineas.push(modulos.map((fila) => fila[i]))
  }
  for (const linea of lineas) {
    let corrida = 1
    for (let i = 1; i <= n; i++) {
      if (i < n && linea[i] === linea[i - 1]) {
        corrida++
      } else {
        if (corrida >= 5) total += 3 + (corrida - 5)
        corrida = 1
      }
    }
    for (let i = 0; i + 11 <= n; i++) {
      if (coincide(linea, i, PATRON_BUSCADOR_A)) total += 40
      if (coincide(linea, i, PATRON_BUSCADOR_B)) total += 40
    }
  }
  let oscuros = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modulos[y][x]) oscuros++
      if (x + 1 < n && y + 1 < n) {
        const color = modulos[y][x]
        if (color === modulos[y][x + 1] && color === modulos[y + 1][x] && color === modulos[y + 1][x + 1]) total += 3
      }
    }
  }
  total += Math.floor(Math.abs(oscuros * 20 - n * n * 10) / (n * n)) * 10
  return total
}

// Genera el QR de `texto` (UTF-8, modo byte, corrección M) en la versión mínima que entra. `mascara` (0 a 7) fuerza una
// máscara en lugar de elegir la de menor penalización: lo usan las pruebas para compararla con una referencia.
export function generarQr(texto: string, opciones: { mascara?: number } = {}): ResultadoQr {
  const bytes = bytesUtf8(texto)
  const version = versionMinima(bytes.length)
  const plantilla = plantillaDeVersion(version)
  const palabras = entrelazar(palabrasDeDatosDe(bytes, version), plantilla)
  const base = dibujarPatronesFijos(version)
  colocarDatos(base, palabras)
  const remanentes = bitsRemanentes(version)
  if (palabras.length * 8 + remanentes !== base.funcion.flat().filter((esFuncion) => !esFuncion).length) {
    throw new Error('El generador de QR no cierra la cantidad de módulos de datos.')
  }

  const forzada = opciones.mascara
  if (forzada !== undefined && (!Number.isInteger(forzada) || forzada < 0 || forzada >= MASCARAS)) {
    throw new RangeError('La máscara del QR debe ser un entero de 0 a 7.')
  }
  let mejor: Matriz | null = null
  let menorPenalizacion = Infinity
  for (let mascara = 0; mascara < MASCARAS; mascara++) {
    if (forzada !== undefined && mascara !== forzada) continue
    const candidata: Matriz = {
      tamano: base.tamano,
      modulos: base.modulos.map((fila) => [...fila]),
      funcion: base.funcion,
    }
    aplicarMascara(candidata, mascara)
    // El formato ocupa módulos de función: se escribe sobre una copia de `funcion` ya reservada (mismas posiciones).
    dibujarFormato(candidata, mascara)
    const puntos = forzada !== undefined ? 0 : penalizacion(candidata.modulos)
    if (puntos < menorPenalizacion) {
      menorPenalizacion = puntos
      mejor = candidata
    }
  }
  if (!mejor) throw new Error('El generador de QR no eligió una máscara.')
  return { tamano: mejor.tamano, modulos: mejor.modulos, version }
}
