import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} terminó con código ${code ?? 'desconocido'}.`)));
  });
}

const repository = required('RUNNER_REPO');
const pat = required('GH_PAT');
const runnerName = `${process.env.RUNNER_NAME || 'automation-platform-template-docker'}-${hostname()}`;
const labels = process.env.RUNNER_LABELS || 'self-hosted,platform-local';
let configured = false;

async function registrationToken() {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runners/registration-token`, {
    method: 'POST', headers: { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub no emitió el token de registro (HTTP ${response.status}).`);
  const token = (await response.json()).token;
  if (!token) throw new Error('GitHub devolvió una respuesta sin token de registro.');
  return token;
}

async function removeRegistration() {
  if (!configured && !existsSync('.runner')) return;
  console.log('Desregistrando runner...');
  try { await execute('./config.sh', ['remove', '--token', await registrationToken()]); } catch { /* La limpieza nunca bloquea el apagado. */ }
  configured = false;
}

const cleanup = async () => { await removeRegistration(); process.exit(0); };
process.once('SIGINT', cleanup); process.once('SIGTERM', cleanup);

try {
  if (existsSync('.runner')) {
    console.log('Registro previo sin desregistrar, limpiando...');
    await removeRegistration();
  }
  await execute('./config.sh', ['--url', `https://github.com/${repository}`, '--token', await registrationToken(), '--name', runnerName, '--work', '_work', '--labels', labels, '--unattended', '--replace']);
  configured = true;
  await execute('./run.sh', []);
  await removeRegistration();
} catch (error) {
  await removeRegistration();
  console.error(error instanceof Error ? error.message : 'El runner no pudo iniciarse.');
  process.exitCode = 1;
}
