import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectarAddColumnSinGuard, enmascarar, partirSentencias, revisarDdl } from './guard-migraciones-ddl.mjs';

const lineas = (sql) => detectarAddColumnSinGuard(sql).map((h) => h.linea);
const reglas = (sql) => revisarDdl(sql).map((h) => h.regla);
const hallazgos = (sql) => revisarDdl(sql);

describe('detectarAddColumnSinGuard', () => {
  it('detecta la forma de una sola línea', () => {
    assert.deepEqual(lineas('alter table public.t add column x int;'), [1]);
  });

  it('detecta ADD COLUMN en una línea aparte (MSF-682)', () => {
    assert.deepEqual(lineas('alter table public.t\n  add column x int;'), [2]);
  });

  it('detecta ADD COLUMN cuando la sentencia no arranca al inicio de línea (MSF-682)', () => {
    assert.deepEqual(lineas('select 1; alter table t add column x int;'), [1]);
    assert.deepEqual(lineas('begin; alter table t add column x int; commit;'), [1]);
    assert.deepEqual(lineas('select 1;\nalter table t\n  add column x int;'), [3]);
  });

  it('acepta IF NOT EXISTS, también multilínea', () => {
    assert.deepEqual(lineas('alter table t\n  add column if not exists x int;'), []);
    assert.deepEqual(lineas('alter table t\n  add column\n    if not exists x int;'), []);
    assert.deepEqual(lineas('select 1; alter table t add column if not exists x int;'), []);
  });

  it('informa la línea correcta cuando hay varios ADD COLUMN y uno sin guard', () => {
    const sql = 'select 1;\nalter table t\n  add column if not exists a int,\n  add column b int,\n  add column if not exists c int;';
    assert.deepEqual(lineas(sql), [4]);
  });

  it('ignora comentarios y literales', () => {
    assert.deepEqual(lineas('-- alter table t add column x int;\n/* alter table t\n add column y int; */\nselect \'alter table t add column z int\';'), []);
  });

  it('no marca el cuerpo dollar-quoted de SQL dinámico (MSF-682)', () => {
    assert.deepEqual(lineas('execute $q$\n  alter table t add column x int\n$q$;'), []);
    assert.deepEqual(lineas("select format($q$alter table t add column x int$q$);"), []);
  });

  it('no mezcla sentencias: add column de otra sentencia no cuenta', () => {
    assert.deepEqual(lineas('alter table t alter column a set not null;\ncomment on column t.a is \'x\';'), []);
  });
});

describe('cuerpos ejecutables y CONCURRENTLY', () => {
  it('detecta DDL dentro de un DO $$ ... $$', () => {
    const sql = 'do $$ begin\n  alter table public.t add column x int;\nend $$;';
    assert.deepEqual(lineas(sql), [2]);
    assert.equal(revisarDdl('do $$ begin create index i on t(a); end $$;').length, 1);
  });
  it('detecta DDL dentro de un cuerpo de función (AS $$)', () => {
    assert.equal(revisarDdl('create function f() returns void as $$ begin drop function g(); end $$ language plpgsql;').length, 1);
  });
  it('sigue enmascarando el SQL dinámico dentro de un DO', () => {
    const sql = "do $$ begin execute $q$ alter table t add column x int $q$; execute 'drop function f()'; end $$;";
    assert.deepEqual(revisarDdl(sql), []);
  });
  it('acepta CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS', () => {
    assert.deepEqual(revisarDdl('create index concurrently if not exists i on t(a);'), []);
    assert.deepEqual(revisarDdl('create unique index concurrently\n if not exists i on t(a);'), []);
    assert.equal(revisarDdl('create index concurrently i on t(a);').length, 1);
  });
  it('acepta DROP INDEX CONCURRENTLY IF EXISTS y marca el que no tiene guard', () => {
    assert.deepEqual(revisarDdl('drop index concurrently if exists i;'), []);
    assert.equal(revisarDdl('drop index concurrently i;').length, 1);
  });
});

describe('revisarDdl', () => {
  it('acepta CREATE INDEX con el guard en la línea siguiente', () => {
    assert.deepEqual(reglas('create index\n  if not exists\n  idx_t_a on t (a);'), []);
  });

  it('marca CREATE INDEX sin guard', () => {
    const h = hallazgos('create index idx_t_a on t (a);');
    assert.deepEqual(h.map((x) => x.regla), ['create-index']);
    assert.equal(h[0].severidad, 'problema');
    assert.equal(h[0].linea, 1);
  });

  it('acepta DROP FUNCTION con el guard en la línea siguiente', () => {
    assert.deepEqual(reglas('drop function\n  if exists\n  public.f();'), []);
  });

  it('marca DROP FUNCTION sin guard aunque no arranque la línea', () => {
    const h = hallazgos('select 1; drop function public.f();');
    assert.deepEqual(h.map((x) => x.regla), ['drop-function']);
    assert.equal(h[0].linea, 1);
  });

  it('marca DROP TABLE y CREATE TABLE sin guard como aviso', () => {
    const h = hallazgos('drop table t;\ncreate table u (a int);');
    assert.deepEqual(h.map((x) => x.regla), ['drop', 'create-table']);
    assert.deepEqual(h.map((x) => x.severidad), ['aviso', 'aviso']);
    assert.deepEqual(h.map((x) => x.linea), [1, 2]);
  });

  it('acepta DROP TABLE y CREATE TABLE con guard', () => {
    assert.deepEqual(reglas('drop table if exists t;\ncreate table if not exists u (a int);'), []);
  });

  it('no marca ALTER TABLE que no agrega columnas', () => {
    assert.deepEqual(reglas('alter table t alter column a set not null;\nalter table t drop constraint c;'), []);
  });

  it('no marca un ; dentro de un literal como fin de sentencia', () => {
    assert.deepEqual(lineas("comment on table t is 'a; b';\nalter table t\n  add column x int;"), [3]);
  });

  it('enmascara conservando la longitud y los saltos de línea', () => {
    const sql = 'select 1;\n-- comentario\nselect 2;';
    const limpio = enmascarar(sql);
    assert.equal(limpio.length, sql.length);
    assert.equal(limpio.split('\n').length, sql.split('\n').length);
    assert.ok(!limpio.includes('comentario'));
  });

  it('parte el SQL en sentencias por `;` sin partir dentro de un literal', () => {
    // el literal va enmascarado: el `;` que tiene adentro no corta la sentencia
    const sentencias = partirSentencias("select 'a; b';\nselect 2;");
    assert.equal(sentencias.length, 2);
    assert.match(sentencias[0].texto, /^select\s+$/);
    assert.match(sentencias[1].texto, /select 2/);
  });
});
