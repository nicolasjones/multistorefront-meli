import { spawn } from 'node:child_process';
import { escaparCopy, ocultarClave } from './copy-clave.mjs';
import { argumentValue, requireEnvironment, redactError } from '../../scripts/operaciones.mjs';

const container = argumentValue(process.argv.slice(2), '--db-container', process.env.SUPABASE_DB_CONTAINER);
const providerCode = requireEnvironment('IA_PROVEEDOR_CODIGO');
const credentialName = requireEnvironment('IA_PROVEEDOR_CREDENCIAL');
const providerKey = requireEnvironment('IA_PROVEEDOR_CLAVE');
if (!/^[a-z0-9-]+$/.test(providerCode)) throw new Error('IA_PROVEEDOR_CODIGO debe coincidir con ^[a-z0-9-]+$.');
if (credentialName.length > 120) throw new Error('IA_PROVEEDOR_CREDENCIAL no puede superar 120 caracteres.');

async function locateContainer() {
  if (container) return container;
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['ps', '--format', '{{.Names}}'], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error('No se pudo listar Docker para localizar PostgreSQL local.')));
  });
  const matches = output.split(/\r?\n/).filter((name) => name.startsWith('supabase_db_'));
  if (matches.length !== 1) throw new Error('Definí SUPABASE_DB_CONTAINER: no se encontró exactamente un contenedor local supabase_db_*.');
  return matches[0];
}

const copyData = escaparCopy(providerKey);

const sql = `\\set proveedor_codigo \`printf %s "$IA_PROVEEDOR_CODIGO"\`
\\set credencial_nombre \`printf %s "$IA_PROVEEDOR_CREDENCIAL"\`
select set_config('app.ia.proveedor_codigo', :'proveedor_codigo', false);
select set_config('app.ia.credencial_nombre', :'credencial_nombre', false);
begin;
-- La clave viaja como DATOS de un COPY ... FROM STDIN (no como texto de una sentencia): así no queda en log_statement,
-- pg_stat_statements ni en el historial de psql. La tabla es temporal y se descarta al cerrar la transacción.
create temp table ia_clave_tmp(valor text not null) on commit drop;
copy ia_clave_tmp(valor) from stdin;
${copyData}
\\.
do $aprovisionar$
declare v_proveedor_id uuid; v_vault_secret_id uuid;
begin
  select id into v_proveedor_id from public.ia_proveedores where codigo = current_setting('app.ia.proveedor_codigo');
  if v_proveedor_id is null then raise exception 'No existe el proveedor de IA'; end if;
  select vault_secret_id into v_vault_secret_id from public.ia_credenciales_proveedor
    where proveedor_id = v_proveedor_id and nombre = current_setting('app.ia.credencial_nombre') for update;
  if found then
    perform vault.update_secret(v_vault_secret_id, (select valor from pg_temp.ia_clave_tmp), null, null, null);
  else
    v_vault_secret_id := vault.create_secret((select valor from pg_temp.ia_clave_tmp), 'ia-' || current_setting('app.ia.proveedor_codigo') || '-' || current_setting('app.ia.credencial_nombre'), 'Clave de proveedor de IA aprovisionada fuera de Refine y Kestra.', null);
    insert into public.ia_credenciales_proveedor(proveedor_id,nombre,vault_secret_id) values(v_proveedor_id,current_setting('app.ia.credencial_nombre'),v_vault_secret_id);
  end if;
end;
$aprovisionar$;
commit;`;

try {
  const dbContainer = await locateContainer();
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '--env', 'IA_PROVEEDOR_CODIGO', '--env', 'IA_PROVEEDOR_CREDENCIAL', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, IA_PROVEEDOR_CODIGO: providerCode, IA_PROVEEDOR_CREDENCIAL: credentialName }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stdin.end(sql);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Falló el aprovisionamiento de Vault.${stderr ? ' ' + stderr : ''}`)));
  });
  // Código y nombre se leen del entorno dentro de psql; la clave viaja solo por stdin como datos de COPY (nunca en el
  // texto SQL, en argumentos ni en variables de entorno del contenedor) y no se imprime ni se registra.
  console.log(`Credencial '${credentialName}' del proveedor '${providerCode}' aprovisionada en Vault.`);
} catch (error) {
  throw new Error(ocultarClave(redactError(error), providerKey));
}
