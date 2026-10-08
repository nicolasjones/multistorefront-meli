// Validación real de FR-013 (bug conexion-invalida-trabada): publica las
// plantillas en el Kestra local del template y verifica que una conexión en
// error vuelve a correr y queda activa, que una en credencial_invalida no la
// recorre el genérico pero sí la destraban el disparo manual de un
// administrador y la actualización de la credencial. Solo usa el stack
// multistorefront-meli-*.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFixtureImages, command, db, dbAsSuperadmin, docker, fixtureWorkerTag as imagen, localStack, provisionOrganization,
  publish, removeOrganizations, request, start, startSshHost, waitExecution, workerEnv,
} from './e2e-comun.mjs';

const sentinel = 'CENTINELA_CONEXION_TRABADA_NO_PERSISTIR';
const run = crypto.randomUUID();
const containers = ['trabada-ssh-x'];
const secretNames = [`fixture-trabada-${run}`];
const namespace = `prueba.trabada.r${run.slice(0, 8)}`;
const flows = [['plantilla-generico', 'infra/kestra/flows/plantilla-generico.yml'], ['plantilla-dedicado', 'infra/kestra/flows/plantilla-dedicado.yml']];
const clave = 'reporte-trabado';

const tarea = (execution, id) => execution.taskRunList?.filter((task) => task.taskId === id) ?? [];
function assert(condition, message) { if (!condition) throw new Error(message); }

async function ejecutar(ctx, flowId, inputs, label) {
  const id = await start(ctx.base, namespace, flowId, { imagen, sistema_externo: 'fixture-exito', ...inputs }, ctx.headers);
  console.log(`  ${label}: ejecución ${id}`);
  await waitExecution(ctx.base, id, ctx.headers);
  const execution = await request(ctx.base, `/executions/${id}`, { method: 'GET' }, ctx.headers);
  const logs = await request(ctx.base, `/logs/${id}`, { method: 'GET' }, ctx.headers);
  await writeFile(path.join(ctx.artifacts, `${label}.exec.json`), JSON.stringify(execution, null, 2));
  await writeFile(path.join(ctx.artifacts, `${label}.logs.json`), JSON.stringify(logs, null, 2));
  return execution;
}

const estado = async (ctx) => (await db(`select estado from public.conexiones where id = '${ctx.conexion}';`, ctx.dbContainer))[0];
const fijarEstado = async (ctx, valor) => db(`update public.conexiones set estado = '${valor}' where id = '${ctx.conexion}';`, ctx.dbContainer);
const despachos = (execution) => tarea(execution, 'despacho_ssh').length;

async function escenarios(ctx) {
  console.log('Genérico con la conexión en error...');
  await fijarEstado(ctx, 'error');
  const error = await ejecutar(ctx, 'plantilla-generico', {}, 'generico-error');
  assert(error.state.current === 'SUCCESS' && despachos(error) === 1, `Error: el genérico no la despachó (${error.state.current}, ${despachos(error)} despachos).`);
  assert(await estado(ctx) === 'activa', 'Error: la ejecución exitosa no la dejó activa (FR-013).');

  console.log('Genérico con la conexión en credencial_invalida...');
  await fijarEstado(ctx, 'credencial_invalida');
  const saltea = await ejecutar(ctx, 'plantilla-generico', {}, 'generico-credencial-invalida');
  assert(saltea.state.current === 'SUCCESS' && despachos(saltea) === 0, 'Credencial inválida: el genérico reintentó el login.');
  assert(await estado(ctx) === 'credencial_invalida', 'Credencial inválida: el estado cambió sin ejecución.');

  console.log('Disparo manual del administrador...');
  const [superadmin] = await db('select user_id from superadmins limit 1;', ctx.dbContainer);
  const [ejecucion] = await dbAsSuperadmin(`select public.iniciar_ejecucion_worker('${ctx.conexion}', '${clave}', 'manual', '${superadmin}');`, ctx.dbContainer);
  assert(/^[0-9a-f-]{36}$/.test(ejecucion ?? ''), 'Manual: el administrador no pudo iniciar la ejecución.');
  const manual = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x }, 'dedicado-manual');
  assert(manual.state.current === 'SUCCESS' && despachos(manual) === 1, `Manual: el despacho terminó en ${manual.state.current}.`);
  assert(await estado(ctx) === 'activa', 'Manual: la ejecución exitosa no la dejó activa (FR-013).');
  await db(`update public.ejecuciones_worker set estado = 'exitosa', finalizada_en = now() where id = '${ejecucion}';`, ctx.dbContainer);

  console.log('Programado sobre credencial_invalida (sin cambios)...');
  await fijarEstado(ctx, 'credencial_invalida');
  let rechazo = '';
  try { await dbAsSuperadmin(`select public.iniciar_ejecucion_worker('${ctx.conexion}', '${clave}', 'programada');`, ctx.dbContainer); } catch (error) { rechazo = error.message; }
  assert(rechazo.includes('CONEXION_CREDENCIAL_INVALIDA'), 'Programado: se aceptó una conexión con la credencial rechazada.');

  console.log('Actualización de la credencial...');
  await dbAsSuperadmin(`select public.actualizar_credencial_conexion('${ctx.conexion}', '${sentinel}');`, ctx.dbContainer);
  assert(await estado(ctx) === 'activa', 'Credencial actualizada: la conexión no volvió a activa.');
  const destrabada = await ejecutar(ctx, 'plantilla-generico', {}, 'generico-credencial-actualizada');
  assert(destrabada.state.current === 'SUCCESS' && despachos(destrabada) === 1, 'Credencial actualizada: el genérico no la volvió a despachar.');
  assert(await estado(ctx) === 'activa', 'Credencial actualizada: la conexión no quedó activa.');
}

let ctx;
let work;
try {
  work = await mkdtemp(path.join(os.tmpdir(), 'trabada-'));
  const stack = await localStack(work);
  ctx = { ...stack, artifacts: path.join(work, 'artifacts') };
  await mkdir(ctx.artifacts);
  await buildFixtureImages();
  const x = await provisionOrganization(ctx.dbContainer, 'fixture-trabada-x', 22081);
  ctx.x = x.id;
  const [vault] = await db(`select vault.create_secret('${sentinel}','${secretNames[0]}');`, ctx.dbContainer);
  [ctx.conexion] = await db(`insert into public.conexiones(organizacion_id,sistema_externo,credencial_vault_id) values ('${ctx.x}','fixture-exito','${vault}') returning id;`, ctx.dbContainer);
  await db(`insert into public.capacidades_ejecucion(organizacion_id,conexion_id,clave) values ('${ctx.x}','${ctx.conexion}','${clave}');`, ctx.dbContainer);
  const envX = path.join(work, 'x.env');
  await writeFile(envX, workerEnv(ctx.x, x.password, ctx.supabasePort));
  await startSshHost('trabada-ssh-x', '22081', ctx.publicKey, envX);
  for (const [id, source] of flows) {
    const copia = path.join(work, `${id}.yml`);
    const content = await readFile(source, 'utf8');
    assert(/^namespace: platform\.orquestacion$/m.test(content), `${source} no declara el namespace esperado.`);
    await writeFile(copia, content.replace(/^namespace: platform\.orquestacion$/m, `namespace: ${namespace}`));
    await publish(ctx.base, copia, namespace, id, ctx.headers);
  }
  await publish(ctx.base, 'infra/kestra/flows/alertas.yml', 'platform.alertas', 'alertas', ctx.headers);

  await escenarios(ctx);

  await writeFile(path.join(ctx.artifacts, 'kestra-internal-storage.txt'), await docker(['exec', ctx.kestra, 'sh', '-c', `grep -rF -e '${sentinel}' -e '${Buffer.from(sentinel).toString('base64')}' /app/storage /tmp/kestra-wd 2>/dev/null; echo fin-busqueda`]));
  await command('node', ['infra/kestra/test-secretos-orquestacion.mjs', '--artifact-directory', ctx.artifacts], { env: { ...process.env, CREDENCIAL_CENTINELA: sentinel } });
  console.log('OK: FR-013 validado en ejecuciones reales sin apariciones del centinela.');
} finally {
  for (const [id] of flows) await fetch(`${ctx?.base}/flows/${namespace}/${id}`, { method: 'DELETE', headers: ctx?.headers }).catch(() => undefined);
  await Promise.all(containers.map((name) => docker(['rm', '-f', name]).catch(() => undefined)));
  await removeOrganizations(ctx?.dbContainer, [ctx?.x], secretNames);
  if (work) await rm(work, { recursive: true, force: true });
}
