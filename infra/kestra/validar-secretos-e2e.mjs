import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFixtureImages, command, db, docker, fixtureWorkerTag as tag, localStack, provisionOrganization,
  publish, removeOrganizations, request, start, startSshHost, waitExecution, workerEnv,
} from './e2e-comun.mjs';

const sentinel = 'CENTINELA_014_NO_PERSISTIR';
const containers = ['spec014-ssh-x', 'spec014-ssh-y'];
const fixtureRun = crypto.randomUUID();
const secretNames = ['x', 'y', 'tecnica', 'credencial'].map((label) => `fixture-014-${fixtureRun}-${label}`);

async function saveArtifacts(base, id, label, headers, artifactDirectory) {
  const execution = await request(base, `/executions/${id}`, { method: 'GET' }, headers);
  await writeFile(path.join(artifactDirectory, `${label}.exec.json`), JSON.stringify(execution, null, 2));
  const logs = await request(base, `/logs/${id}`, { method: 'GET' }, headers);
  await writeFile(path.join(artifactDirectory, `${label}.logs.json`), JSON.stringify(logs, null, 2));
  const alert = execution.taskRunList?.find((task) => ['alertar_tecnica', 'alertar_credencial'].includes(task.taskId) && task.outputs?.executionId);
  if (alert) {
    const alertId = alert.outputs.executionId;
    await writeFile(path.join(artifactDirectory, `${label}.alertas.exec.json`), JSON.stringify(await request(base, `/executions/${alertId}`, { method: 'GET' }, headers), null, 2));
    await writeFile(path.join(artifactDirectory, `${label}.alertas.logs.json`), JSON.stringify(await request(base, `/logs/${alertId}`, { method: 'GET' }, headers), null, 2));
  }
  return execution;
}
function assertClassification(execution, expectedCredential, label) {
  const task = execution.taskRunList?.find((item) => item.taskId === 'clasificar_y_alertar');
  if (!task) throw new Error(`${label} no generó la tarea clasificar_y_alertar.`);
  if (Boolean(task.outputs?.evaluationResult) !== expectedCredential) throw new Error(`${label} tuvo una clasificación inesperada.`);
}

let dbContainer;
let organizationX;
let organizationY;
let work;
try {
  work = await mkdtemp(path.join(os.tmpdir(), 'spec014-'));
  const stack = await localStack(work);
  dbContainer = stack.dbContainer;
  const { base, headers, kestra, publicKey, supabasePort } = stack;
  const artifactDirectory = path.join(work, 'artifacts');
  await mkdir(artifactDirectory);
  await buildFixtureImages();
  const x = await provisionOrganization(dbContainer, 'fixture-014-x', 22041);
  organizationX = x.id;
  const y = await provisionOrganization(dbContainer, 'fixture-014-y', 22042);
  organizationY = y.id;
  const vaultIds = await Promise.all(secretNames.map(async (name) => (await db(`select vault.create_secret('${sentinel}','${name}');`, dbContainer))[0]));
  const connections = Array.from({ length: 4 }, () => crypto.randomUUID());
  await db(`insert into public.conexiones(id,organizacion_id,sistema_externo,credencial_vault_id) values ('${connections[0]}','${organizationX}','fixture-exito','${vaultIds[0]}'),('${connections[1]}','${organizationY}','fixture-exito','${vaultIds[1]}'),('${connections[2]}','${organizationX}','fixture-tecnica','${vaultIds[2]}'),('${connections[3]}','${organizationX}','fixture-credencial','${vaultIds[3]}');`, dbContainer);
  const envX = path.join(work, 'x.env'); const envY = path.join(work, 'y.env');
  await writeFile(envX, workerEnv(organizationX, x.password, supabasePort)); await writeFile(envY, workerEnv(organizationY, y.password, supabasePort));
  await startSshHost('spec014-ssh-x', '22041', publicKey, envX);
  await startSshHost('spec014-ssh-y', '22042', publicKey, envY);
  await publish(base, 'infra/kestra/flows/plantilla-generico.yml', 'platform.orquestacion', 'plantilla-generico', headers);
  await publish(base, 'infra/kestra/flows/plantilla-dedicado.yml', 'platform.orquestacion', 'plantilla-dedicado', headers);
  await publish(base, 'infra/kestra/flows/alertas.yml', 'platform.alertas', 'alertas', headers);
  console.log('Disparando escenario de éxito (dos organizaciones)...');
  const successId = await start(base, 'platform.orquestacion', 'plantilla-generico', { sistema_externo: 'fixture-exito', imagen: tag }, headers);
  await waitExecution(base, successId, headers);
  const success = await saveArtifacts(base, successId, 'exito', headers, artifactDirectory);
  if (success.state.current !== 'SUCCESS') throw new Error(`El escenario de éxito terminó en ${success.state.current}, se esperaba SUCCESS.`);
  console.log('Disparando escenario de falla de credencial (con reintento)...');
  const credentialId = await start(base, 'platform.orquestacion', 'plantilla-dedicado', { organizacion_id: organizationX, sistema_externo: 'fixture-credencial', imagen: tag }, headers);
  await waitExecution(base, credentialId, headers);
  assertClassification(await saveArtifacts(base, credentialId, 'falla-credencial', headers, artifactDirectory), true, 'La falla de credencial');
  console.log('Disparando escenario de falla técnica...');
  const technicalId = await start(base, 'platform.orquestacion', 'plantilla-dedicado', { organizacion_id: organizationX, sistema_externo: 'fixture-tecnica', imagen: tag }, headers);
  await waitExecution(base, technicalId, headers);
  assertClassification(await saveArtifacts(base, technicalId, 'falla-tecnica', headers, artifactDirectory), false, 'La falla técnica');
  await writeFile(path.join(artifactDirectory, 'kestra-internal-storage.txt'), await docker(['exec', kestra, 'sh', '-c', `grep -rF -e '${sentinel}' -e '${Buffer.from(sentinel).toString('base64')}' /app/storage /tmp/kestra-wd 2>/dev/null; echo fin-busqueda`]));
  await command('node', ['infra/kestra/test-secretos-orquestacion.mjs', '--artifact-directory', artifactDirectory], { env: { ...process.env, CREDENCIAL_CENTINELA: sentinel } });
  console.log('OK: recorrido completo sin apariciones del centinela en ninguna ejecución real.');
} finally {
  await Promise.all(containers.map((name) => docker(['rm', '-f', name]).catch(() => undefined)));
  await removeOrganizations(dbContainer, [organizationX, organizationY], secretNames);
  if (work) await rm(work, { recursive: true, force: true });
}
