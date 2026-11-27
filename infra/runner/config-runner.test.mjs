// Pruebas del endurecimiento del runner (MSF-703, MSF-704): roles, etiquetas, PAT, JIT y el `docker run` del contenedor de cada job.
import assert from 'node:assert/strict';
import test from 'node:test';
import { argumentosDockerRun, cuerpoJit, etiquetas, exigirSinPat, leerConfiguracion, leerConfiguracionSupervisor, leerPat, modoSeguro, nombreDeContenedor } from './config-runner.mjs';

const pr = { RUNNER_ROLE: 'pr', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-local,platform-pr' };
const deploy = { RUNNER_ROLE: 'deploy', RUNNER_REPO: 'org/repo', RUNNER_LABELS: 'self-hosted,platform-deploy' };
const sup = (base, extra = {}) => ({ ...base, RUNNER_IMAGE: 'multistorefront-meli-runner:local', ...extra });

test('configuraciones válidas de cada rol', () => {
  const a = leerConfiguracion(pr);
  assert.equal(a.rol, 'pr');
  assert.equal(a.uid, 1001);
  assert.equal(a.dockerInterno, false);
  assert.equal(leerConfiguracion({ ...pr, RUNNER_DOCKER_INTERNO: '1' }).dockerInterno, true);
  assert.equal(leerConfiguracion({ ...deploy, RUNNER_DOCKER_INTERNO: '1' }).dockerInterno, true, 'el deploy construye imágenes con el daemon interno');
  assert.equal(leerConfiguracion({ ...pr, RUNNER_UID: '1000', RUNNER_GID: '1000' }).uid, 1000);
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
    [{ ...pr, RUNNER_DOCKER_SOCKET: '/var/run/docker.sock' }, /socket de Docker del host ya no se admite/],
    [{ ...pr, RUNNER_NAME: 'nombre con espacio' }, /RUNNER_NAME/], [{ ...pr, RUNNER_NAME: '-nombre' }, /RUNNER_NAME/],
    [{ ...pr, RUNNER_UID: '0' }, /UID/], [{ ...pr, RUNNER_UID: '999' }, /UID/], [{ ...pr, RUNNER_GID: '0' }, /UID/], [{ ...pr, RUNNER_UID: 'x' }, /UID/],
  ];
  for (const [env, mensaje] of mutantes) assert.throws(() => leerConfiguracion(env), mensaje, JSON.stringify(env));
});

test('configuración del supervisor: valores por defecto, fronteras y mutantes', () => {
  const c = leerConfiguracionSupervisor(sup(pr));
  assert.deepEqual([c.slots, c.pids, c.cpus, c.memoria, c.runtime, c.limpiarStore], [1, 4096, 2, '6g', 'sysbox-runc', false]);
  assert.equal(leerConfiguracionSupervisor(sup(deploy)).limpiarStore, true, 'el deploy siempre vacía el store');
  assert.equal(leerConfiguracionSupervisor(sup(pr, { RUNNER_SLOTS: '0' })).slots, 0);
  assert.equal(leerConfiguracionSupervisor(sup(pr, { RUNNER_SLOTS: '32' })).slots, 32);
  assert.equal(leerConfiguracionSupervisor(sup(pr, { RUNNER_CPU_LIMIT: '0' })).cpus, 0);
  const malos = [
    [{ RUNNER_IMAGE: '' }, /RUNNER_IMAGE/], [{ RUNNER_IMAGE: 'img con espacio' }, /RUNNER_IMAGE/], [{ RUNNER_IMAGE: '-evil' }, /RUNNER_IMAGE/],
    [{ RUNNER_SLOTS: '-1' }, /RUNNER_SLOTS/], [{ RUNNER_SLOTS: '33' }, /RUNNER_SLOTS/], [{ RUNNER_SLOTS: 'x' }, /RUNNER_SLOTS/],
    [{ RUNNER_PIDS_LIMIT: '63' }, /RUNNER_PIDS_LIMIT/], [{ RUNNER_CPU_LIMIT: '-1' }, /RUNNER_CPU_LIMIT/], [{ RUNNER_CPU_LIMIT: 'x' }, /RUNNER_CPU_LIMIT/],
    [{ RUNNER_MEMORY_LIMIT: '6' }, /RUNNER_MEMORY_LIMIT/], [{ RUNNER_MEMORY_LIMIT: '6g --privileged' }, /RUNNER_MEMORY_LIMIT/], [{ RUNNER_MEMORY_LIMIT: '0g' }, /RUNNER_MEMORY_LIMIT/],
    [{ RUNNER_RUNTIME: 'runc --privileged' }, /RUNNER_RUNTIME/], [{ RUNNER_RUNTIME: '-x' }, /RUNNER_RUNTIME/],
  ];
  for (const [extra, mensaje] of malos) assert.throws(() => leerConfiguracionSupervisor(sup(pr, extra)), mensaje, JSON.stringify(extra));
});

test('etiquetas: espacios y vacíos', () => {
  assert.deepEqual(etiquetas(' a , b ,, c '), ['a', 'b', 'c']);
  assert.deepEqual(etiquetas(undefined), []);
});

test('modoSeguro: frontera por bits de grupo y otros', () => {
  const casos = [[0o400, true], [0o600, true], [0o700, true], [0o640, false], [0o604, false], [0o610, false], [0o644, false], [0o660, false], [0o777, false], [0o444, false], [0o440, false], [0o404, false]];
  for (const [modo, esperado] of casos) assert.equal(modoSeguro(modo), esperado, modo.toString(8));
});

test('leerPat (solo el supervisor): desde archivo 0400 no vacío; nunca por entorno; el error no filtra el PAT', () => {
  const io = (contenido = 'ghp_xxx\n', modo = 0o400) => ({ leer: () => contenido, modoDe: () => modo });
  assert.equal(leerPat({ RUNNER_PAT_FILE: '/run/secrets/pat' }, io()), 'ghp_xxx');
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x', GH_PAT: 'ghp_zzz' }, io()), /no puede venir por variable de entorno/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x', GH_RUNNER_PAT: 'ghp_zzz' }, io()), /no puede venir por variable de entorno/);
  assert.throws(() => leerPat({}, io()), /Falta RUNNER_PAT_FILE/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x' }, io('ghp', 0o644)), /legible por grupo u otros/);
  assert.throws(() => leerPat({ RUNNER_PAT_FILE: '/x' }, io('  \n')), /vacío/);
  try { leerPat({ RUNNER_PAT_FILE: '/x', GH_PAT: 'ghp_SECRETO' }, io()); } catch (e) { assert.ok(!e.message.includes('ghp_SECRETO')); }
});

test('exigirSinPat (contenedor del job): rechaza cualquier variante del PAT', () => {
  exigirSinPat({ PATH: '/bin', RUNNER_ROLE: 'pr' });
  for (const clave of ['GH_PAT', 'GH_RUNNER_PAT', 'RUNNER_PAT_FILE']) assert.throws(() => exigirSinPat({ [clave]: 'x' }), new RegExp(clave), clave);
  exigirSinPat({ GH_PAT: '   ' });
});

test('cuerpoJit: runner efímero de un job con las etiquetas del rol', () => {
  const c = leerConfiguracionSupervisor(sup(pr));
  assert.deepEqual(cuerpoJit(c, 'r-1'), { name: 'r-1', runner_group_id: 1, labels: ['self-hosted', 'platform-local', 'platform-pr'], work_folder: '_work' });
  assert.deepEqual(cuerpoJit(leerConfiguracionSupervisor(sup(deploy)), 'd').labels, ['self-hosted', 'platform-deploy']);
});

test('argumentosDockerRun: el contenedor de un job se destruye solo, no recibe PAT ni socket ni volúmenes ni privilegios', () => {
  const c = leerConfiguracionSupervisor(sup(pr));
  const args = argumentosDockerRun(c, { nombre: 'r-1-1-ab', jit: 'JITBASE64==' });
  const texto = args.join(' ');
  assert.equal(args[0], 'run');
  assert.ok(args.includes('--rm'), 'se destruye al terminar: nada persiste de un job al siguiente');
  assert.equal(args.at(-1), 'multistorefront-meli-runner:local');
  assert.equal(args[args.indexOf('--runtime') + 1], 'sysbox-runc');
  for (const prohibido of ['docker.sock', 'GH_PAT', 'GH_RUNNER_PAT', 'RUNNER_PAT_FILE']) assert.ok(!texto.includes(prohibido), `no debe contener ${prohibido}`);
  // Opciones que abrirían el contenedor al host: comparadas como argumentos completos (`--pids-limit` es legítima).
  for (const prohibido of ['--privileged', '-v', '--volume', '--mount', '--pid', '--network', '--net', '--cap-add', '--device', '--userns', '--ipc', '--security-opt', '--uts']) {
    assert.ok(!args.some((a) => a === prohibido || a.startsWith(`${prohibido}=`)), `no debe llevar ${prohibido}`);
  }
  assert.ok(args.includes('RUNNER_JIT_CONFIG=JITBASE64=='), 'lo único secreto es la configuración JIT de ese runner');
  assert.equal(args[args.indexOf('--memory') + 1], '6g');
  assert.equal(args[args.indexOf('--pids-limit') + 1], '4096');
  assert.equal(args[args.indexOf('--cpus') + 1], '2');
  assert.deepEqual(args.slice(args.indexOf('--add-host'), args.indexOf('--add-host') + 2), ['--add-host', 'host.docker.internal:127.0.0.1']);
  // El deploy no lleva add-host; cpus 0 = sin tope; el runtime se respeta.
  const d = argumentosDockerRun(leerConfiguracionSupervisor(sup(deploy, { RUNNER_CPU_LIMIT: '0', RUNNER_RUNTIME: 'kata' })), { nombre: 'd-1', jit: 'J' });
  assert.ok(!d.includes('--add-host') && !d.includes('--cpus'));
  assert.equal(d[d.indexOf('--runtime') + 1], 'kata');
  assert.ok(d.includes('RUNNER_LIMPIAR_STORE=1') === false, 'la limpieza del store la hace el contenedor nuevo vacío, no un flag');
});

test('argumentosDockerRun: entradas inválidas se rechazan (nombre con guion o espacio, JIT vacío o con espacios)', () => {
  const c = leerConfiguracionSupervisor(sup(pr));
  for (const nombre of ['', '-x', 'a b', 'a;b', 'x'.repeat(70)]) assert.throws(() => argumentosDockerRun(c, { nombre, jit: 'J' }), /Nombre/, nombre);
  for (const jit of ['', 'a b', undefined, 'a\nb']) assert.throws(() => argumentosDockerRun(c, { nombre: 'ok', jit }), /JIT/, String(jit));
});

test('nombreDeContenedor: único por ranura y sufijo', () => {
  const c = leerConfiguracionSupervisor(sup(pr));
  assert.equal(nombreDeContenedor(c, 2, 'ab12'), 'automation-platform-pr-2-ab12');
  assert.notEqual(nombreDeContenedor(c, 1, 'a'), nombreDeContenedor(c, 2, 'a'));
});
