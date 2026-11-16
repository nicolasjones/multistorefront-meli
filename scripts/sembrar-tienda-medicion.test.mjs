// Siembra del catálogo de medición (MSF-552): el seed deja las dos tiendas SIN productos visibles, así que
// sin esta siembra la medición del catálogo y de la ficha no tiene nada que medir.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const raiz = path.resolve(import.meta.dirname, '..');
const sql = readFileSync(path.join(raiz, 'scripts', 'sembrar-tienda-medicion.sql'), 'utf8');

describe('sembrar-tienda-medicion.sql', () => {
  it('siembra las dos tiendas del seed (organización, empresa y dominio)', () => {
    // Ids de supabase/seed.sql (MSF-241): Mundo JC y San Javucho.
    for (const id of [
      '0f5eed00-0000-4000-8000-000000000001',
      '0f5eed00-0000-4000-8000-000000000002',
      '0f5eed01-0000-4000-8000-000000000001',
      '0f5eed01-0000-4000-8000-000000000002',
    ]) {
      assert.ok(sql.includes(id), `falta el id ${id} del seed`);
    }
  });

  it('falla si la base no tiene las tiendas del seed (no siembra a ciegas)', () => {
    assert.match(sql, /raise exception/);
    assert.match(sql, /Faltan las tiendas del seed/);
  });

  it('siembra N productos por tienda con precio y los deja visibles en la tienda', () => {
    assert.match(sql, /generate_series\(1, :N\)/);
    assert.match(sql, /insert into dominio\.productos/);
    // Sin la fila en `producto_empresa` el producto no aparece en el catálogo de la tienda.
    assert.match(sql, /insert into dominio\.producto_empresa/);
    assert.match(sql, /precio_lista/);
  });

  it('deja existencias en la mitad de los productos (filtro «solo con stock» y etiqueta «Disponible»)', () => {
    assert.match(sql, /update dominio\.existencias/);
    assert.match(sql, /% 2 = 0/);
  });

  it('es idempotente (ids fijos) y deja datos: la medición es por HTTP', () => {
    assert.match(sql, /on conflict \(id\) do nothing/);
    assert.doesNotMatch(sql, /rollback;/i);
  });
});
