import { describe, expect, it } from 'vitest';
import { datosDePrueba } from '../fixtures.js';
import { PLANTILLAS } from '../generar.js';
import { armarPresupuesto } from './presupuesto.js';

const presupuesto = () => {
  const base = datosDePrueba('presupuesto');
  return {
    ...base,
    comprobante: { ...base.comprobante, tipo: 'presupuesto', estado: 'pendiente', numero: 'P-0007', valido_hasta: '2026-11-30' },
    cliente: { nombre: 'Ana Pérez', documento: '20123456786', direccion: 'Mitre 45', condicion_iva: 'Responsable Inscripto' },
  };
};

describe('presupuesto (FR-020)', () => {
  const m = armarPresupuesto(presupuesto());

  it('lleva las dos leyendas: no válido como factura y sin valor fiscal', () => {
    expect(m.titulo).toBe('Presupuesto');
    expect(m.leyenda).toContain('Documento no válido como factura');
    expect(m.leyenda).toContain('Versión sin valor fiscal');
  });

  it('encabeza con los datos de la empresa', () => {
    expect(m.empresa[0]).toBe('San Javucho SRL');
    expect(m.empresa).toContain('CUIT 30-71234567-8');
  });

  it('muestra número, fecha y «Válido hasta»', () => {
    expect(m.datos).toEqual([['Número', 'P-0007'], ['Fecha', '25/10/2026'], ['Válido hasta', '30/11/2026']]);
  });

  it('omite «Válido hasta» cuando no está cargado', () => {
    const p = presupuesto();
    const sin = armarPresupuesto({ ...p, comprobante: { ...p.comprobante, valido_hasta: null } });
    expect(sin.datos.map(([etiqueta]) => etiqueta)).toEqual(['Número', 'Fecha']);
  });

  it('identifica al cliente sin dirección de entrega', () => {
    expect(m.cliente).toEqual(['Ana Pérez', 'CUIT / DNI 20123456786', 'Condición frente al IVA: Responsable Inscripto']);
  });

  it('arma la tabla Producto · Cantidad · Precio · Importe y los totales', () => {
    expect(m.columnas.map((c) => c.titulo)).toEqual(['Producto', 'Cantidad', 'Precio', 'Importe']);
    expect(m.filas).toHaveLength(2);
    expect(m.filas[0][0]).toBe('Funda de silicona');
    expect(m.filas[0][3].replace(/\s/g, ' ')).toContain('800,00');
    expect(m.totales.map(([etiqueta]) => etiqueta)).toEqual(['Subtotal sin IVA', 'IVA', 'Total']);
    expect(m.totales[2][1].replace(/\s/g, ' ')).toContain('1.210,00');
  });

  it('está registrada en el worker como plantilla del tipo presupuesto', () => {
    expect(PLANTILLAS.presupuesto).toBe(armarPresupuesto);
  });
});
