// Contrato estático del flow comprobantes-documentos (MSF-230, FR-013): reclama solo las capacidades
// `generar-documento-venta-`, corre cada minuto, reintenta de forma acotada y agota la orden ante un 78.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/comprobantes-documentos.yml';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

test('reclama solo las órdenes generar-documento-venta-* con un límite y un reclamo acotados', async () => {
  const content = await leer();
  assert.match(content, /private\.reclamar_despachos_capacidad\('generar-documento-venta-', 5, 600\)/);
  assert.doesNotMatch(content, /reclamar_despachos_ejecucion/, 'el reclamo genérico tomaría órdenes de otros productos');
  assert.match(content, /detalle->>'documento_id' as documento_id/, 'el flow necesita el documento a generar');
});

test('corre cada minuto', async () => {
  const content = await leer();
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reintenta el despacho de forma acotada', async () => {
  const content = await leer();
  assert.match(content, /retry:\s+type: exponential\s+maxAttempts: 3/);
  assert.match(content, /timeout: PT5M/);
});

test('una falla no reintentable (78) agota la orden y una técnica la libera', async () => {
  const content = await leer();
  assert.match(content, /WORKER_RC" -eq 78/);
  assert.match(content, /== '' \? 'confirmar' : 'agotar'/);
  assert.match(content, /'liberar', 'FALLA_TECNICA_SANITIZADA', 60, 3\)/);
});

test('pasa DOCUMENTO_ID y EJECUCION_ID al worker y exige la red de egress propia', async () => {
  const content = await leer();
  assert.match(content, /-e DOCUMENTO_ID="\{\{ fromJson\(parent\.taskrun\.value\)\.documento_id \}\}"/);
  assert.match(content, /-e EJECUCION_ID=/);
  assert.match(content, /WORKER_NETWORK_ESPERADA="worker-egress-comprobantes-pdf"/);
  assert.match(content, /\{\{ envs\.comprobantes_pdf_imagen \}\}/);
});

test('no lleva secretos en la línea de comandos: la clave de servicio viaja por nombre', async () => {
  const content = await leer();
  assert.match(content, /--env SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY=/);
});
