import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { correrSuites, debeMatarGrupo, defecto } from './correr-suites.mjs';

const sinSalida = { write() {} };

// Muerto = no existe (ESRCH) o es un zombi (estado Z en /proc): en un contenedor sin init el nieto huérfano
// queda zombi hasta que alguien lo recolecte, y eso cuenta como muerto.
function estaMuerto(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === 'ESRCH';
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch {
    return true;
  }
}

test('corre todas las suites aunque alguna falle y devuelve 1 con el resumen', () => {
  const corridas = [];
  const estados = { a: 0, b: 3, c: 0, d: 1 };
  const r = correrSuites(['a', 'b', 'c', 'd'], {
    ejecutar: (c) => { corridas.push(c); return estados[c]; },
    salida: sinSalida,
  });
  assert.deepEqual(corridas, ['a', 'b', 'c', 'd']);
  assert.equal(r.codigo, 1);
  assert.deepEqual(r.fallidas.map((f) => f.comando), ['b', 'd']);
});

test('reporta la señal que mató a la suite y pasa el timeout configurado', () => {
  let timeoutVisto;
  let salida = '';
  const r = correrSuites(['a'], {
    ejecutar: (_c, t) => { timeoutVisto = t; return { estado: 1, senal: 'SIGKILL' }; },
    salida: { write: (x) => { salida += x; } },
    timeoutS: 7,
  });
  assert.equal(timeoutVisto, 7000);
  assert.equal(r.codigo, 1);
  assert.match(salida, /murió por SIGKILL/);
});

test('el binario mata una suite colgada con --timeout y lo informa', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, '--timeout', '1', 'node -e "setTimeout(()=>{},60000)"'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /murió por SIGKILL/);
});

test('devuelve 0 si todas pasan', () => {
  assert.equal(correrSuites(['a', 'b'], { ejecutar: () => 0, salida: sinSalida }).codigo, 0);
});

test('el binario real sale con 1 si una suite falla y 0 si no', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const mal = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"', 'node -e "process.exit(2)"', 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(mal.status, 1);
  assert.match(mal.stdout, /Resumen: 2\/3 suites OK/);
  assert.match(mal.stdout, /FALLÓ \(exit 2\)/);
  const bien = spawnSync(process.execPath, [script, 'node -e "process.exit(0)"'], { encoding: 'utf8' });
  assert.equal(bien.status, 0);
});

test('CORRER_SUITES_TIMEOUT_S y --timeout inválidos salen con 2 y mensaje claro, sin stack', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  for (const crudo of ['abc', '0', '-5', 'Infinity', '999999']) {
    const env = { ...process.env, CORRER_SUITES_TIMEOUT_S: crudo };
    const r = spawnSync(process.execPath, [script, 'node -e "0"'], { encoding: 'utf8', env });
    assert.equal(r.status, 2, crudo);
    assert.match(r.stderr, /CORRER_SUITES_TIMEOUT_S debe ser/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  const r = spawnSync(process.execPath, [script, '--timeout', 'x', 'node -e "0"'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--timeout debe ser/);
  const ok = spawnSync(process.execPath, [script, 'node -e "0"'], { encoding: 'utf8', env: { ...process.env, CORRER_SUITES_TIMEOUT_S: '30' } });
  assert.equal(ok.status, 0);
});

test('al vencer el timeout se mata el grupo: el nieto no queda huérfano y el test tarda pocos segundos', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suites-'));
  const pidfile = path.join(dir, 'nieto.pid');
  const script = new URL('./correr-suites.mjs', import.meta.url).pathname;
  const t = Date.now();
  try {
    const r = spawnSync(process.execPath, [script, '--timeout', '1', `sh -c 'sleep 30 & echo $! > ${pidfile}; wait'`], { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /murió por SIGKILL/);
    assert.ok(Date.now() - t < 10000, `tardó ${Date.now() - t} ms`);
    const pid = Number(fs.readFileSync(pidfile, 'utf8'));
    assert.ok(pid > 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(estaMuerto(pid), `el nieto ${pid} sigue vivo`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('debeMatarGrupo solo acepta pids enteros mayores que 1', () => {
  for (const malo of [undefined, null, 0, -0, 1, -1, 1.5, Number.NaN, Infinity, '123']) assert.equal(debeMatarGrupo(malo), false, String(malo));
  for (const bueno of [2, 12345]) assert.equal(debeMatarGrupo(bueno), true);
});

test('el kill(-pid) real pasa por debeMatarGrupo: solo mata el grupo con un pid válido', () => {
  const matados = [];
  const kill = (pid, senal) => { matados.push([pid, senal]); };
  const con = (r) => defecto('x', 1000, { spawn: () => r, kill });
  // Timeout (ETIMEDOUT) o muerte por señal con un pid real: se mata el grupo entero.
  assert.deepEqual(con({ pid: 4242, error: { code: 'ETIMEDOUT' }, signal: 'SIGKILL', status: null }), { estado: 1, senal: 'SIGKILL' });
  assert.deepEqual(con({ pid: 4243, signal: 'SIGTERM', status: null }), { estado: 1, senal: 'SIGTERM' });
  assert.deepEqual(matados, [[-4242, 'SIGKILL'], [-4243, 'SIGKILL']]);
  // Pids peligrosos (0 y -0 = grupo del runner, 1 = todos los procesos, undefined): nunca se llama a kill.
  matados.length = 0;
  for (const pid of [0, -0, 1, undefined, null]) con({ pid, error: { code: 'ETIMEDOUT' }, signal: 'SIGKILL', status: null });
  assert.deepEqual(matados, []);
  // Sin timeout ni señal no se mata nada y se devuelve el exit code.
  assert.equal(con({ pid: 4244, status: 0 }), 0);
  assert.equal(con({ pid: 4244, status: 3 }), 3);
  assert.deepEqual(matados, []);
  // Si el grupo ya terminó, kill lanza y se ignora.
  assert.deepEqual(defecto('x', 1000, { spawn: () => ({ pid: 4245, signal: 'SIGKILL', status: null }), kill: () => { throw new Error('ESRCH'); } }), { estado: 1, senal: 'SIGKILL' });
});
