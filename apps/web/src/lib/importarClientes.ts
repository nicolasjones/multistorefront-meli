import type { TipoCliente } from './clientes'

// Importación de clientes desde CSV (prototipo Clientes · Listado, diálogo Importar).
// Formato: primera fila de encabezados + una fila por cliente. Separador `;` o `,`
// (se detecta por la cabecera). Los números existentes se actualizan; los nuevos se crean.
// Reglas por fila: nombre obligatorio; DNI/CUIT obligatorio (como pide el diálogo);
// tipo vacío = minorista; tipo inválido o fila vacía = error con número de fila.

export const COLUMNAS_PLANTILLA = [
  'numero', 'nombre', 'documento', 'tipo', 'correo', 'telefono', 'celular', 'direccion',
  'codigo_postal', 'localidad', 'provincia', 'expreso_preferido',
] as const

export type FilaImportacion = {
  fila: number
  numero: number | null
  nombre: string
  documento: string
  tipo: TipoCliente
  correo: string | null
  telefono: string | null
  celular: string | null
  direccion: string | null
  codigo_postal: string | null
  localidad: string | null
  provincia: string | null
  expreso_preferido: string | null
}

export type ErrorImportacion = { fila: number; motivo: string }

const TIPOS_VALIDOS: ReadonlyArray<string> = ['minorista', 'mayorista']

function partirLinea(linea: string, sep: string): string[] {
  // CSV simple con comillas dobles ("" escapa "). Suficiente para la plantilla propia.
  const celdas: string[] = []
  let actual = '', comillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') {
      if (comillas && linea[i + 1] === '"') { actual += '"'; i++ } else { comillas = !comillas }
    } else if (c === sep && !comillas) {
      celdas.push(actual); actual = ''
    } else {
      actual += c
    }
  }
  celdas.push(actual)
  return celdas.map((c) => c.trim())
}

export function plantillaCsv(): string {
  const ejemplo = ['1043', 'Distribuidora Norte SRL', '30-00000001-1', 'mayorista', 'compras@ejemplo.com', '', '', 'Av. Ejemplo 1234', '2000', 'Rosario', 'Santa Fe', 'Expreso Ejemplo del Sur']
  return COLUMNAS_PLANTILLA.join(';') + '\n' + ejemplo.join(';') + '\n'
}

export function parsearCsv(contenido: string): { filas: FilaImportacion[]; errores: ErrorImportacion[] } {
  const filas: FilaImportacion[] = []
  const errores: ErrorImportacion[] = []
  const lineas = contenido.split(/\r?\n/)
  const cabecera = (lineas[0] ?? '').trim()
  if (!cabecera) return { filas, errores: [{ fila: 1, motivo: 'El archivo está vacío.' }] }
  const sep = (cabecera.match(/;/g) || []).length >= (cabecera.match(/,/g) || []).length ? ';' : ','
  const cols = partirLinea(cabecera, sep).map((c) => c.toLowerCase())
  const idx = (n: string) => cols.indexOf(n)
  if (idx('nombre') === -1) return { filas, errores: [{ fila: 1, motivo: 'Falta la columna "nombre" en la cabecera.' }] }
  for (let i = 1; i < lineas.length; i++) {
    if (lineas[i].trim() === '') continue
    const celdas = partirLinea(lineas[i], sep)
    const celda = (n: string) => (idx(n) === -1 ? '' : (celdas[idx(n)] ?? '').trim())
    const nFila = i + 1
    if (celdas.every((c) => c === '')) continue
    const nombre = celda('nombre')
    const documento = celda('documento')
    if (!nombre) { errores.push({ fila: nFila, motivo: 'Falta el nombre.' }); continue }
    if (!documento) { errores.push({ fila: nFila, motivo: 'Falta el DNI/CUIT.' }); continue }
    const tipoCrudo = celda('tipo').toLowerCase()
    const tipo = (tipoCrudo === '' ? 'minorista' : tipoCrudo) as string
    if (!TIPOS_VALIDOS.includes(tipo)) { errores.push({ fila: nFila, motivo: `Tipo inválido ("${celda('tipo')}"): minorista o mayorista.` }); continue }
    const numeroCrudo = celda('numero')
    const numero = numeroCrudo === '' ? null : Number(numeroCrudo)
    if (numeroCrudo !== '' && !Number.isInteger(numero)) { errores.push({ fila: nFila, motivo: `Número inválido ("${numeroCrudo}").` }); continue }
    const oNulo = (v: string) => (v === '' ? null : v)
    filas.push({
      fila: nFila, numero, nombre, documento, tipo: tipo as TipoCliente,
      correo: oNulo(celda('correo')), telefono: oNulo(celda('telefono')), celular: oNulo(celda('celular')),
      direccion: oNulo(celda('direccion')), codigo_postal: oNulo(celda('codigo_postal')),
      localidad: oNulo(celda('localidad')), provincia: oNulo(celda('provincia')),
      expreso_preferido: oNulo(celda('expreso_preferido')),
    })
  }
  return { filas, errores }
}
