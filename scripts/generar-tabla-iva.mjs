// Genera `apps/web/src/lib/iva.tabla.json`: casos [neto, porcentaje, final] calculados por `private.aplicar_iva` en un Postgres
// DESCARTABLE (con las migraciones aplicadas), para que `calcularFinal` (iva.ts) se compare con la base en cientos de casos.
// Uso: PSQL="docker exec -i <contenedor> psql -U postgres -X -tA" node scripts/generar-tabla-iva.mjs
// Los netos son cadenas decimales (lo que llega a la base); la semilla es fija: la tabla es reproducible.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const psql = process.env.PSQL;
if (!psql) { console.error('Falta PSQL (comando psql contra el Postgres descartable)'); process.exit(2); }

let semilla = 41;
const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const porcentajes = ['0', '2.5', '5', '10', '10.5', '21', '27', '100'];
const netos = new Set();
// Netos de hasta 8 cifras enteras y 3 decimales, con y sin signo, y los bordes de medio centavo.
for (let i = 0; i < 520; i++) {
  const enteras = entre(0, 8);
  const decimales = entre(0, 3);
  let entero = enteras === 0 ? '0' : String(entre(1, 9)) + Array.from({ length: enteras - 1 }, () => entre(0, 9)).join('');
  const frac = Array.from({ length: decimales }, () => entre(0, 9)).join('');
  netos.add(`${azar() < 0.15 ? '-' : ''}${entero}${frac ? `.${frac}` : ''}`);
}
for (const base of ['12345678', '99999999', '1', '0', '1234', '29186']) for (const f of ['.005', '.015', '.125', '.995', '.905', '.455', '.5', '.995']) { netos.add(base + f); netos.add(`-${base}${f}`); }
netos.add('12345678.905'); netos.add('99999999.995'); netos.add('0.005'); netos.add('0.001'); netos.add('0.499');

const filas = [];
for (const n of netos) for (const p of porcentajes) if (azar() < 0.18 || p === '21') filas.push([n, p]);
const sql = filas.map(([n, p]) => `select '${n}', '${p}', private.aplicar_iva('${n}'::numeric, '${p}'::numeric, false)::text;`).join('\n');
const salida = execSync(psql, { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tabla = salida.trim().split('\n').map((l) => l.split('|')).map(([n, p, f]) => [n, Number(p), f]);
if (tabla.length !== filas.length) throw new Error(`la base devolvió ${tabla.length} filas de ${filas.length}`);
writeFileSync(new URL('../apps/web/src/lib/iva.tabla.json', import.meta.url), `${JSON.stringify(tabla)}\n`);
console.log(`iva.tabla.json: ${tabla.length} casos`);
