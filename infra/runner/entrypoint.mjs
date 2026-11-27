import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { exigirSinPat, leerConfiguracion } from './config-runner.mjs';
import { restaurarBin } from './restaurar-bin.mjs';

// CONTENEDOR DE UN JOB (MSF-703/704, A1/A2). Lo lanza el supervisor con `docker run --rm` y recibe SOLO una configuración JIT de un solo uso
// (RUNNER_JIT_CONFIG). Este proceso (PID 1) es root solo para iniciar el daemon de Docker interno; el listener y el job corren como `runner`.
// Hace UN job y termina: el contenedor se destruye, así que no queda nada (imágenes, procesos, archivos) para el job siguiente.
// No hay PAT en este contenedor: si llegara uno por entorno, se rechaza.
const HOME = '/home/runner';
exigirSinPat(process.env);
const config = leerConfiguracion(process.env);
const jit = (process.env.RUNNER_JIT_CONFIG ?? '').trim();
if (jit === '' || /\s/.test(jit)) throw new Error('Falta RUNNER_JIT_CONFIG (la configuración JIT del runner).');

// El listener (y por herencia cada step) no recibe ni la configuración JIT: ya la tiene el listener por argumento.
const entorno = { ...process.env, HOME, USER: 'runner', LOGNAME: 'runner' };
delete entorno.RUNNER_JIT_CONFIG;
delete entorno.RUNNER_ALLOW_RUNASROOT;

function ejecutar(comando, args) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, args, { uid: config.uid, gid: config.gid, env: entorno, stdio: 'inherit', cwd: HOME });
    proceso.on('error', reject);
    proceso.on('close', (codigo) => resolve(codigo ?? 1));
  });
}

// Docker del propio contenedor (runtime sysbox): un daemon que NO es el del host. Se espera el socket hasta 60 s.
async function iniciarDockerInterno() {
  console.log('Iniciando el daemon de Docker interno (sysbox)...');
  const demonio = spawn('dockerd', ['--host=unix:///var/run/docker.sock', `--group=${config.gid}`], { stdio: 'inherit' });
  demonio.on('close', (codigo) => { console.error(`dockerd terminó (${codigo}).`); process.exit(1); });
  for (let i = 0; i < 120; i += 1) {
    if (existsSync('/var/run/docker.sock')) return;
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  throw new Error('El daemon de Docker interno no abrió su socket en 60 s: ¿el contenedor corre con el runtime sysbox?');
}

try {
  const respaldo = restaurarBin(HOME);
  if (respaldo) console.log(`Se restauró 'bin' desde '${respaldo}'.`);
} catch (error) {
  console.error(`No se pudo restaurar 'bin': ${error instanceof Error ? error.message : String(error)}`);
}

try {
  if (config.dockerInterno) await iniciarDockerInterno();
  // `run.sh --jitconfig`: el runner se registra con la configuración JIT, toma UN job y sale (el runner JIT es efímero).
  const codigo = await ejecutar(path.join(HOME, 'run.sh'), ['--jitconfig', jit]);
  process.exit(codigo);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'El runner no pudo iniciarse.');
  process.exit(1);
}
