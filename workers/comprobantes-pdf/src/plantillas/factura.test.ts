import { describe, expect, it } from 'vitest';
import { datosDePrueba } from '../fixtures.js';
import { armarFactura } from './factura.js';

describe('factura interna (FR-009)', () => {
  const m = armarFactura(datosDePrueba('factura'));

  it('lleva la leyenda de documento no válido como factura', () => {
    expect(m.leyenda).toBe('Documento no válido como factura');
  });

  it('encabeza con razón social, CUIT, dirección y contacto de la empresa', () => {
    expect(m.empresa).toEqual(['San Javucho SRL', 'San Javucho', 'CUIT 30-71234567-8', 'Calle 1 123, Rosario', 'ventas@sanjavucho.test']);
  });

  it('muestra número, fecha, operador y cliente', () => {
    expect(m.datos).toEqual([['Número', '00000001'], ['Fecha', '25/10/2026'], ['Operador', 'Luis Gómez']]);
    expect(m.cliente).toEqual(['Ana Pérez', 'CUIT / DNI 20123456786', 'Dirección de entrega: Mitre 45, Rosario, Santa Fe']);
  });

  it('arma la tabla Producto · Cantidad · Precio · Importe y los totales', () => {
    expect(m.columnas.map((c) => c.titulo)).toEqual(['Producto', 'Cantidad', 'Precio', 'Importe']);
    expect(m.filas).toHaveLength(2);
    expect(m.filas[0][0]).toBe('Funda de silicona');
    expect(m.filas[0][1]).toBe('2');
    expect(m.filas[0][3].replace(/\s/g, ' ')).toContain('800,00');
    expect(m.totales.map(([etiqueta]) => etiqueta)).toEqual(['Subtotal sin IVA', 'IVA', 'Total']);
    expect(m.totales[2][1].replace(/\s/g, ' ')).toContain('1.210,00');
  });

  it('indica forma de pago y envío elegidos', () => {
    expect(m.notas).toEqual(['Forma de pago: Transferencia', 'Envío: Retiro en tienda']);
  });

  it('omite lo que no está cargado', () => {
    const base = datosDePrueba('factura');
    const sin = armarFactura({
      ...base,
      empresa: { ...base.empresa, razon_social: null, cuit: null, direccion: null, correo: null },
      cliente: { nombre: 'Ana Pérez', documento: null, direccion: null },
      comprobante: { ...base.comprobante, operador: null, fecha: null, forma_pago: null, envio: null },
    });
    expect(sin.empresa).toEqual(['San Javucho']);
    expect(sin.cliente).toEqual(['Ana Pérez']);
    expect(sin.datos).toEqual([['Número', '00000001']]);
    expect(sin.notas).toEqual([]);
  });
});
