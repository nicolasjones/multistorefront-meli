import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filasConjuntosExportacion, grantsServiceRole, inalterablesDe, perdidasDeclaradas, revisar, revisarE2E, revisarExportacionTotal, revisarGrants, revisarSupersetExportacion, revisarVariablesPsql, tablasCreadas, sinBase,
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

const conNombre = (version, nombre, filas) => ({ ...defineExportacion(version, filas), ruta: `supabase/migrations/${version}_${nombre}.sql` });

test('el orden de todasMigraciones no importa: desordenada compara contra la versión vigente correcta', () => {
  const nueva = defineExportacion('20270343000200', [...BASE, ['dominio', 'gastos_pagos']]);
  const p = revisarSupersetExportacion({ migracionesDiff: [nueva], todasMigraciones: [nueva, LISTAS, VIGENTE] });
  assert.equal(p.length, 1);
  assert.match(p[0], /20270340000100_prueba\.sql/);
  const ok = defineExportacion('20270343000200', [...BASE, ['dominio', 'listas_precios']]);
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [ok], todasMigraciones: [ok, VIGENTE, LISTAS] }), []);
});

test('dos migraciones con la misma versión se ordenan por nombre de archivo, sin depender de la entrada', () => {
  const a = conNombre('20270350000000', 'a', [...BASE, ['dominio', 'x']]);
  const b = conNombre('20270350000000', 'b', BASE);
  for (const todas of [[a, b], [b, a]]) {
    const p = revisarSupersetExportacion({ migracionesDiff: [b], todasMigraciones: todas });
    assert.equal(p.length, 1);
    assert.match(p[0], /`dominio\.x`/);
    assert.match(p[0], /20270350000000_a\.sql/);
  }
});

test('la primera definición de la cadena en el diff, sin previa, pasa; sin filas legibles falla', () => {
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [VIGENTE], todasMigraciones: [VIGENTE] }), []);
  const ilegible = mig('20270334000002', 'create or replace function private.conjuntos_exportacion_total() returns table (a text, b text) language sql as $$ select * from otra_funcion() $$;');
  const p = revisarSupersetExportacion({ migracionesDiff: [ilegible], todasMigraciones: [ilegible] });
  assert.equal(p.length, 1);
  assert.match(p[0], /no pudo leer ninguna fila/);
});

test('si la versión previa no tiene filas legibles también falla, nombrando la previa', () => {
  const previa = mig('20270334000002', 'create or replace function private.conjuntos_exportacion_total() returns table (a text, b text) language sql as $$ select * from otra() $$;');
  const nueva = defineExportacion('20270343000200', BASE);
  const p = revisarSupersetExportacion({ migracionesDiff: [nueva], todasMigraciones: [previa, nueva] });
  assert.equal(p.length, 1);
  assert.match(p[0], /20270334000002_prueba\.sql define/);
});

test('las filas con casts (\'x\'::text) se leen igual', () => {
  const sql = "create function private.conjuntos_exportacion_total() returns table (a text, b text) language sql as $$ select * from (values ('public'::text, 'organizaciones'::text), ('dominio' :: text,'gastos'::character varying)) p(a,b) $$;";
  assert.deepEqual([...filasConjuntosExportacion(sql)].sort(), ['dominio.gastos', 'public.organizaciones']);
  const vieja = mig('20270334000002', sql);
  const nueva = defineExportacion('20270343000200', [['public', 'organizaciones']]);
  assert.equal(revisarSupersetExportacion({ migracionesDiff: [nueva], todasMigraciones: [vieja, nueva] }).length, 1);
});

test('el comentario de pérdida declarada exige un motivo no vacío', () => {
  assert.equal(perdidasDeclaradas('-- exportacion-total: se quita dominio.x (pasa a exclusiones)').has('dominio.x'), true);
  assert.equal(perdidasDeclaradas('-- exportacion-total: se quita dominio.x').size, 0);
  assert.equal(perdidasDeclaradas('-- exportacion-total: se quita dominio.x ()').size, 0);
  assert.equal(perdidasDeclaradas('-- exportacion-total: se quita dominio.x (   )').size, 0);
  const sinMotivo = defineExportacion('20270343000200', BASE, '-- exportacion-total: se quita dominio.listas_precios ()');
  assert.equal(revisarSupersetExportacion({ migracionesDiff: [sinMotivo], todasMigraciones: [VIGENTE, LISTAS, sinMotivo] }).length, 1);
});

test('revisar() integra T6: pierde una fila de la versión vigente y falla', () => {
  const nueva = defineExportacion('20270343000200', [...BASE, ['dominio', 'gastos_pagos']]);
  const p = revisar({ migracionesDiff: [nueva], pruebas: [], e2e: [], todasMigraciones: [nueva, LISTAS, VIGENTE] });
  assert.equal(p.length, 1);
  assert.match(p[0], /`dominio\.listas_precios`/);
});

test('sin base de comparación: en CI falla cerrado, en local solo avisa', () => {
  assert.equal(sinBase({ base: 'origin/dokploy', env: { CI: 'true' } }).codigo, 1);
  const gh = sinBase({ base: 'origin/dokploy', env: { GITHUB_ACTIONS: 'true' } });
  assert.equal(gh.codigo, 1);
  assert.match(gh.mensaje, /no existe la base origin\/dokploy/);
  assert.equal(sinBase({ base: 'origin/dokploy', env: {} }).codigo, 0);
});

test('el parseo de casts no se cuelga con espacios hostiles (sin ReDoS)', async () => {
  const { filasConjuntosExportacion } = await import('./verificar-trampas-conocidas.mjs');
  const sql = `create or replace function private.conjuntos_exportacion_total() returns table(a text) as $f$ select 1 from (values ('a'::a${' '.repeat(60000)}) v $f$;`;
  const t = Date.now();
  filasConjuntosExportacion(sql);
  assert.ok(Date.now() - t < 2000, 'tardó demasiado: ReDoS');
});
