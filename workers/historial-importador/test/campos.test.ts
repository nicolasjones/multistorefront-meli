import { describe, expect, it } from 'vitest';
import { normalizarClave, normalizarFecha, normalizarImporte } from '../src/campos.js';

describe('normalizarFecha', () => {
  it.each([
    ['10/01/2020', '2020-01-10'],
    ['1/2/2020', '2020-02-01'],
    ['10-01-2020', '2020-01-10'],
    ['10.01.2020 14:30', '2020-01-10'],
    ['2020-01-10', '2020-01-10'],
    ['2020-01-10T03:00:00Z', '2020-01-10'],
  ])('acepta %s', (entrada, esperado) => {
    expect(normalizarFecha(entrada)).toBe(esperado);
  });

  it('acepta una celda de fecha de Excel', () => {
    expect(normalizarFecha(new Date(Date.UTC(2020, 0, 10)))).toBe('2020-01-10');
  });

  it.each(['31/02/2020', '00/01/2020', '10/13/2020', '10/01/20', 'ayer', '', '2020-1-10'])('rechaza %j', (entrada) => {
    expect(normalizarFecha(entrada)).toBeNull();
  });

  it('rechaza un número suelto (no se adivina un serial de Excel)', () => {
    expect(normalizarFecha(43840)).toBeNull();
  });
});

describe('normalizarImporte', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234,56', 1234.56],
    ['1234.56', 1234.56],
    ['1.234', 1234],
    ['1,5', 1.5],
    ['$ 2.500,00', 2500],
    ['-150,25', -150.25],
    ['1.234.567,8', 1234567.8],
    ['1,234,567', 1234567],
    ['42', 42],
    [42.126, 42.13],
  ])('interpreta %j como %d', (entrada, esperado) => {
    expect(normalizarImporte(entrada)).toBe(esperado);
  });

  it('respeta los decimales pedidos (cotizaciones)', () => {
    expect(normalizarImporte('1234,56789', 4)).toBe(1234.5679);
  });

  it.each(['abc', '', '12a', '1,2,3', '1.2.3', '--5', '(100)', '1e5'])('rechaza %j', (entrada) => {
    expect(normalizarImporte(entrada)).toBeNull();
  });

  it('rechaza lo que no es número ni texto y los desbordes', () => {
    expect(normalizarImporte(null)).toBeNull();
    expect(normalizarImporte(Number.NaN)).toBeNull();
    expect(normalizarImporte(1e12)).toBeNull();
  });
});

describe('normalizarClave', () => {
  it('ignora mayúsculas, tildes, espacios y signos', () => {
    expect(normalizarClave(' Dólar  Comprador ')).toBe('dolarcomprador');
    expect(normalizarClave('N° de cliente')).toBe('ndecliente');
    expect(normalizarClave(null)).toBe('');
  });
});
