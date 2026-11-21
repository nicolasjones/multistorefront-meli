// Script de medición de la RPC del catálogo con catálogo grande (MSF-552): tiene que ser reproducible,
// medir los modos que usa la pantalla y no dejar datos.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const sql = readFileSync(path.resolve(import.meta.dirname, '..', 'scripts', 'medir-tienda-catalogo.sql'), 'utf8');

describe('medir-tienda-catalogo.sql', () => {
  it('mide la RPC del catálogo y cierra con ROLLBACK (no deja datos)', () => {
    assert.match(sql, /publico\.catalogo_pagina_por_dominio/);
    const ultimaSentencia = sql.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--')).at(-1);
    assert.equal(ultimaSentencia, 'rollback;');
  });

  it('siembra N productos (cientos) y con existencias para el filtro de stock', () => {
    assert.match(sql, /generate_series\(1,:N\)/);
    assert.match(sql, /dominio\.existencias set cantidad = 5/);
    assert.match(sql, /dominio\.producto_empresa/);
  });

  it('mide los modos que usa la pantalla: relevancia, orden por precio, precio máximo y solo con stock', () => {
    for (const modo of ['relevancia', 'precio_asc', 'precio_desc', 'precio_max', 'solo_stock']) {
      assert.ok(sql.includes(`'${modo}'`), `falta el modo ${modo}`);
    }
    assert.match(sql, /raise notice/);
    assert.match(sql, /percentile_cont\(0\.5\)/);
  });

  it('no usa variables de psql dentro del bloque de dólares (psql no las interpola ahí)', () => {
    const bloques = sql.matchAll(/\$([a-z_]*)\$([\s\S]*?)\$\1/g);
    for (const bloque of bloques) {
      assert.doesNotMatch(bloque[2], /:'[a-z_]+'/);
    }
  });

  it('no toca las tiendas del seed: usa un dominio propio y lo revierte', () => {
    assert.match(sql, /'med\.ejemplo\.com'/);
    assert.doesNotMatch(sql, /mundojc\.localhost|sanjavucho\.localhost/);
  });
});
