// F-MIG-01 (MSF-299, FR-002): lectura de CSV UTF-8 en el navegador.
//
// No se agrega una dependencia para parsear: el formato que exporta el panel
// actual es CSV simple con campos entre comillas cuando hace falta. Se acepta
// coma o punto y coma como separador (Excel en castellano usa `;`), BOM de
// Excel, saltos CRLF y comillas escapadas (`""`).
//
// Un archivo que no se puede leer no avanza en el asistente: se devuelve un
// `ErrorCsv` con un mensaje en castellano listo para mostrar.

export type FilaCsv = {
  // Número de fila del archivo contando el encabezado como 1 (FR-004).
  numero: number
  celdas: string[]
  /**
   * Motivo por el que la fila no se puede importar (MSF-699). Hoy solo hay un
   * caso: la fila tiene más valores que columnas y sus datos quedan corridos.
   * Las celdas sobrantes NO se descartan: quedan en `celdas` y la fila se
   * marca con error, así el asistente la muestra y no la importa.
   */
  error?: string
}

export type CsvLeido = {
  encabezados: string[]
  filas: FilaCsv[]
  separador: ',' | ';'
}

export type ArchivoCsv = {
  name?: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

export class ErrorCsv extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorCsv'
  }
}

const BOM = '\uFEFF'

function esFilaVacia(celdas: readonly string[]): boolean {
  return celdas.every((celda) => celda.trim() === '')
}

/** Separador de la primera línea: gana el que más aparece fuera de comillas. */
export function detectarSeparador(texto: string): ',' | ';' {
  let comillas = false
  let comas = 0
  let puntoYComas = 0
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice]
    if (caracter === '"') {
      if (comillas && texto[indice + 1] === '"') {
        indice += 1
        continue
      }
      comillas = !comillas
      continue
    }
    if (!comillas && (caracter === '\n' || caracter === '\r')) break
    if (!comillas && caracter === ',') comas += 1
    if (!comillas && caracter === ';') puntoYComas += 1
  }
  return puntoYComas > comas ? ';' : ','
}

/** Parsea texto CSV ya decodificado. Lanza `ErrorCsv` si no hay datos usables. */
export function analizarCsv(textoOriginal: string): CsvLeido {
  const texto = textoOriginal.startsWith(BOM) ? textoOriginal.slice(BOM.length) : textoOriginal
  if (texto.trim() === '') {
    throw new ErrorCsv('El archivo está vacío.')
  }

  const separador = detectarSeparador(texto)
  const registros: string[][] = []
  let campos: string[] = []
  let campo = ''
  let entreComillas = false

  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice]

    if (entreComillas) {
      if (caracter === '"') {
        if (texto[indice + 1] === '"') {
          campo += '"'
          indice += 1
        } else {
          entreComillas = false
        }
      } else {
        campo += caracter
      }
      continue
    }

    // Una comilla solo abre un campo entrecomillado al inicio del campo.
    if (caracter === '"' && campo.trim() === '') {
      entreComillas = true
      campo = ''
      continue
    }

    if (caracter === separador) {
      campos.push(campo)
      campo = ''
      continue
    }

    if (caracter === '\r' || caracter === '\n') {
      campos.push(campo)
      campo = ''
      registros.push(campos)
      campos = []
      if (caracter === '\r' && texto[indice + 1] === '\n') indice += 1
      continue
    }

    campo += caracter
  }

  if (entreComillas) {
    throw new ErrorCsv('El archivo tiene comillas sin cerrar. Revisá la exportación.')
  }

  if (campo !== '' || campos.length > 0) {
    campos.push(campo)
    registros.push(campos)
  }

  while (registros.length > 0 && esFilaVacia(registros[registros.length - 1])) {
    registros.pop()
  }
  if (registros.length === 0) {
    throw new ErrorCsv('El archivo está vacío.')
  }

  const encabezados = registros[0].map((encabezado, indice) => {
    const limpio = encabezado.trim()
    return limpio === '' ? `Columna ${indice + 1}` : limpio
  })
  if (encabezados.length === 0) {
    throw new ErrorCsv('El archivo no tiene encabezados.')
  }

  const ancho = encabezados.length
  const filas = registros
    .slice(1)
    .map((celdas, indice) => ({ numero: indice + 2, celdas }))
    // Las líneas en blanco no son datos: no se importan ni ocupan un número.
    .filter((fila) => !esFilaVacia(fila.celdas))
    .map((fila) => {
      const celdas = fila.celdas.map((celda) => celda.trim())
      // Celdas sobrantes (MSF-699): una fila con más valores que columnas tiene
      // los datos corridos (típico: una coma sin escapar en un export de
      // Excel). Antes se recortaba en silencio y el valor perdido se cargaba
      // desalineado; ahora la fila se marca con error y no se importa.
      // Las celdas sobrantes VACÍAS (coma final) se toleran: no corren datos.
      const conValor = celdas.filter((celda) => celda !== '').length
      const error = conValor > ancho
        ? `La fila ${fila.numero} tiene ${conValor} columnas y se esperaban ${ancho}`
        : undefined
      return {
        numero: fila.numero,
        // Las filas con menos celdas se rellenan con vacíos (no es un dato
        // que se pierda: la base valida los campos obligatorios).
        celdas: celdas.length < ancho ? [...celdas, ...new Array(ancho - celdas.length).fill('')] : celdas,
        ...(error ? { error } : {}),
      }
    })

  if (filas.length === 0) {
    throw new ErrorCsv('El archivo no tiene filas para importar.')
  }

  return { encabezados, filas, separador }
}

/** Error de estructura del archivo por fila (celdas de más). */
export type ErrorFilaCsv = { fila: number; motivo: string }

/**
 * Filas del archivo que no se pueden importar porque tienen más valores que
 * columnas (MSF-699). La base no ve las celdas sobrantes —no viajan en la
 * fila—, así que el motivo lo arma el navegador.
 */
export function erroresDeColumnas(csv: CsvLeido): ErrorFilaCsv[] {
  const errores: ErrorFilaCsv[] = []
  for (const fila of csv.filas) {
    if (fila.error) errores.push({ fila: fila.numero, motivo: fila.error })
  }
  return errores
}

/** Tope de lectura en memoria: evita congelar la pestaña con un archivo enorme. */
export const TAMANO_MAXIMO_BYTES = 25 * 1024 * 1024

/** Decodifica UTF-8 estricto y parsea. Un archivo ilegible no avanza (FR-002). */
export async function leerCsvUtf8(archivo: ArchivoCsv): Promise<CsvLeido> {
  if (archivo.name && !archivo.name.toLowerCase().endsWith('.csv')) {
    throw new ErrorCsv(`«${archivo.name}» no es un archivo .csv. Guardá la planilla como CSV UTF-8.`)
  }
  if (archivo.size === 0) {
    throw new ErrorCsv('El archivo está vacío.')
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    throw new ErrorCsv('El archivo supera los 25 MB. Dividilo en partes y subilas de a una.')
  }

  let bytes: ArrayBuffer
  try {
    bytes = await archivo.arrayBuffer()
  } catch {
    throw new ErrorCsv('No pudimos leer el archivo. Elegilo de nuevo.')
  }

  let texto: string
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ErrorCsv('El archivo no está en UTF-8. Guardalo como CSV UTF-8 y volvé a subirlo.')
  }

  return analizarCsv(texto)
}

export function escaparCampoCsv(valor: string): string {
  return /[",;\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

/** Arma un CSV con encabezados y sin filas: es la plantilla descargable. */
export function generarCsv(encabezados: readonly string[]): string {
  return `${encabezados.map(escaparCampoCsv).join(',')}\n`
}

// BOM para que Excel abra el archivo como UTF-8 sin romper tildes. El parser
// lo descarta si la plantilla se vuelve a subir.
export function descargarCsv(nombre: string, contenido: string): void {
  const blob = new Blob([`${BOM}${contenido}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  enlace.rel = 'noopener'
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}
