#!/usr/bin/env node
// Verificación de higiene de una base Postgres/Supabase (lote 33: MSF-918/922/923/899/917/658/671). SOLO LECTURA.
//   node scripts/verificar-higiene-base.mjs --docker <contenedor>            # psql dentro de un contenedor (usuario postgres)
//   DATABASE_URL=postgres://... node scripts/verificar-higiene-base.mjs      # psql contra una URL
//   --versiones: además compara supabase_migrations.schema_migrations con supabase/migrations (huérfanas / pendientes)
// Sale con 1 si algún control que debe ser 0 no lo es. No ejecuta nada que escriba (la sesión va en read only).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
// Controles que deben ser 0 y los que tienen un valor esperado distinto de 0.
export const ESPERADOS = {
  fk_sin_indice: 0,
  rls_sin_politica: 0,
  tablas_sin_pk: 0,
  fk_no_validas: 0,
  vistas_definer_permitidas: 1, // public.proveedores_basico (a propósito)
  definer_sp_heredadas: 3, // is_superadmin, organizacion_id, puede_escribir (plan en docs/higiene-base-datos.md)
  anon_ejecuta_public_publico: 33, // 31 de publico + 2 RPC de acceso de public
  migraciones_nombre_vacio: 0,
};

export function evaluar(filas) {
  return filas.map(({ control, cantidad, detalle }) => {
    const esperado = ESPERADOS[control];
    return { control, cantidad, detalle, esperado, ok: esperado === undefined ? true : cantidad === esperado };
  });
}

function psql(argv, sql, extra = []) {
  const i = argv.indexOf('--docker');
  const args = ['-tAX', '-F', '|', '-v', 'ON_ERROR_STOP=1', ...extra];
  const r = i >= 0
    ? spawnSync('docker', ['exec', '-i', argv[i + 1], 'psql', '-U', 'postgres', ...args], { input: sql, encoding: 'utf8' })
    : spawnSync('psql', [process.env.DATABASE_URL ?? '', ...args], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || 'psql falló');
    process.exit(2);
  }
  return r.stdout.split('\n').filter((l) => l.includes('|'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const sql = readFileSync(`${RAIZ}/supabase/verificacion/higiene_base.sql`, 'utf8');
  const filas = psql(argv, sql).map((l) => {
    const [control, cantidad, ...resto] = l.split('|');
    return { control, cantidad: Number(cantidad), detalle: resto.join('|') };
  });
  const res = evaluar(filas);
  for (const r of res) {
    console.log(`${r.ok ? 'OK  ' : 'FALLA'} ${r.control}: ${r.cantidad}${r.esperado === undefined ? '' : ` (esperado ${r.esperado})`}${r.detalle ? ` -> ${r.detalle}` : ''}`);
  }
  let fallo = res.some((r) => !r.ok);
  if (argv.includes('--versiones')) {
    const archivos = readdirSync(`${RAIZ}/supabase/migrations`).filter((f) => /^\d+_.+\.sql$/.test(f));
    const enRepo = new Set(archivos.map((f) => f.split('_')[0]));
    const enBase = new Set(psql(argv, 'select version || \'|\' from supabase_migrations.schema_migrations;').map((l) => l.split('|')[0]));
    const huerfanas = [...enBase].filter((v) => !enRepo.has(v)).sort();
    const pendientes = [...enRepo].filter((v) => !enBase.has(v)).sort();
    console.log(`${huerfanas.length === 0 ? 'OK  ' : 'FALLA'} migraciones_huerfanas (en la base y sin archivo): ${huerfanas.length} ${huerfanas.join(', ')}`);
    console.log(`INFO migraciones_pendientes (en el repo y no registradas): ${pendientes.length} ${pendientes.slice(0, 20).join(', ')}`);
    if (huerfanas.length) fallo = true;
  }
  process.exit(fallo ? 1 : 0);
}
