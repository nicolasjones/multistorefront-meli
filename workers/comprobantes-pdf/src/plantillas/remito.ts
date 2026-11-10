// Remito (FR-010, provisorio): sin importes, para el armado y la entrega.
import { formatearCantidad, formatearFecha, lineasEmpresa, LEYENDA_NO_VALIDO } from '../formato.js';
import type { DatosDocumento, ModeloDocumento } from '../tipos.js';

export function armarRemito(d: DatosDocumento): ModeloDocumento {
  const c = d.comprobante;
  const datos: Array<[string, string]> = [['Comprobante', c.numero]];
  const fecha = formatearFecha(c.fecha);
  if (fecha) datos.push(['Fecha', fecha]);

  const cliente = [d.cliente.nombre];
  if (d.cliente.direccion) cliente.push(`Dirección de entrega: ${d.cliente.direccion}`);

  return {
    titulo: 'Remito',
    leyenda: LEYENDA_NO_VALIDO,
    empresa: lineasEmpresa(d.empresa),
    datos,
    cliente,
    columnas: [
      { titulo: 'Producto', ancho: 0.46, alinear: 'left' },
      { titulo: 'Código', ancho: 0.2, alinear: 'left' },
      { titulo: 'Cantidad', ancho: 0.12, alinear: 'right' },
      { titulo: 'Depósito', ancho: 0.22, alinear: 'left' },
    ],
    filas: d.lineas.map((l) => [l.descripcion, l.codigo ?? '', formatearCantidad(l.cantidad), l.deposito ?? '']),
    totales: [],
    notas: c.envio ? [`Envío: ${c.envio}`] : [],
  };
}
