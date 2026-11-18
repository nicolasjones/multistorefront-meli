import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { esEstricto, lineasValidas, preparar } from './preparar-known-hosts-vps.mjs';

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

test('modo transicional: en dev sin clave fijada advierte y usa accept-new; staging y production siguen fallando', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'raiz-'));
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  assert.equal(esEstricto('staging', {}), true);
  assert.equal(esEstricto('production', { VPS_ESTRICTO: '0' }), true);
  assert.equal(esEstricto('dev', {}), false);
  assert.equal(esEstricto('dev', { VPS_ESTRICTO: '1' }), true);
  const r = await preparar({ host: 'vps.ejemplo.com', entorno: 'dev', secreto: '', sshDir: dir, raiz, estricto: false });
  assert.match(r.advertencia, /accept-new/);
  assert.match(await readFile(path.join(dir, 'config'), 'utf8'), /StrictHostKeyChecking accept-new/);
  await assert.rejects(() => preparar({ host: 'vps.ejemplo.com', entorno: 'dev', secreto: '', sshDir: dir, raiz, estricto: true }), /No hay clave de host fijada/);
  await assert.rejects(() => preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: '', sshDir: dir, raiz }), /No hay clave de host fijada/);
  // Con clave fijada, dev también la usa y queda estricto.
  const ok = await preparar({ host: 'vps.ejemplo.com', entorno: 'dev', secreto: LINEA, sshDir: dir, raiz, estricto: false });
  assert.equal(ok.advertencia, undefined);
});

test('MSF-706: el valor EFECTIVO de ssh es yes aunque haya un `Host *` previo con StrictHostKeyChecking no (ssh -G)', async (t) => {
  const { spawnSync } = await import('node:child_process');
  if (spawnSync('ssh', ['-V']).error) return t.skip('ssh no está instalado');
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  await writeFile(path.join(dir, 'config'), 'Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n');
  await preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir });
  const efectivo = (host) => Object.fromEntries(spawnSync('ssh', ['-G', '-F', path.join(dir, 'config'), host], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.split(' ')).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join(' ')]));
  const r = efectivo('vps.ejemplo.com');
  assert.equal(r.stricthostkeychecking, 'true', 'yes se informa como true');
  assert.match(r.userknownhostsfile, /known_hosts_vps/);
  assert.equal(efectivo('otro.host').stricthostkeychecking, 'false', 'el Host * previo sigue valiendo para otros hosts');
  // Una segunda corrida no duplica el bloque ni lo manda al final.
  await preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir });
  const config = await readFile(path.join(dir, 'config'), 'utf8');
  assert.equal(config.match(/# vps-deploy/g).length, 1);
  assert.ok(config.startsWith('# vps-deploy'));
  assert.equal(efectivo('vps.ejemplo.com').stricthostkeychecking, 'true');
});

test('esEstricto lee VPS_ESTRICTO de la misma fuente que el preflight: el proceso manda y, si no está, el .env del entorno', () => {
  assert.equal(esEstricto('dev', {}, 'VPS_ESTRICTO=1\n'), true);
  assert.equal(esEstricto('dev', {}, 'OTRA=1\n'), false);
  assert.equal(esEstricto('dev', { VPS_ESTRICTO: '0' }, 'VPS_ESTRICTO=1\n'), false, 'la variable del proceso manda');
  assert.equal(esEstricto('production', {}, ''), true);
});

test('~/.ssh/config queda en 0600 aunque ya existiera con otros permisos', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  await writeFile(path.join(dir, 'config'), 'Host otro\n  User x\n', { mode: 0o644 });
  await chmod(path.join(dir, 'config'), 0o644);
  await preparar({ host: 'vps.ejemplo.com', entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir });
  assert.equal((await stat(path.join(dir, 'config'))).mode & 0o777, 0o600);
  await chmod(path.join(dir, 'config'), 0o644);
  await preparar({ host: 'vps.ejemplo.com', entorno: 'dev', secreto: '', sshDir: dir, raiz: dir, estricto: false });
  assert.equal((await stat(path.join(dir, 'config'))).mode & 0o777, 0o600, 'también en el modo transicional');
});

test('el host se valida antes de escribir nada: sin espacios, comodines ni saltos de línea', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ssh-'));
  for (const malo of ['vps.ejemplo.com\n  ProxyCommand x', 'vps ejemplo', '*', 'a;b', 'vps.ejemplo.com\n']) {
    await assert.rejects(() => preparar({ host: malo, entorno: 'staging', secreto: LINEA, sshDir: dir, raiz: dir }), /--host solo admite/, JSON.stringify(malo));
  }
  await assert.rejects(() => readFile(path.join(dir, 'config'), 'utf8'), /ENOENT/, 'no se escribió el config');
});
