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
// ALCANCE (MSF-749): las reglas se aplican a las migraciones PROPIAS de la rama —las que
// agregó, renombró o modificó desde el punto de divergencia (`merge-base` con la base)— y
// se comparan contra la PUNTA de la base, para que sigan contando las colisiones reales.
// Lo que la rama heredó sin tocar queda FUERA del alcance: la base renumera migraciones
// casi todos los días y toda rama abierta antes del renumerado quedaba `BEHIND` con el
// job `application` en rojo por «REUSADA»/«MODIFICADA» de migraciones que ese PR no había
// tocado (13 PRs abiertos). Si la base renumeró algo que la rama heredó, el guard AVISA
// (no falla) y pide actualizar la rama.
//
// Uso:  node scripts/verificar-migraciones.mjs [--base origin/dokploy] [--solo-idempotencia] [--estricto]
// Sale con código 1 si hay un problema y con 2 si `--base` o `GITHUB_BASE_REF` empiezan con `-`.

import { spawnSync } from 'node:child_process';
import { revisarDdl } from './guard-migraciones-ddl.mjs';

const args = process.argv.slice(2);
const valorDe = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
// Defensa en profundidad: una base que empieza con `-` se leería como opción de git (`--output=…`, `--upload-pack=…`) en
// los `git rev-parse`/`merge-base`/`diff` de más abajo. `--base --estricto` (falta el valor) también cae acá.
for (const [origen, valor] of [['--base', valorDe('--base', '')], ['GITHUB_BASE_REF', process.env.GITHUB_BASE_REF ?? '']]) {
  if (valor.startsWith('-')) {
    console.error(`${origen} inválido (${JSON.stringify(valor)}): no puede empezar con «-»; se confundiría con una opción de git.`);
    process.exit(2);
  }
}
const base = valorDe('--base', process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dokploy');
const soloIdempotencia = args.includes('--solo-idempotencia');
const esIntegracion = /^origin\/(dokploy|main)$/.test(base);
// Orden contra la base como ERROR: base de épica, destino final en un PR, o `--estricto`.
const ordenEstricto = args.includes('--estricto') || !esIntegracion || Boolean(process.env.GITHUB_BASE_REF);
const git = (a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const problemas = [];
const avisos = [];

const puedeResolver = (ref) => git(['rev-parse', '--verify', '--quiet', ref]).status === 0;
const commitDe = (ref) => (git(['rev-parse', '--verify', '--quiet', ref]).stdout || '').trim();
const versionDe = (f) => f.split('/').pop().split('_')[0];
const versionesDe = (ref) => new Set(
  (git(['ls-tree', '-r', '--name-only', ref, '--', 'supabase/migrations']).stdout || '')
    .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+(_.+)?\.sql$/.test(x))
    .map((x) => x.split('/').pop().split('_')[0].replace(/\.sql$/, ''))
);

// --- Migraciones del árbol actual ---
const archivos = (git(['ls-files', 'supabase/migrations']).stdout || '')
  .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+_.+\.sql$/.test(x));

// --- ALCANCE: las migraciones que la rama agregó, renombró o modificó ---
// El punto de divergencia (`merge-base` con la base) separa lo que la rama trajo de lo que
// la base ya tenía. Sin él, una base que renumera migraciones hace fallar el guard de
// ramas que quedaron atrás, aunque no toquen migraciones (MSF-749).
const existeBase = puedeResolver(base);
const commitBase = existeBase ? commitDe(base) : '';
const head = commitDe('HEAD');
let fork = '';
let forkEsMergeBase = false;
if (commitBase) {
  fork = (git(['merge-base', commitBase, 'HEAD']).stdout || '').trim();
  if (fork) forkEsMergeBase = true;
  // Clone superficial sin ancestro común: cae a HEAD~1 (patrón de verificar-documentacion-cambios.mjs).
  else if (puedeResolver('HEAD~1')) fork = 'HEAD~1';
}
// Sin divergencia, o cuando la base ES el HEAD (push a la rama base): no hay migraciones
// propias y se revisa el árbol entero, como antes.
const migracionesPropias = (ref) => {
  const cambios = (git(['diff', '--name-status', '--cached', ref, '--', 'supabase/migrations']).stdout || '')
    .split('\n').map((x) => x.trim()).filter(Boolean);
  const set = new Set();
  for (const linea of cambios) {
    const partes = linea.split('\t');
    const estado = (partes[0] || '')[0];
    // 'R100 old new': el renombrado es un cambio de la rama → entra el nombre nuevo.
    const rutas = estado === 'R' || estado === 'C' ? partes.slice(2) : partes.slice(1);
    for (const r of rutas) if (r.startsWith('supabase/migrations/')) set.add(r);
  }
  return set;
};
const propias = fork && commitBase !== head ? migracionesPropias(fork) : null;
const enAlcance = (f) => propias === null || propias.has(f);

// Un archivo de migración que no es `<versión>_<nombre>.sql` no lo aplica ni el CLI ni el cron: se rechaza en vez de ignorarlo.
const todosLosArchivos = (git(['ls-files', 'supabase/migrations']).stdout || '')
  .split('\n').map((x) => x.trim()).filter(Boolean);
const NOMBRE_VALIDO = /^supabase\/migrations\/\d+_[^/]+\.sql$/;
for (const f of todosLosArchivos) {
  if (!NOMBRE_VALIDO.test(f) && enAlcance(f)) {
    problemas.push(`nombre inválido ${f}: tiene que ser <versión>_<nombre>.sql; el CLI de Supabase y el cron de las bases lo ignoran y la migración nunca se aplicaría`);
  }
}

const porVersion = new Map();
for (const f of archivos) {
  const v = versionDe(f);
  if (!porVersion.has(v)) porVersion.set(v, []);
  porVersion.get(v).push(f);
}
for (const [v, fs_] of porVersion) {
  if (fs_.length > 1 && fs_.some(enAlcance)) problemas.push(`versión duplicada ${v}: ${fs_.join(', ')}`);
}

// Las versiones que la base tiene publicadas (contra las que se compara el alcance).
const versionesEnBase = existeBase ? versionesDe(commitBase) : new Set();

// La base renumeró migraciones que la rama heredó: no es culpa de este PR, pero la rama
// tiene que actualizarse antes de mergear (si no, la migración vieja y la nueva conviven).
if (commitBase && forkEsMergeBase) {
  const renumeradas = [...versionesDe(fork)].filter((v) => !versionesEnBase.has(v)).sort();
  if (renumeradas.length) {
    avisos.push(`la base ${base} renumeró o quitó ${renumeradas.length} migración(es) que tu rama heredó (${renumeradas.slice(0, 5).join(', ')}${renumeradas.length > 5 ? ', …' : ''}): actualizá tu rama (merge de ${base}) antes de mergear`);
  }
}

if (!soloIdempotencia) {
  if (!existeBase) {
    avisos.push(`no existe la base ${base}: se omite el control de versiones (sí corre el de idempotencia)`);
  } else {
    // En la base también cuentan los archivos SIN nombre (`<versión>.sql`): renombrarlos para que se apliquen no es una versión
    // nueva ni reusada, es la misma migración con el mismo contenido.
    const enBase = (git(['ls-tree', '-r', '--name-only', base, 'supabase/migrations']).stdout || '')
      .split('\n').map((x) => x.trim()).filter((x) => /^supabase\/migrations\/\d+(_.+)?\.sql$/.test(x));
    const basePorVersion = new Map();
    const baseTodasPorVersion = new Map();
    for (const f of enBase) {
      const ver = f.split('/').pop().split('_')[0].replace(/\.sql$/, '');
      basePorVersion.set(ver, f);
      if (!baseTodasPorVersion.has(ver)) baseTodasPorVersion.set(ver, []);
      baseTodasPorVersion.get(ver).push(f);
    }

    const maxBase = [...basePorVersion.keys()].sort().pop() || '0';

    for (const [v, fs_] of porVersion) {
      if (!fs_.some(enAlcance)) continue;
      const propio = fs_.find(enAlcance);
      // Si la base ya tiene dos archivos con la misma versión (colisión heredada), se compara contra el de la MISMA ruta.
      const enLaBase = baseTodasPorVersion.get(v) || [];
      const previo = enLaBase.includes(propio) ? propio : basePorVersion.get(v);
      if (!previo) {
        if (v <= maxBase) {
          if (ordenEstricto) {
            problemas.push(`versión ${v} REUSADA: ya existe ${maxBase} o mayor en ${base}; usá una versión nueva y mayor (${propio})`);
          } else {
            avisos.push(`versión ${v} está por debajo de ${maxBase} (máxima de ${base}) pero no colisiona: se acomoda al integrar la épica (con \`--estricto\` o en el PR a ${base} es error). El aplicador no ejecuta versiones bajo la cola ya aplicada (${propio})`);
          }
        }
        continue;
      }
      const actual = git(['show', `:${propio}`]).stdout || '';
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

// --- Idempotencia del DDL (sólo archivos NUEVOS de la rama respecto de la base) ---
// «Nuevo» = migración PROPIA de la rama cuya VERSIÓN no existe en la base (un archivo
// renombrado de `<versión>.sql` a `<versión>_<nombre>.sql` no es nuevo). Lo que la rama
// heredó no se revisa: ya se validó cuando se publicó.
const nuevos = existeBase
  ? archivos.filter((f) => enAlcance(f) && !versionesEnBase.has(versionDe(f)))
  : archivos.filter(enAlcance);

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
