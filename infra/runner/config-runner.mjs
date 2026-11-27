// Configuración y reglas de endurecimiento del runner (MSF-703, MSF-704). Vive aparte para probarse sin arrancar nada
// (ver `config-runner.test.mjs`). Todas las funciones son puras: reciben el entorno y devuelven datos.
//
// ARQUITECTURA (revisión C+S del lote 99, A1 y A2): hay DOS tipos de contenedor y el PAT solo existe en el primero.
//   - SUPERVISOR (`supervisor.mjs`, Compose `compose.yaml`/`compose.deploy.yaml`): lee el PAT del archivo de secretos, pide a GitHub una
//     configuración JIT (de un solo uso, atada a UN runner) y lanza un contenedor NUEVO por job con `docker run --rm`. Nunca ejecuta
//     código de un job. Es el único con el socket de Docker del host y el único que ve el PAT.
//   - CONTENEDOR DEL JOB (`entrypoint.mjs`): recibe solo la configuración JIT, corre UN job como usuario no root y termina; el supervisor lo
//     destruye (`--rm`). No hay PAT, ni socket del host, ni estado que pase de un job al siguiente (imágenes, procesos, archivos).
//
// Dos roles, dos pools:
//   - `pr`:     jobs de PR y de CI. Etiquetas `self-hosted,platform-local,platform-pr`.
//   - `deploy`: jobs con `environment:` y release. Etiqueta `platform-deploy` y NUNCA `platform-local`.
// La separación de pools NO es un límite de confianza frente a un workflow modificado: en un PR GitHub usa el workflow del propio PR y este
// puede pedir cualquier `runs-on`. Lo que protege los secretos de producción es (1) que viven en Environments de GitHub restringidos a ramas
// protegidas (un job de PR no los recibe aunque caiga en un runner de deploy) y (2) que cada job corre en un contenedor que se destruye al
// terminar (aunque un PR caiga en el pool de deploy, no deja nada para el próximo deploy). Ver docs/endurecimiento-infra.md.

export const ROLES = {
  pr: { requeridas: ['self-hosted', 'platform-local', 'platform-pr'], prohibidas: ['platform-deploy'] },
  deploy: { requeridas: ['self-hosted', 'platform-deploy'], prohibidas: ['platform-local', 'platform-pr'] },
};

// Variables que el contenedor de un JOB no puede recibir nunca (el PAT emite tokens de registro = administración del repo).
export const VARIABLES_SECRETAS = ['GH_PAT', 'GH_RUNNER_PAT', 'RUNNER_PAT_FILE'];

export function etiquetas(texto) {
  return String(texto ?? '').split(',').map((e) => e.trim()).filter((e) => e !== '');
}

const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REPO_VALIDO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const IMAGEN_VALIDA = /^[a-z0-9][a-z0-9._/-]{0,120}(:[A-Za-z0-9._-]{1,128})?$/;
const RUNTIME_VALIDO = /^[a-z0-9][a-z0-9-]{0,40}$/;
const IPV4_VALIDA = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const RED_VALIDA = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
// Redes que NO se pueden usar para los jobs: la de por defecto de Docker (docker0, con ICC y alcance al host), la del host y ninguna.
const REDES_PROHIBIDAS = new Set(['host', 'bridge', 'none', 'default']);
// Subred IPv4 en notación CIDR (24 o más específica es lo razonable para un pool de jobs; se acepta /16 a /30).
const SUBRED_VALIDA = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export function subredValida(texto) {
  const m = SUBRED_VALIDA.exec(String(texto));
  if (!m) return false;
  const octetos = m.slice(1, 5).map(Number);
  const mascara = Number(m[5]);
  return octetos.every((o) => o <= 255) && mascara >= 16 && mascara <= 30;
}

// Lee y valida la configuración común. Lanza con un mensaje claro ante cualquier combinación que rompa el aislamiento.
export function leerConfiguracion(env) {
  const rol = (env.RUNNER_ROLE ?? '').trim();
  if (!Object.hasOwn(ROLES, rol)) throw new Error('RUNNER_ROLE debe ser «pr» o «deploy».');
  const reglas = ROLES[rol];
  const repo = (env.RUNNER_REPO ?? '').trim();
  if (!REPO_VALIDO.test(repo)) throw new Error('RUNNER_REPO debe tener la forma owner/repo.');
  const lista = etiquetas(env.RUNNER_LABELS);
  const faltan = reglas.requeridas.filter((e) => !lista.includes(e));
  if (faltan.length > 0) throw new Error(`El rol ${rol} exige las etiquetas ${reglas.requeridas.join(', ')} (faltan: ${faltan.join(', ')}).`);
  const sobran = reglas.prohibidas.filter((e) => lista.includes(e));
  if (sobran.length > 0) throw new Error(`El rol ${rol} no puede llevar las etiquetas ${sobran.join(', ')}: mezclaría el pool de PR con el de deploy.`);
  if ((env.RUNNER_DOCKER_SOCKET ?? '') !== '') throw new Error('El socket de Docker del host ya no se admite en el contenedor de un job (MSF-703): usá RUNNER_DOCKER_INTERNO=1 con el runtime sysbox.');
  const nombreBase = (env.RUNNER_NAME ?? '').trim() || `automation-platform-${rol}`;
  if (!NOMBRE_VALIDO.test(nombreBase)) throw new Error('RUNNER_NAME solo admite letras, números, punto, guion y guion bajo (hasta 64) y no puede empezar con guion.');
  const uid = Number(env.RUNNER_UID ?? 1001);
  const gid = Number(env.RUNNER_GID ?? 1001);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 1000 || gid < 1000) throw new Error('RUNNER_UID y RUNNER_GID deben ser enteros >= 1000 (los jobs no corren como root).');
  return { rol, repo, etiquetas: lista, nombreBase, uid, gid, dockerInterno: env.RUNNER_DOCKER_INTERNO === '1' };
}

// El contenedor de un JOB no puede recibir el PAT por ningún medio.
export function exigirSinPat(env) {
  for (const clave of VARIABLES_SECRETAS) {
    if ((env[clave] ?? '').trim() !== '') throw new Error(`El contenedor de un job no puede recibir ${clave}: el PAT vive solo en el supervisor (A1).`);
  }
}

// ---- Supervisor ----

const entero = (valor, minimo, maximo, nombre) => {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) throw new Error(`${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
  return n;
};

export function leerConfiguracionSupervisor(env) {
  const base = leerConfiguracion(env);
  const imagen = (env.RUNNER_IMAGE ?? '').trim();
  if (!IMAGEN_VALIDA.test(imagen)) throw new Error('RUNNER_IMAGE es obligatoria y debe ser una referencia de imagen válida.');
  const runtime = (env.RUNNER_RUNTIME ?? 'sysbox-runc').trim();
  if (!RUNTIME_VALIDO.test(runtime)) throw new Error('RUNNER_RUNTIME inválido.');
  const cpus = Number(env.RUNNER_CPU_LIMIT ?? 2);
  if (!Number.isFinite(cpus) || cpus < 0 || cpus > 128) throw new Error('RUNNER_CPU_LIMIT debe ser un número entre 0 y 128 (0 = sin tope).');
  const memoria = (env.RUNNER_MEMORY_LIMIT ?? '6g').trim();
  if (!/^[1-9][0-9]{0,5}[mg]$/.test(memoria)) throw new Error('RUNNER_MEMORY_LIMIT debe ser un número con sufijo m o g (por ejemplo 6g).');
  // Red DEDICADA de los jobs (revisión C+S del #1238, A-1): subred FIJA distinta de docker0 y sin comunicación entre contenedores (ICC off), para
  // que el firewall pueda tratarla distinta (infra/vps/firewall-docker-user.sh, --subred-jobs-pr / --subred-jobs-deploy).
  const red = (env.RUNNER_JOBS_NETWORK ?? `platform-runner-jobs-${base.rol}`).trim();
  if (!RED_VALIDA.test(red) || REDES_PROHIBIDAS.has(red)) throw new Error('RUNNER_JOBS_NETWORK inválida: no puede ser host, bridge, none ni default.');
  // Nombre FIJO del puente de la red (com.docker.network.bridge.name): el firewall filtra por interfaz de entrada, no solo por IP (un job puede falsificar el
  // origen). Linux limita los nombres de interfaz a 15 caracteres.
  const puente = (env.RUNNER_JOBS_BRIDGE ?? `br-jobs-${base.rol}`).trim();
  if (!/^[a-z][a-z0-9-]{0,14}$/.test(puente) || puente === 'docker0') throw new Error('RUNNER_JOBS_BRIDGE inválido: hasta 15 caracteres [a-z0-9-], sin empezar con guion y distinto de docker0.');
  // Resolvedores DNS de los jobs: las reglas del firewall descartan las redes privadas, así que si el resolvedor del host fuera privado los jobs perderían DNS.
  const dns = etiquetas(env.RUNNER_JOBS_DNS ?? '1.1.1.1,8.8.8.8');
  if (dns.length === 0 || dns.length > 3 || dns.some((ip) => !IPV4_VALIDA.test(ip) || ip.split('.').some((o) => Number(o) > 255))) throw new Error('RUNNER_JOBS_DNS debe ser una lista de 1 a 3 direcciones IPv4 separadas por coma.');
  const subred = (env.RUNNER_JOBS_SUBNET ?? (base.rol === 'pr' ? '172.29.250.0/24' : '172.29.251.0/24')).trim();
  if (!subredValida(subred)) throw new Error('RUNNER_JOBS_SUBNET debe ser una subred IPv4 CIDR (/16 a /30), por ejemplo 172.29.250.0/24.');
  return {
    ...base,
    imagen, runtime, cpus, memoria, red, subred, puente, dns,
    slots: entero(env.RUNNER_SLOTS ?? 1, 0, 32, 'RUNNER_SLOTS'),
    pids: entero(env.RUNNER_PIDS_LIMIT ?? 4096, 64, 4_000_000, 'RUNNER_PIDS_LIMIT'),
    pnpmConcurrencia: entero(env.RUNNER_PNPM_NETWORK_CONCURRENCY ?? 16, 1, 64, 'RUNNER_PNPM_NETWORK_CONCURRENCY'),
  };
}

// El PAT viene de un archivo (secreto de Compose) legible solo por root. `GH_PAT` por entorno se rechaza.
export function modoSeguro(modo) {
  return (modo & 0o077) === 0;
}

export function leerPat(env, { leer, modoDe }) {
  if ((env.GH_PAT ?? '').trim() !== '' || (env.GH_RUNNER_PAT ?? '').trim() !== '') {
    throw new Error('El PAT no puede venir por variable de entorno (GH_PAT/GH_RUNNER_PAT): usá RUNNER_PAT_FILE con un secreto de Compose.');
  }
  const archivo = (env.RUNNER_PAT_FILE ?? '').trim();
  if (archivo === '') throw new Error('Falta RUNNER_PAT_FILE (ruta del secreto con el PAT del runner).');
  if (!modoSeguro(modoDe(archivo))) throw new Error('El archivo del PAT es legible por grupo u otros: dejalo en 0400 y de root.');
  const pat = leer(archivo).trim();
  if (pat === '') throw new Error('El archivo del PAT está vacío.');
  return pat;
}

// Un runner JIT no hereda las etiquetas de sistema operativo y arquitectura: se envían explícitas junto con las del rol (los workflows eligen por
// `platform-*`, así que agregarlas no cambia a qué jobs responde). NO probado de punta a punta contra GitHub (ver docs/endurecimiento-infra.md).
export const ETIQUETAS_SISTEMA = ['Linux', 'X64'];

// Cuerpo de `POST /repos/{repo}/actions/runners/generate-jitconfig`: un runner efímero, de un solo job.
export function cuerpoJit(cfg, nombre) {
  const etiquetasJit = [...cfg.etiquetas, ...ETIQUETAS_SISTEMA.filter((e) => !cfg.etiquetas.includes(e))];
  return { name: nombre, runner_group_id: 1, labels: etiquetasJit, work_folder: '_work' };
}

// Argumentos de `docker run` del contenedor de UN job. Invariantes (cubiertas por tests): `--rm` (se destruye al terminar), en la red DEDICADA de jobs
// (nunca host/bridge), sin volúmenes, sin socket del host, sin `--privileged`, sin namespaces del host, sin PAT, y la configuración JIT NO va en el
// argv (se pasa como `-e RUNNER_JIT_CONFIG` sin valor y se toma del entorno del proceso `docker`: no aparece en `ps`).
export function argumentosDockerRun(cfg, { nombre, jit }) {
  if (!NOMBRE_VALIDO.test(nombre)) throw new Error('Nombre de contenedor inválido.');
  if (typeof jit !== 'string' || jit === '' || /\s/.test(jit)) throw new Error('Configuración JIT inválida.');
  const env = {
    RUNNER_ROLE: cfg.rol, RUNNER_REPO: cfg.repo, RUNNER_LABELS: cfg.etiquetas.join(','), RUNNER_UID: String(cfg.uid), RUNNER_GID: String(cfg.gid),
    RUNNER_DOCKER_INTERNO: cfg.dockerInterno ? '1' : '0', RUNNER_DISABLE_AUTO_UPDATE: '1',
    pnpm_config_store_dir: '/home/runner/.pnpm-store', pnpm_config_cache_dir: '/home/runner/.cache/pnpm',
    pnpm_config_network_concurrency: String(cfg.pnpmConcurrencia), pnpm_config_fetch_retries: '5', pnpm_config_fetch_timeout: '600000',
  };
  const args = [
    'run', '--rm', '--init', '--name', nombre, '--label', 'platform-runner=1', '--label', `platform-runner-rol=${cfg.rol}`,
    '--network', cfg.red,
    ...cfg.dns.flatMap((ip) => ['--dns', ip]),
    '--runtime', cfg.runtime, '--memory', cfg.memoria, '--pids-limit', String(cfg.pids),
    ...(cfg.cpus > 0 ? ['--cpus', String(cfg.cpus)] : []),
    // Con el stack de Supabase del job en el daemon interno, host.docker.internal es el loopback del propio contenedor.
    ...(cfg.rol === 'pr' ? ['--add-host', 'host.docker.internal:127.0.0.1'] : []),
  ];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push('-e', 'RUNNER_JIT_CONFIG');
  args.push(cfg.imagen);
  return args;
}

// Entorno del proceso `docker` que lanza el job: lleva la configuración JIT (la única credencial del job) fuera del argv.
export function entornoDockerRun(jit, base = process.env) {
  return { ...base, RUNNER_JIT_CONFIG: jit };
}

// Argumentos para crear la red dedicada de jobs: subred FIJA, nombre de puente FIJO y sin comunicación entre contenedores (ICC desactivado).
export function argumentosCrearRed(cfg) {
  return ['network', 'create', '--driver', 'bridge', '--subnet', cfg.subred, '-o', 'com.docker.network.bridge.enable_icc=false', '-o', `com.docker.network.bridge.name=${cfg.puente}`, '--label', 'platform-runner=1', cfg.red];
}

// Un nombre de contenedor único por ciclo: sin reutilizar nunca el de un contenedor anterior.
export function nombreDeContenedor(cfg, ranura, sufijo) {
  return `${cfg.nombreBase}-${ranura}-${sufijo}`;
}
