import { spawnSync } from 'node:child_process';
import { pantallasSinCaptura } from './capturas-manual.mjs';
import { anotacion, archivosSinDocCorrespondiente, leerMapaDocs, lineaLista } from './docs-correspondencia.mjs';

const run = (args) => spawnSync('git', args, { encoding: 'utf8' });
const configuredBase = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.DOCUMENTATION_CHECK_BASE;
let base = configuredBase || 'HEAD~1';
const canResolve = (ref) => run(['rev-parse', '--verify', ref]).status === 0;
// En dispatch manual no hay GITHUB_BASE_REF: el merge-base con main cubre la
// rama completa (si el clone es shallow y no resuelve, se cae a HEAD~1).
if (!configuredBase) {
  const mb = run(['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' });
  if (mb.status === 0 && mb.stdout.trim()) base = mb.stdout.trim();
}
if (!canResolve(base) && canResolve('HEAD~1')) base = 'HEAD~1';
if (!canResolve(base)) {
  console.error(`No se pudo resolver la base de documentación: ${base}`);
  process.exit(1);
}

// `-z` ya entrega los nombres sin escapar; `core.quotepath=off` es cinturón y tirantes (redundante a propósito).
const diff = run(['-c', 'core.quotepath=off', 'diff', '--name-only', '-z', `${base}...HEAD`]);
if (diff.status !== 0) {
  console.error(diff.stderr.trim() || 'No se pudo inspeccionar el diff de documentación.');
  process.exit(diff.status || 1);
}

const changed = diff.stdout.split('\0').filter(Boolean);
const relevant = changed.filter((path) => /^(apps|workers|supabase|infra|scripts|packages|\.github)\//.test(path));
const documented = changed.some((path) =>
  /^(specs|docs)\//.test(path) || /^\.specify\/(bugs|memory)\//.test(path) || /^(AGENTS|CLAUDE)\.md$/.test(path),
);

if (relevant.length > 0 && !documented) {
  console.error('Fallo de documentación: el cambio toca plataforma/tooling pero no actualiza specs/, docs/, .specify/bugs/, .specify/memory/, AGENTS.md, CLAUDE.md ni la constitución.');
  console.error(relevant.map((path) => lineaLista(path, ' ')).join('\n'));
  process.exit(1);
}

// Verificación adicional por correspondencia (MSF-869): el código que figura en el `sources:` de un
// doc debería cambiar junto con ese doc. Modo aviso (exit 0) salvo DOCUMENTACION_CORRESPONDENCIA_ESTRICTA=1 o --estricto.
const estricto = process.env.DOCUMENTACION_CORRESPONDENCIA_ESTRICTA === '1' || process.argv.includes('--estricto');
const nivel = estricto ? 'error' : 'warning';
try {
  const sinDoc = archivosSinDocCorrespondiente(changed, leerMapaDocs(process.cwd()));
  if (sinDoc.length > 0) {
    const porDoc = new Map();
    for (const { archivo, docs } of sinDoc) for (const doc of docs) porDoc.set(doc, [...(porDoc.get(doc) ?? []), archivo]);
    console.error(`Correspondencia código-doc: ${sinDoc.length} archivo(s) cambiado(s) sin que cambie ningún doc que los declara en sources:`);
    for (const [doc, archivos] of [...porDoc].sort(([a], [b]) => a.localeCompare(b))) {
      console.error(anotacion(nivel, { file: doc }, `${archivos.length} archivo(s) de su sources: cambiaron y el doc no: ${archivos.slice(0, 5).join(', ')}${archivos.length > 5 ? ', …' : ''}`));
      console.error(`${lineaLista(doc, ' ')}\n${archivos.map((a) => lineaLista(a, '     ')).join('\n')}`);
    }
    if (estricto) process.exit(1);
    console.error('(modo aviso: no falla. Activar el error con DOCUMENTACION_CORRESPONDENCIA_ESTRICTA=1 o --estricto.)');
  }
} catch (error) {
  console.error(anotacion(nivel, {}, `no se pudo verificar la correspondencia: ${error?.message ?? error}`));
  if (estricto) process.exit(1);
}

// Capturas del manual (MSF-644): una pantalla del panel que cambia debería rehacer sus capturas. Aviso salvo
// CAPTURAS_MANUAL_ESTRICTO=1 o --capturas-estricto (la excepción se declara en la descripción del PR, que no se ve acá).
const capturasEstricto = process.env.CAPTURAS_MANUAL_ESTRICTO === '1' || process.argv.includes('--capturas-estricto');
const sinCaptura = pantallasSinCaptura(changed);
if (sinCaptura.length > 0) {
  console.error(anotacion(capturasEstricto ? 'error' : 'warning', {}, `${sinCaptura.length} pantalla(s) del panel cambiaron y ninguna captura de docs/producto/img/ se rehízo: corré pnpm docs:capturas o declará en el PR por qué no corresponde (MSF-644).`));
  console.error(sinCaptura.slice(0, 10).map((p) => lineaLista(p, ' ')).join('\n'));
  if (capturasEstricto) process.exit(1);
}

console.log(`Documentación de cambios: OK (${changed.length} archivos comparados contra ${base}).`);
