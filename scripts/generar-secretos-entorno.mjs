// Genera los secretos propios de un entorno (MSF-649): secreto JWT, claves anon y service_role firmadas con él, contraseña de
// Postgres y las credenciales de Kestra, Superset y Nango que el despliegue exige (MSF-705). NUNCA imprime un valor: escribe un
// archivo `.env` con permisos 0600 FUERA del repositorio y muestra solo los nombres y cuántos generó.
//
//   node scripts/generar-secretos-entorno.mjs --entorno dev --salida /root/secretos/dev.env
//
// - No sobrescribe un archivo existente (rotar = generar uno nuevo y cargarlo; ver docs/endurecimiento-infra.md).
// - Rechaza una salida dentro del repositorio: un secreto generado ahí podría terminar commiteado.
// - El JWT usa HS256 con `iss: supabase` y `role` anon/service_role, como el stack self-hosted de Supabase; `exp` a 10 años.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, writeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENTORNOS = ['dev', 'staging', 'production'];
const DIEZ_ANIOS_S = 10 * 365 * 24 * 3600;

const b64url = (buffer) => Buffer.from(buffer).toString('base64url');

export function firmarJwt(payload, secreto) {
  const cabecera = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = b64url(createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest());
  return `${cabecera}.${cuerpo}.${firma}`;
}

// Contraseña alfanumérica (sin símbolos que rompan URLs de conexión ni el parseo de .env).
export function aleatorio(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

// Puerto de la base de cada entorno (mismo mapa que scripts/deploy-vps.mjs).
export const PUERTO_DB = { dev: 7634, staging: 7635, production: 7636 };

export function generarSecretos({ ahora = Math.floor(Date.now() / 1000), azar = aleatorio, uuid = randomUUID, entorno = 'dev' } = {}) {
  const jwtSecret = azar(48);
  const passwordPostgres = azar(32);
  const claims = (role) => ({ role, iss: 'supabase', iat: ahora, exp: ahora + DIEZ_ANIOS_S });
  return new Map([
    ['JWT_SECRET', jwtSecret],
    ['ANON_KEY', firmarJwt(claims('anon'), jwtSecret)],
    ['SERVICE_ROLE_KEY', firmarJwt(claims('service_role'), jwtSecret)],
    ['POSTGRES_PASSWORD', passwordPostgres],
    ['KESTRA_DB_PASSWORD', azar(32)],
    ['KESTRA_BASIC_AUTH_PASSWORD', azar(24)],
    ['KESTRA_BACKUPS_DB_PASSWORD', azar(32)],
    // URL de pg_dump con el superusuario: la contraseña es la de Postgres recién generada y el puerto el de la base de ese entorno.
    ['KESTRA_BACKUPS_PGDUMP_URL', `postgres://postgres:${passwordPostgres}@host.docker.internal:${PUERTO_DB[entorno]}/postgres`],
    // Credenciales S3 del Storage de respaldos: el MISMO par debe cargarse en el servicio Storage (S3_PROTOCOL_ACCESS_KEY_ID/SECRET).
    ['RESPALDOS_STORAGE_ACCESS_KEY_ID', randomBytes(16).toString('hex')],
    ['RESPALDOS_STORAGE_SECRET_ACCESS_KEY', randomBytes(32).toString('hex')],
    ['KESTRA_ORQUESTACION_DB_PASSWORD', azar(32)],
    ['SUPERSET_DB_PASSWORD', azar(32)],
    ['SUPERSET_SECRET_KEY', azar(48)],
    ['SUPERSET_ADMIN_PASSWORD', azar(24)],
    ['SUPERSET_GUEST_TOKEN_JWT_SECRET', azar(48)],
    ['SUPERSET_GUEST_TOKEN_PASSWORD', azar(24)],
    ['NANGO_DB_PASSWORD', azar(32)],
    // Nango pide 32 bytes en base64 para la clave de cifrado y un UUID v4 para el secreto de la API.
    ['NANGO_ENCRYPTION_KEY', randomBytes(32).toString('base64')],
    ['NANGO_DASHBOARD_PASSWORD', azar(24)],
    ['NANGO_SECRET_KEY_DEV', uuid()],
  ]);
}

// La salida no puede estar dentro del repo (ni ser un symlink a algo ya existente: `wx` falla si existe).
export function validarSalida(salida, raiz = RAIZ) {
  if (!salida) throw new Error('Falta --salida <archivo>.');
  const absoluta = path.resolve(salida);
  const relativa = path.relative(raiz, absoluta);
  if (relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))) {
    throw new Error('La salida no puede estar dentro del repositorio: un secreto generado ahí podría commitearse. Usá una ruta fuera (por ejemplo /root/secretos/<entorno>.env).');
  }
  if (existsSync(absoluta)) throw new Error('La salida ya existe: no se sobrescribe. Elegí otro nombre (rotar = generar un archivo nuevo).');
  return absoluta;
}

export function escribirSecretos(secretos, absoluta) {
  mkdirSync(path.dirname(absoluta), { recursive: true, mode: 0o700 });
  const fd = openSync(absoluta, 'wx', 0o600);
  try {
    writeSync(fd, [...secretos].map(([nombre, valor]) => `${nombre}=${valor}`).join('\n') + '\n');
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const opcion = (nombre) => { const i = process.argv.indexOf(nombre); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const entorno = opcion('--entorno');
    if (!ENTORNOS.includes(entorno)) throw new Error(`Uso: --entorno ${ENTORNOS.join('|')} --salida <archivo fuera del repo>`);
    const absoluta = validarSalida(opcion('--salida'));
    const secretos = generarSecretos({ entorno });
    escribirSecretos(secretos, absoluta);
    console.log(`Se generaron ${secretos.size} secretos para ${entorno} en ${absoluta} (permisos 0600). No se imprimió ningún valor.`);
    console.log(`Variables: ${[...secretos.keys()].join(', ')}`);
    console.log('Siguiente paso: docs/endurecimiento-infra.md, «Rotar los secretos de un entorno».');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudieron generar los secretos.');
    process.exit(1);
  }
}
