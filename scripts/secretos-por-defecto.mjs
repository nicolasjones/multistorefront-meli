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

// Valores fijos que viajan en el repo (infra/nango/compose.yaml) y por eso son públicos.
export const VALORES_FIJOS_DEL_REPO = new Set([
  'ybH2At/IUEgUmWW9GMI9PIZbrgQXbuZO97zJShOJElg=',
  '01df8743-e924-4364-8e5e-952170af0721',
]);

const CONTRASENAS_TRIVIALES = new Set(['postgres', 'password', 'admin', 'root', 'secret', '123456', 'changeme', 'supabase']);

// Una variable es sensible por su NOMBRE: se compara por segmentos separados por `_`, sin regex.
const SEGMENTOS_SENSIBLES = new Set(['PASSWORD', 'PASSWD', 'SECRET', 'TOKEN', 'KEY', 'JWT', 'APIKEY']);
export function esNombreSensible(nombre) {
  return String(nombre).toUpperCase().split('_').some((segmento) => SEGMENTOS_SENSIBLES.has(segmento));
}

function base64urlADecodificado(parte) {
  return Buffer.from(parte.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

// Un JWT tiene tres partes base64url separadas por punto. Devuelve { payload, firmadoConSecretoPublico } o null si no lo es.
export function inspeccionarJwt(valor) {
  const partes = String(valor).split('.');
  if (partes.length !== 3 || partes.some((p) => p.length === 0)) return null;
  try {
    const cabecera = JSON.parse(base64urlADecodificado(partes[0]).toString('utf8'));
    const payload = JSON.parse(base64urlADecodificado(partes[1]).toString('utf8'));
    if (cabecera === null || typeof cabecera !== 'object' || payload === null || typeof payload !== 'object') return null;
    const esperada = createHmac('sha256', JWT_SECRET_PUBLICO).update(`${partes[0]}.${partes[1]}`).digest();
    const recibida = base64urlADecodificado(partes[2]);
    const firmadoConSecretoPublico = cabecera.alg === 'HS256' && recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
    return { payload, firmadoConSecretoPublico };
  } catch {
    return null;
  }
}

function esContrasenaPorDefecto(valor) {
  const v = String(valor);
  const minuscula = v.toLowerCase();
  return CONTRASENAS_TRIVIALES.has(minuscula) || minuscula.startsWith('change-me') || minuscula.startsWith('changeme') || minuscula.endsWith('-local');
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
  if (v === JWT_SECRET_PUBLICO) return 'secreto JWT público de Supabase local';
  if (VALORES_FIJOS_DEL_REPO.has(v)) return 'valor fijo y público del repositorio';
  const jwt = inspeccionarJwt(v);
  if (jwt) {
    if (jwt.firmadoConSecretoPublico) return 'JWT firmado con el secreto público de Supabase local';
    if (jwt.payload.iss === 'supabase-demo') return 'JWT de demostración de Supabase local';
    return null;
  }
  const claveDeUrl = contrasenaDeUrl(v);
  if (claveDeUrl !== null) return esContrasenaPorDefecto(claveDeUrl) ? 'contraseña por defecto dentro de la URL de conexión' : null;
  if (!esNombreSensible(nombre)) return null;
  return esContrasenaPorDefecto(v) ? 'contraseña o secreto por defecto (postgres, change-me*, *-local)' : null;
}

// KEY=valor de un .env (sin expandir variables). Mismo formato que scripts/preflight-deploy-vps.mjs.
export function leerPares(contenido) {
  const pares = [];
  for (const linea of String(contenido).split(/\r?\n/)) {
    const igual = linea.indexOf('=');
    if (igual <= 0 || linea.trimStart().startsWith('#')) continue;
    const nombre = linea.slice(0, igual).trim().replace(/^export\s+/, '');
    if (nombre === '' || nombre.includes(' ')) continue;
    let valor = linea.slice(igual + 1).trim();
    if (valor.length >= 2 && (valor[0] === '"' || valor[0] === "'") && valor.at(-1) === valor[0]) valor = valor.slice(1, -1);
    pares.push([nombre, valor]);
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
