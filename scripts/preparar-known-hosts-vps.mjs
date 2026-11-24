// Prepara la verificación de la clave del host del VPS para el despliegue por `DOCKER_HOST=ssh://` (MSF-706).
// Antes el workflow hacía `ssh-keyscan -H "$VPS_SSH_HOST" >> ~/.ssh/known_hosts`: confiaba en lo que contestara la red en ese
// momento (primera conexión = confiar a ciegas), así que un intermediario podía quedarse con la clave de despliegue. Ahora la
// clave pública del host viene FIJADA y la conexión corre con `StrictHostKeyChecking=yes`:
//   1. el secret `VPS_SSH_KNOWN_HOSTS` del Environment (líneas de known_hosts), o
//   2. el archivo versionado `infra/vps/known_hosts.<entorno>` (las claves públicas de host no son secretas).
// Sin ninguna de las dos, el paso FALLA con instrucciones (no se cae a ssh-keyscan). Cómo obtener la línea correcta, fuera de
// banda: docs/deployment.md, «Clave de host del VPS».
//
// Uso: node scripts/preparar-known-hosts-vps.mjs --host <host> --entorno dev|staging|production [--ssh-dir ~/.ssh] [--env-file <.env del entorno>]
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIPv6 } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { modoEstricto } from './preflight-deploy-vps.mjs';

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

// Modo transicional (MSF-706): staging y producción son SIEMPRE estrictos; en `dev` la falta de clave fijada advierte y se usa
// `StrictHostKeyChecking=accept-new` (confía en la primera clave y falla si luego cambia) hasta que VPS_ESTRICTO=1.
// Misma regla que el preflight (`modoEstricto`): la variable del proceso manda y, si no está, se lee VPS_ESTRICTO del `.env` del
// entorno (`contenidoEnv`, opcional: la CLI lo toma de `--env-file`).
export function esEstricto(entorno, env = process.env, contenidoEnv = '') {
  return modoEstricto(entorno, env, contenidoEnv);
}

const MARCA = '# vps-deploy (MSF-706)';
const FIN = '# fin vps-deploy\n';

// Lista segura: un nombre DNS o IPv4 (letras, números, puntos, guiones y guiones bajos; no empieza con `-` ni `.`: sería una opción de
// ssh) o una IPv6 válida, con o sin corchetes (`[2001:db8::1]`). Devuelve el host SIN corchetes (así lo escribe known_hosts y así lo
// compara `Host` en el config). Nunca espacios, saltos de línea, comodines (`* ? !`), comas ni otros caracteres de configuración SSH.
export function validarHost(host) {
  const error = () => new Error('--host solo admite un nombre (letras, números, puntos, guiones y guiones bajos) o una IPv6, con o sin corchetes (sin espacios ni saltos de línea).');
  if (typeof host !== 'string') throw error();
  const sinCorchetes = /^\[[^\]]*\]$/.test(host) ? host.slice(1, -1) : host;
  if (isIPv6(sinCorchetes) && !sinCorchetes.includes('%')) return sinCorchetes;
  if (sinCorchetes !== host || !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(host)) throw error();
  return host;
}

// SSH usa la PRIMERA coincidencia de cada opción: el bloque va AL PRINCIPIO de ~/.ssh/config, así un `Host *` previo (p. ej. en un runner
// persistente, con `StrictHostKeyChecking no`) no lo anula.
function bloqueSsh(host, modo, known) {
  // `host` va a una línea `Host <host>` del config: solo un nombre o IP, nunca espacios, comodines ni saltos de línea.
  host = validarHost(host);
  return `${MARCA}\nHost ${host}\n  StrictHostKeyChecking ${modo}\n  UserKnownHostsFile ${known}\n  GlobalKnownHostsFile /dev/null\n${FIN}`;
}

function quitarBloque(previo) {
  const inicio = previo.indexOf(MARCA);
  const fin = previo.indexOf(FIN);
  return inicio !== -1 && fin > inicio ? previo.slice(0, inicio) + previo.slice(fin + FIN.length) : previo;
}

async function sinClaveFijada({ host, sshDir, entorno }) {
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  const known = path.join(sshDir, 'known_hosts_vps');
  await writeFile(known, '', { mode: 0o600 });
  const config = path.join(sshDir, 'config');
  let previo = '';
  try { previo = await readFile(config, 'utf8'); } catch { /* sin config previa */ }
  await writeFile(config, `${bloqueSsh(host, 'accept-new', known)}${quitarBloque(previo)}`, { mode: 0o600 });
  await chmod(config, 0o600); // `mode` solo aplica si el archivo no existía
  return { origen: `ninguna (modo transicional ${entorno})`, lineas: 0, known, config, advertencia: `No hay clave de host fijada para ${entorno}: se usa StrictHostKeyChecking=accept-new (modo transicional). Cargá el secret VPS_SSH_KNOWN_HOSTS o infra/vps/known_hosts.${entorno} y activá VPS_ESTRICTO=1 (docs/deployment.md, «Pasar dev a modo estricto»).` };
}

export async function preparar({ host, entorno, secreto, sshDir, raiz = process.cwd(), estricto = esEstricto(entorno) }) {
  if (!host) throw new Error('Falta --host (VPS_SSH_HOST).');
  host = validarHost(host);
  if (!['dev', 'staging', 'production'].includes(entorno)) throw new Error('Uso: --entorno dev|staging|production');
  let contenido = secreto?.trim() ? secreto : '';
  let origen = 'el secret VPS_SSH_KNOWN_HOSTS';
  if (!contenido) {
    const archivo = path.join(raiz, 'infra', 'vps', `known_hosts.${entorno}`);
    try {
      contenido = await readFile(archivo, 'utf8');
      origen = `infra/vps/known_hosts.${entorno}`;
    } catch {
      if (!estricto) return await sinClaveFijada({ host, sshDir, entorno });
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
  await writeFile(config, `${bloqueSsh(host, 'yes', known)}${quitarBloque(previo)}`, { mode: 0o600 });
  await chmod(config, 0o600); // `mode` solo aplica si el archivo no existía
  return { origen, lineas: lineas.length, known, config };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const archivoEnv = arg('--env-file');
    let contenidoEnv = '';
    if (archivoEnv) { try { contenidoEnv = await readFile(archivoEnv, 'utf8'); } catch { /* sin .env: rige la variable del proceso */ } }
    const entorno = arg('--entorno');
    const r = await preparar({ host: arg('--host'), entorno, secreto: process.env.VPS_SSH_KNOWN_HOSTS, sshDir: arg('--ssh-dir') ?? path.join(os.homedir(), '.ssh'), estricto: esEstricto(entorno, process.env, contenidoEnv) });
    if (r.advertencia) console.warn(`::warning::${r.advertencia}`);
    else console.log(`Clave de host del VPS fijada desde ${r.origen} (${r.lineas} línea(s)); StrictHostKeyChecking=yes.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
