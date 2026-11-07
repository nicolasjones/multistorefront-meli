// MSF-369 · F-OPS-03 (FR-020, FR-023): GlitchTip es un producto con su propio Compose, sin Compose raíz,
// con comandos de desarrollo y DSN vacío (= desactivado) en .env.example.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('infra/glitchtip/compose.yaml', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const env = readFileSync('.env.example', 'utf8');

test('tiene proyecto Compose propio y servicios mínimos', () => {
  assert.match(compose, /^name: multistorefront-meli-glitchtip-dev$/m);
  for (const servicio of ['glitchtip-db', 'glitchtip-redis', 'glitchtip-web', 'glitchtip-worker', 'glitchtip-migrate']) {
    assert.match(compose, new RegExp(`^  ${servicio}:`, 'm'));
  }
});

test('no existe un Compose raíz', () => {
  for (const nombre of ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']) {
    assert.equal(existsSync(nombre), false, `${nombre} en la raíz`);
  }
});

test('package.json trae dev:glitchtip, dev:down:glitchtip e infra:config:glitchtip', () => {
  assert.equal(pkg.scripts['dev:glitchtip'], 'docker compose -f infra/glitchtip/compose.yaml up -d');
  assert.equal(pkg.scripts['dev:down:glitchtip'], 'docker compose -f infra/glitchtip/compose.yaml down');
  assert.match(pkg.scripts['infra:config'], /infra:config:glitchtip/);
  assert.match(pkg.scripts['infra:config:glitchtip'], /infra\/glitchtip\/compose\.yaml config --quiet/);
});

test('los DSN están vacíos en .env.example (sin DSN no se envía nada)', () => {
  assert.match(env, /^VITE_ERRORES_DSN=$/m);
  assert.match(env, /^ERRORES_DSN=$/m);
});

test('la constitución lista el proyecto Compose de GlitchTip', () => {
  assert.match(readFileSync('.specify/memory/constitution.md', 'utf8'), /multistorefront-meli-glitchtip-dev/);
});
