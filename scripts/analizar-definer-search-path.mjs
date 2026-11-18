#!/usr/bin/env node
// MSF-899 / MSF-917: análisis reproducible de las funciones `security definer` cuyo `search_path` NO es '' (vacío).
//
// Cambiar `set search_path = public` por `''` rompe una función cuyo cuerpo usa objetos SIN calificar (`from tabla`, `llamar()`,
// `::tipo`, operadores de extensiones): con '' solo se resuelve `pg_catalog`. Este script lista las funciones y clasifica cada una:
//   - segura:   el cuerpo no tiene ninguna referencia sin calificar a objetos de los esquemas de la app/extensiones ni SQL dinámico.
//   - revisar:  hay referencias sin calificar (se listan) o SQL dinámico (`execute`, `format`): hay que calificarlas a mano.
// Es una heurística CONSERVADORA (falsos «revisar» posibles, ningún falso «segura» conocido): una función «segura» igual debe
// pasar TODA la suite pgTAP antes de migrarla.
//
// NO detecta (revisión humana): `set local search_path` dentro del cuerpo, `OPERATOR(esquema.op)`, operadores de extensiones fuera de la
// lista fija, el texto de SQL dinámico (solo marca la existencia de execute/format), vistas/triggers/defaults. Ver docs/higiene-base-datos.md.
//
// Uso (solo lectura, no modifica la base):
//   node scripts/analizar-definer-search-path.mjs --docker <contenedor>      # psql dentro de un contenedor (usuario postgres)
//   DATABASE_URL=postgres://... node scripts/analizar-definer-search-path.mjs # psql contra una URL
//   opciones: --json (salida JSON), --solo-seguras (solo los nombres de las seguras, uno por línea)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ESQUEMAS_APP = ['public', 'private', 'dominio', 'publico', 'extensions'];

export const CONSULTA = `
with fn as (
  select p.oid, n.nspname as esquema, p.proname as nombre, pg_get_function_identity_arguments(p.oid) as args,
         l.lanname as lenguaje, coalesce(array_to_string(p.proconfig, ','), '') as config, p.prosrc as cuerpo,
         coalesce(p.proargnames, array[]::text[]) as argnames
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where p.prosecdef
     and n.nspname in ('public','private','dominio','publico')
     and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c = 'search_path=""' or c = 'search_path=')
)
select json_build_object(
  'funciones', (select coalesce(json_agg(row_to_json(fn)), '[]'::json) from fn),
  'relaciones', (select coalesce(json_agg(distinct c.relname), '[]'::json) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where c.relkind in ('r','p','v','m','f','S') and n.nspname in (${ESQUEMAS_APP.map((e) => `'${e}'`).join(',')})),
  'funcionesApp', (select coalesce(json_agg(distinct p.proname), '[]'::json) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in (${ESQUEMAS_APP.map((e) => `'${e}'`).join(',')})
                      and not exists (select 1 from pg_proc q where q.pronamespace = 'pg_catalog'::regnamespace and q.proname = p.proname)),
  'tipos', (select coalesce(json_agg(distinct t.typname), '[]'::json) from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname in (${ESQUEMAS_APP.map((e) => `'${e}'`).join(',')}) and t.typtype in ('b','d','e','c') and t.typname !~ '^_')
);`;

/** Quita comentarios `--` y `/* *​/` y reemplaza literales `'...'` por `''` (conservando que HAY un literal). */
export function limpiar(sql) {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  s = s.replace(/'(?:[^']|'')*'/g, "''");
  return s.toLowerCase();
}

/** Devuelve las referencias sin calificar de una función. `cat` = { relaciones:Set, funcionesApp:Set, tipos:Set }. */
export function analizarFuncion(f, cat) {
  const crudo = f.cuerpo ?? '';
  const s = limpiar(crudo);
  const hallazgos = [];

  // Variables y parámetros locales: no son objetos del catálogo aunque se llamen igual que uno.
  const locales = new Set((f.argnames ?? []).map((x) => x.toLowerCase()));
  for (const m of s.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+[a-z_][a-z0-9_ .%()]*?(?::=|=|default)?[^;]*;/gm)) locales.add(m[1]);
  // CTE: `with nombre as (` y `, nombre as (`
  const ctes = new Set([...s.matchAll(/(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s+as\s*(?:not\s+materialized\s*|materialized\s*)?\(/g)].map((m) => m[1]));

  // 1) Relaciones sin calificar tras from/join/update/delete from/insert into/table/using/lateral.
  for (const m of s.matchAll(/\b(?:from|join|update|into|table|using)\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?!\s*[.(])/g)) {
    const nombre = m[1];
    if (ctes.has(nombre)) continue;
    if (cat.relaciones.has(nombre) && !(locales.has(nombre) && /\binto\s+/.test(m[0]) && !/insert\s+into/.test(s.slice(Math.max(0, m.index - 8), m.index + m[0].length)))) {
      hallazgos.push({ tipo: 'relacion', nombre });
    }
  }
  // 2) Llamadas a funciones de la app sin calificar: `nombre(` sin `.` delante.
  for (const m of s.matchAll(/(?<![.\w])([a-z_][a-z0-9_]*)\s*\(/g)) {
    const nombre = m[1];
    if (cat.funcionesApp.has(nombre) && !ctes.has(nombre)) hallazgos.push({ tipo: 'funcion', nombre });
  }
  // 3) Tipos de la app sin calificar en casts (`::tipo`) y declaraciones `%type`/`as tipo`.
  for (const m of s.matchAll(/::\s*([a-z_][a-z0-9_]*)(?!\s*\.)/g)) {
    if (cat.tipos.has(m[1])) hallazgos.push({ tipo: 'tipo', nombre: m[1] });
  }
  // 4) Operadores de extensiones (pgvector, pg_trgm): se resuelven por search_path.
  for (const op of ['<=>', '<->', '<#>', ' % ', '%>', '<%', '@@@']) {
    if (s.includes(op)) hallazgos.push({ tipo: 'operador', nombre: op.trim() });
  }
  // 5) SQL dinámico: el texto armado en runtime puede traer nombres sin calificar que el análisis estático no ve.
  if (/\bexecute\b/.test(s) || /\bformat\s*\(/.test(s)) hallazgos.push({ tipo: 'dinamico', nombre: 'execute/format' });

  const unicos = [...new Map(hallazgos.map((h) => [`${h.tipo}:${h.nombre}`, h])).values()];
  return { segura: unicos.length === 0, hallazgos: unicos };
}

export function clasificar(datos) {
  const cat = {
    relaciones: new Set(datos.relaciones),
    funcionesApp: new Set(datos.funcionesApp),
    tipos: new Set(datos.tipos),
  };
  return datos.funciones.map((f) => ({
    firma: `${f.esquema}.${f.nombre}(${f.args})`,
    lenguaje: f.lenguaje,
    config: f.config || '(sin search_path)',
    ...analizarFuncion(f, cat),
  }));
}

function ejecutarPsql(argv) {
  const i = argv.indexOf('--docker');
  const docker = i >= 0 ? argv[i + 1] : null;
  const base = ['-tAX', '-v', 'ON_ERROR_STOP=1', '-c', `set default_transaction_read_only = on; ${CONSULTA}`];
  const r = docker
    ? spawnSync('docker', ['exec', '-i', docker, 'psql', '-U', 'postgres', ...base], { encoding: 'utf8', maxBuffer: 1 << 28 })
    : spawnSync('psql', [process.env.DATABASE_URL ?? '', ...base], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(r.stderr || 'psql falló');
    process.exit(1);
  }
  // `set ...;` imprime «SET» y luego el JSON: se toma la última línea no vacía.
  const linea = r.stdout.split('\n').filter((l) => l.trim().startsWith('{')).pop();
  return JSON.parse(linea);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const filas = clasificar(ejecutarPsql(argv));
  const seguras = filas.filter((f) => f.segura);
  const revisar = filas.filter((f) => !f.segura);
  if (argv.includes('--solo-seguras')) {
    for (const f of seguras) console.log(f.firma);
  } else if (argv.includes('--json')) {
    console.log(JSON.stringify({ total: filas.length, seguras: seguras.length, revisar: revisar.length, filas }, null, 2));
  } else {
    console.log(`security definer con search_path distinto de '': ${filas.length} (seguras ${seguras.length}, a revisar ${revisar.length})\n`);
    console.log('## Seguras (candidatas a `alter function ... set search_path = \'\'`)');
    for (const f of seguras) console.log(`- ${f.firma}  [${f.config}]`);
    console.log('\n## A revisar (referencias sin calificar)');
    for (const f of revisar) console.log(`- ${f.firma}  [${f.config}] -> ${f.hallazgos.map((h) => `${h.tipo}:${h.nombre}`).join(', ')}`);
  }
}
