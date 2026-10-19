import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Selección DETERMINISTA de pruebas según el diff. Misma entrada (archivos
// cambiados) ⇒ mismo plan; sin criterio humano ni lenguaje natural.
//
// Uso:
//   node scripts/tests-afectados.mjs                    # plan según origin/dokploy...HEAD
//   node scripts/tests-afectados.mjs --base origin/main
//   node scripts/tests-afectados.mjs --archivos a.ts,b.sql
//   node scripts/tests-afectados.mjs --ejecutar         # corre el plan en orden
//   node scripts/tests-afectados.mjs --json             # plan como JSON
//
// La matriz vive en `SUITES`/`seleccionarSuites` y está documentada en
// docs/pruebas.md. El gate del PR sigue corriendo todo en CI; esto es para
// iterar con exactamente lo que corresponde al cambio.

export const SUITES = {
  lint: { descripcion: 'Lint (Biome)', comando: 'pnpm lint' },
  docs: { descripcion: 'Documentación de cambios', comando: 'pnpm docs:check' },
  web: { descripcion: 'Vitest web (830 tests)', comando: 'pnpm --filter @platform/web test' },
  estilos: { descripcion: 'Estilos sueltos en pantallas', comando: 'pnpm estilos:check && pnpm test:estilos:sueltos' },
  e2e: { descripcion: 'Playwright público', comando: 'pnpm test:e2e -- acceso-publico.e2e.ts' },
  db: { descripcion: 'pgTAP (RLS, RPC, permisos)', comando: 'pnpm test:db' },
  'db:aditivas': { descripcion: 'Migraciones aditivas', comando: 'pnpm test:db:validar-aditivas' },
  edge: {
    descripcion: 'Edge functions',
    comando: 'pnpm test:edge:invitar-miembro && pnpm test:edge:solicitar-acceso && pnpm test:edge:crear-organizacion',
  },
  ia: { descripcion: 'Paquetes IA', comando: 'pnpm test:ia' },
  tooling: { descripcion: 'Scripts/tooling del repo', comando: 'node --test scripts/*.test.mjs' },
  'infra:config': { descripcion: 'Compose de infraestructura', comando: 'pnpm infra:config' },
  prototipo: { descripcion: 'Inventario del prototipo', comando: 'pnpm prototipo:check && pnpm test:prototipo:inventario' },
  matriz: { descripcion: 'Matriz pantalla↔criterios', comando: 'pnpm matriz:check && pnpm test:matriz:pantalla' },
};

const esWeb = (a) => a.startsWith('apps/web/');
const esWebUi = (a) => a.startsWith('apps/web/src/pages/') || a.startsWith('apps/web/src/components/');
const esSupabase = (a) => a.startsWith('supabase/');

// Pura: archivos cambiados → ids de suite (ordenados y sin repetir).
export function seleccionarSuites(archivos) {
  const ids = new Set(['lint', 'docs']);
  for (const archivo of archivos) {
    const a = archivo.trim();
    if (!a) continue;
    if (esWeb(a)) ids.add('web');
    if (esWebUi(a)) {
      ids.add('e2e');
      if (a.startsWith('apps/web/src/pages/')) ids.add('estilos');
    }
    if (a.startsWith('supabase/migrations/')) {
      ids.add('db');
      ids.add('db:aditivas');
    } else if (a.startsWith('supabase/tests/')) {
      ids.add('db');
    } else if (a.startsWith('supabase/functions/')) {
      ids.add('edge');
    }
    if (a.startsWith('packages/')) ids.add('ia');
    if (a.startsWith('scripts/') || a.startsWith('.github/')) ids.add('tooling');
    if (a.startsWith('infra/')) {
      ids.add('infra:config');
      ids.add('tooling');
    }
    if (a.startsWith('design/pantallas/')) ids.add('prototipo');
    if (a.startsWith('specs/')) ids.add('matriz');
  }
  // Orden estable: primero lo barato/estático, después lo pesado.
  const orden = ['lint', 'docs', 'estilos', 'matriz', 'prototipo', 'infra:config', 'tooling', 'ia', 'web', 'edge', 'db:aditivas', 'db', 'e2e'];
  return orden.filter((id) => ids.has(id));
}

export function plan(archivos) {
  return seleccionarSuites(archivos).map((id) => ({ id, ...SUITES[id] }));
}

function archivosDelDiff(base) {
  const salida = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' });
  return salida.split(/\r?\n/).filter(Boolean);
}

function main(argv) {
  const valor = (bandera) => {
    const i = argv.indexOf(bandera);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const archivos = valor('--archivos')?.split(',').map((a) => a.trim()).filter(Boolean);
  const base = valor('--base') || process.env.DOCUMENTATION_CHECK_BASE || 'origin/dokploy';
  const lista = archivos ?? archivosDelDiff(base);
  const pasos = plan(lista);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ archivos: lista, suites: pasos.map(({ id, comando }) => ({ id, comando })) }, null, 2));
    return;
  }

  console.log(`Archivos (${lista.length}) contra ${base}:`);
  for (const archivo of lista) console.log(`  - ${archivo}`);
  console.log(`\nSuites deterministas (${pasos.length}):`);
  for (const { id, descripcion, comando } of pasos) console.log(`  ${id.padEnd(12)} ${descripcion}\n               ${comando}`);

  if (argv.includes('--ejecutar')) {
    for (const { id, comando } of pasos) {
      console.log(`\n=== ${id} ===`);
      execSync(comando, { stdio: 'inherit', shell: true });
    }
    console.log('\nPlan completo OK.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Tests afectados: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
