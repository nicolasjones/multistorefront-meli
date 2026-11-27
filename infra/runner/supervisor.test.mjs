// Pruebas del supervisor (A1/A2): el PAT solo se usa contra la API de GitHub; el contenedor del job recibe solo la configuración JIT y se
// crea uno nuevo por ciclo. fetch y docker se inyectan: no se toca la red ni Docker.
import assert from 'node:assert/strict';
import test from 'node:test';
import { leerConfiguracionSupervisor } from './config-runner.mjs';
import { asegurarRed, bucleRanura, borrarRunner, ciclo, crearRunnerJit, limpiarHuerfanos } from './supervisor.mjs';

const cfg = leerConfiguracionSupervisor({ RUNNER_ROLE: 'pr', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-local,platform-pr', RUNNER_IMAGE: 'img:local' });
const PAT = 'ghp_PAT_SECRETO_DE_PRUEBA';

function githubFalso({ jit = 'JITCFG', id = 77, estadoJit = 201 } = {}) {
  const llamadas = [];
  const fetchFn = async (url, opciones) => {
    llamadas.push({ url, metodo: opciones.method, auth: opciones.headers?.Authorization, cuerpo: opciones.body ? JSON.parse(opciones.body) : undefined });
    if (url.endsWith('/generate-jitconfig')) return { ok: estadoJit < 300, status: estadoJit, json: async () => ({ encoded_jit_config: jit, runner: { id } }) };
    return { ok: true, status: 204, json: async () => ({}) };
  };
  return { llamadas, fetchFn };
}

test('crearRunnerJit: pide un runner efímero con las etiquetas y devuelve id y JIT', async () => {
  const { llamadas, fetchFn } = githubFalso();
  const r = await crearRunnerJit({ cfg, pat: PAT, nombre: 'n-1', fetchFn });
  assert.deepEqual(r, { id: 77, jit: 'JITCFG' });
  assert.equal(llamadas[0].url, 'https://api.github.com/repos/org/repo/actions/runners/generate-jitconfig');
  assert.equal(llamadas[0].metodo, 'POST');
  assert.equal(llamadas[0].auth, `Bearer ${PAT}`);
  assert.deepEqual(llamadas[0].cuerpo.labels, ['self-hosted', 'platform-local', 'platform-pr', 'Linux', 'X64']);
});

test('crearRunnerJit: error de GitHub o respuesta incompleta fallan sin filtrar el PAT', async () => {
  const mala = githubFalso({ estadoJit: 403 });
  await assert.rejects(crearRunnerJit({ cfg, pat: PAT, nombre: 'n', fetchFn: mala.fetchFn }), (e) => /HTTP 403/.test(e.message) && !e.message.includes(PAT));
  await assert.rejects(crearRunnerJit({ cfg, pat: PAT, nombre: 'n', fetchFn: async () => ({ ok: true, status: 201, json: async () => ({}) }) }), /sin configuración JIT/);
});

test('ciclo: un contenedor NUEVO por ciclo, el PAT no llega a docker y el runner se borra aunque docker falle', async () => {
  const { llamadas, fetchFn } = githubFalso();
  const corridas = [];
  const entornos = [];
  const ejecutarDocker = async (args, env) => { corridas.push(args); entornos.push(env); return 0; };
  await ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker, fetchFn, sufijo: 'aaaa' });
  await ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker, fetchFn, sufijo: 'bbbb' });
  assert.equal(corridas.length, 2);
  assert.notEqual(corridas[0][corridas[0].indexOf('--name') + 1], corridas[1][corridas[1].indexOf('--name') + 1], 'nunca se reutiliza un contenedor');
  for (const args of corridas) {
    assert.ok(args.includes('--rm'));
    assert.ok(!args.join(' ').includes(PAT), 'el PAT no entra al contenedor del job');
    assert.ok(!args.join(' ').includes('JITCFG'), 'la configuración JIT no está en el argv');
    assert.ok(args.includes('RUNNER_JIT_CONFIG'));
  }
  for (const env of entornos) assert.equal(env.RUNNER_JIT_CONFIG, 'JITCFG', 'viaja por el entorno del proceso docker');
  assert.equal(llamadas.filter((l) => l.metodo === 'DELETE').length, 2);
  const falla = githubFalso();
  await assert.rejects(ciclo({ cfg, pat: PAT, ranura: 1, ejecutarDocker: async () => { throw new Error('docker murió'); }, fetchFn: falla.fetchFn }), /docker murió/);
  assert.equal(falla.llamadas.filter((l) => l.metodo === 'DELETE').length, 1, 'el runner se borra también si el contenedor falla');
});

test('borrarRunner nunca lanza (un 404 o un error de red no rompe el ciclo)', async () => {
  await borrarRunner({ cfg, pat: PAT, id: 1, fetchFn: async () => { throw new Error('red'); } });
  await borrarRunner({ cfg, pat: PAT, id: 1, fetchFn: async () => ({ ok: false, status: 404 }) });
});

const BUENA = 'bridge|false|br-jobs-pr|172.29.250.0/24 ';

test('asegurarRed (A-1): crea la red si falta (subred, ICC y puente fijos) y acepta la existente SOLO si coincide en todo', async () => {
  const llamadas = [];
  const consulta = (respuestas) => async (args) => { llamadas.push(args); return respuestas.shift(); };
  assert.equal(await asegurarRed({ cfg, consultar: consulta([{ codigo: 1, salida: '' }, { codigo: 0, salida: '' }]) }), 'creada');
  assert.deepEqual(llamadas[0].slice(0, 2), ['network', 'inspect']);
  assert.deepEqual(llamadas[1].slice(0, 2), ['network', 'create']);
  assert.ok(llamadas[1].includes('com.docker.network.bridge.enable_icc=false') && llamadas[1].includes('172.29.250.0/24') && llamadas[1].includes('com.docker.network.bridge.name=br-jobs-pr'));
  assert.equal(await asegurarRed({ cfg, consultar: consulta([{ codigo: 0, salida: BUENA }]) }), 'existente');
  await assert.rejects(asegurarRed({ cfg, consultar: consulta([{ codigo: 1, salida: '' }, { codigo: 1, salida: '' }]) }), /No se pudo crear la red/);
});

test('asegurarRed (C+S B-1): una red PREEXISTENTE con otro driver, ICC activo, otro puente o otra subred falla cerrado (una condición por mutante)', async () => {
  const mutantes = [
    ['driver', 'macvlan|false|br-jobs-pr|172.29.250.0/24 ', /driver macvlan/],
    ['icc activado', 'bridge|true|br-jobs-pr|172.29.250.0/24 ', /ICC activado/],
    ['icc ausente', 'bridge||br-jobs-pr|172.29.250.0/24 ', /ICC activado/],
    ['puente', 'bridge|false|docker0|172.29.250.0/24 ', /puente docker0/],
    ['puente sin nombre fijo', 'bridge|false||172.29.250.0/24 ', /sin nombre fijo/],
    ['subred', 'bridge|false|br-jobs-pr|172.17.0.0/16 ', /subred 172\.17\.0\.0\/16/],
    ['sin subred', 'bridge|false|br-jobs-pr|', /subred ninguna/],
  ];
  for (const [nombre, salida, patron] of mutantes) {
    await assert.rejects(asegurarRed({ cfg, consultar: async () => ({ codigo: 0, salida }) }), (e) => patron.test(e.message) && /no coincide con lo que espera el firewall/.test(e.message), nombre);
  }
  // Varios problemas a la vez se listan todos.
  await assert.rejects(asegurarRed({ cfg, consultar: async () => ({ codigo: 0, salida: 'macvlan|true|x|1.2.3.0/24 ' }) }), (e) => /driver/.test(e.message) && /ICC/.test(e.message) && /puente x/.test(e.message) && /subred/.test(e.message));
});

test('limpiarHuerfanos (B-7): solo contenedores de ESTE rol que ya NO corren; los que corren se dejan terminar', async () => {
  const llamadas = [];
  const consultar = async (args) => { llamadas.push(args); return args[0] === 'ps' ? { codigo: 0, salida: 'abcdef123456\n0123456789ab\n; rm -rf /\nXYZ' } : { codigo: 0, salida: '' }; };
  assert.equal(await limpiarHuerfanos({ cfg, consultar }), 2);
  const ps = llamadas[0];
  assert.ok(ps.includes('label=platform-runner-rol=pr'));
  const estados = ps.filter((a, i) => ps[i - 1] === '--filter' && a.startsWith('status=')).sort();
  assert.deepEqual(estados, ['status=created', 'status=dead', 'status=exited'], 'nunca status=running');
  assert.ok(!ps.some((a) => a === 'status=running' || a === 'status=paused'));
  assert.deepEqual(llamadas[1], ['rm', '-f', 'abcdef123456', '0123456789ab']);
  const vacio = [];
  assert.equal(await limpiarHuerfanos({ cfg, consultar: async (a) => { vacio.push(a); return { codigo: 0, salida: '' }; } }), 0);
  assert.equal(vacio.length, 1, 'sin huérfanos no se llama a rm');
});

test('bucleRanura (B-7): tras 5 fallos seguidos SOLO esa ranura se corta; un ciclo largo reinicia la cuenta; las demás ranuras no se tocan', async () => {
  const dormidas = [];
  const dormir = async (ms) => { dormidas.push(ms); };
  const registros = [];
  // Falla siempre: se corta a la 5.ª y duerme entre intentos.
  let n = 0;
  const r = await bucleRanura({ cfg, pat: PAT, ranura: 1, parando: () => false, ejecutarCiclo: async () => { n += 1; throw new Error('boom'); }, dormir, registrar: (m) => registros.push(m) });
  assert.equal(r, 'cortada');
  assert.equal(n, 5);
  assert.equal(dormidas.length, 4, 'duerme entre intentos, no tras el último');
  assert.match(registros.at(-1), /ranura 1 falló 5 veces seguidas: se corta \(las demás siguen\)/);
  // Ciclos cortos (< 2 s sin tomar job) también cuentan como fallo; uno largo reinicia.
  let m = 0;
  const duraciones = [100, 100, 5000, 100, 100, 100, 100, 100];
  const r2 = await bucleRanura({ cfg, pat: PAT, ranura: 2, parando: () => false, ejecutarCiclo: async () => duraciones[m++], dormir, registrar: () => {} });
  assert.equal(r2, 'cortada');
  assert.equal(m, 8, '2 cortos, uno largo que reinicia, y 5 cortos hasta cortar');
  // Parar detiene el bucle sin cortar.
  let vueltas = 0;
  const r3 = await bucleRanura({ cfg, pat: PAT, ranura: 3, parando: () => vueltas >= 2, ejecutarCiclo: async () => { vueltas += 1; return 60000; }, dormir, registrar: () => {} });
  assert.equal(r3, 'detenida');
  assert.equal(vueltas, 2);
});
