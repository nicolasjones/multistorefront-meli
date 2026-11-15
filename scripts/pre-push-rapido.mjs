#!/usr/bin/env node
// Verificación rápida antes de pushear: así el CI es solo la verificación final y se evitan los rojos
// que cuestan una vuelta de CI. Opt-in: `pnpm prepush` a mano o como hook (ver docs/control-ci.md).
// `SKIP_PREPUSH=1` la saltea. Solo corre lo que el diff puede afectar.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function comandos(archivos, base = 'origin/dokploy') {
  const web = archivos.some((f) => /^(apps\/web|packages)\//.test(f));
  const lista = [];
  if (web) {
    lista.push(['pnpm', ['--filter', '@platform/web', 'exec', 'tsc', '-b']]);
    lista.push(['pnpm', ['--filter', '@platform/web', 'exec', 'oxlint', 'src']]);
    lista.push(['pnpm', ['--filter', '@platform/web', 'exec', 'vitest', 'run', '--changed', base, '--passWithNoTests', '--maxWorkers=1']]);
  }
  if (archivos.some((f) => /^(docs\/|specs\/|mkdocs\.yml$)/.test(f))) lista.push(['pnpm', ['docs:check']]);
  if (archivos.some((f) => /^(supabase\/(migrations|tests\/database)\/.+\.sql|apps\/web\/e2e\/.+\.ts)$/.test(f))) lista.push(['node', ['scripts/verificar-trampas-conocidas.mjs']]);
  if (archivos.some((f) => /^apps\/web\/src\/pages\//.test(f))) lista.push(['pnpm', ['estilos:check']]);
  return lista;
}

function main() {
  if (process.env.SKIP_PREPUSH === '1') return 0;
  const base = process.env.PREPUSH_BASE || 'origin/dokploy';
  if (!existsSync('node_modules')) {
    console.log('pre-push: sin node_modules, no se verifica (pnpm install).');
    return 0;
  }
  const merge = spawnSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' });
  const archivos = spawnSync('git', ['diff', '--name-only', merge.stdout.trim() || base, 'HEAD'], { encoding: 'utf8' }).stdout
    .split('\n').filter(Boolean);
  for (const [cmd, args] of comandos(archivos, base)) {
    console.log(`pre-push: ${cmd} ${args.join(' ')}`);
    if (spawnSync(cmd, args, { stdio: 'inherit' }).status !== 0) {
      console.error('pre-push: falló. Arreglalo antes de pushear (o SKIP_PREPUSH=1 para saltearlo).');
      return 1;
    }
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
