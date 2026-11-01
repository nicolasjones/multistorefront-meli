import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectarAddColumnSinGuard } from './detectar-add-column.mjs';

const lineas = (sql) => detectarAddColumnSinGuard(sql).map((h) => h.linea);

describe('detectarAddColumnSinGuard', () => {
  it('detecta la forma de una sola línea', () => {
    assert.deepEqual(lineas('alter table public.t add column x int;'), [1]);
  });
  it('detecta ADD COLUMN en una línea aparte (MSF-682)', () => {
    assert.deepEqual(lineas('alter table public.t\n  add column x int;'), [2]);
  });
  it('acepta IF NOT EXISTS, también multilínea', () => {
    assert.deepEqual(lineas('alter table t\n  add column if not exists x int;'), []);
    assert.deepEqual(lineas('alter table t\n  add column\n    if not exists x int;'), []);
  });
  it('informa la línea correcta cuando hay varios ADD COLUMN y uno sin guard', () => {
    const sql = 'select 1;\nalter table t\n  add column if not exists a int,\n  add column b int,\n  add column if not exists c int;';
    assert.deepEqual(lineas(sql), [4]);
  });
  it('ignora comentarios y literales', () => {
    assert.deepEqual(lineas('-- alter table t add column x int;\n/* alter table t\n add column y int; */\nselect \'alter table t add column z int\';'), []);
  });
  it('no mezcla sentencias: add column de otra sentencia no cuenta', () => {
    assert.deepEqual(lineas('alter table t alter column a set not null;\ncomment on column t.a is \'x\';'), []);
  });
});
