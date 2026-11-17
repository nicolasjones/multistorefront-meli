import { listarComprobantes, type ComprobanteListado, type FiltrosComprobantes } from './ventasComprobantes'

// Tope de páginas que recorre `listarFacturasElegibles`: acota las consultas si casi todo es borrador o anulado.
export const PAGINAS_MAXIMAS_ELEGIBLES = 10
export const TAMANO_PAGINA_ELEGIBLES = 50

export type FacturasElegibles = {
  facturas: ComprobanteListado[]
  /** Se agotó el tope de páginas con resultados pendientes y sin juntar la cantidad pedida: la lista es parcial. */
  truncado: boolean
  /** La búsqueda se canceló a mitad de camino: `facturas` queda vacío y NO es un resultado; el llamador lo descarta. */
  cancelado: boolean
}

/**
 * Facturas que pasan `esElegible`, hasta `cantidad`, filtrando cada página y recorriendo páginas hasta juntarlas (o
 * agotar el listado o el tope de páginas). Antes se pedía solo la página 1 y se filtraba en el cliente: con borradores,
 * anuladas o notas de crédito entre los más recientes, las facturas buenas quedaban en la página 2 y la búsqueda decía
 * «No hay facturas para elegir» aunque existieran. `cancelado` se consulta antes de cada petición: si la persona cerró
 * el diálogo o siguió tipeando, el bucle corta y no pide páginas de más (devuelve `cancelado: true` con la lista vacía: no es un «no hay facturas» ni un resultado parcial).
 */
export async function listarFacturasElegibles(
  filtros: FiltrosComprobantes,
  esElegible: (comprobante: ComprobanteListado) => boolean,
  cantidad = 20,
  cancelado: () => boolean = () => false,
): Promise<FacturasElegibles> {
  const facturas: ComprobanteListado[] = []
  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS_ELEGIBLES; pagina++) {
    if (cancelado()) return { facturas: [], truncado: false, cancelado: true }
    const { comprobantes, total } = await listarComprobantes(filtros, pagina, TAMANO_PAGINA_ELEGIBLES)
    for (const c of comprobantes) {
      if (c.tipo === 'factura' && esElegible(c)) facturas.push(c)
      if (facturas.length >= cantidad) return { facturas, truncado: false, cancelado: false }
    }
    // Una página vacía corta aunque `total` diga que quedan filas (desalineado): no se insiste.
    if (comprobantes.length === 0 || pagina * TAMANO_PAGINA_ELEGIBLES >= total) break
    if (pagina === PAGINAS_MAXIMAS_ELEGIBLES) return { facturas, truncado: true, cancelado: false }
  }
  return { facturas, truncado: false, cancelado: false }
}
