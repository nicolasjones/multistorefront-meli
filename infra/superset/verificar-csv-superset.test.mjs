import assert from 'node:assert/strict';
import test from 'node:test';
import { analizarCsv, problemas } from './verificar-csv-superset.mjs';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const csv = (texto, conBom = true) => Buffer.concat([conBom ? BOM : Buffer.alloc(0), Buffer.from(texto, 'utf8')]);

test('BOM y celda escapada: sin problemas', () => {
  assert.deepEqual(problemas(analizarCsv(csv("cliente;total\r\n'=1+1;10,5\r\n"))), []);
});

test('sin BOM se informa', () => {
  assert.match(problemas(analizarCsv(csv("cliente\r\n'=1+1\r\n", false)))[0], /EF BB BF/);
});

test('BOM duplicado se informa (frontera: uno solo está bien)', () => {
  assert.deepEqual(problemas(analizarCsv(csv("a\r\n'=1+1\r\n"))), []);
  assert.match(problemas(analizarCsv(Buffer.concat([BOM, BOM, Buffer.from("a\r\n'=1+1\r\n")]))).join('|'), /dos veces/);
});

test('la celda sin apóstrofo se informa como fórmula ejecutable', () => {
  assert.match(problemas(analizarCsv(csv('cliente\r\n=1+1\r\n'))).join('|'), /SIN apóstrofo/);
});

test('la celda entrecomillada también se reconoce, y una ausente se pide cargar', () => {
  assert.deepEqual(problemas(analizarCsv(csv('c\r\n"\'=1+1"\r\n'))), []);
  assert.match(problemas(analizarCsv(csv('c\r\nAna\r\n'))).join('|'), /no está en el CSV/);
});

test('una celda que solo contiene el texto dentro de otra no cuenta como encontrada', () => {
  assert.match(problemas(analizarCsv(csv("c\r\nxx'=1+1yy\r\n"))).join('|'), /no está en el CSV/);
});

test('cada disparador (= + - @) se puede verificar y otra celda se rechaza', () => {
  for (const c of ['=1+1', '+1+1', '-1+1', '@SUMA(A1)']) assert.deepEqual(problemas(analizarCsv(csv(`x\r\n'${c}\r\n`), c)), []);
  assert.throws(() => analizarCsv(csv('x'), 'hola'), /empezar con/);
  assert.throws(() => analizarCsv('texto'), /Buffer/);
});
