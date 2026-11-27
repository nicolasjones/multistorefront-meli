// Pruebas del guard de infra/runner (MSF-703, MSF-704): el repo real cumple y cada mutante falla por UNA razón.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { analizarCompose, analizarDockerfile, analizarRaiz } from './verificar-compose.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (f) => readFileSync(path.join(raiz, 'infra', 'runner', f), 'utf8');
const pr = leer('compose.yaml');
const deploy = leer('compose.deploy.yaml');
const dockerfile = leer('Dockerfile');

test('el repositorio real cumple el guard', () => {
  assert.deepEqual(analizarRaiz(raiz), []);
});

test('mutantes del Compose de PR: cada uno produce exactamente un hallazgo con el motivo esperado', () => {
  const mutantes = [
    ['socket en otro servicio', (t) => `${t.replace('\nsecrets:\n  gh_runner_pat:', '\n  trabajo:\n    image: x\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\nsecrets:\n  gh_runner_pat:')}`, /el único servicio es `supervisor`|socket de Docker del host solo puede estar en el supervisor/],
    ['socket por variable', (t) => t.replace('      RUNNER_ROLE: pr\n', '      RUNNER_ROLE: pr\n      DOCKER_HOST: unix:///var/run/docker.sock\n'), /socket de Docker del host solo puede estar en el supervisor/],
    ['volumen extra del supervisor', (t) => t.replace('      - /var/run/docker.sock:/var/run/docker.sock\n', '      - /var/run/docker.sock:/var/run/docker.sock\n      - /root:/root\n'), /solo monta el socket/],
    ['store compartido', (t) => `${t}\nvolumes:\n  pnpm-store:\n    name: x\n`, /volúmenes de primer nivel/],
    ['PAT por entorno', (t) => t.replace('      RUNNER_ROLE: pr\n', '      RUNNER_ROLE: pr\n      GH_PAT: ${GH_RUNNER_PAT}\n'), /PAT por variable de entorno/],
    ['privileged', (t) => t.replace('    init: true\n', '    init: true\n    privileged: true\n'), /privileged/],
    ['pid host', (t) => t.replace('    init: true\n', '    init: true\n    pid: host\n'), /espacio de nombres/],
    ['cap_add', (t) => t.replace('    init: true\n', '    init: true\n    cap_add:\n      - SYS_ADMIN\n'), /cap_add/],
    ['sin sysbox por defecto', (t) => t.replace('${RUNNER_RUNTIME:-sysbox-runc}', '${RUNNER_RUNTIME:-runc}'), /sysbox-runc/],
    ['entrypoint distinto', (t) => t.replace('["node", "/supervisor.mjs"]', '["node", "/entrypoint.mjs"]'), /entrypoint del servicio/],
    ['sin daemon interno', (t) => t.replace('RUNNER_DOCKER_INTERNO: "1"', 'RUNNER_DOCKER_INTERNO: "0"'), /RUNNER_DOCKER_INTERNO/],
    ['PAT en otra ruta', (t) => t.replace('/run/secrets/gh_runner_pat', '/tmp/pat'), /RUNNER_PAT_FILE/],
    ['sin imagen', (t) => t.replace(/^ {6}RUNNER_IMAGE:.*\n/m, ''), /RUNNER_IMAGE/],
    ['rol equivocado', (t) => t.replace('RUNNER_ROLE: pr', 'RUNNER_ROLE: deploy'), /RUNNER_ROLE debe ser pr/],
    ['PR con etiqueta de deploy', (t) => t.replace('RUNNER_LABELS: self-hosted,platform-local,platform-pr', 'RUNNER_LABELS: self-hosted,platform-local,platform-pr,platform-deploy'), /no puede llevar platform-deploy/],
    ['PR sin platform-pr', (t) => t.replace('RUNNER_LABELS: self-hosted,platform-local,platform-pr', 'RUNNER_LABELS: self-hosted,platform-local'), /lleva platform-local y platform-pr/],
  ];
  for (const [nombre, mutar, motivo] of mutantes) {
    const mutado = mutar(pr);
    assert.notEqual(mutado, pr, `${nombre}: la mutación no cambió nada`);
    const h = analizarCompose('pr', mutado, 'pr');
    assert.ok(h.some((x) => motivo.test(x)), `${nombre}: ${JSON.stringify(h)}`);
  }
});

test('mutantes del Compose de deploy', () => {
  const mutantes = [
    ['con platform-local', (t) => t.replace('RUNNER_LABELS: self-hosted,platform-deploy', 'RUNNER_LABELS: self-hosted,platform-deploy,platform-local'), /no puede llevar platform-local/],
    ['con platform-pr', (t) => t.replace('RUNNER_LABELS: self-hosted,platform-deploy', 'RUNNER_LABELS: self-hosted,platform-deploy,platform-pr'), /no puede llevar platform-local ni platform-pr/],
    ['sin platform-deploy', (t) => t.replace('RUNNER_LABELS: self-hosted,platform-deploy', 'RUNNER_LABELS: self-hosted'), /lleva platform-deploy/],
    ['store sin vaciar', (t) => t.replace('RUNNER_LIMPIAR_STORE: "1"', 'RUNNER_LIMPIAR_STORE: "0"'), /vacía el store/],
  ];
  for (const [nombre, mutar, motivo] of mutantes) {
    const mutado = mutar(deploy);
    assert.notEqual(mutado, deploy, nombre);
    const h = analizarCompose('deploy', mutado, 'deploy');
    assert.equal(h.length, 1, `${nombre}: ${JSON.stringify(h)}`);
    assert.match(h[0], motivo, nombre);
  }
});

test('un comentario que menciona el socket o el PAT no cuenta (los comentarios explican lo que NO se hace)', () => {
  assert.match(pr, /# .*socket de Docker/);
  assert.deepEqual(analizarCompose('pr', pr, 'pr'), []);
});

test('mutantes del Dockerfile', () => {
  const mutantes = [
    ['root', (t) => t.replace('ARG RUNNER_UID=1001', 'ENV RUNNER_ALLOW_RUNASROOT=1\nARG RUNNER_UID=1001'), /RUNNER_ALLOW_RUNASROOT/],
    ['sin usuario', (t) => t.replace(/useradd[^\n]*\n/, '\n'), /usuario `runner`/],
    ['sin chown', (t) => t.replace('chown -R runner:runner /home/runner', 'true'), /pertenecer/],
    ['plugins en /root', (t) => t.replace('/usr/local/lib/docker/cli-plugins/docker-scout', '/root/.docker/cli-plugins/docker-scout'), /directorio del sistema/],
    ['binario con dueño del tarball', (t) => t.replace('tar xzf supabase.tar.gz --no-same-owner', 'tar xzf supabase.tar.gz'), /--no-same-owner/],
    ['módulos escribibles', (t) => t.replace('chmod 0555 /entrypoint.mjs /supervisor.mjs', 'chmod 0755 /entrypoint.mjs /supervisor.mjs'), /solo lectura/],
  ];
  for (const [nombre, mutar, motivo] of mutantes) {
    const mutado = mutar(dockerfile);
    assert.notEqual(mutado, dockerfile, nombre);
    const h = analizarDockerfile(mutado);
    assert.ok(h.some((x) => motivo.test(x)), `${nombre}: ${JSON.stringify(h)}`);
  }
  assert.deepEqual(analizarDockerfile(dockerfile), []);
});
