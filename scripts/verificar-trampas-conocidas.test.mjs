import assert from 'node:assert/strict';
import test from 'node:test';
import {
  grantsServiceRole, inalterablesDe, revisar, revisarE2E, revisarExportacionTotal, revisarGrants, revisarVariablesPsql, tablasCreadas,
} from './verificar-trampas-conocidas.mjs';

const mig = (version, sql) => ({ ruta: `supabase/migrations/${version}_prueba.sql`, sql });
const NUEVA = '20270400000000';

test('detecta tablas creadas y sus columnas, ignorando comentarios', () => {
  const t = tablasCreadas('-- create table dominio.falsa (x int);\ncreate table if not exists dominio.cosas (id int, organizacion_id uuid);');
  assert.deepEqual(t.map((x) => x.tabla), ['cosas']);
  assert.match(t[0].cuerpo, /organizacion_id/);
  assert.equal(grantsServiceRole('grant select on dominio.a to authenticated; grant select on dominio.a to service_role;').length, 1);
});

test('una tabla nueva de dominio sin grant a service_role falla con mensaje accionable', () => {
  const p = revisarGrants({ migracionesDiff: [mig(NUEVA, 'create table dominio.cosas (id int);')] });
  assert.equal(p.length, 1);
  assert.match(p[0], /dominio\.cosas sin `grant \.\.\. to service_role`/);
  assert.match(p[0], /grant select, insert, update, delete on dominio\.cosas to service_role/);
});

test('con el grant a service_role la tabla pasa, también en otra migración del diff', () => {
  const crea = mig(NUEVA, 'create table dominio.cosas (id int);');
  assert.deepEqual(revisarGrants({ migracionesDiff: [mig(NUEVA, `${crea.sql}\ngrant select, insert, update, delete on dominio.cosas to service_role;`)] }), []);
  assert.deepEqual(revisarGrants({ migracionesDiff: [crea, mig('20270400000001', 'grant all on table dominio.cosas to service_role;')] }), []);
});

test('las tablas inalterables declaradas y las de public no exigen grant', () => {
  const sqlTest = "insert into inalterables values ('historial_x'), ('otra');\n";
  const inalterables = inalterablesDe(sqlTest);
  assert.ok(inalterables.has('historial_x'));
  assert.deepEqual(revisarGrants({ migracionesDiff: [mig(NUEVA, 'create table dominio.historial_x (id int);')], inalterables }), []);
  assert.deepEqual(revisarGrants({ migracionesDiff: [mig(NUEVA, 'create table public.cosas (id int);')] }), []);
});

test('una variable de psql dentro de un bloque de dólares falla; fuera del bloque o con format no', () => {
  const mal = revisarVariablesPsql({ pruebas: [{ ruta: 'supabase/tests/database/x.test.sql', sql: "select throws_ok($$ select :'org' $$, '42501');" }] });
  assert.equal(mal.length, 1);
  assert.match(mal[0], /format\(/);
  const bien = "select throws_ok(format($$ select %L $$, :'org'), '42501');\nselect :'org';\nselect '{\"a\":\"b\"}'::jsonb, $$ '10:30'::time $$;";
  assert.deepEqual(revisarVariablesPsql({ pruebas: [{ ruta: 'a.sql', sql: bien }] }), []);
});

test('una tabla con organizacion_id fuera de la exportación total falla', () => {
  const crea = mig(NUEVA, 'create table dominio.cosas (id int, organizacion_id uuid);');
  const p = revisarExportacionTotal({ migracionesDiff: [crea] });
  assert.equal(p.length, 1);
  assert.match(p[0], /conjuntos_exportacion_total/);
  const redefine = mig('20270400000001', "create or replace function private.conjuntos_exportacion_total() returns void as $$ select ('dominio', 'cosas') $$ language sql;");
  assert.deepEqual(revisarExportacionTotal({ migracionesDiff: [crea, redefine] }), []);
  assert.deepEqual(revisarExportacionTotal({ migracionesDiff: [mig(NUEVA, 'create table dominio.sin_org (id int);')] }), []);
});

test('un E2E que escribe con la service key en una tabla de dominio sin grant falla', () => {
  const e2e = [{ ruta: 'apps/web/e2e/x.e2e.ts', sql: "await rest('cosas', { a: 1 }, 'dominio')\nawait rest('otra', { a: 1 }, 'dominio')\nawait rest('cosas', {a: 1})" }];
  const versionCreacion = new Map([['cosas', NUEVA], ['otra', NUEVA]]);
  const p = revisarE2E({ e2e, tablasConGrant: new Set(['otra']), versionCreacion });
  assert.equal(p.length, 1);
  assert.match(p[0], /dominio\.cosas/);
  assert.deepEqual(revisarE2E({ e2e, tablasConGrant: new Set(['cosas', 'otra']), versionCreacion }), []);
  assert.deepEqual(revisarE2E({ e2e, tablasConGrant: new Set(), versionCreacion: new Map([['cosas', '20270101000000']]) }), []);
});

test('revisar integra las reglas y el grant de una migración anterior cubre al E2E', () => {
  const todas = [mig(NUEVA, 'create table dominio.cosas (id int);\ngrant select, insert, update, delete on dominio.cosas to service_role;')];
  const e2e = [{ ruta: 'e.e2e.ts', sql: "await borrar(`cosas?id=eq.1`, 'dominio')" }];
  assert.deepEqual(revisar({ migracionesDiff: [], pruebas: [], e2e, todasMigraciones: todas }), []);
  assert.equal(revisar({ migracionesDiff: [], pruebas: [], e2e, todasMigraciones: [mig(NUEVA, 'create table dominio.cosas (id int);')] }).length, 1);
});
