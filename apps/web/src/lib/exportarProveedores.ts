import { ErrorExportacion, ExportacionCancelada, neutralizarFormula } from './exportarClientes'
import { hoyEnOrganizacion } from './periodosRanking'
import { supabaseClient } from './supabase'
import { formatearCuit } from './cuit'
import type { EstadoProveedores } from '../hooks/useListarProveedores'
import { esCodigoDeConflicto } from './mensajeErrorBase'

// Exportación del listado de proveedores a .xlsx (MSF-526). Los lotes salen de
// `public.exportar_proveedores` (security definer: la base exige la acción «exportar» y acota a la
// organización); acá solo se arma el archivo. Mismo patrón que `exportarClientes`.

export const TAMANO_LOTE_EXPORTACION_PROVEEDORES = 1000
export const NOMBRE_HOJA_PROVEEDORES = 'Proveedores'

export type FiltrosExportacionProveedores = {
  texto: string
  estado: EstadoProveedores
  /** Tienda por la que se filtra (la del listado); null = todas. */
  empresaId: string | null
}

export type FilaExportacionProveedor = {
  id: string
  numero: number
  razon_social: string
  cuit: string
  compra_para: string
  correo: string | null
  telefono: string | null
  activo: boolean
  total: number | string
}

export type ProgresoExportacionProveedores = { descargados: number; total: number }

const COLUMNAS: ReadonlyArray<{ encabezado: string; valor: (fila: FilaExportacionProveedor) => string | number | null; ancho: number }> = [
  { encabezado: 'N.º', valor: (f) => f.numero, ancho: 8 },
  { encabezado: 'Razón social', valor: (f) => f.razon_social, ancho: 34 },
  { encabezado: 'CUIT', valor: (f) => formatearCuit(f.cuit), ancho: 16 },
  { encabezado: 'Compra para', valor: (f) => f.compra_para, ancho: 28 },
  { encabezado: 'Correo', valor: (f) => f.correo, ancho: 28 },
  { encabezado: 'Teléfono', valor: (f) => f.telefono, ancho: 16 },
  { encabezado: 'Estado', valor: (f) => (f.activo ? 'Activo' : 'Inactivo'), ancho: 12 },
]

function celdaTexto(valor: string | number | null) {
  if (valor === null || valor === '') return null
  return { type: String, value: neutralizarFormula(String(valor)) }
}

export function filasPlanillaProveedores(filas: readonly FilaExportacionProveedor[]) {
  return filas.map((fila) => COLUMNAS.map((columna) => celdaTexto(columna.valor(fila))))
}

async function pedirLote(filtros: FiltrosExportacionProveedores, despuesDe: string | null): Promise<FilaExportacionProveedor[]> {
  const { data, error } = await supabaseClient.rpc('exportar_proveedores', {
    p_texto: filtros.texto.trim() === '' ? null : filtros.texto.trim(),
    p_estado: filtros.estado,
    p_empresa_id: filtros.empresaId,
    p_despues_de: despuesDe,
    p_limite: TAMANO_LOTE_EXPORTACION_PROVEEDORES,
  })
  if (error) {
    const { code } = error as { code?: string }
    if (code === '54000') throw new ErrorExportacion('Son demasiados proveedores para un solo archivo. Afiná la búsqueda e intentá de nuevo.', code)
    if (code === '42501') throw new ErrorExportacion('No tenés permiso para exportar proveedores.', code)
    if (esCodigoDeConflicto(code)) throw new ErrorExportacion('Los proveedores cambiaron mientras se exportaba. Intentá de nuevo.', code)
    console.error('exportar_proveedores falló', error)
    throw new ErrorExportacion('No pudimos exportar los proveedores. Intentá de nuevo.', code)
  }
  return (data ?? []) as FilaExportacionProveedor[]
}

// Descarga todos los lotes (keyset) y arma el .xlsx. La librería de planillas se carga recién acá.
export async function exportarProveedores(
  filtros: FiltrosExportacionProveedores,
  { alProgresar, signal }: { alProgresar?: (progreso: ProgresoExportacionProveedores) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const filas: FilaExportacionProveedor[] = []
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
    if (lote.length < TAMANO_LOTE_EXPORTACION_PROVEEDORES) break
  }
  if (signal?.aborted) throw new ExportacionCancelada()

  let blob: Blob
  try {
    const { default: escribirXlsx } = await import('write-excel-file/browser')
    const encabezados = COLUMNAS.map((columna) => ({ type: String, value: columna.encabezado, fontWeight: 'bold' as const }))
    blob = await escribirXlsx(
      [encabezados, ...filasPlanillaProveedores(filas)],
      { sheet: NOMBRE_HOJA_PROVEEDORES, columns: COLUMNAS.map((columna) => ({ width: columna.ancho })), stickyRowsCount: 1 },
    ).toBlob()
  } catch (error) {
    console.error('armado del .xlsx falló', error)
    throw new ErrorExportacion('No pudimos armar el archivo. Intentá de nuevo.')
  }
  if (signal?.aborted) throw new ExportacionCancelada()
  return blob
}

export function nombreArchivoExportacionProveedores(fecha: Date = new Date()): string {
  return `proveedores-${hoyEnOrganizacion(fecha)}.xlsx`
}
