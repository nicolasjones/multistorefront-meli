import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { lineasValidas, preparar } from './preparar-known-hosts-vps.mjs';

const CLAVE = `AAAAC3NzaC1lZDI1NTE5AAAAI${'A'.repeat(40)}`;
const LINEA = `vps.ejemplo.com ssh-ed25519 ${CLAVE}`;

test('acepta la línea del host y rechaza las de otro host, comodines, marcadores y formatos raros', () => {
  assert.deepEqual(lineasValidas(`# comentario\n${LINEA}\n`, 'vps.ejemplo.com'), [LINEA]);
  assert.deepEqual(lineasValidas(`|1|abc=|def= ssh-ed25519 ${CLAVE}`, 'vps.ejemplo.com').length, 1, 'el formato hasheado de ssh-keyscan -H es válido');
  assert.throws(() => lineasValidas(LINEA, 'otro.com'), /es de vps\.ejemplo\.com y se despliega a otro\.com/);
  assert.throws(() => lineasValidas(`*.ejemplo.com ssh-ed25519 ${CLAVE}`, '*.ejemplo.com'), /comodines/);
  assert.throws(() => lineasValidas(`@cert-authority vps.ejemplo.com ssh-ed25519 ${CLAVE}`, 'vps.ejemplo.com'), /marcadores/);
  assert.throws(() => lineasValidas('vps.ejemplo.com basura', 'vps.ejemplo.com'), /formato inválido/);
  assert.throws(() => lineasValidas('\n# nada\n', 'vps.ejemplo.com'), /no hay ninguna clave/);
});

test('con el secret escribe known_hosts_vps y una config con StrictHostKeyChecking yes acotada al host', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  const r = await preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir });
  assert.match(r.origen, /secret/);
  assert.equal((await readFile(path.join(dir, 'known_hosts_vps'), 'utf8')).trim(), LINEA);
  const config = await readFile(path.join(dir, 'config'), 'utf8');
  assert.match(config, /Host vps\.ejemplo\.com\n {2}StrictHostKeyChecking yes\n {2}UserKnownHostsFile .*known_hosts_vps\n {2}GlobalKnownHostsFile \/dev\/null/);
  // Idempotente: una segunda corrida no duplica el bloque.
  await preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir });
  assert.equal((await readFile(path.join(dir, 'config'), 'utf8')).match(/Host vps\.ejemplo\.com/g).length, 1);
});

test('sin secret usa el archivo versionado del entorno; sin ninguno de los dos FALLA (no usa ssh-keyscan)', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'raiz-'));
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  await assert.rejects(() => preparar({ host: 'vps.ejemplo.com', entorno: 'production', secreto: '', sshDir: dir, raiz }), /No hay clave de host fijada para production.*No se usa ssh-keyscan/);
  await mkdir(path.join(raiz, 'infra', 'vps'), { recursive: true });
  await writeFile(path.join(raiz, 'infra', 'vps', 'known_hosts.production'), `${LINEA}\n`);
  const r = await preparar({ host: 'vps.ejemplo.com', entorno: 'production', secreto: '  ', sshDir: dir, raiz });
  assert.match(r.origen, /infra\/vps\/known_hosts\.production/);
});

test('el CLI sale con código 1 y un ::error:: cuando no hay clave fijada', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  const r = spawnSync(process.execPath, [path.resolve('scripts/preparar-known-hosts-vps.mjs'), '--host', 'vps.ejemplo.com', '--entorno', 'staging', '--ssh-dir', dir], { cwd: dir, env: { ...process.env, VPS_SSH_KNOWN_HOSTS: '' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /::error::No hay clave de host fijada/);
});

test('los workflows de despliegue ya no usan ssh-keyscan y llaman al preparador (MSF-706)', async () => {
  const wf = await readFile('.github/workflows/deploy-infraestructura-vps.yml', 'utf8');
  assert.doesNotMatch(wf.replace(/^\s*#.*$/gm, ''), /ssh-keyscan/);
  assert.equal(wf.match(/node scripts\/preparar-known-hosts-vps\.mjs/g).length, 2);
  assert.match(wf, /--entorno staging/);
  assert.match(wf, /--entorno production/);
});
