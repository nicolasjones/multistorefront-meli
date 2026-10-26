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
    .map((fila) => ({
      numero: fila.numero,
      celdas: Array.from({ length: ancho }, (_, indice) => (fila.celdas[indice] ?? '').trim()),
    }))

  if (filas.length === 0) {
    throw new ErrorCsv('El archivo no tiene filas para importar.')
  }

  return { encabezados, filas, separador }
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
