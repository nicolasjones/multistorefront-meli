// MSF-680: antes de correr `supabase db push` se comprueba que el destino del SUPABASE_DB_URL acepta conexiones TCP. Si no, el error dice QUÉ
// destino (el PUERTO; el host se enmascara en el log con `::add-mask::`: el repo es público y puede ser la IP del VPS) y QUÉ revisar, en vez de
// un `dial error ... ECONNREFUSED` opaco del CLI (los runs de staging fallaban desde el 21/10 y nadie lo vio). Nunca imprime la URL completa.
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

export async function comprobarConexion(url, entorno, { conectar = conectarTcp, timeoutMs = 10_000, enmascarar = (valor) => console.log(`::add-mask::${valor}`) } = {}) {
  const { host, puerto } = destinoDeUrl(url);
  // El host se enmascara SIEMPRE y antes de conectar: cualquier línea posterior del log (CLI, errores de red) ya sale con asteriscos.
  enmascarar(host);
  const motivo = await conectar(host, puerto, timeoutMs);
  if (motivo === null) return { host, puerto };
  throw new Error([
    `No se pudo conectar al host del SUPABASE_DB_URL (puerto ${puerto}) del Environment migraciones-cloud-${entorno}: ${motivo}.`,
    'Revisá: (1) que el secret apunte a la base de ESE entorno (dev 7634, staging 7635, producción 7636); (2) que el runner de deploy alcance el host: el',
    'contenedor de un job corre en una red dedicada con salida solo a Internet y SIN acceso al host del VPS ni a la tailnet, salvo los puertos de base de datos',
    'que el firewall le abre a la red de deploy (--puertos-db-deploy, y --destinos-tailnet-deploy si la base está en otro nodo de Tailscale);',
    '(3) que el firewall del VPS deje pasar esa ruta (docs/endurecimiento-infra.md, «Firewall del VPS»).',
  ].join('\n'));
}
