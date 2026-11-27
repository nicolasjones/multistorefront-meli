// Pruebas de scripts/instalar-binario-verificado.sh (MSF-712): hash correcto instala; cualquier otra cosa no instala nada.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'instalar-binario-verificado.sh');

async function paquete(contenido = '#!/bin/sh\necho hola\n') {
  const dir = await mkdtemp(path.join(tmpdir(), 'bin-'));
  const origen = path.join(dir, 'origen');
  await mkdir(origen);
  await writeFile(path.join(origen, 'herramienta'), contenido);
  const tgz = path.join(dir, 'paquete.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', tgz, '-C', origen, 'herramienta']).status, 0);
  const sha = createHash('sha256').update(await readFile(tgz)).digest('hex');
  return { dir, tgz, sha, destino: path.join(dir, 'destino') };
}
const correr = (...args) => spawnSync('bash', [script, ...args], { encoding: 'utf8' });

test('con el hash correcto instala el binario ejecutable en el destino', async () => {
  const p = await paquete();
  const r = correr(`file://${p.tgz}`, p.sha, 'herramienta', p.destino);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(((await stat(path.join(p.destino, 'herramienta'))).mode & 0o777).toString(8), '755');
  assert.match(r.stdout, /SHA256 verificado/);
});

test('un solo carácter distinto en el hash: no instala nada y no crea el destino', async () => {
  const p = await paquete();
  const casos = [
    `${p.sha.slice(0, 63)}${p.sha[63] === '0' ? '1' : '0'}`, // último carácter
    `${p.sha[0] === '0' ? '1' : '0'}${p.sha.slice(1)}`, // primero
    'a'.repeat(64),
  ];
  for (const malo of casos) {
    const r = correr(`file://${p.tgz}`, malo, 'herramienta', p.destino);
    assert.equal(r.status, 1, malo);
    assert.match(r.stderr, /no se instala/);
    assert.equal(existsSync(p.destino), false, 'el destino no se crea');
  }
});

test('un paquete alterado (mismo hash fijado) no se instala', async () => {
  const bueno = await paquete('#!/bin/sh\necho bueno\n');
  const alterado = await paquete('#!/bin/sh\necho malicioso\n');
  const r = correr(`file://${alterado.tgz}`, bueno.sha, 'herramienta', alterado.destino);
  assert.equal(r.status, 1);
  assert.equal(existsSync(alterado.destino), false);
});

test('argumentos inválidos salen con 2 sin descargar nada', async () => {
  const p = await paquete();
  const invalidos = [
    [], [`file://${p.tgz}`], [`file://${p.tgz}`, p.sha, 'herramienta'],
    [`file://${p.tgz}`, p.sha.toUpperCase(), 'herramienta', p.destino], [`file://${p.tgz}`, p.sha.slice(1), 'herramienta', p.destino],
    [`file://${p.tgz}`, `${p.sha}0`, 'herramienta', p.destino], [`file://${p.tgz}`, '', 'herramienta', p.destino],
    [`file://${p.tgz}`, p.sha, '../herramienta', p.destino], [`file://${p.tgz}`, p.sha, '.oculto', p.destino], [`file://${p.tgz}`, p.sha, '', p.destino],
    [`file://${p.tgz}`, p.sha, 'a/b', p.destino],
  ];
  for (const args of invalidos) assert.equal(correr(...args).status, 2, JSON.stringify(args));
  assert.equal(existsSync(p.destino), false);
});

test('una URL inexistente falla sin instalar', async () => {
  const p = await paquete();
  const r = correr(`file://${p.dir}/no-existe.tar.gz`, p.sha, 'herramienta', p.destino);
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(p.destino), false);
});
