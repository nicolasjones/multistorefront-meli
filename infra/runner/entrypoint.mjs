import { existsSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { argumentosConfig, entornoDelRunner, leerConfiguracion, leerPat } from '/config-runner.mjs';
import { restaurarBin } from '/restaurar-bin.mjs';

// MSF-703/704: este proceso (PID 1) corre como root SOLO para supervisar y leer el PAT del archivo de secretos; el listener y cada job
// corren como el usuario `runner` (uid/gid de RUNNER_UID/RUNNER_GID), sin el PAT en el entorno, sin socket del host y con runner efímero
// (un job y se descarta). Las reglas viven en `config-runner.mjs` (con pruebas); acá solo hay orquestación.
const config = leerConfiguracion(process.env);
const pat = leerPat(process.env, { leer: (ruta) => readFileSync(ruta, 'utf8'), modoDe: (ruta) => statSync(ruta).mode });
const entorno = entornoDelRunner(process.env);
const opcionesUsuario = { uid: config.uid, gid: config.gid, env: entorno, stdio: 'inherit' };
const nombre = `${config.nombreBase}-${hostname()}`;
const HOME = '/home/runner';
let configurado = false;
let deteniendo = false;
let hijo = null;

function ejecutar(comando, args, opciones = opcionesUsuario) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, args, { ...opciones, cwd: HOME });
    hijo = proceso;
    proceso.on('error', reject);
    proceso.on('close', (code) => { hijo = null; code === 0 ? resolve() : reject(new Error(`${path.basename(comando)} terminó con código ${code ?? 'desconocido'}.`)); });
  });
}

async function tokenDeRegistro() {
  const respuesta = await fetch(`https://api.github.com/repos/${config.repo}/actions/runners/registration-token`, {
    method: 'POST', headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' },
  });
  if (!respuesta.ok) throw new Error(`GitHub no emitió el token de registro (HTTP ${respuesta.status}).`);
  const token = (await respuesta.json()).token;
  if (!token) throw new Error('GitHub devolvió una respuesta sin token de registro.');
  return token;
}

async function desregistrar() {
  if (!configurado && !existsSync(path.join(HOME, '.runner'))) return;
  console.log('Desregistrando runner...');
  try { await ejecutar('./config.sh', ['remove', '--token', await tokenDeRegistro()]); } catch { /* La limpieza nunca bloquea el apagado. */ }
  configurado = false;
}

async function apagar() {
  deteniendo = true;
  if (hijo) hijo.kill('SIGTERM');
  await desregistrar();
  process.exit(0);
}
process.once('SIGINT', apagar); process.once('SIGTERM', apagar);

// Cada job arranca de un directorio de trabajo limpio; el rol deploy y RUNNER_LIMPIAR_STORE=1 también vacían el store de pnpm (MSF-704):
// lo que un job deja en disco no llega al siguiente.
function limpiarEntreJobs() {
  const vaciar = (directorio) => { try { for (const e of readdirSync(directorio)) rmSync(path.join(directorio, e), { recursive: true, force: true }); } catch { /* no existe todavía */ } };
  vaciar(path.join(HOME, '_work'));
  for (const archivo of ['.runner', '.credentials', '.credentials_rsaparams', '.gitconfig', '.npmrc']) rmSync(path.join(HOME, archivo), { force: true });
  // Credenciales que un job pudo dejar (docker login, claves y known_hosts de SSH): ningún job hereda las del anterior.
  for (const directorio of ['.docker', '.ssh']) vaciar(path.join(HOME, directorio));
  if (config.limpiarStore) { vaciar(path.join(HOME, '.pnpm-store')); vaciar(path.join(HOME, '.cache')); }
}

// Docker del propio contenedor (rol pr con runtime sysbox): un daemon que NO es el del host. Se espera el socket hasta 60 s.
async function iniciarDockerInterno() {
  console.log('Iniciando el daemon de Docker interno (sysbox)...');
  const demonio = spawn('dockerd', ['--host=unix:///var/run/docker.sock', `--group=${config.gid}`], { stdio: 'inherit' });
  demonio.on('close', (code) => { if (!deteniendo) { console.error(`dockerd terminó (${code}).`); process.exit(1); } });
  for (let i = 0; i < 120; i += 1) {
    if (existsSync('/var/run/docker.sock')) return;
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  throw new Error('El daemon de Docker interno no abrió su socket en 60 s: ¿el contenedor corre con el runtime sysbox?');
}

// El runner de GitHub se autoactualiza en el sitio: renombra `bin` a `bin.<version>` y recién
// después deja el `bin` nuevo. Si el contenedor se reinicia en medio de ese swap, `bin` queda AUSENTE y el
// runner no arranca (crash-loop; MSF-223/MSF-326). `restaurarBin` deja el runner como estaba antes.
try {
  const respaldo = restaurarBin(HOME);
  if (respaldo) console.log(`Se restauró 'bin' desde '${respaldo}' (autoactualización interrumpida a medias).`);
} catch (error) {
  console.error(`No se pudo restaurar 'bin': ${error instanceof Error ? error.message : String(error)}`);
}

try {
  if (config.dockerInterno) await iniciarDockerInterno();
  let fallosSeguidos = 0;
  while (!deteniendo) {
    const inicio = Date.now();
    limpiarEntreJobs();
    try {
      await ejecutar('./config.sh', argumentosConfig(config, await tokenDeRegistro(), nombre));
      configurado = true;
      await ejecutar('./run.sh', []);
      fallosSeguidos = 0;
    } catch (error) {
      if (deteniendo) break;
      console.error(error instanceof Error ? error.message : 'El runner no pudo iniciarse.');
      fallosSeguidos += 1;
      if (!config.efimero || fallosSeguidos >= 3) throw error;
      await new Promise((resolver) => setTimeout(resolver, 10_000));
    }
    if (!config.efimero) break;
    // Un ciclo efímero que termina en menos de 2 s sin haber tomado ningún job es un fallo silencioso: no girar en vacío.
    if (Date.now() - inicio < 2000) await new Promise((resolver) => setTimeout(resolver, 5000));
  }
  await desregistrar();
} catch (error) {
  await desregistrar();
  console.error(error instanceof Error ? error.message : 'El runner no pudo iniciarse.');
  process.exitCode = 1;
}
