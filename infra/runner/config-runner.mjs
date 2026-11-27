// Configuración y reglas de endurecimiento del runner (MSF-703, MSF-704). Vive aparte del `entrypoint.mjs` para probarse sin arrancar nada
// (ver `config-runner.test.mjs`). Todas las funciones son puras: reciben el entorno y devuelven datos.
//
// Dos roles, dos pools, nunca mezclados:
//   - `pr`:     ejecuta los jobs de PR y de CI. Etiquetas `self-hosted,platform-local,platform-pr`. Docker solo a través del daemon
//               INTERNO del propio contenedor (runtime sysbox): NUNCA el socket del host.
//   - `deploy`: ejecuta deploys, migraciones y publicación de imágenes a staging/producción (los jobs con `environment:`). Etiqueta
//               `platform-deploy` y NUNCA `platform-local` (si no, un job de PR podría caer acá). Su Docker (para construir imágenes) es
//               también el daemon interno sysbox; el resto de los deploys usan `DOCKER_HOST=ssh://` contra el VPS.
// Los dos: usuario no root para los jobs, runner `--ephemeral` (un job y se descarta), PAT fuera del entorno de los jobs.

export const ROLES = {
  pr: { requeridas: ['self-hosted', 'platform-local', 'platform-pr'], prohibidas: ['platform-deploy'] },
  deploy: { requeridas: ['self-hosted', 'platform-deploy'], prohibidas: ['platform-local', 'platform-pr'] },
};

// Variables que el contenedor recibe para registrarse pero que un job NO debe ver (el PAT emite tokens de registro = administración del repo).
export const VARIABLES_SECRETAS = ['GH_PAT', 'GH_RUNNER_PAT', 'RUNNER_PAT_FILE'];

export function etiquetas(texto) {
  return String(texto ?? '').split(',').map((e) => e.trim()).filter((e) => e !== '');
}

const NOMBRE_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;
const REPO_VALIDO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

// Lee y valida la configuración. Lanza con un mensaje claro ante cualquier combinación que rompa el aislamiento.
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
  const dockerInterno = env.RUNNER_DOCKER_INTERNO === '1';
  if ((env.RUNNER_DOCKER_SOCKET ?? '') !== '') throw new Error('El socket de Docker del host ya no se admite (MSF-703): usá RUNNER_DOCKER_INTERNO=1 con el runtime sysbox.');
  const nombreBase = (env.RUNNER_NAME ?? '').trim() || `automation-platform-${rol}`;
  if (!NOMBRE_VALIDO.test(nombreBase)) throw new Error('RUNNER_NAME solo admite letras, números, punto, guion y guion bajo (hasta 64).');
  const uid = Number(env.RUNNER_UID ?? 1001);
  const gid = Number(env.RUNNER_GID ?? 1001);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 1000 || gid < 1000) throw new Error('RUNNER_UID y RUNNER_GID deben ser enteros >= 1000 (los jobs no corren como root).');
  return {
    rol, repo, etiquetas: lista, nombreBase, uid, gid, dockerInterno,
    efimero: env.RUNNER_EPHEMERAL !== '0',
    limpiarStore: env.RUNNER_LIMPIAR_STORE === '1' || rol === 'deploy',
  };
}

// El PAT viene de un archivo (secreto de Compose) y no se acepta legible por el grupo ni por otros: un job que corre como otro usuario
// podría leerlo. `GH_PAT` por entorno se rechaza: queda en /proc/1/environ y en el entorno heredado.
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

export function argumentosConfig(cfg, tokenRegistro, nombre) {
  return [
    '--url', `https://github.com/${cfg.repo}`, '--token', tokenRegistro, '--name', nombre, '--work', '_work',
    '--labels', cfg.etiquetas.join(','), '--unattended', '--replace', ...(cfg.efimero ? ['--ephemeral'] : []),
  ];
}

// Entorno con el que corre el listener (y por herencia, cada step de cada job): sin el PAT ni sus variantes.
export function entornoDelRunner(env) {
  const limpio = {};
  for (const [clave, valor] of Object.entries(env)) if (!VARIABLES_SECRETAS.includes(clave) && valor !== undefined) limpio[clave] = valor;
  return { ...limpio, HOME: '/home/runner', USER: 'runner', LOGNAME: 'runner', RUNNER_ALLOW_RUNASROOT: undefined };
}
