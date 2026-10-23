import { argumentValue, redactError, requireEnvironment, run } from './operaciones.mjs';

const args = process.argv.slice(2);
const entorno = argumentValue(args, '--entorno');
if (!['staging', 'production'].includes(entorno)) throw new Error('Uso: pnpm db:migrar:cloud -- --entorno staging|production');

const dbUrl = requireEnvironment('SUPABASE_DB_URL');
const claveAnalitica = requireEnvironment('SUPERSET_ANALITICA_DB_PASSWORD');

// El rol superset_analitica nace nologin y sin contraseña en la migración; acá se habilita (el SQL
// viaja por stdin para que la contraseña no aparezca en argv). No es atómico con `db push`: si psql
// falla o no está instalado, las migraciones quedan aplicadas y el rol sigue nologin; el comando es
// idempotente, así que se reintenta entero. Con `log_statement` en `all`/`ddl` la contraseña puede quedar
// en los logs de Postgres: dejarlo en `none` o `mod` fuera de `ddl` para el rol que corre la migración.
function sqlHabilitarRolAnalitica(clave) {
  return `alter role superset_analitica with login password '${clave.replaceAll("'", "''")}';\n`;
}

try {
  await run('supabase', ['db', 'push', '--db-url', dbUrl]);
  await run('psql', [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sqlHabilitarRolAnalitica(claveAnalitica) });
  console.log(`Migraciones aplicadas contra el proyecto Supabase de ${entorno}.`);
} catch (error) {
  throw new Error(redactError(error));
}
