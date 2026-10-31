import type { ColumnaCsv } from './exportarCsv'
import { formatearDiaCompleto, listarReparaciones, type FiltrosReparaciones, type ReparacionListada } from './reparacionesListado'
import { formatearARS } from './serviceTecnico'

// Exportación del listado de Reparaciones a CSV (F-SVC-23, FR-060/FR-061). No hay RPC nueva: se pide
// `listar_reparaciones` (con su RLS) por lotes con los filtros congelados al pulsar «Exportar». Las
// nueve columnas son las del listado y salen como se ven; nunca costos internos ni ganancia.

// El máximo de filas que acepta `listar_reparaciones` por página.
export const TAMANO_LOTE_REPARACIONES = 200

// Filtros de la exportación: los del listado sin la paginación (la fija el lote).
export type FiltrosExportacionReparaciones = Omit<FiltrosReparaciones, 'pagina' | 'tamano'>

export const COLUMNAS: readonly ColumnaCsv<ReparacionListada>[] = [
  { encabezado: 'Reparación', valor: (reparacion) => reparacion.codigo },
  { encabezado: 'Tienda', valor: (reparacion) => reparacion.empresa },
  { encabezado: 'Cliente', valor: (reparacion) => reparacion.cliente },
  { encabezado: 'Equipo', valor: (reparacion) => `${reparacion.equipo} ${reparacion.modelo}`.trim() },
  { encabezado: 'N.º de serie', valor: (reparacion) => reparacion.numero_serie ?? '—' },
  { encabezado: 'Estado', valor: (reparacion) => reparacion.estado },
  { encabezado: 'Técnico', valor: (reparacion) => reparacion.tecnico ?? '—' },
  { encabezado: 'Entrega', valor: (reparacion) => (reparacion.entrega_prevista ? formatearDiaCompleto(reparacion.entrega_prevista) : '—') },
  { encabezado: 'Total', valor: (reparacion) => (reparacion.total_cliente > 0 ? formatearARS(reparacion.total_cliente) : 'A presupuestar') },
]

// Mismo contrato que `pedirLote` de `useExportarCsv`: `limite` filas a partir de la posición `desde`, sobre
// páginas de 200. El orden de la RPC es estable (ingreso, número, id), así que los lotes no se pisan.
export async function pedirLoteReparaciones(
  filtros: FiltrosExportacionReparaciones,
  desde: number,
  limite: number,
): Promise<ReparacionListada[]> {
  const pagina = Math.floor(desde / TAMANO_LOTE_REPARACIONES) + 1
  const { filas } = await listarReparaciones({ ...filtros, pagina, tamano: TAMANO_LOTE_REPARACIONES })
  const inicio = desde % TAMANO_LOTE_REPARACIONES
  return filas.slice(inicio, inicio + limite)
}
