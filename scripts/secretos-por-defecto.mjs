// Valores por defecto conocidos (públicos) de secretos y contraseñas, y la detección de uno de ellos en un archivo `.env` o en el
// entorno de un contenedor (MSF-649, MSF-705). Solo se manejan NOMBRES de variable en los mensajes: el valor nunca sale de acá.
//
// Qué se considera «por defecto»:
//   - el secreto JWT público del Supabase local y los JWT de demostración (`iss: supabase-demo`);
//   - cualquier JWT HS256 firmado con ese secreto público (se verifica la firma: quien conoce el secreto lo forja);
//   - los valores fijos del repo (clave de cifrado y secreto de la API de Nango);
//   - contraseñas `postgres`/`password`, todo lo que empiece con `change-me`/`changeme` y todo lo que termine en `-local`;
//   - URLs de conexión con la contraseña `postgres` o una de las anteriores.
// No hay regex con cuantificadores anidados: las comparaciones son por prefijo/sufijo/igualdad y `URL`/`JSON.parse` del runtime.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const JWT_SECRET_PUBLICO = 'super-secret-jwt-token-with-at-least-32-characters-long';
// Valores públicos del `.env.example` del Supabase self-hosted (docker/.env.example): quien los copia sin cambiarlos queda con claves conocidas.
export const SECRETOS_JWT_PUBLICOS = [JWT_SECRET_PUBLICO, `your-${JWT_SECRET_PUBLICO}`];
const PREFIJOS_PUBLICOS = ['your-super-secret', 'your-encryption-key', 'this_password_is_insecure'];

// Valores fijos que viajan en el repo (infra/nango/compose.yaml) y por eso son públicos.
export const VALORES_FIJOS_DEL_REPO = new Set([
  'ybH2At/IUEgUmWW9GMI9PIZbrgQXbuZO97zJShOJElg=',
  '01df8743-e924-4364-8e5e-952170af0721',
]);

const CONTRASENAS_TRIVIALES = new Set(['postgres', 'password', 'admin', 'root', 'secret', '123456', 'changeme', 'supabase']);

// Una variable es sensible por su NOMBRE: por segmentos separados por `_` o porque TERMINA en una palabra sensible (`PGPASSWORD`, `APIKEY`), sin regex.
const SEGMENTOS_SENSIBLES = new Set(['PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'KEY', 'JWT', 'APIKEY']);
const SUFIJOS_SENSIBLES = ['PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'APIKEY'];
export function esNombreSensible(nombre) {
  const mayusculas = String(nombre).toUpperCase();
  return mayusculas.split('_').some((segmento) => SEGMENTOS_SENSIBLES.has(segmento)) || SUFIJOS_SENSIBLES.some((sufijo) => mayusculas.endsWith(sufijo));
}

function base64urlADecodificado(parte) {
  return Buffer.from(parte.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

const ALGORITMOS = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };

// Un JWT tiene tres partes base64url separadas por punto. Devuelve { payload, firmadoConSecretoPublico } o null si no lo es.
// La firma se verifica con HS256, HS384 y HS512 contra cada secreto público: quien conoce el secreto forja el token con cualquiera.
export function inspeccionarJwt(valor) {
  const partes = String(valor).split('.');
  if (partes.length !== 3 || partes.some((p) => p.length === 0)) return null;
  try {
    const cabecera = JSON.parse(base64urlADecodificado(partes[0]).toString('utf8'));
    const payload = JSON.parse(base64urlADecodificado(partes[1]).toString('utf8'));
    if (cabecera === null || typeof cabecera !== 'object' || payload === null || typeof payload !== 'object') return null;
    const recibida = base64urlADecodificado(partes[2]);
    const algoritmo = Object.hasOwn(ALGORITMOS, cabecera.alg) ? ALGORITMOS[cabecera.alg] : null;
    let firmadoConSecretoPublico = false;
    if (algoritmo) {
      for (const secreto of SECRETOS_JWT_PUBLICOS) {
        const esperada = createHmac(algoritmo, secreto).update(`${partes[0]}.${partes[1]}`).digest();
        if (recibida.length === esperada.length && timingSafeEqual(recibida, esperada)) firmadoConSecretoPublico = true;
      }
    }
    return { payload, firmadoConSecretoPublico };
  } catch {
    return null;
  }
}

function esContrasenaPorDefecto(valor) {
  const v = String(valor);
  const minuscula = v.toLowerCase();
  return CONTRASENAS_TRIVIALES.has(minuscula) || PREFIJOS_PUBLICOS.some((prefijo) => minuscula.startsWith(prefijo)) || minuscula.startsWith('change-me') || minuscula.startsWith('changeme') || minuscula.endsWith('-local');
}

// Contraseña dentro de una URL de conexión (`postgres://usuario:clave@host/db`, `jdbc:postgresql://...`). null si no hay.
export function contrasenaDeUrl(valor) {
  let texto = String(valor).trim();
  if (texto.startsWith('jdbc:')) texto = texto.slice(5);
  if (!texto.includes('://')) return null;
  try {
    const url = new URL(texto);
    return url.password ? decodeURIComponent(url.password) : null;
  } catch {
    return null;
  }
}

// Devuelve el motivo (texto fijo, sin el valor) si `valor` es un valor por defecto conocido; null si no.
export function motivoPorDefecto(nombre, valor) {
  const v = String(valor ?? '').trim();
  if (v === '') return null;
  if (SECRETOS_JWT_PUBLICOS.includes(v)) return 'secreto JWT público de Supabase';
  if (VALORES_FIJOS_DEL_REPO.has(v)) return 'valor fijo y público del repositorio';
  const jwt = inspeccionarJwt(v);
  if (jwt) {
    if (jwt.firmadoConSecretoPublico) return 'JWT firmado con un secreto público de Supabase';
    if (jwt.payload.iss === 'supabase-demo') return 'JWT de demostración de Supabase local';
    return null;
  }
  const claveDeUrl = contrasenaDeUrl(v);
  if (claveDeUrl !== null) return esContrasenaPorDefecto(claveDeUrl) ? 'contraseña por defecto dentro de la URL de conexión' : null;
  if (!esNombreSensible(nombre)) return null;
  return esContrasenaPorDefecto(v) ? 'contraseña o secreto por defecto (postgres, change-me*, *-local)' : null;
}

// KEY=valor de un .env (sin expandir variables). Mismo formato que scripts/preflight-deploy-vps.mjs.
// Valor de una línea de .env: entre comillas se toma lo de adentro (lo que sigue al cierre es un comentario); sin comillas se corta en ` #`.
export function valorDeLinea(resto) {
  const v = resto.trim();
  const comilla = v[0];
  if (comilla === '"' || comilla === "'") {
    const cierre = v.indexOf(comilla, 1);
    return cierre === -1 ? v.slice(1) : v.slice(1, cierre);
  }
  const marca = v.search(/\s#/);
  return (marca === -1 ? v : v.slice(0, marca)).trim();
}

// KEY=valor de un .env (sin expandir variables). Mismo formato que scripts/preflight-deploy-vps.mjs.
export function leerPares(contenido) {
  const pares = [];
  for (const linea of String(contenido).split(/\r?\n/)) {
    const igual = linea.indexOf('=');
    if (igual <= 0 || linea.trimStart().startsWith('#')) continue;
    const nombre = linea.slice(0, igual).trim().replace(/^export\s+/, '');
    if (nombre === '' || nombre.includes(' ')) continue;
    pares.push([nombre, valorDeLinea(linea.slice(igual + 1))]);
  }
  return pares;
}

// [{ nombre, motivo }] de las variables con un valor por defecto conocido. Nunca incluye el valor.
export function hallazgosPorDefecto(contenido) {
  const hallazgos = [];
  for (const [nombre, valor] of leerPares(contenido)) {
    const motivo = motivoPorDefecto(nombre, valor);
    if (motivo) hallazgos.push({ nombre, motivo });
  }
  return hallazgos;
}
