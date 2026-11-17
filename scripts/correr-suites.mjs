import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Corre cada suite (un comando de shell) hasta el final, sin cortar en la primera que falla, y devuelve un
// resumen. Uso: node scripts/correr-suites.mjs "<cmd 1>" "<cmd 2>" …  (exit 1 si alguna falló).
export function correrSuites(comandos, { ejecutar = defecto, salida = process.stdout } = {}) {
  const resultados = comandos.map((comando) => {
    salida.write(`\n== ${comando}\n`);
    const estado = ejecutar(comando);
    return { comando, estado };
  });
  const fallidas = resultados.filter((r) => r.estado !== 0);
  salida.write(`\n== Resumen: ${resultados.length - fallidas.length}/${resultados.length} suites OK\n`);
  for (const f of fallidas) salida.write(`FALLÓ (exit ${f.estado}): ${f.comando}\n`);
  return { resultados, fallidas, codigo: fallidas.length > 0 ? 1 : 0 };
}

function defecto(comando) {
  return spawnSync(comando, { shell: true, stdio: 'inherit' }).status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const comandos = process.argv.slice(2);
  if (comandos.length === 0) {
    console.error('Uso: node scripts/correr-suites.mjs "<comando>" …');
    process.exit(2);
  }
  process.exit(correrSuites(comandos).codigo);
}
