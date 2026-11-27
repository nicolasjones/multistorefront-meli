// Pruebas del endurecimiento del runner (MSF-703, MSF-704): roles, etiquetas, PAT y entorno de los jobs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { argumentosConfig, entornoDelRunner, etiquetas, leerConfiguracion, leerPat, modoSeguro } from './config-runner.mjs';

const pr = { RUNNER_ROLE: 'pr', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-local,platform-pr' };
const deploy = { RUNNER_ROLE: 'deploy', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-deploy' };

test('configuraciones válidas de cada rol', () => {
  const a = leerConfiguracion(pr);
  assert.equal(a.rol, 'pr');
  assert.equal(a.efimero, true);
  assert.equal(a.limpiarStore, false);
  assert.equal(a.uid, 1001);
  const b = leerConfiguracion(deploy);
  assert.equal(b.limpiarStore, true, 'el deploy siempre arranca con store limpio');
  assert.equal(leerConfiguracion({ ...pr, RUNNER_EPHEMERAL: '0' }).efimero, false);
  assert.equal(leerConfiguracion({ ...pr, RUNNER_LIMPIAR_STORE: '1' }).limpiarStore, true);
  assert.equal(leerConfiguracion({ ...pr, RUNNER_DOCKER_INTERNO: '1' }).dockerInterno, true);
  assert.equal(leerConfiguracion({ ...deploy, RUNNER_DOCKER_INTERNO: '1' }).dockerInterno, true, 'el deploy construye imágenes con el daemon interno');
  assert.equal(leerConfiguracion(pr).dockerInterno, false);
});

test('cada mutante inválido se rechaza por UNA razón', () => {
  const mutantes = [
    [{ ...pr, RUNNER_ROLE: '' }, /RUNNER_ROLE/], [{ ...pr, RUNNER_ROLE: 'admin' }, /RUNNER_ROLE/], [{ ...pr, RUNNER_ROLE: 'constructor' }, /RUNNER_ROLE/],
    [{ ...pr, RUNNER_REPO: 'sin-barra' }, /owner\/repo/], [{ ...pr, RUNNER_REPO: 'a/b;rm' }, /owner\/repo/],
    [{ ...pr, RUNNER_LABELS: 'self-hosted,platform-local' }, /faltan: platform-pr/],
    [{ ...pr, RUNNER_LABELS: 'self-hosted,platform-pr' }, /faltan: platform-local/],
    [{ ...pr, RUNNER_LABELS: 'self-hosted,platform-local,platform-pr,platform-deploy' }, /no puede llevar.*platform-deploy/],
    [{ ...deploy, RUNNER_LABELS: 'self-hosted,platform-deploy,platform-local' }, /no puede llevar.*platform-local/],
    [{ ...deploy, RUNNER_LABELS: 'self-hosted,platform-deploy,platform-pr' }, /no puede llevar.*platform-pr/],
    [{ ...deploy, RUNNER_LABELS: 'self-hosted' }, /faltan: platform-deploy/],
    [{ ...deploy, RUNNER_DOCKER_SOCKET: '1' }, /socket de Docker del host ya no se admite/],
    [{ ...pr, RUNNER_DOCKER_SOCKET: '1' }, /socket de Docker del host ya no se admite/],
    [{ ...pr, RUNNER_DOCKER_SOCKET: '/var/run/docker.sock' }, /socket de Docker del host ya no se admite/],
    [{ ...pr, RUNNER_NAME: 'nombre con espacio' }, /RUNNER_NAME/],
    [{ ...pr, RUNNER_UID: '0' }, /UID/], [{ ...pr, RUNNER_UID: '999' }, /UID/], [{ ...pr, RUNNER_GID: '0' }, /UID/], [{ ...pr, RUNNER_UID: 'x' }, /UID/],
  ];
  for (const [env, mensaje] of mutantes) assert.throws(() => leerConfiguracion(env), mensaje, JSON.stringify(env));
  // Frontera del uid: 1000 pasa, 999 no.
  assert.equal(leerConfiguracion({ ...pr, RUNNER_UID: '1000', RUNNER_GID: '1000' }).uid, 1000);
});

test('etiquetas: espacios y vacíos', () => {
  assert.deepEqual(etiquetas(' a , b ,, c '), ['a', 'b', 'c']);
  assert.deepEqual(etiquetas(undefined), []);
});

test('modoSeguro: frontera por bits de grupo y otros', () => {
  const casos = [[0o400, true], [0o600, true], [0o700, true], [0o640, false], [0o604, false], [0o610, false], [0o644, false], [0o660, false], [0o777, false], [0o444, false], [0o440, false], [0o404, false]];
  for (const [modo, esperado] of casos) assert.equal(modoSeguro(modo), esperado, modo.toString(8));
});

test('leerPat: solo desde archivo 0400 no vacío; nunca por entorno', () => {
  const io = (contenido = 'ghp_xxx\n', modo = 0o400) => ({ leer: () => contenido, modoDe: () => modo });
  assert.equal(leerPat({ RUNNER_PAT_FILE: '/run/secrets/pat' }, io()), 'ghp_xxx');
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x', GH_PAT: 'ghp_zzz' }, io()), /no puede venir por variable de entorno/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x', GH_RUNNER_PAT: 'ghp_zzz' }, io()), /no puede venir por variable de entorno/);
  assert.throws(() => leerPat({}, io()), /Falta RUNNER_PAT_FILE/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x' }, io('ghp', 0o644)), /legible por grupo u otros/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x' }, io('  \n')), /vacío/);
  // El mensaje de error nunca contiene el PAT.
  try { leerPat({ RUNNER_PAT_FILE: '/x', GH_PAT: 'ghp_SECRETO' }, io()); } catch (e) { assert.ok(!e.message.includes('ghp_SECRETO')); }
});

test('argumentosConfig: --ephemeral solo si corresponde y etiquetas del rol', () => {
  const cfg = leerConfiguracion(pr);
  const args = argumentosConfig(cfg, 'TOKEN', 'runner-1');
  assert.ok(args.includes('--ephemeral'));
  assert.equal(args[args.indexOf('--labels') + 1], 'self-hosted,platform-local,platform-pr');
  assert.ok(!argumentosConfig({ ...cfg, efimero: false }, 'T', 'n').includes('--ephemeral'));
});

test('entornoDelRunner: los jobs no heredan el PAT (ninguna variante) y sí el resto', () => {
  const env = { GH_PAT: 'a', GH_RUNNER_PAT: 'b', RUNNER_PAT_FILE: '/x', PATH: '/bin', pnpm_config_store_dir: '/s', DOCKER_HOST: 'unix:///var/run/docker.sock' };
  const limpio = entornoDelRunner(env);
  for (const secreta of ['GH_PAT', 'GH_RUNNER_PAT', 'RUNNER_PAT_FILE']) assert.equal(secreta in limpio, false, secreta);
  assert.equal(limpio.PATH, '/bin');
  assert.equal(limpio.pnpm_config_store_dir, '/s');
  assert.equal(limpio.HOME, '/home/runner');
  assert.equal(limpio.DOCKER_HOST, 'unix:///var/run/docker.sock');
});
