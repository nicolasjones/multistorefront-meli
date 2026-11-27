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

export function analizarCompose(nombre, texto, rol) {
  const lineas = sinComentarios(texto);
  const hallazgos = [];
  const regla = (condicion, mensaje) => { if (condicion) hallazgos.push(`${nombre}: ${mensaje}`); };
  const todo = lineas.join('\n');
  regla(/docker\.sock/.test(todo), 'monta el socket de Docker del host (MSF-703): cada runner usa su daemon interno con sysbox.');
  regla(/(^|\n)\s*volumes:\s*\n\s*-/.test(todo) || /(^|\n)volumes:/.test(todo), 'declara volúmenes: el store de pnpm no se comparte ni persiste fuera del contenedor (MSF-704).');
  regla(/(^|\s)(GH_PAT|GH_RUNNER_PAT)\s*:/.test(todo), 'pasa el PAT por variable de entorno: los jobs lo heredan (MSF-703). Usá el secreto RUNNER_PAT_FILE.');
  regla(/^\s*privileged:\s*true/m.test(todo), 'privileged: true.');
  regla(/^\s*(pid|network_mode|ipc|userns_mode):\s*["']?host/m.test(todo), 'comparte un espacio de nombres con el host.');
  regla(/^\s*cap_add:/m.test(todo), 'cap_add: capacidades extra.');
  regla(valorDe(lineas, 'runtime') === undefined, 'sin `runtime:` (sysbox): el daemon interno quedaría con acceso real al host.');
  regla(valorDe(lineas, 'RUNNER_DOCKER_INTERNO') !== '1', 'RUNNER_DOCKER_INTERNO debe ser "1".');
  regla(valorDe(lineas, 'RUNNER_EPHEMERAL') !== '1', 'RUNNER_EPHEMERAL debe ser "1" (runner de un solo job).');
  regla(valorDe(lineas, 'RUNNER_PAT_FILE') !== '/run/secrets/gh_runner_pat', 'RUNNER_PAT_FILE debe apuntar al secreto de Compose.');
  regla(valorDe(lineas, 'RUNNER_ROLE') !== rol, `RUNNER_ROLE debe ser ${rol}.`);
  const etiquetas = (valorDe(lineas, 'RUNNER_LABELS') ?? '').split(',').map((e) => e.trim());
  if (rol === 'pr') {
    regla(!etiquetas.includes('platform-pr') || !etiquetas.includes('platform-local'), 'el pool de PR lleva platform-local y platform-pr.');
    regla(etiquetas.includes('platform-deploy'), 'el pool de PR no puede llevar platform-deploy.');
  } else {
    regla(!etiquetas.includes('platform-deploy'), 'el pool de deploy lleva platform-deploy.');
    regla(etiquetas.includes('platform-local') || etiquetas.includes('platform-pr'), 'el pool de deploy no puede llevar platform-local ni platform-pr: un job de PR caería en él (MSF-704).');
    regla(valorDe(lineas, 'RUNNER_LIMPIAR_STORE') !== '1', 'el pool de deploy vacía el store entre jobs (RUNNER_LIMPIAR_STORE=1).');
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
  if (!/chmod 0555 \/entrypoint\.mjs/.test(todo)) hallazgos.push('Dockerfile: los módulos del entrypoint deben quedar de solo lectura (0555).');
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
  console.log('Runners: usuario no root, sin socket del host, sin store compartido, PAT por archivo y pools separados.');
}
