// MSF-680: antes de correr `supabase db push` se comprueba que el destino del SUPABASE_DB_URL acepta conexiones TCP. Si no, el error dice QUÉ
// destino (host y puerto, sin usuario ni contraseña) y QUÉ revisar, en vez de un `dial error ... ECONNREFUSED` opaco del CLI (los runs de
// staging fallaban desde el 21/10 con «connect ECONNREFUSED 172.17.0.1:7635» y nadie lo vio). Nunca imprime la URL completa.
import net from 'node:net';

// { host, puerto } de una URL de conexión (postgres://, postgresql://). Lanza sin incluir la URL en el mensaje.
export function destinoDeUrl(url) {
  let analizada;
  try { analizada = new URL(String(url).trim()); } catch { throw new Error('SUPABASE_DB_URL no es una URL válida (postgresql://usuario:clave@host:puerto/base).'); }
  if (!['postgres:', 'postgresql:'].includes(analizada.protocol)) throw new Error('SUPABASE_DB_URL debe empezar con postgresql:// o postgres://.');
  if (analizada.hostname === '') throw new Error('SUPABASE_DB_URL no tiene host.');
  const puerto = analizada.port === '' ? 5432 : Number(analizada.port);
  return { host: analizada.hostname.replace(/^\[|\]$/g, ''), puerto };
}

export function conectarTcp(host, puerto, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: puerto });
    const fin = (error) => { socket.destroy(); resolve(error); };
    socket.setTimeout(timeoutMs, () => fin('timeout'));
    socket.once('connect', () => fin(null));
    socket.once('error', (e) => fin(e.code ?? 'error'));
  });
}

export async function comprobarConexion(url, entorno, { conectar = conectarTcp, timeoutMs = 10_000 } = {}) {
  const { host, puerto } = destinoDeUrl(url);
  const motivo = await conectar(host, puerto, timeoutMs);
  if (motivo === null) return { host, puerto };
  throw new Error([
    `No se pudo conectar a ${host}:${puerto} (${motivo}), el destino del SUPABASE_DB_URL del Environment migraciones-cloud-${entorno}.`,
    'Revisá: (1) que el secret apunte a la base de ESE entorno (dev 7634, staging 7635, producción 7636); (2) que el runner de deploy alcance el host:',
    'un runner en contenedor NO llega a 172.17.0.1 ni a localhost del VPS: usá la IP de Tailscale del VPS (y publicá Postgres también en esa IP);',
    '(3) que el firewall del VPS deje pasar a la red de Tailscale (docs/endurecimiento-infra.md, «Firewall del VPS»).',
  ].join('\n'));
}
