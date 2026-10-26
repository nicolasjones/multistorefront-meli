import { supabaseClient } from './supabase'
import { neutralizarFormula } from './exportarClientes'
import { parametrosDeFiltros, type FiltrosComprobantes } from './ventasComprobantes'

// Exportación de comprobantes y presupuestos a CSV (F-VTA-09, MSF-346, FR-006/FR-007/FR-010). Hasta 10.000 filas
// el navegador arma el CSV con `exportar_comprobantes`; por encima, la base registra la solicitud
// (`solicitar_exportacion_comprobantes`) y el worker `exportar-comprobantes` lo genera. El formato del CSV es el mismo
// en las dos vías (ver workers/exportar-comprobantes): separador «;», BOM UTF-8 y CRLF para que Excel lo abra bien.
// El helper de neutralización de fórmulas y la descarga son los de `exportarClientes.ts`.

export { descargarArchivo } from './exportarClientes'

export type TipoExportacion = 'comprobantes' | 'presupuestos'

/** Tope de la vía inmediata; coincide con el de `exportar_comprobantes` en la base. */
export const TOPE_EXPORTACION_INMEDIATA = 10000

export type ViaExportacion = 'vacia' | 'inmediata' | 'diferida'

export const viaDeExportacion = (total: number): ViaExportacion =>
  total <= 0 ? 'vacia' : total <= TOPE_EXPORTACION_INMEDIATA ? 'inmediata' : 'diferida'

export class ErrorExportacionComprobantes extends Error {
  readonly codigo?: string
  constructor(mensaje: string, codigo?: string) {
    super(mensaje)
    this.codigo = codigo
    this.name = 'ErrorExportacionComprobantes'
  }
}

export type FilaExportacionComprobante = {
  numero: string
  tipo: string
  empresa: string
  fecha: string
  cliente: string
  operador: string
  estado_etiqueta: string
  forma_pago: string | null
  envio: string | null
  total: number | string
  filas: number | string
}

const ETIQUETA_TIPO: Readonly<Record<string, string>> = { factura: 'Factura', nota_credito: 'Nota de crédito', presupuesto: 'Presupuesto' }

const ENCABEZADOS = ['Comprobante', 'Tipo', 'Tienda', 'Fecha', 'Cliente', 'Operador', 'Estado', 'Pago', 'Envío', 'Total'] as const

const SEPARADOR = ';'
const FIN_DE_LINEA = '\r\n'
const BOM = '﻿'

// RFC 4180: se entrecomilla lo que trae separador, comillas o saltos de línea; las comillas se duplican.
function celda(valor: string): string {
  const texto = neutralizarFormula(valor)
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

const fechaLegible = (iso: string): string => {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : iso
}

// El total es un número (no un texto): una nota de crédito en negativo NO lleva el apóstrofo de la neutralización.
const importeLegible = (total: number | string): string => Number(total).toFixed(2).replace('.', ',')

export function construirCsv(filas: ReadonlyArray<FilaExportacionComprobante>): string {
  const lineas = [ENCABEZADOS.join(SEPARADOR)]
  for (const f of filas) {
    lineas.push(
      [
        celda(f.numero),
        celda(ETIQUETA_TIPO[f.tipo] ?? f.tipo),
        celda(f.empresa),
        fechaLegible(f.fecha),
        celda(f.cliente),
        celda(f.operador),
        celda(f.estado_etiqueta),
        celda(f.forma_pago ?? ''),
        celda(f.envio ?? ''),
        importeLegible(f.total),
      ].join(SEPARADOR),
    )
  }
  return BOM + lineas.join(FIN_DE_LINEA) + FIN_DE_LINEA
}

function errorDeExportacion(error: unknown, porDefecto: string): ErrorExportacionComprobantes {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  if (code === '42501') return new ErrorExportacionComprobantes('No tenés permiso para exportar ventas.', code)
  if (message?.startsWith('YA_EN_CURSO')) {
    return new ErrorExportacionComprobantes('Ya tenés una exportación grande en curso. Esperá a que termine para pedir otra.', code)
  }
  if (message?.startsWith('SIN_CONEXION_EXPORTACION')) {
    return new ErrorExportacionComprobantes('La exportación de archivos grandes todavía no está habilitada para tu organización. Pedile a un administrador que la active.', code)
  }
  console.error(porDefecto, error)
  return new ErrorExportacionComprobantes(porDefecto, code)
}

/** `truncado`: el filtro creció después del listado y la base cortó en el tope; el archivo no tiene todas las filas. */
export type ResultadoInmediato = { archivo: Blob; filas: number; truncado: boolean }

// Vía inmediata: trae TODAS las filas del filtro (no la página) y arma el CSV en el navegador.
export async function exportarInmediato(tipo: TipoExportacion, filtros: FiltrosComprobantes): Promise<ResultadoInmediato> {
  const { data, error } = await supabaseClient.rpc('exportar_comprobantes', { p_tipo: tipo, ...parametrosDeFiltros(filtros) })
  if (error) throw errorDeExportacion(error, 'No pudimos exportar los comprobantes. Intentá de nuevo.')
  const filas = (data ?? []) as FilaExportacionComprobante[]
  const totalReal = filas.length > 0 ? Number(filas[0].filas) : 0
  return {
    archivo: new Blob([construirCsv(filas)], { type: 'text/csv;charset=utf-8' }),
    filas: filas.length,
    truncado: totalReal > filas.length,
  }
}

// Vía diferida: la base registra la ejecución del worker con estos filtros y devuelve su id.
export async function solicitarExportacionDiferida(tipo: TipoExportacion, filtros: FiltrosComprobantes): Promise<string> {
  const p = parametrosDeFiltros(filtros)
  const { data, error } = await supabaseClient.rpc('solicitar_exportacion_comprobantes', {
    p_tipo: tipo,
    p_filtros: {
      busqueda: p.p_busqueda,
      estado: p.p_estado,
      pago_id: p.p_pago_id,
      envio_id: p.p_envio_id,
      operador_id: p.p_operador_id,
      empresa_id: p.p_empresa_id,
    },
  })
  if (error) throw errorDeExportacion(error, 'No pudimos pedir la exportación. Intentá de nuevo.')
  return data as string
}

// Descarga del CSV de una exportación diferida: la base dice si terminó y de quién es; la URL firmada dura 60 s.
export async function descargarExportacionDiferida(ejecucionId: string, nombre: string): Promise<void> {
  const { data, error } = await supabaseClient.rpc('archivo_exportacion_comprobantes', { p_ejecucion_id: ejecucionId })
  if (error) throw errorDeExportacion(error, 'No pudimos buscar tu exportación. Intentá de nuevo.')
  const fila = (Array.isArray(data) ? data[0] : data) as { estado: string; archivo: string | null } | null
  if (!fila) throw new ErrorExportacionComprobantes('No encontramos esa exportación.')
  if (fila.estado === 'en_curso') throw new ErrorExportacionComprobantes('Tu exportación todavía se está generando. Probá de nuevo en unos minutos.')
  if (fila.estado !== 'exitosa' || !fila.archivo) throw new ErrorExportacionComprobantes('La exportación no pudo completarse. Pedila de nuevo.')
  const { data: firmada, error: errorFirma } = await supabaseClient.storage.from('exportaciones-ventas').createSignedUrl(fila.archivo, 60, { download: nombre })
  if (errorFirma || !firmada?.signedUrl) throw new ErrorExportacionComprobantes('No pudimos preparar la descarga. Intentá de nuevo.')
  const enlace = document.createElement('a')
  enlace.href = firmada.signedUrl
  enlace.download = nombre
  enlace.rel = 'noopener'
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
}

export function nombreArchivoComprobantes(tipo: TipoExportacion, fecha: Date = new Date()): string {
  return `${tipo}-${fecha.toISOString().slice(0, 10)}.csv`
}
