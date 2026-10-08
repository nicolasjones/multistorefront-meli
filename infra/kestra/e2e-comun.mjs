// Helpers compartidos por las validaciones E2E reales contra el Kestra y el
// Supabase locales (specs 014 y 20260925-133820). Solo usan el
// stack multistorefront-meli-*; nunca contenedores de otro proyecto.
import { execFile, spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const root = process.cwd();
export const fixtureWorkerTag = 'multistorefront-meli/spec014-fixture-worker:local';
export const fixtureSshTag = 'multistorefront-meli/spec014-fixture-ssh:local';

export async function command(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(`${file} terminó con código ${error.code ?? 'desconocido'}${detail ? `: ${detail}` : ''}`);
  }
}

export async function docker(args, options) { return (await command('docker', args, options)).stdout.trim(); }
export async function compose(args, options) { return (await docker(['compose', '-f', 'infra/kestra/compose.yaml', ...args], options)).trim(); }
async function commandWithInput(file, args, input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${file} terminó con código ${code ?? 'desconocido'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
    child.stdin.end(input);
  });
}
export async function db(sql, dbContainer) {
  const output = await commandWithInput('docker', ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], sql);
  return output.split(/\r?\n/).filter(Boolean);
}
export async function dbAsSuperadmin(sql, dbContainer) {
  const [superadmin] = await db('select user_id from superadmins limit 1;', dbContainer);
  if (!superadmin) throw new Error('No hay un superadmin local para aprovisionar el fixture; sembralo antes de correr este comando.');
  return await db(`do $$ begin perform set_config('request.jwt.claims', json_build_object('sub','${superadmin}','role','authenticated')::text, false); end $$; ${sql}`, dbContainer);
}
export async function workerRoleRemove(organizationId, dbContainer) {
  const role = `worker_${organizationId.replaceAll('-', '')}`;
  await db(`revoke all on schema private from ${role}; revoke all on function private.organizacion_del_rol_actual() from ${role}; drop role if exists ${role};`, dbContainer);
}
export async function waitPort(port, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { await command('node', ['-e', `require('net').connect(${Number(port)}, '127.0.0.1').once('connect',()=>process.exit(0)).once('error',()=>process.exit(1))`]); return; } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
  }
  throw new Error(`${label} no quedó disponible en 127.0.0.1:${port} dentro de 30 segundos.`);
}
export function basicHeader(configuration, envFile) {
  const fromEnv = (name, fallback) => process.env[name] || fallback;
  let username = fromEnv('KESTRA_BASIC_AUTH_USERNAME', 'admin@local.test');
  let password = fromEnv('KESTRA_BASIC_AUTH_PASSWORD', 'change-me-local');
  for (const line of envFile.split(/\r?\n/)) {
    const [, key, value] = /^(KESTRA_BASIC_AUTH_(?:USERNAME|PASSWORD))=(.*)$/.exec(line) || [];
    if (key === 'KESTRA_BASIC_AUTH_USERNAME') username = value.trim();
    if (key === 'KESTRA_BASIC_AUTH_PASSWORD') password = value.trim();
  }
  const found = /basic-auth:\s*\n\s*enabled:\s*true\s*\n\s*username:\s*([^\s]+)\s*\n\s*password:\s*([^\s]+)/s.exec(configuration);
  if (found) [, username, password] = found;
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'ascii').toString('base64')}` };
}
export async function request(base, endpoint, options, headers) {
  const response = await fetch(`${base}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) throw new Error(`Kestra devolvió HTTP ${response.status}.`);
  return response.status === 204 ? undefined : await response.json();
}
export async function publish(base, source, namespace, id, headers) {
  const body = await readFile(source, 'utf8');
  const options = { headers: { 'content-type': 'application/x-yaml' }, body };
  try { await request(base, `/flows/${namespace}/${id}`, { ...options, method: 'PUT' }, headers); }
  catch (error) {
    if (!error.message.includes('HTTP 404')) throw error;
    await request(base, '/flows', { ...options, method: 'POST' }, headers);
  }
}
export async function start(base, namespace, id, inputs, headers) {
  const form = new FormData();
  for (const [key, value] of Object.entries(inputs)) form.set(key, value);
  return (await request(base, `/executions/${namespace}/${id}`, { method: 'POST', body: form }, headers)).id;
}
export async function waitExecution(base, id, headers) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const execution = await request(base, `/executions/${id}`, { method: 'GET' }, headers);
    if (!['CREATED', 'RUNNING', 'RETRYING'].includes(execution.state.current)) return execution;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`La ejecución ${id} no llegó a un estado terminal a tiempo.`);
}

// Resuelve el stack local del template: contenedor de Supabase DB, Kestra,
// puertos, cabecera de autenticación y la clave pública de orquestación.
export async function localStack(work) {
  const localDatabases = (await docker(['ps', '--format', '{{.Names}} {{.ID}}'])).split(/\r?\n/);
  const dbContainer = localDatabases.find((line) => line.startsWith('supabase_db_multistorefront-meli-supabase-'))?.split(' ')[1];
  const kestra = await compose(['ps', '-q', 'kestra']);
  if (!dbContainer || !kestra) throw new Error('Supabase o Kestra local no están levantados para el fixture E2E.');
  const kestraPort = (await docker(['port', kestra, '8080/tcp'])).match(/:(\d+)$/)?.[1];
  const supabasePort = (await docker(['port', dbContainer, '5432/tcp'])).match(/:(\d+)$/)?.[1];
  if (!kestraPort || !supabasePort) throw new Error('No se pudo resolver un puerto local requerido por el fixture.');
  const keyBase64 = await docker(['exec', kestra, 'sh', '-c', 'printf "%s" "$SECRET_ORQUESTACION_SSH_PRIVATE_KEY"']);
  if (!keyBase64) throw new Error('Kestra no tiene una clave SSH de orquestación utilizable.');
  const keyFile = path.join(work, 'orquestacion.key');
  await writeFile(keyFile, Buffer.from(keyBase64, 'base64'), { mode: 0o600 });
  if (process.platform === 'win32') {
    const username = process.env.USERNAME;
    if (!username) throw new Error('No se pudo resolver el usuario actual para proteger la clave temporal.');
    await command('icacls', [keyFile, '/inheritance:r', '/grant:r', `${username}:(R,W)`]);
  }
  const publicKey = await command('ssh-keygen', ['-y', '-f', keyFile]).then((result) => result.stdout.trim());
  await rm(keyFile, { force: true });
  const headers = basicHeader(await docker(['exec', kestra, 'cat', '/app/confs/application.yml']), await readFile('infra/kestra/.env', 'utf8').catch(() => ''));
  return { dbContainer, kestra, supabasePort, publicKey, headers, base: `http://127.0.0.1:${kestraPort}/api/v1/main` };
}

export async function buildFixtureImages() {
  await docker(['build', '-t', fixtureWorkerTag, 'infra/kestra/fixtures/worker']);
  await docker(['build', '-t', fixtureSshTag, 'infra/kestra/fixtures/ssh-host']);
}

// Da de alta una organización con su rol de worker y servidor de despacho
// apuntando al host SSH fixture del puerto indicado.
export async function provisionOrganization(dbContainer, name, port) {
  const id = crypto.randomUUID();
  await db(`insert into public.organizaciones(id,nombre) values ('${id}','${name}');`, dbContainer);
  const [password] = await dbAsSuperadmin(`select password_rol from public.aprovisionar_servidor_organizacion('${id}','host.docker.internal','fixture','no-usar',${Number(port)});`, dbContainer);
  return { id, password };
}

export function workerEnv(organizationId, password, supabasePort) {
  return `PGHOST=host.docker.internal\nPGPORT=${supabasePort}\nPGDATABASE=postgres\nPGUSER=worker_${organizationId.replaceAll('-', '')}\nPGPASSWORD=${password}\nWORKER_NETWORK=bridge\n`;
}

// `extraArgs` permite montar, por ejemplo, la base de evidencia con la misma
// ruta absoluta que resuelve el daemon Docker.
export async function startSshHost(name, port, publicKey, envFile, extraArgs = []) {
  await docker(['run', '-d', '--name', name, '-p', `127.0.0.1:${port}:2222`, '-e', `PUBLIC_KEY=${publicKey}`, '-e', 'USER_NAME=fixture', '-e', 'PASSWORD_ACCESS=false', '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', `${envFile}:/opt/automation-platform/worker.env:ro`, ...extraArgs, fixtureSshTag]);
  await waitPort(port, `SSH fixture ${name}`);
}

export async function removeOrganizations(dbContainer, organizationIds, secretNames) {
  if (!dbContainer) return;
  const ids = organizationIds.filter(Boolean);
  if (ids.length) await db(`delete from public.organizaciones where id in (${ids.map((id) => `'${id}'`).join(',')});`, dbContainer).catch(() => undefined);
  for (const id of ids) await workerRoleRemove(id, dbContainer).catch(() => undefined);
  if (secretNames.length) await db(`delete from vault.secrets where name in (${secretNames.map((name) => `'${name}'`).join(',')});`, dbContainer).catch(() => undefined);
}
