// Prepara la verificación de la clave del host del VPS para el despliegue por `DOCKER_HOST=ssh://` (MSF-706).
// Antes el workflow hacía `ssh-keyscan -H "$VPS_SSH_HOST" >> ~/.ssh/known_hosts`: confiaba en lo que contestara la red en ese
// momento (primera conexión = confiar a ciegas), así que un intermediario podía quedarse con la clave de despliegue. Ahora la
// clave pública del host viene FIJADA y la conexión corre con `StrictHostKeyChecking=yes`:
//   1. el secret `VPS_SSH_KNOWN_HOSTS` del Environment (líneas de known_hosts), o
//   2. el archivo versionado `infra/vps/known_hosts.<entorno>` (las claves públicas de host no son secretas).
// Sin ninguna de las dos, el paso FALLA con instrucciones (no se cae a ssh-keyscan). Cómo obtener la línea correcta, fuera de
// banda: docs/deployment.md, «Clave de host del VPS».
//
// Uso: node scripts/preparar-known-hosts-vps.mjs --host <host> --entorno staging|production [--ssh-dir ~/.ssh]
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TIPOS = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;

// Devuelve las líneas válidas de known_hosts para `host`, o lanza con el motivo. No se aceptan marcadores (@revoked,
// @cert-authority) ni comodines: una sola clave por tipo, fijada a ESE host.
export function lineasValidas(contenido, host) {
  const validas = [];
  for (const cruda of String(contenido).split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const [patrones, tipo, clave, ...resto] = linea.split(/\s+/);
    if (patrones?.startsWith('@')) throw new Error(`known_hosts: no se admiten marcadores (${patrones}).`);
    if (!tipo || !TIPOS.test(tipo) || !clave || !/^[A-Za-z0-9+/=]{40,}$/.test(clave)) {
      throw new Error(`known_hosts: línea con formato inválido (${linea.slice(0, 40)}…).`);
    }
    if (/[*?!]/.test(patrones)) throw new Error('known_hosts: no se admiten comodines en el host.');
    const hosts = patrones.split(',');
    const coincide = hosts.some((h) => h === host || h === `[${host}]` || h.startsWith(`[${host}]:`) || h.startsWith('|1|'));
    if (!coincide) throw new Error(`known_hosts: la línea es de ${patrones} y se despliega a ${host}.`);
    validas.push(linea);
  }
  if (validas.length === 0) throw new Error('known_hosts: no hay ninguna clave de host.');
  return validas;
}

export async function preparar({ host, entorno, secreto, sshDir, raiz = process.cwd() }) {
  if (!host) throw new Error('Falta --host (VPS_SSH_HOST).');
  if (!['staging', 'production'].includes(entorno)) throw new Error('Uso: --entorno staging|production');
  let contenido = secreto?.trim() ? secreto : '';
  let origen = 'el secret VPS_SSH_KNOWN_HOSTS';
  if (!contenido) {
    const archivo = path.join(raiz, 'infra', 'vps', `known_hosts.${entorno}`);
    try {
      contenido = await readFile(archivo, 'utf8');
      origen = `infra/vps/known_hosts.${entorno}`;
    } catch {
      throw new Error(`No hay clave de host fijada para ${entorno}: definí el secret VPS_SSH_KNOWN_HOSTS del Environment o versioná infra/vps/known_hosts.${entorno}. No se usa ssh-keyscan (confiaría a ciegas en la red). Ver docs/deployment.md, «Clave de host del VPS».`);
    }
  }
  const lineas = lineasValidas(contenido, host);
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  const known = path.join(sshDir, 'known_hosts_vps');
  await writeFile(known, `${lineas.join('\n')}\n`, { mode: 0o600 });
  await chmod(known, 0o600);
  // `Host <host>` acota la política estricta a ESTE servidor y usa SOLO el archivo fijado.
  const config = path.join(sshDir, 'config');
  let previo = '';
  try { previo = await readFile(config, 'utf8'); } catch { /* sin config previa */ }
  const marca = '# vps-deploy (MSF-706)';
  const inicio = previo.indexOf(marca);
  const fin = previo.indexOf('# fin vps-deploy\n');
  const sinPrevio = inicio !== -1 && fin > inicio ? previo.slice(0, inicio) + previo.slice(fin + '# fin vps-deploy\n'.length) : previo;
  await writeFile(config, `${sinPrevio}${marca}\nHost ${host}\n  StrictHostKeyChecking yes\n  UserKnownHostsFile ${known}\n  GlobalKnownHostsFile /dev/null\n# fin vps-deploy\n`, { mode: 0o600 });
  return { origen, lineas: lineas.length, known, config };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const r = await preparar({ host: arg('--host'), entorno: arg('--entorno'), secreto: process.env.VPS_SSH_KNOWN_HOSTS, sshDir: arg('--ssh-dir') ?? path.join(os.homedir(), '.ssh') });
    console.log(`Clave de host del VPS fijada desde ${r.origen} (${r.lineas} línea(s)); StrictHostKeyChecking=yes.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
