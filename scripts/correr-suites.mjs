import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Corre cada suite (un comando de shell) hasta el final, sin cortar en la primera que falla, y devuelve un
// resumen. Uso: node scripts/correr-suites.mjs "<cmd 1>" "<cmd 2>" …  (exit 1 si alguna falló).
// `ejecutar(comando, timeoutMs)` devuelve el exit code (número) o `{ estado, senal }` si lo mató una señal
// (incluido el timeout por suite, SIGTERM). Timeout por suite: `--timeout <s>` o CORRER_SUITES_TIMEOUT_S (600 por defecto).
export const TIMEOUT_POR_DEFECTO_S = 600;

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
  let timeoutS = Number(process.env.CORRER_SUITES_TIMEOUT_S) || TIMEOUT_POR_DEFECTO_S;
  if (argumentos[0] === '--timeout') {
    timeoutS = Number(argumentos[1]);
    if (!(timeoutS > 0)) {
      console.error('--timeout requiere segundos > 0');
      process.exit(2);
    }
    argumentos = argumentos.slice(2);
  }
  const comandos = argumentos;
  if (comandos.length === 0) {
    console.error('Uso: node scripts/correr-suites.mjs "<comando>" …');
    process.exit(2);
  }
  process.exit(correrSuites(comandos, { timeoutS }).codigo);
}
