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

// Las Edge Functions de index.ts importan módulos hermanos (handler.ts, guardas.ts...): si una capacidad lista
// el index.ts pero no sus imports relativos, un cambio en ellos no exige subir la versión de la capacidad.
// Alcance: solo las capacidades ya corregidas. emitir-acceso-reporte y document-rag-mechanism tienen el mismo defecto
// pendiente; al completarlas, agregar su id acá (o quitar el filtro).
const CAPACIDADES_VERIFICADAS = ['chat-companion-mechanism', 'oauth-connections-nango'];
test('el catálogo real cubre los imports relativos de cada Edge Function listada', () => {
  const catalogo = JSON.parse(readFileSync('template-capabilities.json', 'utf8'));
  const cubierto = (capacidad, archivo) => capacidad.paths.some((ruta) => (ruta.endsWith('/') ? archivo.startsWith(ruta) : archivo === ruta));
  const faltantes = [];
  for (const capacidad of catalogo.capabilities.filter((item) => CAPACIDADES_VERIFICADAS.includes(item.id))) {
    const pendientes = capacidad.paths.filter((ruta) => /^supabase\/functions\/[^/_][^/]*\/index\.ts$/.test(ruta));
    const vistos = new Set();
    while (pendientes.length) {
      const archivo = pendientes.pop();
      if (vistos.has(archivo)) continue;
      vistos.add(archivo);
      const fuente = readFileSync(archivo, 'utf8');
      for (const [, destino] of fuente.matchAll(/(?:from|import)\s+['"](\.[^'"]+\.ts)['"]/g)) {
        const resuelto = path.posix.normalize(path.posix.join(path.posix.dirname(archivo), destino));
        if (!cubierto(capacidad, resuelto)) faltantes.push(`${capacidad.id}: ${resuelto} (importado por ${archivo})`);
        pendientes.push(resuelto);
      }
    }
  }
  assert.deepEqual(faltantes, []);
});
