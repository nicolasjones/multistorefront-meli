// Contrato estático del flow historial-importador (F-VTA-37, FR-004). No reemplaza una corrida
// real en Kestra: fija las garantías que el CI puede comprobar sin levantarlo.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/historial-importador.yml';
const sinComentarios = (c) => c.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const leer = async () => sinComentarios((await readFile(FLOW, 'utf8')).replace(/\r\n/g, '\n'));

test('consume la outbox por JDBC y solo despacha capacidades importar_historial_*', async () => {
  const c = await leer();
  assert.match(c, /private\.reclamar_despachos_ejecucion\(/);
  assert.match(c, /starts with 'importar_historial_'/);
  assert.doesNotMatch(c, /https?:\/\//, 'no se agregan URLs de despacho');
});

test('reintenta solo lo técnico (retry del paso SSH, 3 intentos) y corta el código 78', async () => {
  const c = await leer();
  assert.match(c, /retry:\n\s+type: exponential\n\s+maxAttempts: 3/);
  assert.match(c, /\[ "\$WORKER_RC" -eq 78 \]/);
  assert.match(c, /printf '::\{"outputs":\{"no_reintentable":"%s"\}\}::\\n' "\$NO_REINTENTABLE"\n\s+exit 0/);
});

test('una falla no reintentable agota la orden, nunca la libera', async () => {
  const c = await leer();
  assert.match(c, /'confirmar' : 'agotar'/);
  // Las únicas liberaciones: falla técnica persistente (máx. 3) y orden ajena.
  const liberaciones = [...c.matchAll(/'liberar', '([A-Z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(liberaciones.sort(), ['FALLA_TECNICA_SANITIZADA', 'ORDEN_AJENA']);
});

test('el contenedor va endurecido y con la red de egress propia', async () => {
  const c = await leer();
  for (const flag of ['--read-only', '--cap-drop=ALL', 'no-new-privileges:true', '--cpus', '--memory']) {
    assert.ok(c.includes(flag), `falta ${flag}`);
  }
  assert.match(c, /worker-egress-historial-importador/);
  assert.doesNotMatch(c, /docker\.sock/, 'nunca monta el socket Docker');
});

test('la service-role se pasa por nombre de variable, nunca con valor en el flow', async () => {
  const c = await leer();
  assert.match(c, /--env SUPABASE_SERVICE_ROLE_KEY( |\\)/);
  assert.doesNotMatch(c, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(c, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
});
