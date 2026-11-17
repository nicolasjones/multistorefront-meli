import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Corre cada suite (un comando de shell) hasta el final, sin cortar en la primera que falla, y devuelve un
// resumen. Uso: node scripts/correr-suites.mjs "<cmd 1>" "<cmd 2>" …  (exit 1 si alguna falló).
// `ejecutar(comando, timeoutMs)` devuelve el exit code (número) o `{ estado, senal }` si lo mató una señal
// (incluido el timeout por suite, SIGTERM). Timeout por suite: `--timeout <s>` o CORRER_SUITES_TIMEOUT_S (600 por defecto).
export const TIMEOUT_POR_DEFECTO_S = 600;
export const TIMEOUT_MAXIMO_S = 86400;
// Limitación: SIGKILL mata solo el shell de la suite; los procesos nietos pueden quedar huérfanos.

// Valida un timeout en segundos (finito, > 0 y <= TIMEOUT_MAXIMO_S). Lanza un Error con mensaje claro.
export function parsearTimeoutS(crudo, origen) {
  const n = Number(crudo);
  if (String(crudo).trim() === '' || !Number.isFinite(n) || n <= 0 || n > TIMEOUT_MAXIMO_S) {
    throw new Error(`${origen} debe ser un número de segundos mayor que 0 y de hasta ${TIMEOUT_MAXIMO_S} (recibido: ${JSON.stringify(crudo)}).`);
  }
  return n;
}

export function correrSuites(comandos, { ejecutar = defecto, salida = process.stdout, timeoutS = TIMEOUT_POR_DEFECTO_S } = {}) {
  const resultados = comandos.map((comando) => {
    salida.write(`\n== ${comando}\n`);
    const r = ejecutar(comando, timeoutS * 1000);
    const { estado, senal } = typeof r === 'object' && r !== null ? r : { estado: r, senal: null };
    return { comando, estado, senal };
  });
  const fallidas = resultados.filter((r) => r.estado !== 0);
  salida.write(`\n== Resumen: ${resultados.length - fallidas.length}/${resultados.length} suites OK\n`);
  for (const f of fallidas) salida.write(f.senal ? `FALLÓ (murió por ${f.senal}, timeout ${timeoutS} s o señal externa): ${f.comando}\n` : `FALLÓ (exit ${f.estado}): ${f.comando}\n`);
  return { resultados, fallidas, codigo: fallidas.length > 0 ? 1 : 0 };
}

function defecto(comando, timeoutMs) {
  const r = spawnSync(comando, { shell: true, stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.signal) return { estado: 1, senal: r.signal };
  if (r.error?.code === 'ETIMEDOUT') return { estado: 1, senal: 'SIGKILL' };
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let argumentos = process.argv.slice(2);
  let timeoutS = TIMEOUT_POR_DEFECTO_S;
  try {
    if (process.env.CORRER_SUITES_TIMEOUT_S !== undefined && process.env.CORRER_SUITES_TIMEOUT_S !== '') {
      timeoutS = parsearTimeoutS(process.env.CORRER_SUITES_TIMEOUT_S, 'CORRER_SUITES_TIMEOUT_S');
    }
    if (argumentos[0] === '--timeout') {
      timeoutS = parsearTimeoutS(argumentos[1] ?? '', '--timeout');
      argumentos = argumentos.slice(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const comandos = argumentos;
  if (comandos.length === 0) {
    console.error('Uso: node scripts/correr-suites.mjs "<comando>" …');
    process.exit(2);
  }
  process.exit(correrSuites(comandos, { timeoutS }).codigo);
}
