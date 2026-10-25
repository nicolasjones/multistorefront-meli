import { describe, expect, it } from 'vitest';
import { ArchivoInvalidoError, decodificar, esXlsx, leerPlanilla } from '../src/lector.js';
import { crearXlsx } from './xlsx.js';

describe('CSV', () => {
  it('detecta la coma, el punto y coma, el tabulador y la barra vertical', async () => {
    for (const sep of [',', ';', '\t', '|']) {
      const csv = `Fecha${sep}Dólar comprador${sep}Dólar vendedor\n10/01/2020${sep}59${sep}63\n`;
      const matriz = await leerPlanilla(Buffer.from(csv, 'utf8'), 'cotizaciones.csv');
      expect(matriz).toEqual([
        ['Fecha', 'Dólar comprador', 'Dólar vendedor'],
        ['10/01/2020', '59', '63'],
      ]);
    }
  });

  it('lee UTF-8 con BOM sin contaminar el primer encabezado', async () => {
    const contenido = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Cliente;Total\nMuñoz;10\n', 'utf8')]);
    const matriz = await leerPlanilla(contenido, 'x.csv');
    expect(matriz[0][0]).toBe('Cliente');
    expect(matriz[1][0]).toBe('Muñoz');
  });

  it('lee Latin-1 / Windows-1252 cuando no es UTF-8 válido', async () => {
    const contenido = Buffer.from('Cliente;Total\nMuñoz;10\n', 'latin1');
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(contenido)).toThrow();
    const matriz = await leerPlanilla(contenido, 'x.csv');
    expect(matriz[1][0]).toBe('Muñoz');
  });

  it('respeta campos entre comillas con el separador adentro y salta líneas vacías', async () => {
    const matriz = await leerPlanilla(Buffer.from('Cliente;Total\n"Pérez; Juan";10\n\n;\n', 'utf8'), 'x.csv');
    expect(matriz).toEqual([
      ['Cliente', 'Total'],
      ['Pérez; Juan', '10'],
    ]);
  });

  it('rechaza un CSV con comillas sin cerrar', async () => {
    await expect(leerPlanilla(Buffer.from('Cliente;Total\n"Pérez;10\n', 'utf8'), 'x.csv')).rejects.toBeInstanceOf(
      ArchivoInvalidoError,
    );
  });

  it('decodifica un archivo vacío como texto vacío', () => {
    expect(decodificar(Buffer.alloc(0))).toBe('');
  });
});

describe('Excel (.xlsx)', () => {
  it('lee texto, números y celdas de fecha', async () => {
    const xlsx = crearXlsx([
      ['Fecha', 'Dólar comprador', 'Dólar vendedor', 'Cargó'],
      [{ fecha: 43840 }, 59.5, 63.5, 'Ana'],
    ]);
    const matriz = await leerPlanilla(xlsx, 'cotizaciones.xlsx');
    expect(matriz[0]).toEqual(['Fecha', 'Dólar comprador', 'Dólar vendedor', 'Cargó']);
    expect(matriz[1][0]).toBeInstanceOf(Date);
    expect((matriz[1][0] as Date).toISOString().slice(0, 10)).toBe('2020-01-10');
    expect(matriz[1].slice(1)).toEqual([59.5, 63.5, 'Ana']);
  });

  it('se reconoce por extensión o por la firma ZIP', () => {
    const xlsx = crearXlsx([['a']]);
    expect(esXlsx('sin-extension', xlsx)).toBe(true);
    expect(esXlsx('datos.XLSX', Buffer.from('texto'))).toBe(true);
    expect(esXlsx('datos.csv', Buffer.from('a;b'))).toBe(false);
  });

  it('rechaza un .xlsx dañado como archivo inválido', async () => {
    await expect(leerPlanilla(Buffer.from('esto no es un zip'), 'roto.xlsx')).rejects.toBeInstanceOf(ArchivoInvalidoError);
  });
});
