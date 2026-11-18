import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const script = path.resolve('scripts/deploy-vps.mjs');

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('acepta el entorno con el separador "--" que pnpm reenvía sin eliminar (regresión real, T025)', async () => {
  const result = await run(['--', 'staging']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /No existe \.env\.staging/);
  assert.doesNotMatch(result.stderr, /Uso:/);
});

test('acepta el entorno sin el separador "--"', async () => {
  const result = await run(['staging']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /No existe \.env\.staging/);
});

test('rechaza un entorno inválido incluso detrás de "--"', async () => {
  const result = await run(['--', 'qa']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Uso:/);
});

test('rechaza cuando no hay ningún entorno', async () => {
  const result = await run([]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Uso:/);
});

test('preflight: sin CORREO_MASIVO_URL_BAJA dice qué variable falta y dónde definirla, antes de tocar Docker', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-vps-'));
  const archivo = path.join(dir, '.env.staging');
  await writeFile(archivo, 'OTRA=1\nCORREO_MASIVO_URL_BAJA=\n');
  const child = spawn(process.execPath, [script, 'staging'], { env: { ...process.env, DEPLOY_VPS_ENV_FILE: archivo }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const code = await new Promise((r) => child.on('close', r));
  assert.notEqual(code, 0);
  assert.match(stderr, /Falta definir CORREO_MASIVO_URL_BAJA, .* en \.env\.staging \(/);
  assert.match(stderr, /KESTRA_BASIC_AUTH_PASSWORD/);
  assert.match(stderr, /NANGO_ENCRYPTION_KEY/);
  assert.match(stderr, /VPS_DEPLOY_ENV/);
  assert.match(stderr, /https:\/\/panel\.ejemplo\.com/);
});

test('preflight: con las variables definidas no las reclama (variablesFaltantes)', async () => {
  const { variablesFaltantes, leerEnv, VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
  const completo = VARIABLES_OBLIGATORIAS.map(({ nombre, inmutable }) => `${nombre}=${inmutable ? `ghcr.io/org/worker@sha256:${'b'.repeat(64)}` : 'x'}`).join('\n');
  assert.deepEqual(variablesFaltantes(`${completo}\n`), []);
  assert.deepEqual(variablesFaltantes(completo.replace('CORREO_MASIVO_URL_BAJA=x', 'export CORREO_MASIVO_URL_BAJA="https://panel.ejemplo.com"')).length, 0);
  assert.deepEqual(variablesFaltantes(completo.replace('CORREO_MASIVO_URL_BAJA=x', '# CORREO_MASIVO_URL_BAJA=x')).map((f) => f.nombre), ['CORREO_MASIVO_URL_BAJA']);
  assert.ok(variablesFaltantes('').length >= 15, 'sin nada, faltan la URL de baja y las credenciales de los tres productos');
  assert.equal(leerEnv('A=1\nB = "dos"').get('B'), 'dos');
});

test('preflight: con CORREO_MASIVO_URL_BAJA definida el script no corta con «Falta definir» y llega a Docker (doble de docker)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-vps-ok-'));
  const archivo = path.join(dir, '.env.staging');
  const { VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
  await writeFile(archivo, `${VARIABLES_OBLIGATORIAS.map(({ nombre, inmutable }) => `${nombre}=${nombre === 'CORREO_MASIVO_URL_BAJA' ? 'https://panel.ejemplo.com' : inmutable ? `ghcr.io/org/worker@sha256:${'a'.repeat(64)}` : 'valor-de-prueba'}`).join('\n')}\n`);
  // Doble de `docker` en el PATH: registra los argumentos y sale 0, así no se toca ningún Docker real.
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const registro = path.join(dir, 'docker.log');
  await writeFile(path.join(bin, 'docker'), `#!/bin/sh\necho "$@" >> "${registro}"\nexit 0\n`);
  await chmod(path.join(bin, 'docker'), 0o755);
  const child = spawn(process.execPath, [script, 'staging'], { env: { ...process.env, DEPLOY_VPS_ENV_FILE: archivo, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdout.on('data', () => {});
  const code = await new Promise((r) => child.on('close', r));
  assert.doesNotMatch(stderr, /Falta definir/);
  assert.equal(code, 0, stderr);
  assert.match(await readFile(registro, 'utf8'), /compose .*config --quiet/);
});

// MSF-705: Kestra, Superset y Nango no arrancan con credenciales por defecto en el VPS.
test('las credenciales del VPS son obligatorias en compose.vps.yaml y coinciden con el preflight (MSF-705)', async () => {
  const { VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
  const enCompose = new Set();
  for (const producto of ['kestra', 'superset', 'nango']) {
    const texto = await readFile(path.resolve('infra', producto, 'compose.estricto.yaml'), 'utf8');
    const vps = await readFile(path.resolve('infra', producto, 'compose.vps.yaml'), 'utf8');
    assert.doesNotMatch(vps, /x-variables-obligatorias/, `${producto}: las obligatorias nuevas viven en compose.estricto.yaml (modo transicional)`);
    const bloque = texto.match(/^x-variables-obligatorias:\n((?: {2}.+\n)+)/m);
    assert.ok(bloque, `${producto}: falta x-variables-obligatorias`);
    for (const m of `${texto}${vps}`.matchAll(/\$\{([A-Z0-9_]+):\?/g)) enCompose.add(m[1]);
    assert.ok([...bloque[1].matchAll(/\$\{([A-Z0-9_]+):\?/g)].length >= 4, `${producto}: pocas variables obligatorias`);
    // El Compose base conserva sus valores locales; el overlay del VPS no puede tener un valor por defecto para estas.
    assert.doesNotMatch(bloque[1], /:-/, `${producto}: una obligatoria no puede traer valor por defecto`);
  }
  const preflight = new Set(VARIABLES_OBLIGATORIAS.map((v) => v.nombre));
  for (const nombre of enCompose) assert.ok(preflight.has(nombre), `${nombre} está en el Compose pero no en el preflight`);
  for (const nombre of preflight) if (nombre !== 'CORREO_MASIVO_URL_BAJA') assert.ok(enCompose.has(nombre), `${nombre} está en el preflight pero no en el Compose`);
});

test('preflight: una imagen de worker con tag mutable (:latest) o sin tag cuenta como faltante (MSF-712)', async () => {
  const { variablesFaltantes, VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
  const base = VARIABLES_OBLIGATORIAS.map(({ nombre, inmutable }) => `${nombre}=${inmutable ? `ghcr.io/org/worker@sha256:${'c'.repeat(64)}` : 'x'}`);
  assert.deepEqual(variablesFaltantes(base.join('\n')), []);
  const con = (valor) => base.map((l) => (l.startsWith('HISTORIAL_IMPORTADOR_IMAGEN=') ? `HISTORIAL_IMPORTADOR_IMAGEN=${valor}` : l)).join('\n');
  for (const mutable of ['ghcr.io/org/worker:latest', 'ghcr.io/org/worker', 'ghcr.io/org/worker:v1', 'local/worker-historial-importador:latest']) {
    assert.deepEqual(variablesFaltantes(con(mutable)).map((f) => f.nombre), ['HISTORIAL_IMPORTADOR_IMAGEN'], mutable);
  }
  assert.deepEqual(variablesFaltantes(con(`ghcr.io/org/worker:${'d'.repeat(40)}`)), [], 'el tag del commit es inmutable');
});

// --- Modo transicional (MSF-705/706/712): dev advierte, staging y producción bloquean ---

const { VARIABLES_OBLIGATORIAS } = await import('./preflight-deploy-vps.mjs');
const SECRETO = 'valor-secreto-que-nunca-debe-imprimirse';
const envCompleto = () => VARIABLES_OBLIGATORIAS.map(({ nombre, inmutable }) => `${nombre}=${nombre === 'CORREO_MASIVO_URL_BAJA' ? 'https://panel.ejemplo.com' : inmutable ? `ghcr.io/org/w@sha256:${'a'.repeat(64)}` : SECRETO}`).join('\n');
const soloLaUrl = () => `CORREO_MASIVO_URL_BAJA=https://panel.ejemplo.com\nKESTRA_DB_PASSWORD=${SECRETO}\n`;

async function correrDeploy(entorno, contenido, extraEnv = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-modo-'));
  const archivo = path.join(dir, `.env.${entorno}`);
  await writeFile(archivo, contenido);
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const registro = path.join(dir, 'docker.log');
  await writeFile(path.join(bin, 'docker'), `#!/bin/sh\necho "$@" >> "${registro}"\nexit 0\n`);
  await chmod(path.join(bin, 'docker'), 0o755);
  const child = spawn(process.execPath, [script, entorno], { env: { ...process.env, VPS_ESTRICTO: '', DEPLOY_VPS_ENV_FILE: archivo, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; let stdout = '';
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdout.on('data', (c) => { stdout += c; });
  const code = await new Promise((r) => child.on('close', r));
  let docker = '';
  try { docker = await readFile(registro, 'utf8'); } catch { /* no llegó a Docker */ }
  return { code, stderr, stdout, docker };
}

test('(a) sin secretos en dev el deploy CONTINÚA con advertencias que listan lo que falta, y no usa el compose estricto', async () => {
  const r = await correrDeploy('dev', soloLaUrl());
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /MODO TRANSICIONAL \(dev\)/);
  assert.match(r.stderr, /KESTRA_BASIC_AUTH_PASSWORD/);
  assert.match(r.stderr, /HISTORIAL_IMPORTADOR_IMAGEN/);
  assert.match(r.stderr, /VPS_ESTRICTO=1/);
  assert.doesNotMatch(r.docker, /compose\.estricto\.yaml/);
  assert.match(r.docker, /compose .*config --quiet/);
});

test('(b) sin secretos en staging y production FALLA con un mensaje claro, antes de tocar Docker; VPS_ESTRICTO=0 no los relaja', async () => {
  for (const entorno of ['staging', 'production']) {
    const r = await correrDeploy(entorno, soloLaUrl(), { VPS_ESTRICTO: '0' });
    assert.notEqual(r.code, 0, entorno);
    assert.match(r.stderr, new RegExp(`Falta definir .*KESTRA_BASIC_AUTH_PASSWORD.* en \\.env\\.${entorno}`), entorno);
    assert.match(r.stderr, /VPS_DEPLOY_ENV/);
    assert.equal(r.docker, '', 'no llegó a Docker');
  }
});

test('(b2) dev con VPS_ESTRICTO=1 también bloquea', async () => {
  const r = await correrDeploy('dev', soloLaUrl(), { VPS_ESTRICTO: '1' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Falta definir/);
});

test('(c) con todos los valores pasa en los tres entornos y en staging/production/dev-estricto agrega el compose estricto', async () => {
  for (const [entorno, extra, estricto] of [['dev', {}, false], ['dev', { VPS_ESTRICTO: '1' }, true], ['staging', {}, true], ['production', {}, true]]) {
    const r = await correrDeploy(entorno, envCompleto(), extra);
    assert.equal(r.code, 0, `${entorno}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /MODO TRANSICIONAL|Falta definir/);
    assert.equal(/compose\.estricto\.yaml/.test(r.docker), estricto, `${entorno}`);
  }
});

test('(d) el preflight nunca imprime valores de variables, ni en advertencias ni en errores', async () => {
  const contenido = `${soloLaUrl()}HISTORIAL_IMPORTADOR_IMAGEN=ghcr.io/o/w:latest-${SECRETO}\nNANGO_ENCRYPTION_KEY=${SECRETO}\n`;
  for (const entorno of ['dev', 'staging']) {
    const r = await correrDeploy(entorno, contenido);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, new RegExp(SECRETO), entorno);
  }
});

test('el modo estricto depende del entorno y de VPS_ESTRICTO solo en dev', async () => {
  const { modoEstricto, clasificarFaltantes } = await import('./preflight-deploy-vps.mjs');
  assert.equal(modoEstricto('staging', {}), true);
  assert.equal(modoEstricto('production', { VPS_ESTRICTO: '0' }), true);
  assert.equal(modoEstricto('dev', {}), false);
  assert.equal(modoEstricto('dev', { VPS_ESTRICTO: '1' }), true);
  const url = VARIABLES_OBLIGATORIAS.filter((v) => v.nombre === 'CORREO_MASIVO_URL_BAJA');
  assert.equal(clasificarFaltantes(url, false).bloqueantes.length, 1, 'la URL de baja bloquea siempre (compose.vps.yaml)');
});

test('VPS_ESTRICTO=1 también se lee del `.env.dev` (misma fuente que las demás variables) y el del proceso manda', async () => {
  const { modoEstricto } = await import('./preflight-deploy-vps.mjs');
  assert.equal(modoEstricto('dev', {}, 'VPS_ESTRICTO=1\n'), true);
  assert.equal(modoEstricto('dev', {}, '# VPS_ESTRICTO=1\n'), false);
  assert.equal(modoEstricto('dev', { VPS_ESTRICTO: '1' }, ''), true);
  assert.equal(modoEstricto('staging', { VPS_ESTRICTO: '0' }, 'VPS_ESTRICTO=0'), true);
  const r = await correrDeploy('dev', `${soloLaUrl()}VPS_ESTRICTO=1\n`);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Falta definir/);
});
