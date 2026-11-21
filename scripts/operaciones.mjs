import { spawn } from 'node:child_process';

// Variables de libpq que cambian el destino o la autenticación de psql: se quitan del entorno hijo.
// Viven acá (y no en el script que las usó primero) porque ya los usan dos scripts.
export const VARIABLES_PG_PELIGROSAS = [
  'PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGOPTIONS',
  'PGSSLMODE', 'PGTARGETSESSIONATTRS', 'PGSYSCONFDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT',
];

// Entorno del proceso hijo sin las variables de libpq que podrían cambiar el destino ya validado.
export function entornoLimpio(base = process.env, extra = {}) {
  const env = { ...base, ...extra };
  for (const k of VARIABLES_PG_PELIGROSAS) delete env[k];
  return env;
}

// Corre un proceso y devuelve su código y sus dos salidas: para los scripts que LEEN la salida de
// psql (no sólo su código de salida).
export function ejecutarProceso(comando, args, { input, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(comando, args, { env: entornoLimpio(process.env, env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let salida = '';
    let error = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { error += d; });
    hijo.on('error', reject);
    hijo.on('close', (codigo) => resolve({ codigo, salida, error }));
    hijo.stdin.end(input ?? '');
  });
}

export function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno requerida ${name}.`);
  return value;
}

// Contraseña embebida en la URL de la base: aparte de la URL completa, se enmascara sola por si algún
// mensaje de psql/supabase la imprime suelta (viaja por PGPASSWORD, no por argv).
function contrasenaDeUrl(url) {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return undefined;
  }
}

export function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [process.env.KESTRA_BASIC_AUTH_PASSWORD, process.env.KESTRA_WEBHOOK_KEY, process.env.IA_PROVEEDOR_CLAVE, process.env.SUPABASE_DB_URL, contrasenaDeUrl(process.env.SUPABASE_DB_URL), process.env.SUPERSET_PASSWORD, process.env.SUPERSET_ANALITICA_DB_PASSWORD, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .reduce((redacted, value) => redacted.replaceAll(value, '[REDACTADO]'), message);
}

export async function run(command, args, options = {}) {
  const { input, env, quiet = false } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...env },
      stdio: input === undefined && !quiet ? 'inherit' : ['pipe', quiet ? 'pipe' : 'inherit', quiet ? 'pipe' : 'inherit'],
      windowsHide: true,
    });
    let stderr = '';
    if (input !== undefined) child.stdin.end(input);
    if (quiet) child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} terminó con código ${code ?? signal ?? 'desconocido'}${stderr ? ': ' + redactError(new Error(stderr)) : ''}`));
    });
  });
}

export function argumentValue(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${name}.`);
  return value;
}

export function separarContrasena(url) {
  const parsed = new URL(url);
  const contrasena = decodeURIComponent(parsed.password);
  parsed.password = '';
  return { urlSinContrasena: parsed.toString(), env: contrasena ? { PGPASSWORD: contrasena } : {} };
}
