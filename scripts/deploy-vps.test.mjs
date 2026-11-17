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
  assert.match(stderr, /Falta definir CORREO_MASIVO_URL_BAJA en \.env\.staging \(/);
  assert.match(stderr, /VPS_DEPLOY_ENV/);
  assert.match(stderr, /https:\/\/panel\.ejemplo\.com/);
});

test('preflight: con la variable definida no la reclama (variablesFaltantes)', async () => {
  const { variablesFaltantes, leerEnv } = await import('./preflight-deploy-vps.mjs');
  assert.deepEqual(variablesFaltantes('CORREO_MASIVO_URL_BAJA=https://panel.ejemplo.com\n'), []);
  assert.deepEqual(variablesFaltantes('export CORREO_MASIVO_URL_BAJA="https://panel.ejemplo.com"').length, 0);
  assert.equal(variablesFaltantes('# CORREO_MASIVO_URL_BAJA=x').length, 1);
  assert.equal(leerEnv('A=1\nB = "dos"').get('B'), 'dos');
});

test('preflight: con CORREO_MASIVO_URL_BAJA definida el script no corta con «Falta definir» y llega a Docker (doble de docker)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deploy-vps-ok-'));
  const archivo = path.join(dir, '.env.staging');
  await writeFile(archivo, 'CORREO_MASIVO_URL_BAJA=https://panel.ejemplo.com\n');
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
