import assert from 'node:assert/strict';
import test from 'node:test';
import {
  grantsServiceRole, inalterablesDe, revisar, revisarE2E, revisarExportacionTotal, revisarGrants, revisarSupersetExportacion, revisarVariablesPsql, tablasCreadas,
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

const lista = (...filas) => filas.map(([e, t]) => `('${e}', '${t}')`).join(', ');
const defineExportacion = (version, filas, extra = '') => mig(version, `${extra}\ncreate or replace function private.conjuntos_exportacion_total() returns table (esquema text, tabla text) language sql as $$ select p.esquema, p.tabla from (values ${lista(...filas)}) as p(esquema, tabla) $$;`);
const BASE = [['public', 'organizaciones'], ['dominio', 'gastos']];
const VIGENTE = defineExportacion('20270334000002', BASE);
const LISTAS = defineExportacion('20270340000100', [...BASE, ['dominio', 'listas_precios']]);

test('una redefinición de la exportación total que parte de una versión vieja y pierde una fila falla', () => {
  const nueva = defineExportacion('20270343000200', [...BASE, ['dominio', 'gastos_pagos']]);
  const p = revisarSupersetExportacion({ migracionesDiff: [nueva], todasMigraciones: [VIGENTE, LISTAS, nueva] });
  assert.equal(p.length, 1);
  assert.match(p[0], /`dominio\.listas_precios`/);
  assert.match(p[0], /20270340000100_prueba\.sql/);
  assert.match(p[0], /-- exportacion-total: se quita <esquema>\.<tabla> \(motivo\)/);
});

test('una redefinición que es superconjunto de la versión vigente pasa', () => {
  const nueva = defineExportacion('20270343000200', [...BASE, ['dominio', 'listas_precios'], ['dominio', 'gastos_pagos']]);
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [nueva], todasMigraciones: [VIGENTE, LISTAS, nueva] }), []);
});

test('una pérdida intencional declarada con el comentario pasa, y sin declarar falla', () => {
  const sinFila = defineExportacion('20270343000200', BASE, '-- exportacion-total: se quita dominio.listas_precios (pasa a exclusiones)');
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [sinFila], todasMigraciones: [VIGENTE, LISTAS, sinFila] }), []);
  const sinDeclarar = defineExportacion('20270343000200', BASE);
  assert.equal(revisarSupersetExportacion({ migracionesDiff: [sinDeclarar], todasMigraciones: [VIGENTE, LISTAS, sinDeclarar] }).length, 1);
});

test('dos redefiniciones en el mismo diff en el orden correcto pasan; la segunda compara con la primera', () => {
  const a = defineExportacion('20270343000200', [...BASE, ['dominio', 'listas_precios'], ['dominio', 'opiniones']]);
  const b = defineExportacion('20270344000100', [...BASE, ['dominio', 'listas_precios'], ['dominio', 'opiniones'], ['dominio', 'newsletter']]);
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [a, b], todasMigraciones: [VIGENTE, LISTAS, a, b] }), []);
  const bMal = defineExportacion('20270344000100', [...BASE, ['dominio', 'listas_precios'], ['dominio', 'newsletter']]);
  const p = revisarSupersetExportacion({ migracionesDiff: [a, bMal], todasMigraciones: [VIGENTE, LISTAS, a, bMal] });
  assert.equal(p.length, 1);
  assert.match(p[0], /`dominio\.opiniones`/);
  assert.match(p[0], /20270343000200_prueba\.sql/);
});
