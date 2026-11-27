import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filasConjuntosExportacion, leeListaBlanca, grantsServiceRole, inalterablesDe, perdidasDeclaradas, revisar, revisarE2E, revisarExportacionTotal, revisarGrants, revisarSupersetExportacion, revisarVariablesPsql, revisarFechasBuenosAires, recorrerSql, tablasCreadas, sinBase,
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

// MSF-817: la función vigente puede leer la lista blanca por columna (sin lista propia de tablas).
const BLANCA = mig('20270516000100', 'create or replace function private.conjuntos_exportacion_total() returns table (esquema text, tabla text) language sql as $$ select d.esquema, d.tabla from private.exportacion_total_columnas d where d.exportar $$;');

test('leeListaBlanca distingue la definición por tabla de decisiones de la de lista propia (y no cuenta un comentario)', () => {
  assert.equal(leeListaBlanca(BLANCA.sql), true);
  assert.equal(leeListaBlanca(VIGENTE.sql), false);
  assert.equal(leeListaBlanca('-- usa private.exportacion_total_columnas\nselect 1'), false);
});

test('una definición que lee la lista blanca no se compara con filas y pasa', () => {
  assert.deepEqual(revisarSupersetExportacion({ migracionesDiff: [BLANCA], todasMigraciones: [VIGENTE, LISTAS, BLANCA] }), []);
});

test('redefinir con lista propia sobre la vigente por tabla de decisiones falla y explica qué hacer', () => {
  const vieja = defineExportacion('20270517000000', [...BASE, ['dominio', 'listas_precios']]);
  const p = revisarSupersetExportacion({ migracionesDiff: [vieja], todasMigraciones: [VIGENTE, LISTAS, BLANCA, vieja] });
  assert.equal(p.length, 1);
  assert.match(p[0], /lee private\.exportacion_total_columnas/);
  assert.match(p[0], /20270516000100_prueba\.sql/);
});

test('una tabla nueva con organizacion_id cubierta por filas en la lista blanca no falla', () => {
  const crea = mig('20270518000000', 'create table dominio.cosas (id uuid, organizacion_id uuid);');
  const filas = mig('20270518000001', "insert into private.exportacion_total_columnas (esquema, tabla, columna, exportar) values ('dominio', 'cosas', 'id', true);");
  assert.deepEqual(revisarExportacionTotal({ migracionesDiff: [crea, filas] }), []);
  assert.equal(revisarExportacionTotal({ migracionesDiff: [crea] }).length, 1);
});

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
  // Red de seguridad contra el ReDoS (que tarda minutos), generosa para que la carga del host no dé un falso positivo.
  acotado(() => filasConjuntosExportacion(sql));
});

test('current_date en el alta de una reparación falla; con la fecha de Buenos Aires o en otra tabla pasa', () => {
  const mal = revisarFechasBuenosAires({ pruebas: [{ ruta: 'x.sql', sql: 'insert into dominio.reparaciones (id, ingreso_en)\n  values (1, current_date);' }] });
  assert.equal(mal.length, 1);
  assert.match(mal[0], /Buenos_Aires/);
  const bien = "insert into dominio.reparaciones (id, ingreso_en) values (1, (now() at time zone 'America/Argentina/Buenos_Aires')::date);\ninsert into dominio.otra (f) values (current_date);\nselect throws_ok($$insert into dominio.reparaciones (ingreso_en) values (current_date)$$, '42501');";
  assert.deepEqual(revisarFechasBuenosAires({ pruebas: [{ ruta: 'a.sql', sql: bien }] }), []);
});

const t7 = (sql) => revisarFechasBuenosAires({ pruebas: [{ ruta: 'x.sql', sql }] });

test('T7: un punto y coma dentro de un literal no corta la sentencia (antes: falso negativo)', () => {
  assert.equal(t7("insert into dominio.reparaciones (falla, ingreso_en) values ('roto; no enciende', current_date);").length, 1);
  assert.equal(t7("insert into dominio.reparaciones (falla, ingreso_en) values ('a;b;c', current_date);").length, 1);
});

test('T7: throws_ok con punto y coma dentro de $$ ... $$ es una sola sentencia exenta (antes: falso positivo)', () => {
  const sql = "select throws_ok($$insert into dominio.reparaciones (a, ingreso_en) values (1, current_date); select 1$$, '22023');";
  assert.deepEqual(t7(sql), []);
  const etiquetado = "select throws_ok($f$insert into dominio.reparaciones (ingreso_en) values (current_date); x$f$, '22023');";
  assert.deepEqual(t7(etiquetado), []);
});

test('T7: la palabra current_date dentro de un literal o un comentario no cuenta', () => {
  assert.deepEqual(t7("insert into dominio.reparaciones (nota) values ('usa current_date en UTC');"), []);
  assert.deepEqual(t7("-- insert into dominio.reparaciones (ingreso_en) values (current_date);\nselect 1;"), []);
  assert.deepEqual(t7("/* update dominio.reparaciones set ingreso_en = current_date; */ select 1;"), []);
  assert.deepEqual(t7("insert into dominio.reparaciones (nota, ingreso_en) values ('it''s; ok', (now() at time zone 'America/Argentina/Buenos_Aires')::date);"), []);
});

test('T7: un alta dentro de un bloque do $$ sin throws_ok sí falla', () => {
  assert.equal(t7("do $$ begin insert into dominio.reparaciones (ingreso_en) values (current_date); end $$;").length, 1);
});

test('T7: update reparaciones set ingreso_en = current_date falla; otras columnas o la fecha de Buenos Aires no', () => {
  const mal = t7("update dominio.reparaciones set falla = 'x', ingreso_en = current_date - 1 where id = 1;");
  assert.equal(mal.length, 1);
  assert.match(mal[0], /x\.sql:1 /);
  assert.equal(t7("update reparaciones set ingreso_en = coalesce(ingreso_en, current_date);").length, 1);
  assert.deepEqual(t7("update dominio.reparaciones set entrega_prevista = current_date where id = 1;"), []);
  assert.deepEqual(t7("update dominio.reparaciones set ingreso_en = (now() at time zone 'America/Argentina/Buenos_Aires')::date where creado_en::date = current_date;"), []);
  assert.deepEqual(t7("update dominio.otra set ingreso_en = current_date;"), []);
});

test('T7: crear_reparacion con p_ingreso => current_date falla; otros argumentos o la fecha de BA no', () => {
  assert.equal(t7("select public.crear_reparacion(p_empresa_id => 'x', p_ingreso => current_date, p_falla => 'y');").length, 1);
  assert.equal(t7("select crear_reparacion(p_ingreso_en => current_date);").length, 1);
  assert.deepEqual(t7("select public.crear_reparacion(p_empresa_id => 'x', p_entrega_prevista => current_date);"), []);
  assert.deepEqual(t7("select public.crear_reparacion(p_ingreso => (now() at time zone 'America/Argentina/Buenos_Aires')::date, p_falla => 'a');"), []);
  assert.deepEqual(t7("select throws_ok($$select public.crear_reparacion(p_ingreso => current_date)$$, '22023');"), []);
});

test('recorrerSql conserva largo y líneas, y no corta en ; de literales ni de dólares', () => {
  const sql = "select 'a;b' ; -- c;d\nselect $$x;y$$; select 1";
  const r = recorrerSql(sql);
  assert.equal(r.enmascarado.length, sql.length);
  assert.equal(r.sentencias.length, 3);
  assert.match(r.sentencias[1].texto, /\$\$x;y\$\$/);
});

test('T7: SQL sin cerrar o con cadenas raras no cuelga ni lanza', () => {
  assert.doesNotThrow(() => t7("select 'sin cerrar; current_date"));
  assert.doesNotThrow(() => t7('select $$ sin cerrar; insert into reparaciones (x) values (current_date)'));
  assert.doesNotThrow(() => t7("select \"id ; current_date"));
});

test('T7: current_date en OTRA columna de fecha del insert no se marca; en ingreso_en sí (QA-3)', () => {
  assert.deepEqual(t7("insert into dominio.reparaciones (id, prometida_en, ingreso_en) values (1, current_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date);"), []);
  assert.equal(t7("insert into dominio.reparaciones (id, prometida_en, ingreso_en) values (1, null, current_date);").length, 1);
  assert.equal(t7("insert into dominio.reparaciones (id, ingreso_en) values (1, current_date), (2, current_date - 1);").length, 2);
  assert.equal(t7("insert into dominio.reparaciones (id, ingreso_en) select 1, current_date from x;").length, 1);
  assert.deepEqual(t7("insert into dominio.reparaciones (id, prometida_en, ingreso_en) select 1, current_date, now()::date from x;"), []);
  assert.deepEqual(t7("insert into dominio.reparaciones (id, prometida_en) values (1, current_date);"), []);
  assert.equal(t7("insert into dominio.reparaciones values (1, current_date);").length, 1);
  assert.equal(t7("insert into dominio.reparaciones (id, ingreso_en) values (f(1, 2), coalesce(null, current_date));").length, 1);
});

test('T7: la exención de throws_ok es solo para su llamada, no para toda la sentencia (QA-4)', () => {
  const sql = "create function pg_temp.f() returns void language plpgsql as $f$ begin\n  perform throws_ok($$insert into dominio.reparaciones (ingreso_en) values (current_date)$$, '22023');\n  insert into dominio.reparaciones (ingreso_en) values (current_date);\nend $f$;";
  const p = t7(sql);
  assert.equal(p.length, 1);
  assert.match(p[0], /x\.sql:3 /);
  assert.deepEqual(t7("select throws_ok($$insert into dominio.reparaciones (ingreso_en) values (current_date)$$, '22023'), 1;"), []);
});

test('recorrerSql y T7: las cadenas E\'...\\\'...\' respetan el backslash (QA-5)', () => {
  const ne = (sql) => recorrerSql(sql).sentencias.filter((x) => x.texto.trim()).length;
  const sql = "insert into dominio.reparaciones (falla, ingreso_en) values (E'no \\' enciende; roto', current_date);";
  assert.equal(ne(sql), 1);
  assert.equal(t7(sql).length, 1);
  assert.deepEqual(t7("insert into dominio.reparaciones (falla) values (E'dice \\'current_date\\' y; mas');"), []);
  // Un literal común termina en la primera comilla: el backslash no escapa; con E sí.
  assert.equal(recorrerSql("select 'a\\'; b'; select 1;").sentencias[0].texto.length, "select 'a\\'".length);
  assert.equal(recorrerSql("select e'a\\'; b'; select 1;").sentencias[0].texto.length, "select e'a\\'; b'".length);
  assert.equal(ne("select e'a\\'; b'; select 1;"), 2);
});

// Criterio de tiempo RELATIVO y robusto a la carga del host (los tests corren en paralelo con otros y bajo CPU saturada):
//  - se mide tiempo de CPU del proceso y el MÍNIMO de varias corridas tras un calentamiento (un pico de carga no cuenta, una regresión sí: falla en todas);
//  - se compara el tiempo con una entrada 4 veces mayor: lineal ≈ 4×, cuadrático ≈ 16×; el límite es 12× sobre un piso de
//    tiempo (los tiempos de pocos ms son ruido);
//  - un tope absoluto generoso (10 s) queda solo como red de seguridad contra el caso patológico (cuadrático o peor: minutos).
const PISO_MS = 20;
const RAZON_MAXIMA = 12;
const TOPE_ABSOLUTO_MS = 10_000;
// Tiempo de CPU del proceso (no de pared): una CPU saturada por otros procesos no infla la medida, una regresión superlineal sí.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const minimoDe = (fn, corridas = 3) => { let mejor = Infinity; let r; for (let i = 0; i < corridas; i++) { const t = cpuMs(); r = fn(); mejor = Math.min(mejor, cpuMs() - t); } return { ms: mejor, r }; };
const verificarEscala = (fabrica, fn) => {
  fn(fabrica(1)); // calentamiento
  const chica = fabrica(1);
  const grande = fabrica(4);
  const a = minimoDe(() => fn(chica)).ms;
  const b = minimoDe(() => fn(grande)).ms;
  assert.ok(b < TOPE_ABSOLUTO_MS, `la entrada de 4× tardó ${b.toFixed(0)} ms`);
  assert.ok(b <= RAZON_MAXIMA * Math.max(a, PISO_MS), `escala superlineal: 1× ${a.toFixed(1)} ms, 4× ${b.toFixed(1)} ms (más de ${RAZON_MAXIMA}× el piso o la base)`);
};
const acotado = (fn) => { const { ms, r } = minimoDe(fn, 1); assert.ok(ms < TOPE_ABSOLUTO_MS, `tardó ${ms.toFixed(0)} ms`); return r; };

// Entradas adversariales: el análisis de T7 debe ser lineal y no lanzar (`fabrica(k)` arma la entrada de tamaño k×).
const rapido = (nombre, fabrica, comprobar = () => {}) => test(`T7 rendimiento: ${nombre}`, () => {
  verificarEscala(fabrica, t7);
  comprobar(t7(fabrica(1)));
});
rapido('500 updates y 666 «ingreso_en = 1,» en una sentencia sin punto y coma', (k) => `${'update reparaciones set x = 1 '.repeat(500 * k)}${'ingreso_en = 1, '.repeat(666 * k)}`, (r) => assert.deepEqual(r, []));
rapido('13000 «ingreso_en = 1» sin comas (cerca del tope): conservador y rápido', (k) => `update reparaciones set ${'ingreso_en = 1 '.repeat(6000 * k)}`, (r) => assert.equal(r.length, 1));
rapido('«ingreso_en =» repetido sin comas ni cierres', (k) => `update reparaciones set ${'ingreso_en = 1 '.repeat(20000 * k)}`);
rapido('2500 altas con paréntesis sin cerrar', (k) => 'insert into reparaciones (a,ingreso_en values ('.repeat(2500 * k), (r) => assert.equal(r.length, 1));
rapido('10000 throws_ok( sin cerrar con un alta', (k) => `${'throws_ok('.repeat(10000 * k)} insert into reparaciones (ingreso_en) values (current_date)`);
rapido('altas anidadas en paréntesis', (k) => `${'insert into reparaciones ('.repeat(1500 * k)}ingreso_en${')'.repeat(1500 * k)}`);
rapido('sentencia gigante que toca reparaciones', (k) => `insert into reparaciones (ingreso_en) values (now()); ${'select 1, '.repeat(30000 * k)}select 1 -- reparaciones`.replace(/;/, ' '), (r) => assert.ok(r.length >= 1));
rapido('muchos usos de current_date en una sentencia', (k) => `insert into reparaciones (ingreso_en) values ${'(current_date),'.repeat(3000 * k)}(current_date)`, (r) => assert.ok(r.length <= 21));
rapido('un solo update con current_date sigue marcándose', () => 'update reparaciones set a = 1; update reparaciones set ingreso_en = current_date', (r) => assert.equal(r.length, 1));

test('T7 conservador: expresión de ingreso más larga que el tope no se trunca en silencio (1)', () => {
  const larga = `update reparaciones set ingreso_en = coalesce(${'x, '.repeat(600)}current_date);`;
  const r = t7(larga);
  assert.equal(r.length, 1);
  assert.match(r[0], /no se puede comprobar/);
  assert.deepEqual(t7("update reparaciones set ingreso_en = coalesce(x, y);"), []);
  assert.equal(t7(`insert into reparaciones (ingreso_en) select ${'a+'.repeat(400)}current_date`).length, 1);
});

test('T7 rendimiento: peor caso ingreso_en sin comas bajo el tope de sentencia escala linealmente', () => {
  verificarEscala((k) => `update reparaciones set ${'ingreso_en = 1 '.repeat(1600 * k)}`, t7);
});

test('T7 conservador: throws_ok( sin cerrar y comilla o bloque sin cerrar se marcan (3)', () => {
  assert.equal(t7("select throws_ok($$insert into reparaciones (ingreso_en) values (current_date)$$, '22023';").length, 1);
  assert.match(t7("select throws_ok(\n$$select 1$$, 'x';")[0], /throws_ok\( sin cerrar/);
  assert.match(t7("select 1;\nselect 'sin cerrar; current_date")[0], /sin cerrar/);
  assert.match(t7('select $$ sin cerrar')[0], /sin cerrar/);
  assert.match(t7('select 1; /* sin cerrar')[0], /sin cerrar/);
  assert.match(t7('select "id sin cerrar')[0], /sin cerrar/);
  assert.equal(recorrerSql("select 'a'; select $$b$$").sinCerrar, -1);
});

test('recorrerSql: dentro de $$ una comilla, comillas dobles o -- que no cierran son datos y no rompen el cierre', () => {
  const sql = `select f($$o'brien"; drop table x; --$$) , 1; select 2;`;
  const r = recorrerSql(sql);
  assert.equal(r.sinCerrar, -1);
  assert.equal(r.sentencias.filter((x) => x.texto.trim()).length, 2);
  assert.equal(recorrerSql("select $$ /* x $$; select 1;").sinCerrar, -1);
  // Dentro de un bloque, un literal que sí cierra se sigue enmascarando.
  assert.deepEqual(t7("select throws_ok($$insert into reparaciones (nota, ingreso_en) values ('current_date', now())$$, '22023');"), []);
});

// Bloques de dólares grandes con de todo adentro (comillas, $x$, --, /*, "), con y sin cierre: lineal (criterio relativo, ver `verificarEscala`).
const relleno = (kb) => { const u = "$x$ ' -- /* \" "; return u.repeat(Math.ceil((kb * 1024) / u.length)); };
for (const kb of [100, 300]) {
  for (const [nombre, armar] of [
    ['con cierre', (r) => `select $$ ${r} $$; select 1`],
    ['sin cierre', (r) => `select $$ ${r}`],
    ['con cierre y una alta mala después', (r) => `select $$ ${r} $$; insert into reparaciones (ingreso_en) values (current_date)`],
  ]) {
    test(`recorrerSql rendimiento: bloque $$ de ${kb} KB ${nombre}`, () => {
      verificarEscala((k) => armar(relleno(kb * k)), recorrerSql);
      const r = recorrerSql(armar(relleno(kb)));
      if (nombre === 'sin cierre') assert.ok(r.sinCerrar >= 0);
      if (nombre === 'con cierre') assert.equal(r.sinCerrar, -1);
    });
  }
}
for (const [nombre, unidad] of [['/* sin cierre', 'a /* '], ['-- sin salto de línea', 'a -- '], ['comillas dobles sin cerrar', 'a " '], ['$x$ alternados', '$x$ a ']]) {
  test(`recorrerSql rendimiento: «${nombre}» repetido 100 KB`, () => {
    verificarEscala((k) => unidad.repeat(Math.ceil((102400 * k) / unidad.length)), (x) => { recorrerSql(`select $$ ${x}`); recorrerSql(x); });
  });
}

test('recorrerSql: sin bypass dentro de bloques; lo malo posterior se sigue marcando', () => {
  assert.equal(t7("select $$ it's $$; insert into reparaciones (ingreso_en) values (current_date)").length, 1);
  assert.equal(t7("select $a$ x $b$ ' $b$ y $a$; insert into reparaciones (ingreso_en) values (current_date)").length, 1);
  assert.equal(t7("select $$ \" -- /* $$; insert into reparaciones (ingreso_en) values (current_date)").length, 1);
  assert.deepEqual(t7("select $$ it's $$; select 1"), []);
});

// Oráculo: el recorrido anterior (busca el cierre del bloque con indexOf en cada carácter; cuadrático pero de semántica de referencia).
function recorrerSqlViejo(sql) {
  const salida = sql.split('');
  const sentencias = [];
  const pila = [];
  let inicio = 0;
  let sinCerrar = -1; // posición del primer comentario, literal o bloque de dólares que no cierra (SQL roto)
  const abierto = (i) => { if (sinCerrar < 0) sinCerrar = i; };
  const blanquear = (desde, hasta) => { for (let k = desde; k < hasta; k++) if (salida[k] !== '\n') salida[k] = ' '; };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    // Dentro de un bloque de dólares el texto puede ser un dato (`$$o'brien"; --$$`): nada de lo que abra adentro puede pasar del cierre del bloque.
    const tope = pila.length ? sql.indexOf(pila[pila.length - 1], i) : -1;
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i);
      let hasta = fin < 0 ? sql.length : fin;
      if (tope >= 0 && tope < hasta) hasta = tope;
      blanquear(i, hasta); i = hasta; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2);
      if (tope >= 0 && (fin < 0 || tope < fin)) { i++; continue; }
      if (fin < 0) abierto(i);
      const hasta = fin < 0 ? sql.length : fin + 2;
      blanquear(i, hasta); i = hasta; continue;
    }
    if (c === "'") {
      // E'...' admite \' y \\ como escapes (además de ''); un literal común no.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[a-z0-9_$]/i.test(sql[i - 2] ?? ' ');
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      if (tope >= 0 && tope < j) { i++; continue; } // la comilla no cierra antes del bloque: es texto del dato
      if (j >= sql.length) abierto(i);
      blanquear(i + 1, Math.min(j, sql.length)); i = j + 1; continue;
    }
    if (c === '"') {
      const fin = sql.indexOf('"', i + 1);
      if (tope >= 0 && (fin < 0 || tope < fin)) { i++; continue; }
      if (fin < 0) abierto(i);
      i = fin < 0 ? sql.length : fin + 1; continue;
    }
    if (c === '$') {
      const m = /^\$[a-z_][a-z0-9_]*\$|^\$\$/i.exec(sql.slice(i, i + 80));
      if (m) {
        if (pila.length && pila[pila.length - 1] === m[0]) pila.pop(); else pila.push(m[0]);
        i += m[0].length; continue;
      }
    }
    if (c === ';' && pila.length === 0) {
      sentencias.push({ texto: salida.slice(inicio, i).join(''), desde: inicio });
      inicio = i + 1;
    }
    i++;
  }
  sentencias.push({ texto: salida.slice(inicio).join(''), desde: inicio });
  if (pila.length) abierto(sql.length - 1);
  return { enmascarado: salida.join(''), sentencias, sinCerrar };
}

// PRNG determinista (mulberry32).
const prng = (semilla) => () => { semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0; let x = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const FICHAS = ['$$', '$x$', '$y$', "'", '"', '--', '/*', '*/', '\n', ';', ' ', 'a', 'E', '(', ')', '$', 'insert into reparaciones (ingreso_en) values (current_date)', 'throws_ok(', ','];
const aleatorio = (rnd, n) => { let s = ''; while (s.length < n) s += FICHAS[Math.floor(rnd() * FICHAS.length)]; return s; };

test('recorrerSql: ejemplos con tokens que se pisan (cierre vencido) igualan al oráculo y no retroceden', () => {
  for (const sql of ['$$ $x$$ $x$ -- a\nb $$', '$$$x$$x$*//*a;\';', '$$ $x$$ $x$ /* a $$ \' ; $$', "select $$ a $$$ b $$; select 'x'; --$$"]) {
    const a = recorrerSql(sql); const b = recorrerSqlViejo(sql);
    assert.deepEqual(a, b, sql);
  }
  assert.equal(recorrerSql('$$$x$$x$*//*a;\';').sinCerrar, recorrerSqlViejo('$$$x$$x$*//*a;\';').sinCerrar);
});

test('recorrerSql: equivale al oráculo en miles de entradas aleatorias (semilla fija)', () => {
  const rnd = prng(12345);
  for (let k = 0; k < 4000; k++) {
    const sql = aleatorio(rnd, 5 + Math.floor(rnd() * 120));
    assert.deepEqual(recorrerSql(sql), recorrerSqlViejo(sql), JSON.stringify(sql));
  }
});

test('T7: mismos problemas que con el oráculo en miles de entradas aleatorias con una alta mala insertada', () => {
  const rnd = prng(777);
  for (let k = 0; k < 2000; k++) {
    const sql = `${aleatorio(rnd, 40 + Math.floor(rnd() * 80))} ; insert into reparaciones (ingreso_en) values (current_date); ${aleatorio(rnd, 30)}`;
    const nuevo = t7(sql);
    const viejo = recorrerSqlViejo(sql);
    // El oráculo corta igual: se compara la enmascarada y las sentencias, y que T7 no pierda la alta mala cuando el SQL cierra bien.
    assert.deepEqual(recorrerSql(sql).sentencias, viejo.sentencias, JSON.stringify(sql));
    if (viejo.sinCerrar < 0 && viejo.sentencias.some((x) => /insert\s+into\s+reparaciones\s*\(ingreso_en\)\s*values\s*\(current_date\)/i.test(x.texto)) && !/throws_ok/i.test(sql)) {
      assert.ok(nuevo.length >= 1, JSON.stringify(sql));
    }
  }
});

test('recorrerSql rendimiento: tokens que se pisan repetidos y SQL aleatorio de 300 KB escalan linealmente', () => {
  for (const fabrica of [
    (k) => '$$ $x$$ $x$ -- a\n'.repeat(5000 * k),
    (k) => '$$ $x$$ $x$ /* a '.repeat(5000 * k),
    (k) => aleatorio(prng(99), 75000 * k),
    (k) => aleatorio(prng(7), 75000 * k).replace(/;/g, ' '),
  ]) verificarEscala(fabrica, recorrerSql);
});

test('recorrerSql rendimiento: miles de etiquetas $tN$ distintas y alfabeto {$,x,y} escalan linealmente', () => {
  const unicas = (kb) => { let s = ''; for (let n = 0; s.length < kb * 1024; n++) s += `$t${n}$ `; return s; };
  const alfabeto = (kb, semilla) => { const rnd = prng(semilla); let s = ''; while (s.length < kb * 1024) s += '$xy'[Math.floor(rnd() * 3)]; return s; };
  for (const fabrica of [(k) => unicas(75 * k), (k) => unicas(150 * k), (k) => alfabeto(75 * k, 5), (k) => alfabeto(150 * k, 6)]) verificarEscala(fabrica, recorrerSql);
});

test('recorrerSql: el cierre por etiqueta es idéntico al oráculo con etiquetas que se pisan y repiten', () => {
  const rnd = prng(2024);
  const trozos = ['$$', '$x$', '$y$', '$x$$', '$$x$', 'a', ' ', "'", '--', '\n', ';'];
  for (let k = 0; k < 3000; k++) {
    let sql = '';
    while (sql.length < 60) sql += trozos[Math.floor(rnd() * trozos.length)];
    assert.deepEqual(recorrerSql(sql), recorrerSqlViejo(sql), JSON.stringify(sql));
  }
});
