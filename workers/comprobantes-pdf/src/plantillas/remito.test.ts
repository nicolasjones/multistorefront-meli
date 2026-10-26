import { describe, expect, it } from 'vitest';
import { datosDePrueba } from '../fixtures.js';
import { armarRemito } from './remito.js';

describe('remito (FR-010)', () => {
  const m = armarRemito(datosDePrueba('remito'));

  it('lleva encabezado de empresa y leyenda', () => {
    expect(m.empresa[0]).toBe('San Javucho SRL');
    expect(m.leyenda).toBe('Documento no válido como factura');
  });

  it('muestra número del comprobante, fecha, cliente y dirección de entrega', () => {
    expect(m.datos).toEqual([['Comprobante', '00000001'], ['Fecha', '25/10/2026']]);
    expect(m.cliente).toEqual(['Ana Pérez', 'Dirección de entrega: Mitre 45, Rosario, Santa Fe']);
    expect(m.notas).toEqual(['Envío: Retiro en tienda']);
  });

  it('arma la tabla Producto · Código · Cantidad · Depósito', () => {
    expect(m.columnas.map((c) => c.titulo)).toEqual(['Producto', 'Código', 'Cantidad', 'Depósito']);
    expect(m.filas).toEqual([
      ['Funda de silicona', 'FS-01', '2', 'Central'],
      ['Vidrio templado', '', '1', 'Central'],
    ]);
  });

  it('no incluye importes ni totales', () => {
    expect(m.totales).toEqual([]);
    expect(JSON.stringify(m)).not.toMatch(/\$|IVA|Precio|Importe/);
  });
});
