// Pruebas de scripts/reconciliar-base.mjs (MSF-653/658/671/915): clasificación, informe, validación de --aplicar y el modo solo lectura real
// (docker falso que captura lo que recibe psql).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { INDICES_ESPERADOS, SQL_REVOKE_ACL, clasificar, destinoDe, diagnosticar, hallazgos, informe, listaCerradaDePublico, migracionesDelRepo, parsearRegistro, validarAplicar } from './reconciliar-base.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(aqui, 'reconciliar-base.mjs');
const repo = migracionesDelRepo(['20261019120000_productos_codigo_barras.sql', '20261019120001_productos_de_proveedor_costo.sql', '20270101000000_nueva.sql', 'README.md', '2026_mal.sql']);

test('migracionesDelRepo: solo archivos versión_nombre.sql de 14 dígitos', () => {
  assert.deepEqual([...repo], [['20261019120000', 'productos_codigo_barras'], ['20261019120001', 'productos_de_proveedor_costo'], ['20270101000000', 'nueva']]);
});

test('parsearRegistro y clasificar: renumeradas, sin equivalente, otro nombre, aplicada-manual, sin statements y pendientes', () => {
  const registro = parsearRegistro([
    '20261019120000|productos_de_proveedor_costo|0', // misma versión, nombre de otra migración del repo (MSF-658)
    '20261019120001|productos_de_proveedor_costo|3',
    '20261022120850|productos_codigo_barras|1', // huérfana renumerada: el repo la tiene como 20261019120000
    '29990101000000|algo_viejo|0', // sin equivalente
    '20261012140100|aplicada-manual|0', // huérfana con nombre «aplicada-manual»
    'basura sin barra',
  ]);
  assert.equal(registro.length, 5);
  const c = clasificar(registro, repo);
  assert.equal(c.total, 5);
  assert.equal(c.archivos, 3);
  assert.deepEqual(c.huerfanas.map((h) => h.version), ['20261022120850', '29990101000000', '20261012140100']);
  assert.deepEqual(c.renumeradas.map((h) => [h.version, h.equivalente]), [['20261022120850', '20261019120000 (también registrada)']]);
  assert.deepEqual(c.sinEquivalente.map((h) => h.version), ['29990101000000', '20261012140100']);
  assert.deepEqual(c.otroNombre.map((o) => [o.version, o.nombre, o.nombreRepo]), [['20261019120000', 'productos_de_proveedor_costo', 'productos_codigo_barras']]);
  assert.equal(c.aplicadaManual.length, 1);
  assert.equal(c.sinStatements, 3);
  assert.deepEqual(c.pendientes, ['20270101000000']);
});

test('clasificar: una fila registrada con el nombre del repo y la misma versión no es hallazgo; «aplicada-manual» con versión del repo tampoco es otro nombre', () => {
  const c = clasificar(parsearRegistro(['20261019120000|productos_codigo_barras|2', '20261019120001|aplicada-manual|0']), repo);
  assert.equal(c.otroNombre.length, 0);
  assert.equal(c.huerfanas.length, 0);
  assert.equal(c.aplicadaManual.length, 1);
});

test('listaCerradaDePublico lee la lista del pgTAP real y falla cerrado si no la encuentra', async () => {
  const texto = await readFile(path.join(aqui, '..', 'supabase', 'tests', 'database', 'lote42_superficie_global_seguridad.test.sql'), 'utf8');
  const lista = listaCerradaDePublico(texto);
  assert.ok(lista.has('catalogo_pagina_por_dominio') && lista.size > 5);
  assert.ok(!lista.has('crear_consulta_publica'));
  assert.equal(listaCerradaDePublico('sin lista'), null);
  assert.equal(listaCerradaDePublico('p.proname <> all (array[])'), null);
});

test('los índices esperados existen en las migraciones del repo (no se inventan nombres)', async () => {
  const m = (await readFile(path.join(aqui, '..', 'supabase', 'migrations', '20270507190000_indices_en_claves_foraneas_public.sql'), 'utf8'))
    + (await readFile(path.join(aqui, '..', 'supabase', 'migrations', '20270507190100_indices_en_claves_foraneas_dominio.sql'), 'utf8'));
  for (const nombre of INDICES_ESPERADOS) assert.ok(m.includes(`create index if not exists ${nombre.split('.')[1]}`), nombre);
});

function consultarCon({ registro = [], anon = [], org = [], indices = INDICES_ESPERADOS.map((n) => `${n}|t`), hayRegistro = 't' } = {}) {
  return (sql) => {
    if (sql.includes("to_regclass('supabase_migrations.schema_migrations')")) return [hayRegistro];
    if (sql.includes('from supabase_migrations.schema_migrations')) return registro;
    if (sql.includes("has_function_privilege('anon'")) return anon;
    if (sql.includes("o.nombre like 'Org T%'")) return org;
    if (sql.includes('unnest(array[')) return indices;
    throw new Error(`consulta inesperada: ${sql.slice(0, 60)}`);
  };
}
const lista = new Set(['catalogo_pagina_por_dominio']);

test('diagnosticar + informe + hallazgos: base sana no tiene hallazgos y cada mutante suma uno', () => {
  const sano = diagnosticar(consultarCon({ registro: ['20261019120000|productos_codigo_barras|1'], anon: ['catalogo_pagina_por_dominio'] }), { repo, listaCerrada: lista });
  assert.equal(hallazgos(sano), 0);
  assert.match(informe(sano), /OK: anon solo ejecuta/);
  const mutantes = [
    ['ACL expuesta', { anon: ['catalogo_pagina_por_dominio', 'crear_consulta_publica'] }, /FALLA: anon ejecuta fuera de la lista cerrada: crear_consulta_publica/],
    ['org de prueba', { org: ['aaaaaaaa-0000-4000-8000-000000000001|Org T019|5001'] }, /Org T019 \(aaaaaaaa-0000-4000-8000-000000000001, 5001 clientes\)/],
    ['índice faltante', { indices: INDICES_ESPERADOS.map((n, i) => `${n}|${i === 0 ? 'f' : 't'}`) }, /faltan índices.*mensajes_chat_ia_conversacion_id_fk_idx/],
    ['huérfana sin equivalente', { registro: ['29990101000000|x|0'] }, /SIN EQUIVALENTE 29990101000000/],
    ['otro nombre', { registro: ['20261019120000|otra_cosa|0'] }, /NOMBRE 20261019120000/],
  ];
  for (const [nombre, entrada, patron] of mutantes) {
    const d = diagnosticar(consultarCon({ anon: ['catalogo_pagina_por_dominio'], ...entrada }), { repo, listaCerrada: lista });
    assert.equal(hallazgos(d), 1, nombre);
    assert.match(informe(d), patron, nombre);
  }
});

test('sin registro de migraciones y sin lista cerrada: se omiten con un INFO y no cuentan como hallazgo', () => {
  const d = diagnosticar(consultarCon({ hayRegistro: 'f' }), { repo, listaCerrada: null });
  assert.equal(hallazgos(d), 0);
  const texto = informe(d);
  assert.match(texto, /INFO: la base no tiene supabase_migrations/);
  assert.match(texto, /INFO: no se pudo leer la lista cerrada/);
});

test('el informe nunca propone borrar filas de schema_migrations de forma masiva ni ejecuta el borrado de la organización', () => {
  const d = diagnosticar(consultarCon({ registro: ['29990101000000|x|0'], org: ['aaaaaaaa-0000-4000-8000-000000000001|Org T019|5'] }), { repo, listaCerrada: lista });
  const texto = informe(d);
  assert.match(texto, /PLAN manual \(NO lo ejecuta este script/);
  assert.doesNotMatch(texto, /delete from supabase_migrations/);
  assert.match(texto, /debe dar 0/);
});

test('validarAplicar: exige --confirmo con el MISMO destino', () => {
  assert.equal(validarAplicar(['--docker', 'db']), false);
  assert.equal(validarAplicar(['--docker', 'db', '--aplicar', '--confirmo', 'db']), true);
  for (const malo of [['--docker', 'db', '--aplicar'], ['--docker', 'db', '--aplicar', '--confirmo'], ['--docker', 'db', '--aplicar', '--confirmo', 'otra'], ['--docker', 'db', '--aplicar', '--confirmo', 'DB']]) {
    assert.throws(() => validarAplicar(malo), /--aplicar exige --confirmo db/, malo.join(' '));
  }
  assert.equal(destinoDe(['--docker', 'x']), 'x');
  assert.equal(destinoDe([]), 'DATABASE_URL');
});

test('SQL de reparación: solo toca las dos RPC internas y no contiene borrados, renombres ni índices', () => {
  assert.match(SQL_REVOKE_ACL, /crear_consulta_publica/);
  assert.match(SQL_REVOKE_ACL, /registrar_interes_whatsapp/);
  assert.doesNotMatch(SQL_REVOKE_ACL, /\b(delete|drop|truncate|update|insert|create index|alter)\b/i);
});

async function conDockerFalso() {
  const dir = await mkdtemp(path.join(tmpdir(), 'recon-'));
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const log = path.join(dir, 'psql-stdin.log');
  // El docker falso registra lo que recibe psql (stdin) y responde según la consulta, como una base sana.
  await writeFile(path.join(bin, 'docker'), `#!/bin/sh\ncat > "${dir}/entrada.sql"\ncat "${dir}/entrada.sql" >> "${log}"\necho "-----" >> "${log}"\nif grep -q "to_regclass('supabase_migrations.schema_migrations')" "${dir}/entrada.sql"; then echo "f"; fi\nexit 0\n`);
  await chmod(path.join(bin, 'docker'), 0o755);
  return { dir, bin, log };
}

test('CLI: el diagnóstico va SIEMPRE en sesión de solo lectura; --aplicar sin confirmación no abre ninguna sesión', async () => {
  const { bin, log } = await conDockerFalso();
  const correr = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const diag = correr('--docker', 'db');
  assert.equal(diag.status, 0, diag.stderr);
  const entradas = (await readFile(log, 'utf8')).split('-----').filter((x) => x.trim());
  assert.ok(entradas.length >= 3);
  for (const e of entradas) {
    assert.match(e.trimStart(), /^set default_transaction_read_only = on;/, 'cada sesión de diagnóstico es de solo lectura');
    assert.doesNotMatch(e, /\b(begin|commit|revoke|grant|delete|insert)\b/i);
  }
  const sinConfirmar = correr('--docker', 'db', '--aplicar');
  assert.equal(sinConfirmar.status, 2);
  assert.match(sinConfirmar.stderr, /--confirmo db/);
  assert.equal((await readFile(log, 'utf8')).split('-----').filter((x) => x.trim()).length, entradas.length, 'no se abrió ninguna sesión nueva');
});

test('CLI: con --aplicar --confirmo la sesión de reparación es de escritura y solo contiene la reparación del ACL', async () => {
  const { bin, log } = await conDockerFalso();
  const r = spawnSync(process.execPath, [script, '--docker', 'db', '--aplicar', '--confirmo', 'db'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  const entradas = (await readFile(log, 'utf8')).split('-----').filter((x) => x.trim());
  const escritura = entradas.filter((e) => e.includes('default_transaction_read_only = off'));
  assert.equal(escritura.length, 1);
  assert.match(escritura[0], /begin;[\s\S]*reafirmar_acl_rpc_internas_de_publico[\s\S]*commit;/);
  assert.doesNotMatch(escritura[0], /\b(delete|drop|truncate)\b/i);
  assert.match(r.stdout, /Modo: REPARACIÓN/);
});
