// Tablas de ISO/IEC 18004 para el generador de QR (F-SVC-32, FR-040): versiones 1 a 10, corrección de errores M.
// Son datos, no lógica; el test `qr.test.ts` comprueba su coherencia (palabras totales = datos + corrección por bloque) y
// los vectores dorados y el escaneo real (FR-041) comprueban que producen símbolos legibles.

export type PlantillaVersion = {
  version: number
  // Palabras de corrección por bloque.
  correccionPorBloque: number
  // Bloques del grupo 1 y del grupo 2 (el 2 tiene una palabra de datos más); `datos` es por bloque.
  grupo1: { bloques: number; datos: number }
  grupo2: { bloques: number; datos: number }
  // Centros de los patrones de alineación (filas y columnas), vacío en la versión 1.
  alineacion: readonly number[]
}

export const VERSION_MINIMA = 1
export const VERSION_MAXIMA = 10

const SIN_GRUPO = { bloques: 0, datos: 0 }

// Índice 0 = versión 1.
export const PLANTILLAS_M: readonly PlantillaVersion[] = [
  { version: 1, correccionPorBloque: 10, grupo1: { bloques: 1, datos: 16 }, grupo2: SIN_GRUPO, alineacion: [] },
  { version: 2, correccionPorBloque: 16, grupo1: { bloques: 1, datos: 28 }, grupo2: SIN_GRUPO, alineacion: [6, 18] },
  { version: 3, correccionPorBloque: 26, grupo1: { bloques: 1, datos: 44 }, grupo2: SIN_GRUPO, alineacion: [6, 22] },
  { version: 4, correccionPorBloque: 18, grupo1: { bloques: 2, datos: 32 }, grupo2: SIN_GRUPO, alineacion: [6, 26] },
  { version: 5, correccionPorBloque: 24, grupo1: { bloques: 2, datos: 43 }, grupo2: SIN_GRUPO, alineacion: [6, 30] },
  { version: 6, correccionPorBloque: 16, grupo1: { bloques: 4, datos: 27 }, grupo2: SIN_GRUPO, alineacion: [6, 34] },
  { version: 7, correccionPorBloque: 18, grupo1: { bloques: 4, datos: 31 }, grupo2: SIN_GRUPO, alineacion: [6, 22, 38] },
  { version: 8, correccionPorBloque: 22, grupo1: { bloques: 2, datos: 38 }, grupo2: { bloques: 2, datos: 39 }, alineacion: [6, 24, 42] },
  { version: 9, correccionPorBloque: 22, grupo1: { bloques: 3, datos: 36 }, grupo2: { bloques: 2, datos: 37 }, alineacion: [6, 26, 46] },
  { version: 10, correccionPorBloque: 26, grupo1: { bloques: 4, datos: 43 }, grupo2: { bloques: 1, datos: 44 }, alineacion: [6, 28, 50] },
]

export function plantillaDeVersion(version: number): PlantillaVersion {
  const plantilla = PLANTILLAS_M[version - VERSION_MINIMA]
  if (!plantilla || plantilla.version !== version) throw new RangeError('Versión de QR fuera de rango.')
  return plantilla
}

export function palabrasDeDatos(plantilla: PlantillaVersion): number {
  return plantilla.grupo1.bloques * plantilla.grupo1.datos + plantilla.grupo2.bloques * plantilla.grupo2.datos
}

export function totalDeBloques(plantilla: PlantillaVersion): number {
  return plantilla.grupo1.bloques + plantilla.grupo2.bloques
}

// Bits del indicador de cantidad de caracteres en modo byte: 8 hasta la versión 9 y 16 desde la 10.
export function bitsDeCantidad(version: number): number {
  return version <= 9 ? 8 : 16
}

// Bytes de texto que entran en la versión (modo byte): 4 bits de modo + cantidad + datos.
export function capacidadEnBytes(version: number): number {
  const bitsLibres = palabrasDeDatos(plantillaDeVersion(version)) * 8 - 4 - bitsDeCantidad(version)
  return Math.floor(bitsLibres / 8)
}

// Bits sobrantes tras las palabras de código (0 en la versión 1 y de la 7 a la 10; 7 de la 2 a la 6).
export function bitsRemanentes(version: number): number {
  return version >= 2 && version <= 6 ? 7 : 0
}

export const CAPACIDAD_MAXIMA_BYTES = capacidadEnBytes(VERSION_MAXIMA)
