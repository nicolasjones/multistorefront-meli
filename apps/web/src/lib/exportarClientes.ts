import { supabaseClient } from './supabase'
import type { TipoCliente } from './clientes'

// Exportación de clientes a .xlsx (F-CLI-04, FR-011/FR-012). Los lotes salen de
// `public.exportar_clientes` (security definer: la base exige la acción
// «exportar» y acota a la organización); acá solo se arma el archivo.

export const TAMANO_LOTE_EXPORTACION = 1000
export const NOMBRE_HOJA = 'Clientes'

export type FiltrosExportacion = {
  texto: string
  tipo: TipoCliente | null
  archivados: boolean
  /** Tienda (empresa) por la que se filtra la exportación (F-CLI-11); null = todas. */
  empresaId: string | null
  /** «Con cuenta web»: mismos clientes que el filtro del listado (FR-014). */
  conCuentaWeb: boolean
}

export type FilaExportacion = {
  id: string
  numero: number
  nombre: string
  documento: string | null
  tipo: TipoCliente
  correo: string | null
  telefono: string | null
  celular: string | null
  direccion: string | null
  codigo_postal: string | null
  localidad: string | null
  provincia: string | null
  expreso_preferido: string | null
  archivado_en: string | null
  total: number | string
}

export type ProgresoExportacion = { descargados: number; total: number }

export class ErrorExportacion extends Error {
  readonly codigo?: string
  constructor(mensaje: string, codigo?: string) {
    super(mensaje)
    this.codigo = codigo
    this.name = 'ErrorExportacion'
  }
}

export class ExportacionCancelada extends Error {
  constructor() {
    super('Exportación cancelada')
    this.name = 'ExportacionCancelada'
  }
}

const COLUMNAS: ReadonlyArray<{ encabezado: string; valor: (fila: FilaExportacion) => string | number | null; ancho: number }> = [
  { encabezado: 'Nº', valor: (f) => f.numero, ancho: 8 },
  { encabezado: 'Nombre o razón social', valor: (f) => f.nombre, ancho: 32 },
  { encabezado: 'DNI/CUIT', valor: (f) => f.documento, ancho: 16 },
  { encabezado: 'Tipo', valor: (f) => (f.tipo === 'mayorista' ? 'Mayorista' : 'Minorista'), ancho: 12 },
  { encabezado: 'Correo', valor: (f) => f.correo, ancho: 28 },
  { encabezado: 'Teléfono', valor: (f) => f.telefono, ancho: 16 },
  { encabezado: 'Celular', valor: (f) => f.celular, ancho: 16 },
  { encabezado: 'Dirección', valor: (f) => f.direccion, ancho: 30 },
  { encabezado: 'Código postal', valor: (f) => f.codigo_postal, ancho: 14 },
  { encabezado: 'Localidad', valor: (f) => f.localidad, ancho: 20 },
  { encabezado: 'Provincia', valor: (f) => f.provincia, ancho: 20 },
  { encabezado: 'Expreso preferido', valor: (f) => f.expreso_preferido, ancho: 22 },
  { encabezado: 'Estado', valor: (f) => (f.archivado_en ? 'Archivado' : 'Activo'), ancho: 12 },
]

// Las hojas de cálculo interpretan como fórmula un texto que empieza con
// = + - @ (o tab / retorno); por eso se le antepone un apóstrofo
// (OWASP, «CSV injection») y además cada celda se escribe con type String.
// El apóstrofo queda visible en la celda (p. ej. un teléfono «+54…» se ve
// «'+54…»): es el costo aceptado de la defensa.
export function neutralizarFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
}

function celdaTexto(valor: string | number | null) {
  if (valor === null || valor === '') return null
  return { type: String, value: neutralizarFormula(String(valor)) }
}

export function filasPlanilla(filas: readonly FilaExportacion[]) {
  return filas.map((fila) => COLUMNAS.map((columna) => celdaTexto(columna.valor(fila))))
}

async function pedirLote(filtros: FiltrosExportacion, despuesDe: string | null): Promise<FilaExportacion[]> {
  const { data, error } = await supabaseClient.rpc('exportar_clientes', {
    p_texto: filtros.texto.trim() === '' ? null : filtros.texto.trim(),
    p_tipo: filtros.tipo,
    p_archivados: filtros.archivados,
    p_despues_de: despuesDe,
    p_limite: TAMANO_LOTE_EXPORTACION,
    p_empresa_id: filtros.empresaId,
    p_con_cuenta_web: filtros.conCuentaWeb,
  })
  if (error) {
    const { code } = error as { code?: string }
    if (code === '54000') throw new ErrorExportacion('Son demasiados clientes para un solo archivo. Afiná la búsqueda e intentá de nuevo.', code)
    if (code === '42501') throw new ErrorExportacion('No tenés permiso para exportar clientes.', code)
    if (code === '40001') throw new ErrorExportacion('Los clientes cambiaron mientras se exportaba. Intentá de nuevo.', code)
    console.error('exportar_clientes falló', error)
    throw new ErrorExportacion('No pudimos exportar los clientes. Intentá de nuevo.', code)
  }
  return (data ?? []) as FilaExportacion[]
}

// Descarga todos los lotes (keyset) y arma el .xlsx. La librería de planillas
// se carga recién acá (import diferido): no pesa en el recorrido principal.
export async function exportarClientes(
  filtros: FiltrosExportacion,
  { alProgresar, signal }: { alProgresar?: (progreso: ProgresoExportacion) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const filas: FilaExportacion[] = []
  let despuesDe: string | null = null
  let total = 0
  for (;;) {
    if (signal?.aborted) throw new ExportacionCancelada()
    const lote = await pedirLote(filtros, despuesDe)
    if (signal?.aborted) throw new ExportacionCancelada()
    if (lote.length === 0) break
    if (despuesDe === null) total = Number(lote[0].total)
    filas.push(...lote)
    despuesDe = lote[lote.length - 1].id
    alProgresar?.({ descargados: filas.length, total })
    if (lote.length < TAMANO_LOTE_EXPORTACION) break
  }
  if (signal?.aborted) throw new ExportacionCancelada()

  let blob: Blob
  try {
    const { default: escribirXlsx } = await import('write-excel-file/browser')
    const encabezados = COLUMNAS.map((columna) => ({ type: String, value: columna.encabezado, fontWeight: 'bold' as const }))
    blob = await escribirXlsx(
      [encabezados, ...filasPlanilla(filas)],
      { sheet: NOMBRE_HOJA, columns: COLUMNAS.map((columna) => ({ width: columna.ancho })), stickyRowsCount: 1 },
    ).toBlob()
  } catch (error) {
    console.error('armado del .xlsx falló', error)
    throw new ErrorExportacion('No pudimos armar el archivo. Intentá de nuevo.')
  }
  if (signal?.aborted) throw new ExportacionCancelada()
  return blob
}

export function nombreArchivoExportacion(fecha: Date = new Date()): string {
  return `clientes-${fecha.toISOString().slice(0, 10)}.xlsx`
}

export function descargarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
