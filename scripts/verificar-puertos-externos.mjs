// Comprobación EXTERNA de MSF-648 (solo lectura): intenta un `connect` TCP a cada puerto sensible del VPS y falla si alguno abre.
// Correrla desde una máquina FUERA del VPS y de la red Tailscale, antes y después de aplicar el firewall (infra/vps/firewall-docker-user.sh).
//
//   node scripts/verificar-puertos-externos.mjs --host <IP pública> [--puertos 7634,7635,...] [--esperados 22,80,443] [--timeout-ms 3000]
//
// Sale 0 si ningún puerto sensible acepta conexiones; 1 si alguno abre; 2 por uso inválido.
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Los de la auditoría MSF-648 más los de Kestra, Superset, Nango, GlitchTip y el servidor MCP.
export const PUERTOS_SENSIBLES = [7633, 7634, 7635, 7636, 4301, 4302, 4304, 4305, 4306, 4307, 9300, 9301, 9302, 3000, 8085, 8089, 3005, 8100, 8788, 4300, 4303, 54322, 54321, 57329];

export function conectar(host, puerto, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: puerto });
    const fin = (abierto) => { socket.destroy(); resolve(abierto); };
    socket.setTimeout(timeoutMs, () => fin(false));
    socket.once('connect', () => fin(true));
    socket.once('error', () => fin(false));
  });
}

export function listaDePuertos(texto) {
  const partes = String(texto).split(',');
  const puertos = partes.map((p) => (/^\d{1,5}$/.test(p.trim()) ? Number(p) : NaN));
  if (puertos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error(`Lista de puertos inválida: ${texto}`);
  return [...new Set(puertos)];
}

export async function verificar({ host, puertos = PUERTOS_SENSIBLES, esperados = [22, 80, 443], timeoutMs = 3000, probar = conectar }) {
  const resultados = await Promise.all([...new Set([...puertos, ...esperados])].map(async (puerto) => [puerto, await probar(host, puerto, timeoutMs)]));
  const abiertos = resultados.filter(([, abierto]) => abierto).map(([puerto]) => puerto).sort((a, b) => a - b);
  const sensiblesAbiertos = abiertos.filter((p) => !esperados.includes(p));
  const esperadosCerrados = esperados.filter((p) => !abiertos.includes(p));
  return { abiertos, sensiblesAbiertos, esperadosCerrados, ok: sensiblesAbiertos.length === 0 };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const opcion = (nombre) => { const i = process.argv.indexOf(nombre); return i === -1 ? undefined : process.argv[i + 1]; };
  try {
    const host = opcion('--host');
    if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) throw new Error('Uso: --host <IP o nombre> [--puertos a,b] [--esperados 22,80,443] [--timeout-ms 3000]');
    const timeoutMs = Number(opcion('--timeout-ms') ?? 3000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('--timeout-ms entre 100 y 30000');
    const r = await verificar({
      host,
      puertos: opcion('--puertos') ? listaDePuertos(opcion('--puertos')) : PUERTOS_SENSIBLES,
      esperados: opcion('--esperados') ? listaDePuertos(opcion('--esperados')) : [22, 80, 443],
      timeoutMs,
    });
    console.log(`Abiertos: ${r.abiertos.join(', ') || 'ninguno'}`);
    if (r.esperadosCerrados.length > 0) console.log(`Aviso: esperados cerrados (¿SSH/HTTP caídos?): ${r.esperadosCerrados.join(', ')}`);
    if (!r.ok) { console.error(`FALLA: puertos sensibles abiertos desde afuera: ${r.sensiblesAbiertos.join(', ')}`); process.exit(1); }
    console.log('OK: ningún puerto sensible acepta conexiones desde esta máquina.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Uso inválido.');
    process.exit(2);
  }
}
