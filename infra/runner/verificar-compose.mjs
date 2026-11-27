// Guard del endurecimiento de los runners (MSF-703, MSF-704): los Compose y el Dockerfile de infra/runner no pueden volver a montar el socket
// de Docker del host, compartir el store de pnpm, pasar el PAT por entorno, correr privilegiados ni mezclar las etiquetas de los pools.
// Uso: node infra/runner/verificar-compose.mjs (desde la raíz). Sale 1 con la lista de hallazgos.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sinComentarios = (texto) => texto.split('\n').map((l) => (l.trimStart().startsWith('#') ? '' : l.replace(/\s+#.*$/, '')));

function valorDe(lineas, clave) {
  for (const l of lineas) {
    const m = new RegExp(`^\\s*${clave}:\\s*(.*?)\\s*$`).exec(l);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

// Bloque (líneas) de un servicio de primer nivel `  nombre:` dentro de `services:`; null si no existe.
function bloqueDeServicio(lineas, nombre) {
  const i = lineas.findIndex((l) => new RegExp(`^ {2}${nombre}:\\s*$`).test(l));
  if (i === -1) return null;
  let j = i + 1;
  while (j < lineas.length && (lineas[j] === '' || /^ {3,}/.test(lineas[j]))) j += 1;
  return { desde: i, hasta: j, lineas: lineas.slice(i, j) };
}

// Arquitectura nueva (revisión C+S del lote 99): el Compose solo levanta el SUPERVISOR; los contenedores de los jobs los crea él con `docker run
// --rm` (argumentosDockerRun, probado aparte). El único lugar donde puede aparecer el socket de Docker es el supervisor.
export function analizarCompose(nombre, texto, rol) {
  const lineas = sinComentarios(texto);
  const hallazgos = [];
  const regla = (condicion, mensaje) => { if (condicion) hallazgos.push(`${nombre}: ${mensaje}`); };
  const inicioServicios = lineas.findIndex((l) => /^services:\s*$/.test(l));
  let finServicios = inicioServicios + 1;
  while (inicioServicios !== -1 && finServicios < lineas.length && (lineas[finServicios] === '' || /^\s/.test(lineas[finServicios]))) finServicios += 1;
  const servicios = inicioServicios === -1 ? [] : lineas.slice(inicioServicios + 1, finServicios).filter((l) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l)).map((l) => l.trim().slice(0, -1));
  const superv = bloqueDeServicio(lineas, 'supervisor');
  regla(!superv || servicios.length !== 1, 'el único servicio es `supervisor`: los contenedores de los jobs los crea él, uno nuevo por job.');
  const fuera = superv ? [...lineas.slice(0, superv.desde), ...lineas.slice(superv.hasta)].join('\n') : lineas.join('\n');
  const dentro = superv ? superv.lineas.join('\n') : '';
  const todo = lineas.join('\n');
  regla(/docker\.sock/.test(fuera), 'el socket de Docker del host solo puede estar en el supervisor (MSF-703).');
  regla(/docker\.sock/.test(dentro.replace('- /var/run/docker.sock:/var/run/docker.sock', '')), 'el socket de Docker del host solo puede estar en el supervisor, y solo como volumen (MSF-703).');
  const volumenes = (dentro.match(/^ {4}volumes:\s*\n((?: {6}- .*\n?)+)/m)?.[1] ?? '').split('\n').filter(Boolean).map((l) => l.replace(/^ {6}- /, '').replace(/^["']|["']$/g, ''));
  regla(volumenes.some((v) => v !== '/var/run/docker.sock:/var/run/docker.sock'), 'el supervisor solo monta el socket de Docker: ningún otro volumen (MSF-704).');
  regla(/(^|\n)volumes:/.test(todo), 'declara volúmenes de primer nivel: no se comparte nada entre jobs (MSF-704).');
  regla(/(^|\s)(GH_PAT|GH_RUNNER_PAT)\s*:/.test(todo), 'pasa el PAT por variable de entorno (MSF-703). Usá el secreto RUNNER_PAT_FILE.');
  regla(/^\s*privileged:\s*true/m.test(todo), 'privileged: true.');
  regla(/^\s*(pid|network_mode|ipc|userns_mode):\s*["']?host/m.test(todo), 'comparte un espacio de nombres con el host.');
  regla(/^\s*cap_add:/m.test(todo), 'cap_add: capacidades extra.');
  regla(/^\s*devices:/m.test(todo), 'devices: el supervisor no necesita dispositivos del host.');
  regla(/(seccomp|apparmor)[=:]\s*unconfined/.test(todo), 'desactiva seccomp o apparmor.');
  regla(!/^ {4}read_only:\s*true\s*$/m.test(dentro), 'el supervisor debe ser de solo lectura (read_only: true).');
  regla(!/^ {4}cap_drop:\s*\[ALL\]\s*$/m.test(dentro), 'el supervisor debe soltar todas las capacidades (cap_drop: [ALL]).');
  regla(!/no-new-privileges:true/.test(dentro), 'el supervisor debe llevar no-new-privileges:true.');
  regla(!/^ {6}RUNNER_JOBS_NETWORK:\s*\$\{RUNNER_JOBS_NETWORK_[A-Z]+:-platform-runner-jobs-(pr|deploy)\}\s*$/m.test(dentro), 'falta la red DEDICADA de los jobs (RUNNER_JOBS_NETWORK con por defecto platform-runner-jobs-<rol>): nunca docker0.');
  regla(!/^ {6}RUNNER_JOBS_BRIDGE:\s*\$\{RUNNER_JOBS_BRIDGE_[A-Z]+:-br-jobs-(pr|deploy)\}\s*$/m.test(dentro), 'falta el nombre FIJO del puente de la red de jobs (RUNNER_JOBS_BRIDGE): el firewall filtra por interfaz, no solo por IP.');
  regla(!/^ {6}RUNNER_JOBS_DNS:\s*\$\{RUNNER_JOBS_DNS:-[0-9.,]+\}\s*$/m.test(dentro), 'falta RUNNER_JOBS_DNS (resolvedores públicos de los jobs: el firewall descarta las redes privadas).');
  regla(valorDe(lineas, 'DOCKER_CONFIG') !== '/tmp/.docker', 'DOCKER_CONFIG debe apuntar al tmpfs (el supervisor es de solo lectura).');
  regla(!/^ {6}RUNNER_JOBS_SUBNET:\s*\$\{RUNNER_JOBS_SUBNET_[A-Z]+:-172\.29\.25[01]\.0\/24\}\s*$/m.test(dentro), 'falta la subred fija de los jobs (RUNNER_JOBS_SUBNET).');
  regla(valorDe(lineas, 'entrypoint') !== '["node", "/supervisor.mjs"]', 'el entrypoint del servicio debe ser el supervisor.');
  regla(valorDe(lineas, 'RUNNER_RUNTIME') !== '${RUNNER_RUNTIME:-sysbox-runc}', 'RUNNER_RUNTIME debe tener por defecto sysbox-runc (sin sysbox no hay modo inseguro).');
  regla(valorDe(lineas, 'RUNNER_DOCKER_INTERNO') !== '1', 'RUNNER_DOCKER_INTERNO debe ser "1" (el job usa su propio daemon, no el del host).');
  regla(valorDe(lineas, 'RUNNER_PAT_FILE') !== '/run/secrets/gh_runner_pat', 'RUNNER_PAT_FILE debe apuntar al secreto de Compose.');
  regla(valorDe(lineas, 'RUNNER_IMAGE') === undefined, 'falta RUNNER_IMAGE: imagen con la que el supervisor crea los contenedores de los jobs.');
  regla(valorDe(lineas, 'RUNNER_ROLE') !== rol, `RUNNER_ROLE debe ser ${rol}.`);
  const etiquetas = (valorDe(lineas, 'RUNNER_LABELS') ?? '').split(',').map((e) => e.trim());
  if (rol === 'pr') {
    regla(!etiquetas.includes('platform-pr') || !etiquetas.includes('platform-local'), 'el pool de PR lleva platform-local y platform-pr.');
    regla(etiquetas.includes('platform-deploy'), 'el pool de PR no puede llevar platform-deploy.');
  } else {
    regla(!etiquetas.includes('platform-deploy'), 'el pool de deploy lleva platform-deploy.');
    regla(etiquetas.includes('platform-local') || etiquetas.includes('platform-pr'), 'el pool de deploy no puede llevar platform-local ni platform-pr: un job de PR caería en él (MSF-704).');
  }
  return hallazgos;
}

export function analizarDockerfile(texto) {
  const lineas = sinComentarios(texto);
  const todo = lineas.join('\n');
  const hallazgos = [];
  if (/RUNNER_ALLOW_RUNASROOT/.test(todo)) hallazgos.push('Dockerfile: RUNNER_ALLOW_RUNASROOT: el runner no puede correr como root (MSF-703).');
  if (!/useradd[^\n]*\brunner\b/.test(todo)) hallazgos.push('Dockerfile: falta crear el usuario `runner`.');
  if (!/chown -R runner:runner \/home\/runner/.test(todo)) hallazgos.push('Dockerfile: /home/runner debe pertenecer al usuario runner.');
  if (/\/root\/\.docker/.test(todo)) hallazgos.push('Dockerfile: los plugins de Docker van en el directorio del sistema, no en /root.');
  if (!/chmod 0555 \/entrypoint\.mjs \/supervisor\.mjs/.test(todo)) hallazgos.push('Dockerfile: los módulos del entrypoint y del supervisor deben quedar de solo lectura (0555).');
  if ((todo.match(/--no-same-owner/g) ?? []).length < 2) hallazgos.push('Dockerfile: los binarios extraídos (scout, supabase) deben quedar de root (--no-same-owner): si no, el usuario runner podría reemplazarlos.');
  return hallazgos;
}

export function analizarRaiz(raiz) {
  const leer = (f) => readFileSync(path.join(raiz, 'infra', 'runner', f), 'utf8');
  return [
    ...analizarCompose('infra/runner/compose.yaml', leer('compose.yaml'), 'pr'),
    ...analizarCompose('infra/runner/compose.deploy.yaml', leer('compose.deploy.yaml'), 'deploy'),
    ...analizarDockerfile(leer('Dockerfile')),
  ];
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const hallazgos = analizarRaiz(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  for (const h of hallazgos) console.error(h);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Runners: supervisor con PAT, un contenedor nuevo por job sin socket del host ni volúmenes, y pools separados.');
}
