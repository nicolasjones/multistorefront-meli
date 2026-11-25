import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { verifyVersionBumps } from './verificar-versiones-capacidades.mjs';

const previous = { schema_version: 1, capabilities: [{ id: 'worker-cycle', version: '1.0.0', paths: ['workers/'] }] };

test('exige incrementar SemVer cuando cambia el código de una capacidad', () => {
  const current = { ...previous, capabilities: [{ ...previous.capabilities[0], title: 'Ciclo', version: '1.0.0' }] };
  assert.deepEqual(verifyVersionBumps(previous, current, ['workers/worker.mjs']), [
    { id: 'worker-cycle', version: '1.0.0', paths: ['workers/worker.mjs'] },
  ]);
});

test('acepta la versión incrementada y los cambios ajenos a capacidades registradas', () => {
  const current = { ...previous, capabilities: [{ ...previous.capabilities[0], version: '1.1.0' }] };
  assert.deepEqual(verifyVersionBumps(previous, current, ['workers/worker.mjs']), []);
  assert.deepEqual(verifyVersionBumps(previous, previous, ['docs/guia.md']), []);
});

test('rechaza borrar una capacidad ya publicada', () => {
  assert.throws(() => verifyVersionBumps(previous, { schema_version: 1, capabilities: [] }, []), /no se pueden borrar/);
});

test('permite publicar el catálogo por primera vez', () => {
  assert.deepEqual(verifyVersionBumps({ schema_version: 1, capabilities: [] }, previous, ['template-capabilities.json']), []);
});

// Las Edge Functions de index.ts importan módulos hermanos (handler.ts, guardas.ts, _shared/...): si una capacidad lista
// el index.ts pero no sus imports relativos, un cambio en ellos no exige subir la versión de la capacidad y los
// derivados que copian solo los paths listados se quedan sin módulos. La regla cubre todo el catálogo.
const RAIZ = new URL('../', import.meta.url);
const ENTRADA = /^supabase\/functions\/[^/_][^/]*\/index\.ts$/;
// from './x.ts' | import './x.ts' (efecto lateral) | import('./x.ts') (dinámico) | export ... from './x.ts'
const IMPORT_RELATIVO = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

const cubierto = (capacidad, archivo) =>
  capacidad.paths.some((ruta) => (ruta.endsWith('/') ? archivo.startsWith(ruta) : archivo === ruta));

export function importsRelativos(fuente) {
  return [...fuente.matchAll(IMPORT_RELATIVO)].map((coincidencia) => coincidencia[1]);
}

export function importsNoCubiertos(capacidad, leer) {
  const faltantes = [];
  const pendientes = capacidad.paths.filter((ruta) => ENTRADA.test(ruta));
  const vistos = new Set();
  while (pendientes.length) {
    const archivo = pendientes.pop();
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    for (const destino of importsRelativos(leer(archivo))) {
      const resuelto = path.posix.normalize(path.posix.join(path.posix.dirname(archivo), destino));
      if (!cubierto(capacidad, resuelto)) faltantes.push(`${capacidad.id}: ${resuelto} (importado por ${archivo})`);
      pendientes.push(resuelto);
    }
  }
  return [...new Set(faltantes)];
}

const leerDelRepo = (archivo) => readFileSync(new URL(archivo, RAIZ), 'utf8');

test('el catálogo real cubre los imports relativos de cada Edge Function listada', () => {
  const catalogo = JSON.parse(leerDelRepo('template-capabilities.json'));
  const faltantes = catalogo.capabilities.flatMap((capacidad) => importsNoCubiertos(capacidad, leerDelRepo));
  assert.deepEqual(faltantes, []);
});

test('detecta imports estáticos, dinámicos y de efectos laterales no cubiertos', () => {
  const fuentes = {
    'supabase/functions/f/index.ts': "import { a } from './a.ts';\nimport './efecto.ts';\nconst b = await import('./b.ts');\nexport * from '../_shared/c.ts';",
    'supabase/functions/f/a.ts': '',
    'supabase/functions/f/efecto.ts': '',
    'supabase/functions/f/b.ts': '',
    'supabase/functions/_shared/c.ts': '',
  };
  const capacidad = { id: 'demo', paths: ['supabase/functions/f/index.ts', 'supabase/functions/f/a.ts'] };
  assert.deepEqual(importsNoCubiertos(capacidad, (archivo) => fuentes[archivo]), [
    'demo: supabase/functions/f/efecto.ts (importado por supabase/functions/f/index.ts)',
    'demo: supabase/functions/f/b.ts (importado por supabase/functions/f/index.ts)',
    'demo: supabase/functions/_shared/c.ts (importado por supabase/functions/f/index.ts)',
  ]);
});
