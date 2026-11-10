// Presupuesto (FR-020, provisorio hasta confirmar el formato con el cliente): una sola plantilla para ajustarlo
// sin tocar el resto. Precios sin IVA; el IVA va en los totales.
import { formatearCantidad, formatearFecha, formatearMoneda, lineasEmpresa, LEYENDA_NO_VALIDO } from '../formato.js';
import type { DatosDocumento, ModeloDocumento } from '../tipos.js';

export const LEYENDA_SIN_VALOR_FISCAL = 'Versión sin valor fiscal';

export function armarPresupuesto(d: DatosDocumento): ModeloDocumento {
  const c = d.comprobante;
  const datos: Array<[string, string]> = [['Número', c.numero]];
  const fecha = formatearFecha(c.fecha);
  if (fecha) datos.push(['Fecha', fecha]);
  const validoHasta = formatearFecha(c.valido_hasta);
  if (validoHasta) datos.push(['Válido hasta', validoHasta]);

  const cliente = [d.cliente.nombre];
  if (d.cliente.documento) cliente.push(`CUIT / DNI ${d.cliente.documento}`);
  if (d.cliente.condicion_iva) cliente.push(`Condición frente al IVA: ${d.cliente.condicion_iva}`);

  return {
    titulo: 'Presupuesto',
    leyenda: `${LEYENDA_NO_VALIDO} · ${LEYENDA_SIN_VALOR_FISCAL}`,
    empresa: lineasEmpresa(d.empresa),
    datos,
    cliente,
    columnas: [
      { titulo: 'Producto', ancho: 0.46, alinear: 'left' },
      { titulo: 'Cantidad', ancho: 0.12, alinear: 'right' },
      { titulo: 'Precio', ancho: 0.21, alinear: 'right' },
      { titulo: 'Importe', ancho: 0.21, alinear: 'right' },
    ],
    filas: d.lineas.map((l) => [
      l.descripcion,
      formatearCantidad(l.cantidad),
      formatearMoneda(l.precio_unitario),
      formatearMoneda(l.subtotal_sin_iva),
    ]),
    totales: [
      ['Subtotal sin IVA', formatearMoneda(c.total_sin_iva)],
      ['IVA', formatearMoneda(c.iva)],
      ['Total', formatearMoneda(c.total_con_iva)],
    ],
    notas: [],
  };
}
