import { supabaseClient } from './supabase'
import { descargarArchivo, neutralizarFormula } from './exportarClientes'
import { type ArchivoCsv, type CsvLeido, ErrorCsv, escaparCampoCsv, leerCsvUtf8 } from './migracionCsv'

// Importación de productos desde CSV (F-CAT-10, MSF-375). El navegador lee el CSV y las imágenes; las
// reglas de cada fila las evalúa el servidor (`validar_importacion_productos`) y
// `solicitar_importacion_productos` las revalida y encola la orden del worker. Acá solo se normaliza la
// planilla y se rotula: la autoridad es la base (RLS y es_administrador_de).

export const COLUMNAS_PLANTILLA = [
  'sku', 'nombre', 'categoria', 'costo', 'precio_x1', 'precio_x5', 'precio_x10', 'precio_x50',
  'proveedor', 'codigo_barras', 'tiendas', 'imagenes',
] as const
export type ColumnaPlantilla = (typeof COLUMNAS_PLANTILLA)[number]

export const COLUMNAS_OBLIGATORIAS: readonly ColumnaPlantilla[] = ['sku', 'nombre', 'categoria']
export const MAXIMO_FILAS_IMPORTACION = 2000
export const NOMBRE_PLANTILLA = 'plantilla-productos.csv'
export const BUCKET_IMPORTACIONES = 'productos-importaciones'
export const MAX_BYTES_IMAGEN_IMPORTACION = 2 * 1024 * 1024
export const MAX_BYTES_ZIP = 50 * 1024 * 1024
export const MAX_IMAGENES_CARGA = 500
export const TEXTO_FILAS_CON_ERROR = 'Las filas con error no se importan. Los avisos se importan igual.'
export const AYUDA_COLUMNAS =
  'En la columna imagenes poné los nombres de archivo separados por «|». La primera es la principal. ' +
  'En tiendas poné los códigos SJ o MJC separados por «|»; si queda vacía, el producto se crea sin publicar en ninguna tienda.'

// Panel «Columnas de la plantilla» (Columna / Obligatoria / Ejemplo).
export const DESCRIPCION_COLUMNAS: readonly { columna: string; obligatoria: boolean; ejemplo: string }[] = [
  { columna: 'sku', obligatoria: true, ejemplo: '9266a' },
  { columna: 'nombre', obligatoria: true, ejemplo: 'Vidrio templado Switch OLED' },
  { columna: 'categoria', obligatoria: true, ejemplo: 'Accesorios > Nintendo > Vidrios' },
  { columna: 'costo', obligatoria: false, ejemplo: '1200' },
  { columna: 'precio_x1 / x5 / x10 / x50', obligatoria: false, ejemplo: '2500 / 2300 / 2100 / 1900' },
  { columna: 'proveedor', obligatoria: false, ejemplo: 'Proveedor Ejemplo SA' },
  { columna: 'codigo_barras', obligatoria: false, ejemplo: '7790000000012' },
  { columna: 'tiendas', obligatoria: false, ejemplo: 'SJ|MJC' },
  { columna: 'imagenes', obligatoria: false, ejemplo: '9266a-1.jpg|9266a-2.jpg' },
]

export class ErrorImportacion extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorImportacion'
  }
}

/** Fila de la planilla normalizada; `fila` es el número de línea en el archivo (el encabezado es la 1). */
export type FilaImportacion = { fila: number } & Record<ColumnaPlantilla, string>

export type PlanillaProductos = { filas: FilaImportacion[]; separador: ',' | ';' }

export type EstadoValidacion = 'ok' | 'aviso' | 'error'
export type AccionImportacion = 'nuevo' | 'actualiza'

export type FilaValidada = {
  fila: number
  sku: string
  accion: AccionImportacion
  estado: EstadoValidacion
  mensaje: string
}

export type EstadoImportacion = 'en_cola' | 'aplicando' | 'terminada' | 'fallida'

export type ErrorFila = { fila: number; sku: string; mensaje: string }

export type ImportacionObtenida = {
  estado: EstadoImportacion
  total_filas: number
  importables: number
  procesadas: number
  omitidas: number
  mensaje_fallo: string | null
  errores: ErrorFila[]
}

export type ResultadoSolicitud = { importacion_id: string; estado: EstadoImportacion; importables: number; omitidas: number }

// Importes: acepta «1200», «1200,50» y «1.200,50» (Excel en castellano) y los lleva a «1200.50». Lo que
// no se reconoce queda como vino: el servidor lo marca como error con su motivo.
export function normalizarImporte(valor: string): string {
  const limpio = valor.replace(/\s|\$/g, '')
  if (limpio === '') return ''
  if (limpio.includes(',') && limpio.includes('.')) {
    const decimal = limpio.lastIndexOf(',') > limpio.lastIndexOf('.') ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    return limpio.split(miles).join('').replace(decimal, '.')
  }
  return limpio.includes(',') ? limpio.replace(',', '.') : limpio
}

const COLUMNAS_IMPORTE: readonly ColumnaPlantilla[] = ['costo', 'precio_x1', 'precio_x5', 'precio_x10', 'precio_x50']

// Pasa un CSV ya parseado a filas de planilla. Reglas de FR-102/FR-103 y edge cases: sin columnas
// obligatorias o con más de 2.000 filas no hay vista previa.
export function normalizarCsv(csv: CsvLeido): PlanillaProductos {
  const encabezados = csv.encabezados.map((encabezado) => encabezado.trim().toLowerCase())
  const faltantes = COLUMNAS_OBLIGATORIAS.filter((columna) => !encabezados.includes(columna))
  if (faltantes.length > 0) {
    throw new ErrorImportacion(`Faltan columnas obligatorias: ${faltantes.join(', ')}. Descargá la plantilla para ver el formato.`)
  }
  if (csv.filas.length > MAXIMO_FILAS_IMPORTACION) {
    throw new ErrorImportacion(`El archivo tiene más de ${MAXIMO_FILAS_IMPORTACION.toLocaleString('es-AR')} filas. Dividilo en archivos más chicos.`)
  }
  const posicion = Object.fromEntries(COLUMNAS_PLANTILLA.map((columna) => [columna, encabezados.indexOf(columna)])) as Record<ColumnaPlantilla, number>

  const filas = csv.filas.map((fila) => {
    const valores = Object.fromEntries(
      COLUMNAS_PLANTILLA.map((columna) => {
        const crudo = posicion[columna] === -1 ? '' : (fila.celdas[posicion[columna]] ?? '').trim()
        return [columna, COLUMNAS_IMPORTE.includes(columna) ? normalizarImporte(crudo) : crudo]
      }),
    ) as Record<ColumnaPlantilla, string>
    return { fila: fila.numero, ...valores }
  })
  return { filas, separador: csv.separador }
}

/** Lee el CSV (UTF-8, `,` o `;`, con o sin BOM). Un archivo ilegible no avanza. */
export async function leerPlanillaProductos(archivo: ArchivoCsv): Promise<PlanillaProductos> {
  try {
    return normalizarCsv(await leerCsvUtf8(archivo))
  } catch (error) {
    if (error instanceof ErrorCsv) throw new ErrorImportacion(error.message)
    throw error
  }
}

export const armarPlantilla = () => `${COLUMNAS_PLANTILLA.join(',')}\n`

export function descargarPlantilla(): void {
  descargarArchivo(new Blob([`\uFEFF${armarPlantilla()}`], { type: 'text/csv;charset=utf-8' }), NOMBRE_PLANTILLA)
}

/** Resumen del archivo para el paso «1 · Archivos». */
export function resumenCsv(nombre: string, planilla: PlanillaProductos): string {
  return `${nombre} · ${planilla.filas.length.toLocaleString('es-AR')} ${planilla.filas.length === 1 ? 'fila' : 'filas'} · separador «${planilla.separador}»`
}

// ---------------------------------------------------------------------------------------------
// Imágenes (FR-103): JPG/PNG/WebP de hasta 2 MB; ZIP o archivos sueltos. El worker vuelve a
// comprobar los bytes; acá se avisa antes.
// ---------------------------------------------------------------------------------------------

export type ImagenCarga = { nombre: string; tipo: string; blob: Blob }

const TIPO_POR_EXTENSION: Readonly<Record<string, string>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export const tipoDeNombreImagen = (nombre: string) => TIPO_POR_EXTENSION[/\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase() ?? '']

/** Motivo de rechazo de una imagen, o null si se puede subir. */
export function validarImagenCarga(nombre: string, bytes: number): string | null {
  if (!tipoDeNombreImagen(nombre)) return `«${nombre}» no es JPG, PNG ni WebP.`
  if (bytes > MAX_BYTES_IMAGEN_IMPORTACION) return `«${nombre}» pesa más de 2 MB.`
  if (bytes === 0) return `«${nombre}» está vacía.`
  return null
}

export type ImagenesLeidas = { imagenes: ImagenCarga[]; rechazadas: string[] }

const nombreBase = (ruta: string) => ruta.split(/[\\/]/).pop() ?? ruta

/** Junta archivos sueltos y ZIP (se abren acá) en una lista de imágenes válidas y los motivos de rechazo. */
export async function leerImagenes(archivos: readonly File[]): Promise<ImagenesLeidas> {
  const imagenes = new Map<string, ImagenCarga>()
  const rechazadas: string[] = []

  const agregar = (nombre: string, bytes: number, blob: Blob) => {
    const motivo = validarImagenCarga(nombre, bytes)
    if (motivo) {
      rechazadas.push(motivo)
      return
    }
    if (imagenes.size >= MAX_IMAGENES_CARGA && !imagenes.has(nombre)) {
      rechazadas.push(`«${nombre}» no entra: el máximo es ${MAX_IMAGENES_CARGA} imágenes por importación.`)
      return
    }
    imagenes.set(nombre, { nombre, tipo: tipoDeNombreImagen(nombre), blob })
  }

  for (const archivo of archivos) {
    if (/\.zip$/i.test(archivo.name)) {
      if (archivo.size > MAX_BYTES_ZIP) {
        rechazadas.push(`«${archivo.name}» pesa más de ${MAX_BYTES_ZIP / (1024 * 1024)} MB.`)
        continue
      }
      try {
        const { unzipSync } = await import('fflate')
        // El filtro corre antes de descomprimir: no se expande lo que ya sabemos que no sirve.
        const contenido = unzipSync(new Uint8Array(await archivo.arrayBuffer()), {
          filter: (entrada) =>
            !entrada.name.endsWith('/') && !entrada.name.startsWith('__MACOSX') &&
            entrada.originalSize <= MAX_BYTES_IMAGEN_IMPORTACION && Boolean(tipoDeNombreImagen(nombreBase(entrada.name))),
        })
        for (const [ruta, bytes] of Object.entries(contenido)) {
          const nombre = nombreBase(ruta)
          agregar(nombre, bytes.length, new Blob([bytes as BlobPart], { type: tipoDeNombreImagen(nombre) }))
        }
      } catch {
        rechazadas.push(`No pudimos abrir «${archivo.name}». Verificá que sea un ZIP válido.`)
      }
      continue
    }
    agregar(archivo.name, archivo.size, archivo)
  }
  return { imagenes: [...imagenes.values()], rechazadas }
}

/** Sube las imágenes al bucket temporal (`<organización>/<clave>/<archivo>`). Devuelve las que fallaron. */
export async function subirImagenes(organizacionId: string, clave: string, imagenes: readonly ImagenCarga[]): Promise<string[]> {
  const fallidas: string[] = []
  const bucket = supabaseClient.storage.from(BUCKET_IMPORTACIONES)
  for (const imagen of imagenes) {
    const { error } = await bucket.upload(`${organizacionId}/${clave}/${imagen.nombre}`, imagen.blob, { contentType: imagen.tipo, upsert: true })
    if (error) {
      console.error('subida de imagen de importación falló', error)
      fallidas.push(imagen.nombre)
    }
  }
  return fallidas
}

/** Descarta las imágenes temporales de una vista previa cancelada (no es crítico si falla). */
export async function descartarImagenes(organizacionId: string, clave: string, nombres: readonly string[]): Promise<void> {
  if (nombres.length === 0) return
  const { error } = await supabaseClient.storage.from(BUCKET_IMPORTACIONES).remove(nombres.map((nombre) => `${organizacionId}/${clave}/${nombre}`))
  if (error) console.error('no se pudieron descartar las imágenes temporales', error)
}

// ---------------------------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------------------------

export function filasParaRpc(filas: readonly FilaImportacion[]) {
  return filas.map((fila) => ({ ...fila }))
}

export async function validarImportacion(filas: readonly FilaImportacion[], clave: string): Promise<FilaValidada[]> {
  const { data, error } = await supabaseClient.rpc('validar_importacion_productos', { p_filas: filasParaRpc(filas), p_clave: clave })
  if (error) throw error
  return (data ?? []) as FilaValidada[]
}

export async function solicitarImportacion(filas: readonly FilaImportacion[], clave: string): Promise<ResultadoSolicitud> {
  const { data, error } = await supabaseClient.rpc('solicitar_importacion_productos', { p_filas: filasParaRpc(filas), p_clave: clave })
  if (error) throw error
  return data as ResultadoSolicitud
}

export async function obtenerImportacion(importacionId: string): Promise<ImportacionObtenida> {
  const { data, error } = await supabaseClient.rpc('obtener_importacion_productos', { p_importacion_id: importacionId })
  if (error) throw error
  return data as ImportacionObtenida
}

export const contarPorEstado = (filas: readonly FilaValidada[], estado: EstadoValidacion) => filas.filter((fila) => fila.estado === estado).length
export const contarImportables = (filas: readonly FilaValidada[]) => filas.filter((fila) => fila.estado !== 'error').length

export const ROTULO_ESTADO: Readonly<Record<EstadoImportacion, string>> = {
  en_cola: 'En cola',
  aplicando: 'Aplicando',
  terminada: 'Terminada',
  fallida: 'Fallida',
}

export function mensajeFinal(procesadas: number, omitidas: number): string {
  return `Importación terminada. ${procesadas} ${procesadas === 1 ? 'producto procesado' : 'productos procesados'}, ${omitidas} ${omitidas === 1 ? 'omitido' : 'omitidos'} por error. Ya figuran en Catálogo · Productos.`
}

// ---------------------------------------------------------------------------------------------
// Reporte de errores (FR-110): CSV con fila, SKU y motivo de las filas omitidas.
// ---------------------------------------------------------------------------------------------

export const NOMBRE_REPORTE_ERRORES = 'errores-importacion-productos.csv'

export function armarReporteErrores(errores: readonly ErrorFila[]): string {
  const celda = (valor: string | number) => escaparCampoCsv(neutralizarFormula(String(valor)))
  const lineas = [['fila', 'sku', 'motivo'].join(','), ...errores.map((e) => [celda(e.fila), celda(e.sku), celda(e.mensaje)].join(','))]
  return `\uFEFF${lineas.join('\r\n')}\r\n`
}

export function descargarReporteErrores(errores: readonly ErrorFila[]): void {
  descargarArchivo(new Blob([armarReporteErrores(errores)], { type: 'text/csv;charset=utf-8' }), NOMBRE_REPORTE_ERRORES)
}

export function mensajeDeErrorImportacion(error: unknown, porDefecto: string): string {
  console.error(porDefecto, error)
  const e = error as { code?: string; message?: string } | null
  if (e?.code === '42501') return 'No tenés permiso para importar productos. Puede que tu rol haya cambiado: recargá la página.'
  if (e?.code === '22023' && e.message) return e.message.replace(/^[A-Z_]+:\s*/, '')
  if (e?.message?.startsWith('SIN_CONEXION_IMPORTACION')) return 'Tu organización todavía no tiene habilitada la importación de productos. Pedile a soporte que la active.'
  return porDefecto
}
