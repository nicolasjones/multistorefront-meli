import { spawn } from 'node:child_process';
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

const sql = `\\set proveedor_codigo \`printf %s "$IA_PROVEEDOR_CODIGO"\`
\\set credencial_nombre \`printf %s "$IA_PROVEEDOR_CREDENCIAL"\`
\\set clave \`printf %s "$IA_PROVEEDOR_CLAVE"\`
select set_config('app.ia.proveedor_codigo', :'proveedor_codigo', false);
select set_config('app.ia.credencial_nombre', :'credencial_nombre', false);
select set_config('app.ia.clave', :'clave', false);
begin;
do $aprovisionar$
declare v_proveedor_id uuid; v_vault_secret_id uuid;
begin
  select id into v_proveedor_id from public.ia_proveedores where codigo = current_setting('app.ia.proveedor_codigo');
  if v_proveedor_id is null then raise exception 'No existe el proveedor de IA'; end if;
  select vault_secret_id into v_vault_secret_id from public.ia_credenciales_proveedor
    where proveedor_id = v_proveedor_id and nombre = current_setting('app.ia.credencial_nombre') for update;
  if found then
    perform vault.update_secret(v_vault_secret_id, current_setting('app.ia.clave'), null, null, null);
  else
    v_vault_secret_id := vault.create_secret(current_setting('app.ia.clave'), 'ia-' || current_setting('app.ia.proveedor_codigo') || '-' || current_setting('app.ia.credencial_nombre'), 'Clave de proveedor de IA aprovisionada fuera de Refine y Kestra.', null);
    insert into public.ia_credenciales_proveedor(proveedor_id,nombre,vault_secret_id) values(v_proveedor_id,current_setting('app.ia.credencial_nombre'),v_vault_secret_id);
  end if;
end;
$aprovisionar$;
commit;`;

try {
  const dbContainer = await locateContainer();
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', '--env', 'IA_PROVEEDOR_CODIGO', '--env', 'IA_PROVEEDOR_CREDENCIAL', '--env', 'IA_PROVEEDOR_CLAVE', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, IA_PROVEEDOR_CODIGO: providerCode, IA_PROVEEDOR_CREDENCIAL: credentialName, IA_PROVEEDOR_CLAVE: providerKey }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stdin.end(sql);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Falló el aprovisionamiento de Vault.${stderr ? ' ' + stderr : ''}`)));
  });
  // Las variables se leen dentro de PostgreSQL en una única sesión; nunca se
  // interpolan en SQL ni en argumentos expuestos por el host.
  console.log(`Credencial '${credentialName}' del proveedor '${providerCode}' aprovisionada en Vault.`);
} catch (error) {
  throw new Error(redactError(error));
}
