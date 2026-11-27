import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PUERTOS_SENSIBLES, conectar, listaDePuertos, verificar } from './verificar-puertos-externos.mjs';

const cli = fileURLToPath(new URL('./verificar-puertos-externos.mjs', import.meta.url));
const abrir = () => new Promise((resolve) => { const s = net.createServer((c) => c.end()); s.listen(0, '127.0.0.1', () => resolve(s)); });

test('la lista cubre los puertos de la auditoría MSF-648', () => {
  for (const p of [7634, 7635, 7636, 4301, 4304, 4305, 9300, 9301, 9302, 4306, 4307, 3000]) assert.ok(PUERTOS_SENSIBLES.includes(p), String(p));
  for (const esperado of [22, 80, 443]) assert.ok(!PUERTOS_SENSIBLES.includes(esperado));
});

test('conectar: puerto abierto true, cerrado false (conexión real a loopback)', async () => {
  const servidor = await abrir();
  const { port } = servidor.address();
  assert.equal(await conectar('127.0.0.1', port, 1000), true);
  servidor.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await conectar('127.0.0.1', port, 1000), false);
});

test('verificar: un sensible abierto falla; solo los esperados abiertos pasa; esperado cerrado avisa', async () => {
  const falso = (abiertos) => async (_h, p) => abiertos.includes(p);
  const base = { host: 'x', puertos: [7634, 4305], esperados: [22, 80, 443] };
  assert.deepEqual(await verificar({ ...base, probar: falso([22, 80, 443]) }), { abiertos: [22, 80, 443], sensiblesAbiertos: [], esperadosCerrados: [], ok: true });
  const una = await verificar({ ...base, probar: falso([22, 80, 443, 4305]) });
  assert.equal(una.ok, false);
  assert.deepEqual(una.sensiblesAbiertos, [4305]);
  const sinHttp = await verificar({ ...base, probar: falso([22]) });
  assert.equal(sinHttp.ok, true);
  assert.deepEqual(sinHttp.esperadosCerrados, [80, 443]);
  assert.equal((await verificar({ ...base, probar: falso([7634]) })).ok, false);
});

test('listaDePuertos: frontera 1..65535 y basura', () => {
  assert.deepEqual(listaDePuertos('1,65535,80,80'), [1, 65535, 80]);
  for (const mala of ['0', '65536', 'a', '1,,2', '', '-1', '1.5']) assert.throws(() => listaDePuertos(mala), /inválida/, mala);
});

test('CLI: puerto sensible abierto en loopback sale 1; cerrado sale 0; uso inválido sale 2', async () => {
  const servidor = await abrir();
  const { port } = servidor.address();
  const correr = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8' });
  const abierto = correr('--host', '127.0.0.1', '--puertos', String(port), '--esperados', '22');
  assert.equal(abierto.status, 1, abierto.stdout + abierto.stderr);
  assert.match(abierto.stderr, new RegExp(`${port}`));
  servidor.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(correr('--host', '127.0.0.1', '--puertos', String(port), '--esperados', '22').status, 0);
  assert.equal(correr().status, 2);
  assert.equal(correr('--host', 'a b').status, 2);
  assert.equal(correr('--host', '127.0.0.1', '--timeout-ms', '5').status, 2);
});
