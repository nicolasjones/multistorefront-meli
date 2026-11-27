// Pruebas de infra/vps/obtener-clave-host.sh con ssh-keyscan/ssh-keygen falsos: no toca la red.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'vps', 'obtener-clave-host.sh');
const CLAVE = `vps.ejemplo.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${'A'.repeat(43)}`;

async function correr(args, { scan = `echo "${CLAVE}"` } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ckh-'));
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'ssh-keyscan'), `#!/bin/sh\n${scan}\n`);
  await writeFile(path.join(bin, 'ssh-keygen'), '#!/bin/sh\ncat >/dev/null\necho "256 SHA256:huellaDePrueba vps.ejemplo.com (ED25519)"\n');
  await chmod(path.join(bin, 'ssh-keyscan'), 0o755);
  await chmod(path.join(bin, 'ssh-keygen'), 0o755);
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}` } });
}

test('imprime la huella y la línea de known_hosts', async () => {
  const r = await correr(['vps.ejemplo.com']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SHA256:huellaDePrueba/);
  assert.ok(r.stdout.includes(CLAVE));
  assert.match(r.stdout, /solo si la huella coincide/);
});

test('hosts inválidos salen con 2; sin clave sale con 1', async () => {
  for (const malo of [[], [''], ['-oProxyCommand=x'], ['a b'], ['host;ls'], ['$(id)']]) assert.equal((await correr(malo)).status, 2, JSON.stringify(malo));
  const sin = await correr(['vps.ejemplo.com'], { scan: 'echo "# comentario"' });
  assert.equal(sin.status, 1);
  assert.match(sin.stderr, /No se obtuvo ninguna clave/);
});
