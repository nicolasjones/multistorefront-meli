#!/usr/bin/env node
// Guard de migraciones: evita la clase de falla que trabó DEV el 2026-10-23.
//
//   1. VERSIONES ÚNICAS: dos archivos con la misma versión rompen el registro.
//   2. VERSIÓN INMUTABLE: una versión que ya existía en la base NO puede cambiar de
//      contenido (se aplicó en algún entorno con ese contenido; cambiarla hace que el
//      registro y el archivo discrepen y que la migración NUNCA se aplique — pasó con
//      `20261019120000`, que quedó grabada con otro contenido y bloqueó toda la cola).
//   3. VERSIÓN NUEVA: una migración agregada debe usar una versión MAYOR que la máxima
//      de la base (no reusar un número viejo). Es ERROR cuando la base es la rama contra
//      la que se mergea de verdad (una épica en un PR a la épica) o el destino final
//      (`dokploy`/`main`) en un PR o con `--estricto`. Fuera de eso, comparar una rama de
//      épica con `dokploy` (que avanza con cada épica que mergea) es sólo un AVISO de
//      orden: se resuelve al integrar la épica, y no obliga a renombrar en bucle.
//   0. NOMBRE VÁLIDO: todo archivo de `supabase/migrations/` es `<versión>_<nombre>.sql`. El CLI de Supabase y el cron de las
//      bases dev/stg/prd (`migrar-supabase-vps.sh`) IGNORAN un archivo sin nombre (`20270202200501.sql`): el CI lo aplica
//      (toma todos los `.sql`) y los entornos no, así que la migración existe en el repo y nunca llega a la base. Pasó con las
//      tres migraciones de seguridad MSF-724 del chat de IA, que quedaron sin aplicar en dev.
//   4. IDEMPOTENCIA: el DDL debe tolerar una aplicación parcial (el aplicador se detiene
//      en el primer error y reintenta): `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`,
//      `CREATE INDEX IF NOT EXISTS`.
//
// Uso:  node scripts/verificar-migraciones.mjs [--base origin/dokploy] [--solo-idempotencia] [--estricto]
// Sale con código 1 si hay un problema.

import { spawnSync } from 'node:child_process';
import { revisarDdl } from './guard-migraciones-ddl.mjs';

const args = process.argv.slice(2);
const valorDe = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = valorDe('--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dokploy');
const soloIdempotencia = args.includes('--solo-idempotencia');
const esIntegracion = /^origin\/(dokploy|main)$/.test(base);
// Orden contra la base como ERROR: base de épica, destino final en un PR, o `--estricto`.
const ordenEstricto = args.includes('--estricto') || !esIntegracion || Boolean(process.env.GITHUB_BASE_REF);
const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const problemas = [];
const avisos = [];

// --- Migraciones del árbol actual ---
const archivos = (git(['ls-files', 'supabase/migrations']).stdout || '')
  .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+_.+\.sql$/.test(x));

// Un archivo de migración que no es `<versión>_<nombre>.sql` no lo aplica ni el CLI ni el cron: se rechaza en vez de ignorarlo.
const todosLosArchivos = (git(['ls-files', 'supabase/migrations']).stdout || '')
  .split('\n').map((x) => x.trim()).filter(Boolean);
const NOMBRE_VALIDO = /^supabase\/migrations\/\d+_[^/]+\.sql$/;
for (const f of todosLosArchivos) {
  if (!NOMBRE_VALIDO.test(f)) {
    problemas.push(`nombre inválido ${f}: tiene que ser <versión>_<nombre>.sql; el CLI de Supabase y el cron de las bases lo ignoran y la migración nunca se aplicaría`);
  }
}

const porVersion = new Map();
for (const f of archivos) {
  const v = f.split('/').pop().split('_')[0];
  if (!porVersion.has(v)) porVersion.set(v, []);
  porVersion.get(v).push(f);
}
for (const [v, fs_] of porVersion) {
  if (fs_.length > 1) problemas.push(`versión duplicada ${v}: ${fs_.join(', ')}`);
}

if (!soloIdempotencia) {
  const existeBase = git(['rev-parse', '--verify', '--quiet', base]).status === 0;
  if (!existeBase) {
    avisos.push(`no existe la base ${base}: se omite el control de versiones (sí corre el de idempotencia)`);
  } else {
    // En la base también cuentan los archivos SIN nombre (`<versión>.sql`): renombrarlos para que se apliquen no es una versión
    // nueva ni reusada, es la misma migración con el mismo contenido.
    const enBase = (git(['ls-tree', '-r', '--name-only', base, 'supabase/migrations']).stdout || '')
      .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+(_.+)?\.sql$/.test(x));
    const basePorVersion = new Map();
    for (const f of enBase) basePorVersion.set(f.split('/').pop().split('_')[0].replace(/\.sql$/, ''), f);

    const maxBase = [...basePorVersion.keys()].sort().pop() || '0';

    for (const [v, fs_] of porVersion) {
      const previo = basePorVersion.get(v);
      if (!previo) {
        if (v <= maxBase) {
          if (ordenEstricto) {
            problemas.push(`versión ${v} REUSADA: ya existe ${maxBase} o mayor en ${base}; usá una versión nueva y mayor (${fs_[0]})`);
          } else {
            avisos.push(`versión ${v} está por debajo de ${maxBase} (máxima de ${base}) pero no colisiona: se acomoda al integrar la épica (con \`--estricto\` o en el PR a ${base} es error). El aplicador no ejecuta versiones bajo la cola ya aplicada (${fs_[0]})`);
          }
        }
        continue;
      }
      const actual = git(['show', `:${fs_[0]}`]).stdout || '';
      const anterior = git(['show', `${base}:${previo}`]).stdout || '';
      if (actual !== anterior) {
        // Editar una versión ya publicada es peligroso en general, pero AGREGAR guards de
        // idempotencia (IF NOT EXISTS / IF EXISTS) no cambia el efecto cuando la migración
        // se aplica completa: es justamente el arreglo que destraba una aplicación parcial.
        // Se compara el contenido con los guards normalizados.
        const sinGuards = (s) => s
          .replace(/\badd\s+column\s+if\s+not\s+exists\b/gi, 'add column')
          .replace(/\bcreate\s+(unique\s+)?index\s+if\s+not\s+exists\b/gi, 'create $1index')
          .replace(/\bdrop\s+(\w+)\s+if\s+exists\b/gi, 'drop $1')
          .replace(/\bcreate\s+table\s+if\s+not\s+exists\b/gi, 'create table');
        if (sinGuards(actual) === sinGuards(anterior)) {
          avisos.push(`versión ${v}: sólo se agregaron guards de idempotencia (permitido)`);
        } else {
          problemas.push(`versión ${v} MODIFICADA: ya existe en ${base} (${previo}). Una versión aplicada es inmutable: si el contenido nunca se aplicó, renombrala a una versión libre y mayor.`);
        }
      }
    }
  }
}

// --- Idempotencia del DDL (sólo archivos NUEVOS respecto de la base) ---
const existeBase2 = git(['rev-parse', '--verify', '--quiet', base]).status === 0;
// «Nuevo» = su VERSIÓN no existe en la base (un archivo renombrado de `<versión>.sql` a `<versión>_<nombre>.sql` no es nuevo).
const versionesEnBase = new Set(existeBase2
  ? (git(['ls-tree', '-r', '--name-only', base, 'supabase/migrations']).stdout || '')
    .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+(_.+)?\.sql$/.test(x))
    .map((x) => x.split('/').pop().split('_')[0].replace(/\.sql$/, ''))
  : []);
const nuevos = existeBase2
  ? archivos.filter((f) => !versionesEnBase.has(f.split('/').pop().split('_')[0]))
  : archivos;

const revisar = (archivo) => {
  const sql = git(['show', `:${archivo}`]).stdout || '';
  // Todas las reglas de idempotencia se evalúan por SENTENCIA completa (hasta `;`), no línea por
  // línea: `alter table t` + `add column x` en líneas distintas (MSF-682), o `create index` +
  // `if not exists` en la línea siguiente, son el mismo problema.
  for (const h of revisarDdl(sql)) {
    const texto = `${archivo}:${h.linea} ${h.mensaje}`;
    if (h.severidad === 'problema') problemas.push(texto);
    else avisos.push(texto);
  }
};
for (const f of nuevos) revisar(f);

for (const a of avisos) console.warn(`aviso: ${a}`);
if (problemas.length) {
  console.error('Migraciones: revisar antes de mergear');
  for (const p of problemas) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Migraciones OK: ${archivos.length} archivo(s), ${nuevos.length} nuevo(s) contra ${base}.`);
