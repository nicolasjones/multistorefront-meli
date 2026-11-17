import { listarComprobantes, type ComprobanteListado, type FiltrosComprobantes } from './ventasComprobantes'

// Tope de páginas que recorre `listarFacturasElegibles`: acota las consultas si casi todo es borrador o anulado.
export const PAGINAS_MAXIMAS_ELEGIBLES = 10
export const TAMANO_PAGINA_ELEGIBLES = 50

/**
 * Facturas que pasan `esElegible`, hasta `cantidad`, filtrando cada página y recorriendo páginas hasta juntarlas (o
 * agotar el listado o el tope de páginas). Antes se pedía solo la página 1 y se filtraba en el cliente: con borradores,
 * anuladas o notas de crédito entre los más recientes, las facturas buenas quedaban en la página 2 y la búsqueda decía
 * «No hay facturas para elegir» aunque existieran.
 */
export async function listarFacturasElegibles(
  filtros: FiltrosComprobantes,
  esElegible: (comprobante: ComprobanteListado) => boolean,
  cantidad = 20,
): Promise<ComprobanteListado[]> {
  const elegidas: ComprobanteListado[] = []
  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS_ELEGIBLES; pagina++) {
    const { comprobantes, total } = await listarComprobantes(filtros, pagina, TAMANO_PAGINA_ELEGIBLES)
    for (const c of comprobantes) {
      if (c.tipo === 'factura' && esElegible(c)) elegidas.push(c)
      if (elegidas.length >= cantidad) return elegidas
    }
    if (comprobantes.length === 0 || pagina * TAMANO_PAGINA_ELEGIBLES >= total) break
  }
  return elegidas
}
