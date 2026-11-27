#!/usr/bin/env node
// Diagnóstico y reparación acotada de una base viva (DEV) respecto del repositorio: MSF-653, MSF-658, MSF-671, MSF-915.
// SOLO LECTURA por defecto: la sesión de psql va en `default_transaction_read_only = on`. Escribe únicamente con --aplicar y --confirmo <destino>.
//
//   node scripts/reconciliar-base.mjs --docker <contenedor-db> [--salida informe.txt]                        # diagnóstico
//   DATABASE_URL=postgres://... node scripts/reconciliar-base.mjs                                            # idem contra una URL
//   node scripts/reconciliar-base.mjs --docker <contenedor-db> --aplicar --confirmo <contenedor-db>          # repara SOLO el ACL (abajo)
//
// Qué diagnostica (todo por solo lectura):
//   - MSF-915/658  versiones registradas en `supabase_migrations.schema_migrations` que no están en el repo, separadas en
//                  «renumerada» (el repo tiene un archivo con el MISMO nombre y otra versión: el guard renumera archivos, no filas) y
//                  «sin equivalente» (a revisar); versiones con otro nombre que el archivo del repo; pendientes (en el repo, sin registrar).
//   - MSF-671      filas `aplicada-manual`, filas sin statements (informativo: el cron las inserta así), organizaciones de prueba vacías
//                  (`Org T…` sin usuarios ni empresas) y los índices que faltan (los crean las migraciones 20270507190000/…190100).
//   - MSF-653      funciones de `publico` ejecutables por anon fuera de la lista cerrada del pgTAP lote42 (deriva de ACL).
// Qué repara con --aplicar (idempotente, reversible con el `grant` de la migración 20270514000000): el ACL de las dos RPC internas de
// `publico` (revoke a public/anon/authenticated, grant a service_role). NADA MÁS: no borra filas de schema_migrations, no renombra registros,
// no borra organizaciones ni crea índices; eso se imprime como PLAN para ejecutar a mano con aprobación (docs/endurecimiento-infra.md).
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const INDICES_ESPERADOS = [
  'public.mensajes_chat_ia_conversacion_id_fk_idx',
  'public.conversaciones_chat_ia_organizacion_id_fk_idx',
  'public.conversaciones_chat_ia_usuario_id_fk_idx',
  'public.documentos_organizacion_id_fk_idx',
  'public.fragmentos_indexados_version_id_fk_idx',
  'dominio.existencias_organizacion_id_fk_idx',
];

export const SQL_REVOKE_ACL = `
do $$
declare v_firma text;
begin
  if to_regprocedure('private.reafirmar_acl_rpc_internas_de_publico()') is not null then
    perform private.reafirmar_acl_rpc_internas_de_publico();
  else
    foreach v_firma in array array['publico.crear_consulta_publica(text, text, text, text, text, uuid)', 'publico.registrar_interes_whatsapp(text, uuid)'] loop
      if to_regprocedure(v_firma) is not null then
        execute format('revoke execute on function %s from public, anon, authenticated', v_firma);
        execute format('grant execute on function %s to service_role', v_firma);
      end if;
    end loop;
  end if;
end $$;
`;

// ---- Repo ----
export function migracionesDelRepo(archivos) {
  const porVersion = new Map();
  for (const archivo of archivos) {
    const m = /^(\d{14})_(.+)\.sql$/.exec(archivo);
    if (m) porVersion.set(m[1], m[2]);
  }
  return porVersion;
}

// ---- Registro de la base: filas `version|nombre|cantidad_de_statements` ----
export function parsearRegistro(lineas) {
  return lineas.filter((l) => l.includes('|')).map((l) => {
    const [version, nombre, statements] = l.split('|');
    return { version: version.trim(), nombre: (nombre ?? '').trim(), statements: Number(statements ?? 0) };
  });
}

export function clasificar(registro, repo) {
  const versionesRepo = new Set(repo.keys());
  const versionPorNombre = new Map([...repo].map(([v, n]) => [n, v]));
  const enBase = new Set(registro.map((r) => r.version));
  const huerfanas = [];
  const otroNombre = [];
  for (const fila of registro) {
    if (!versionesRepo.has(fila.version)) {
      const equivalente = versionPorNombre.get(fila.nombre);
      huerfanas.push({ ...fila, equivalente: equivalente && !enBase.has(equivalente) ? equivalente : equivalente ? `${equivalente} (también registrada)` : null });
    } else if (fila.nombre !== repo.get(fila.version) && fila.nombre !== 'aplicada-manual') {
      otroNombre.push({ ...fila, nombreRepo: repo.get(fila.version) });
    }
  }
  return {
    total: registro.length,
    archivos: repo.size,
    huerfanas,
    renumeradas: huerfanas.filter((h) => h.equivalente !== null),
    sinEquivalente: huerfanas.filter((h) => h.equivalente === null),
    otroNombre,
    aplicadaManual: registro.filter((r) => r.nombre === 'aplicada-manual'),
    sinStatements: registro.filter((r) => r.statements === 0).length,
    pendientes: [...versionesRepo].filter((v) => !enBase.has(v)).sort(),
  };
}

// ---- Lista cerrada de RPC públicas (pgTAP lote42): se lee del test para no duplicarla ----
export function listaCerradaDePublico(textoTest) {
  const i = textoTest.indexOf('p.proname <> all (array[');
  if (i === -1) return null;
  const fin = textoTest.indexOf(']', i);
  const nombres = [...textoTest.slice(i, fin).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  return nombres.length > 0 ? new Set(nombres) : null;
}

const SQL_REGISTRO = `select version, coalesce(name, ''), coalesce(cardinality(statements), 0) from supabase_migrations.schema_migrations order by version;`;
const SQL_PUBLICO_ANON = `select p.proname from pg_proc p where p.pronamespace = 'publico'::regnamespace and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1;`;
const SQL_ORG_PRUEBA = `select o.id, o.nombre, (select count(*) from public.clientes c where c.organizacion_id = o.id)
  from public.organizaciones o
 where o.nombre like 'Org T%'
   and not exists (select 1 from public.usuarios_organizacion u where u.organizacion_id = o.id)
   and not exists (select 1 from dominio.empresas e where e.organizacion_id = o.id) order by o.nombre;`;
const sqlIndices = () => `select x.n, to_regclass(x.n) is not null from unnest(array[${INDICES_ESPERADOS.map((n) => `'${n}'`).join(', ')}]) as x(n);`;
const SQL_TIENE_REGISTRO = `select to_regclass('supabase_migrations.schema_migrations') is not null;`;

// `consultar(sql)` -> líneas `a|b|c`. Devuelve las secciones del diagnóstico (sin imprimir nada).
export function diagnosticar(consultar, { repo, listaCerrada }) {
  const hayRegistro = consultar(SQL_TIENE_REGISTRO).some((l) => l.trim() === 't');
  const migraciones = hayRegistro ? clasificar(parsearRegistro(consultar(SQL_REGISTRO)), repo) : null;
  const expuestas = listaCerrada ? consultar(SQL_PUBLICO_ANON).map((l) => l.trim()).filter((n) => n && !listaCerrada.has(n)) : null;
  const orgPrueba = consultar(SQL_ORG_PRUEBA).map((l) => { const [id, nombre, clientes] = l.split('|'); return { id, nombre, clientes: Number(clientes) }; });
  const indices = consultar(sqlIndices()).map((l) => { const [nombre, existe] = l.split('|'); return { nombre, existe: existe.trim() === 't' }; });
  return { hayRegistro, migraciones, expuestas, orgPrueba, indicesFaltantes: indices.filter((i) => !i.existe).map((i) => i.nombre) };
}

export function informe(d, { aplicar = false } = {}) {
  const l = [];
  l.push(`Modo: ${aplicar ? 'REPARACIÓN (--aplicar)' : 'solo lectura'}`);
  if (!d.hayRegistro) l.push('INFO: la base no tiene supabase_migrations.schema_migrations; se omite el análisis de migraciones.');
  else {
    const m = d.migraciones;
    l.push(`== Migraciones (MSF-915/658/671) ==`, `Registradas en la base: ${m.total} · archivos en el repo: ${m.archivos} · diferencia: ${m.total - m.archivos}`);
    l.push(`Registradas sin archivo con esa versión: ${m.huerfanas.length} = ${m.renumeradas.length} renumeradas (mismo nombre, otra versión en el repo) + ${m.sinEquivalente.length} sin equivalente`);
    for (const h of m.sinEquivalente.slice(0, 50)) l.push(`  SIN EQUIVALENTE ${h.version} ${h.nombre || '(sin nombre)'}`);
    if (m.sinEquivalente.length > 50) l.push(`  ... y ${m.sinEquivalente.length - 50} más (usá --salida para el listado completo)`);
    l.push(`Con otro nombre que el archivo del repo (MSF-658): ${m.otroNombre.length}`);
    for (const o of m.otroNombre.slice(0, 20)) l.push(`  NOMBRE ${o.version}: base «${o.nombre}» vs repo «${o.nombreRepo}»`);
    l.push(`«aplicada-manual» (MSF-671): ${m.aplicadaManual.length}${m.aplicadaManual.length ? ` -> ${m.aplicadaManual.map((r) => r.version).join(', ')}` : ''}`);
    l.push(`Sin statements (informativo: el cron las registra así por diseño): ${m.sinStatements}`);
    l.push(`Pendientes (en el repo y sin registrar; el cron las aplicará): ${m.pendientes.length}`);
  }
  l.push('== ACL de publico (MSF-653) ==');
  if (d.expuestas === null) l.push('INFO: no se pudo leer la lista cerrada del pgTAP lote42; se omite.');
  else l.push(d.expuestas.length === 0 ? 'OK: anon solo ejecuta las RPC de la lista cerrada.' : `FALLA: anon ejecuta fuera de la lista cerrada: ${d.expuestas.join(', ')}`);
  l.push('== Higiene (MSF-671) ==');
  l.push(d.orgPrueba.length === 0 ? 'OK: sin organizaciones de prueba vacías.' : `FALLA: organizaciones de prueba vacías: ${d.orgPrueba.map((o) => `${o.nombre} (${o.id}, ${o.clientes} clientes)`).join('; ')}`);
  l.push(d.indicesFaltantes.length === 0 ? 'OK: están los índices esperados.' : `FALLA: faltan índices (los crean las migraciones 20270507190000/…190100 cuando el cron las aplique): ${d.indicesFaltantes.join(', ')}`);
  l.push('== PLAN manual (NO lo ejecuta este script; requiere aprobación y una copia restaurada primero) ==');
  if (d.expuestas && d.expuestas.length > 0) l.push('1. ACL: `--aplicar --confirmo <destino>` repara las dos RPC internas; para otra función: revoke execute on function <firma> from public, anon, authenticated; y agregala a la migración correspondiente.');
  for (const o of d.orgPrueba) l.push(`2. Organización de prueba: begin; select count(*) from public.usuarios_organizacion where organizacion_id = '${o.id}'; -- debe dar 0\n   delete from public.organizaciones where id = '${o.id}'; -- cascada; commit solo si el conteo previo fue 0`);
  if (d.migraciones?.otroNombre.length) l.push('3. Nombre distinto: verificar objeto por objeto qué SQL corrió realmente bajo esa versión; no renombrar el registro sin verificarlo (docs/endurecimiento-infra.md, «Reconciliar el registro»).');
  if (d.migraciones?.sinEquivalente.length) l.push('4. Sin equivalente: decidir una por una si es histórica legítima (conservar) o basura; el borrado de filas de schema_migrations es un `delete` explícito y auditado, nunca masivo.');
  return l.join('\n');
}

export function hallazgos(d) {
  return (d.expuestas?.length ?? 0) + d.orgPrueba.length + d.indicesFaltantes.length + (d.migraciones ? d.migraciones.sinEquivalente.length + d.migraciones.otroNombre.length : 0);
}

// ---- psql ----
function psql(argv, sql, escritura) {
  const i = argv.indexOf('--docker');
  const sesion = escritura ? 'set default_transaction_read_only = off;\nbegin;\n' : 'set default_transaction_read_only = on;\n';
  const cierre = escritura ? '\ncommit;\n' : '';
  const args = ['-tAX', '-F', '|', '-v', 'ON_ERROR_STOP=1'];
  const entrada = `${sesion}${sql}${cierre}`;
  const r = i >= 0
    ? spawnSync('docker', ['exec', '-i', argv[i + 1], 'psql', '-U', 'postgres', ...args], { input: entrada, encoding: 'utf8' })
    : spawnSync('psql', [process.env.DATABASE_URL ?? '', ...args], { input: entrada, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || 'psql falló').split('\n')[0]);
  return r.stdout.split('\n').filter((x) => x.trim() !== '' && x.trim() !== 'SET' && x.trim() !== 'BEGIN' && x.trim() !== 'COMMIT');
}

export function destinoDe(argv) {
  const i = argv.indexOf('--docker');
  return i >= 0 ? argv[i + 1] : 'DATABASE_URL';
}

// Valida --aplicar: exige --confirmo con el mismo destino. Lanza con el motivo.
export function validarAplicar(argv) {
  if (!argv.includes('--aplicar')) return false;
  const i = argv.indexOf('--confirmo');
  const confirmo = i >= 0 ? argv[i + 1] : undefined;
  const destino = destinoDe(argv);
  if (!confirmo || confirmo !== destino) throw new Error(`--aplicar exige --confirmo ${destino} (el mismo destino que --docker): es una confirmación explícita de que escribís en ESA base.`);
  if (destino === 'DATABASE_URL' && !process.env.DATABASE_URL) throw new Error('Falta --docker <contenedor> o DATABASE_URL.');
  return true;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  try {
    const aplicar = validarAplicar(argv);
    const repo = migracionesDelRepo(readdirSync(path.join(RAIZ, 'supabase', 'migrations')));
    const listaCerrada = listaCerradaDePublico(readFileSync(path.join(RAIZ, 'supabase', 'tests', 'database', 'lote42_superficie_global_seguridad.test.sql'), 'utf8'));
    const consultar = (sql) => psql(argv, sql, false);
    let d = diagnosticar(consultar, { repo, listaCerrada });
    if (aplicar) {
      psql(argv, SQL_REVOKE_ACL, true);
      console.log('Reparación aplicada: ACL de las RPC internas de publico (revoke a public/anon/authenticated, grant a service_role).');
      d = diagnosticar(consultar, { repo, listaCerrada });
    }
    const texto = informe(d, { aplicar });
    const s = argv.indexOf('--salida');
    if (s >= 0 && argv[s + 1]) {
      const completo = d.migraciones ? `${texto}\n\n== Listado completo sin equivalente ==\n${d.migraciones.sinEquivalente.map((h) => `${h.version} ${h.nombre}`).join('\n')}\n` : texto;
      writeFileSync(argv[s + 1], completo, { mode: 0o600 });
    }
    console.log(texto);
    process.exit(hallazgos(d) > 0 ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Falló la reconciliación.');
    process.exit(2);
  }
}
