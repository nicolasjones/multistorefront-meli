import { spawnSync } from 'node:child_process';

const run = (args) => spawnSync('git', args, { encoding: 'utf8' });
const configuredBase = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.DOCUMENTATION_CHECK_BASE;
let base = configuredBase || 'HEAD~1';
const canResolve = (ref) => run(['rev-parse', '--verify', ref]).status === 0;
if (!canResolve(base) && canResolve('HEAD~1')) base = 'HEAD~1';
if (!canResolve(base)) {
  console.error(`No se pudo resolver la base de documentación: ${base}`);
  process.exit(1);
}

const diff = run(['diff', '--name-only', `${base}...HEAD`]);
if (diff.status !== 0) {
  console.error(diff.stderr.trim() || 'No se pudo inspeccionar el diff de documentación.');
  process.exit(diff.status || 1);
}

const changed = diff.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
const relevant = changed.filter((path) => /^(apps|workers|supabase|infra|scripts|packages|\.github)\//.test(path));
const documented = changed.some((path) =>
  /^(specs|docs)\//.test(path) || /^(AGENTS|CLAUDE)\.md$/.test(path) || path === '.specify/memory/constitution.md',
);

if (relevant.length > 0 && !documented) {
  console.error('Fallo de documentación: el cambio toca plataforma/tooling pero no actualiza specs/, docs/, AGENTS.md, CLAUDE.md ni la constitución.');
  console.error(relevant.map((path) => ` - ${path}`).join('\n'));
  process.exit(1);
}

console.log(`Documentación de cambios: OK (${changed.length} archivos comparados contra ${base}).`);
