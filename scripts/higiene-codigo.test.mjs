// Guardián de los hallazgos de higiene del lote consolidado MSF-878:
// MSF-584 (código muerto y configuración de knip), MSF-745 (import, función y
// tipo sin uso), MSF-631 (tests desactualizados) y MSF-753 (espía de consola
// que quedaba fuera del bloque que restaura los mocks).
// Los cuatro estaban resueltos, pero nada impedía que volvieran: este archivo
// los vigila y falla si alguno se deshace.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const raiz = path.resolve(import.meta.dirname, '..');
const leer = (relativo) => readFileSync(path.join(raiz, relativo), 'utf8');

function archivosEn(relativo) {
  const base = path.join(raiz, relativo);
  const salida = [];
  for (const entrada of readdirSync(base, { withFileTypes: true })) {
    const completa = path.join(base, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivosEn(path.join(relativo, entrada.name)));
    else salida.push(relativo.replace(/\\/g, '/') + '/' + entrada.name);
  }
  return salida;
}

test('MSF-584 · la configuración de knip declara los entry points reales', () => {
  const config = JSON.parse(leer('knip.json'));
  // Las Edge Functions y los fixtures son entry points: knip no puede inferirlos.
  assert.ok(config.ignore.includes('supabase/functions/**'), 'las Edge Functions son entry points');
  assert.ok(config.ignore.includes('scripts/fixtures/**'), 'los fixtures son entry points');
  // Binarios que usan los scripts de la plataforma, no dependencias de npm.
  for (const binario of ['pg_prove', 'graphify', 'ffmpeg', 'tailscale']) {
    assert.ok(config.ignoreBinaries.includes(binario), `falta el binario ${binario}`);
  }
  // `@playwright/test` se resuelve desde apps/web/package.json (scripts/armar-video-evidencia.mjs).
  assert.ok(config.ignoreDependencies.includes('@playwright/test'));
});

test('MSF-584 · el helper que knip marcaba sin uso se borró, no se escondió', () => {
  assert.equal(existsSync(path.join(raiz, 'apps/web/src/test/renderPanel.tsx')), false);
  const config = JSON.parse(leer('knip.json'));
  assert.equal(
    config.ignore.includes('apps/web/src/test/renderPanel.tsx'),
    false,
    'un archivo muerto no se esconde en la lista de ignorados de knip',
  );
});

test('MSF-584 · el hook que knip marcaba sin uso está en uso', () => {
  const usos = archivosEn('apps/web/src').filter(
    (archivo) =>
      archivo !== 'apps/web/src/hooks/useFeatureHabilitada.ts' &&
      (archivo.endsWith('.ts') || archivo.endsWith('.tsx')) &&
      leer(archivo).includes('useFeatureHabilitada'),
  );
  assert.ok(usos.length > 0, 'el hook está en uso: no es código muerto');
});

test('MSF-745 · chat-ia-responder no importa el sanitizador sin uso', () => {
  const fuente = leer('supabase/functions/chat-ia-responder/index.ts');
  assert.equal(/import[^;]*\bsanitizarDato\b/.test(fuente), false);
});

test('MSF-745 · intentarRecuperarPaso no declara la función ni el tipo sin uso', () => {
  const fuente = leer('packages/ia-navegacion/src/intentarRecuperarPaso.ts');
  assert.equal(/\babrirInvocacion\b/.test(fuente), false);
  assert.equal(/\bInteraccionEnCurso\b/.test(fuente), false);
});

test('MSF-631 · una migración nueva de la épica no rompe el test de migraciones', () => {
  // El test del repo fijaba un conteo exacto de migraciones: una migración
  // legítima posterior lo rompía (MSF-631). Con un piso, sigue pasando.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'msf-878-migraciones-'));
  try {
    mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    cpSync(
      path.join(raiz, 'scripts/migraciones-ventas-comprobantes.test.mjs'),
      path.join(dir, 'scripts/migraciones-ventas-comprobantes.test.mjs'),
    );
    const sufijos = 'abcdefghijklm'.split('');
    sufijos.forEach((sufijo, indice) => {
      const version = `202612030000${String(indice + 1).padStart(2, '0')}`;
      writeFileSync(
        path.join(dir, `supabase/migrations/${version}_ventas_comprobantes_${sufijo}.sql`),
        'select 1;\n',
      );
    });
    writeFileSync(
      path.join(dir, 'docs/ventas-comprobantes.md'),
      'Copia de `20261203000001_ventas_comprobantes_a.sql`.\n',
    );
    // `NODE_TEST_CONTEXT` lo pone el runner de tests: si el hijo lo hereda, su
    // salida va al padre y el proceso termina con 0 sin correr nada.
    const entorno = { ...process.env };
    delete entorno.NODE_TEST_CONTEXT;
    const corrida = spawnSync(
      process.execPath,
      ['--test', path.join(dir, 'scripts/migraciones-ventas-comprobantes.test.mjs')],
      { encoding: 'utf8', env: entorno },
    );
    assert.equal(corrida.status, 0, `${corrida.stdout}\n${corrida.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MSF-631 · el test de perfil de usuario no exige el índice único que Storage dropeó', () => {
  // El archivo explica en un comentario por qué ese `on conflict` no se usa:
  // el chequeo mira el SQL, no la prosa.
  const sql = leer('supabase/tests/database/perfil_usuario.test.sql')
    .split('\n')
    .map((linea) => linea.split('--')[0])
    .join('\n');
  assert.equal(/on conflict\s*\(\s*bucket_id\s*,\s*name\s*\)/i.test(sql), false);
  assert.match(sql, /on conflict do nothing/i);
});

test('MSF-753 · el espía de console.error se crea una vez y dentro del bloque que lo restaura', () => {
  const fuente = leer('apps/web/src/lib/mensajeErrorBase.test.ts');
  const espias = fuente.match(/spyOn\(console, 'error'\)/g) ?? [];
  assert.equal(espias.length, 1, 'el espía se crea en el beforeEach y el bloque anidado lo reutiliza');
  const lineas = fuente.split('\n');
  const indicePii = lineas.findIndex((linea) => linea.includes('log sin PII'));
  const indiceCierre = lineas.findIndex((linea) => linea === '})');
  assert.ok(indicePii >= 0, 'el archivo tiene el bloque de «log sin PII»');
  assert.ok(indiceCierre >= 0, 'el describe externo cierra el archivo');
  assert.ok(indicePii < indiceCierre, 'el bloque va dentro del describe que restaura los mocks');
});
