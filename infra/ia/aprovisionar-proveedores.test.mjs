import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import test from 'node:test';

const invoke = async (command, args, options = {}) => await new Promise((resolve, reject) => {
  const child = spawn(command, args, { env: { ...process.env, ...options.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  if (options.input) child.stdin.end(options.input); else child.stdin.end();
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} falló (${code}): ${stderr}`)));
});

test('aprovisiona y rota una única referencia Vault sin revelar la clave', async () => {
  const containers = (await invoke('docker', ['ps', '--format', '{{.Names}}'])).split(/\r?\n/);
  const dbContainer = process.env.SUPABASE_DB_CONTAINER ?? containers.find((name) => name.startsWith('supabase_db_multistorefront-meli'));
  assert.ok(dbContainer, 'requiere el contenedor local de Supabase');
  const providerCode = `fixture-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const credentialName = 'prueba-aprovisionamiento';
  const firstKey = `fixture-${randomUUID()}`;
  const query = async (sql) => await invoke('docker', ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql });
  try {
    await query(`insert into public.ia_proveedores(codigo,nombre,adaptador) values ('${providerCode}','Fixture aprovisionamiento','fixture');`);
    const firstOutput = await invoke('node', ['infra/ia/aprovisionar-proveedores.mjs', '--db-container', dbContainer], { env: { IA_PROVEEDOR_CODIGO: providerCode, IA_PROVEEDOR_CREDENCIAL: credentialName, IA_PROVEEDOR_CLAVE: firstKey } });
    assert.ok(!firstOutput.includes(firstKey), 'la primera carga no imprime la clave');
    const before = await query(`select vault_secret_id from public.ia_credenciales_proveedor c join public.ia_proveedores p on p.id=c.proveedor_id where p.codigo='${providerCode}' and c.nombre='${credentialName}';`);
    const secondKey = `fixture-${randomUUID()}`;
    const secondOutput = await invoke('node', ['infra/ia/aprovisionar-proveedores.mjs', '--db-container', dbContainer], { env: { IA_PROVEEDOR_CODIGO: providerCode, IA_PROVEEDOR_CREDENCIAL: credentialName, IA_PROVEEDOR_CLAVE: secondKey } });
    assert.ok(!secondOutput.includes(secondKey), 'la rotación no imprime la clave');
    const after = await query(`select vault_secret_id from public.ia_credenciales_proveedor c join public.ia_proveedores p on p.id=c.proveedor_id where p.codigo='${providerCode}' and c.nombre='${credentialName}';`);
    const count = await query(`select count(*) from public.ia_credenciales_proveedor c join public.ia_proveedores p on p.id=c.proveedor_id where p.codigo='${providerCode}' and c.nombre='${credentialName}';`);
    assert.equal(after, before, 'la rotación conserva el mismo secreto Vault');
    assert.equal(count, '1', 'hay una única referencia por proveedor y nombre');
  } finally {
    await query(`with borradas as (delete from public.ia_credenciales_proveedor c using public.ia_proveedores p where c.proveedor_id=p.id and p.codigo='${providerCode}' returning c.vault_secret_id) delete from vault.secrets where id in (select vault_secret_id from borradas); delete from public.ia_proveedores where codigo='${providerCode}';`);
  }
});
