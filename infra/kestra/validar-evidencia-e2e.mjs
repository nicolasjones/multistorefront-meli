// Validación real de la observabilidad de workers (spec 20260925-133820):
// publica las plantillas en el Kestra local del template, despacha el worker
// fixture por hosts SSH fixture y verifica eventos, logs publicados, capturas
// y limpieza, sin apariciones de la credencial centinela.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFixtureImages, command, db, docker, fixtureWorkerTag as imagen, localStack, provisionOrganization,
  publish, removeOrganizations, request, start, startSshHost, waitExecution, workerEnv,
} from './e2e-comun.mjs';

const sentinel = 'CENTINELA_OBSERVABILIDAD_NO_PERSISTIR';
const run = crypto.randomUUID();
const containers = ['obs-ssh-x', 'obs-ssh-y'];
const secretNames = ['x', 'y', 'tecnica', 'captura'].map((label) => `fixture-obs-${run}-${label}`);
// Namespace propio de la corrida: la limpieza con retención 0 solo puede
// purgar las ejecuciones de esta validación, nunca otras del Kestra local.
const namespace = `prueba.observabilidad.r${run.slice(0, 8)}`;
const flows = [['plantilla-generico', 'infra/kestra/flows/plantilla-generico.yml'], ['plantilla-dedicado', 'infra/kestra/flows/plantilla-dedicado.yml'], ['limpieza-evidencia', 'infra/kestra/flows/limpieza-evidencia.yml']];

const tarea = (execution, id) => execution.taskRunList?.filter((task) => task.taskId === id) ?? [];
function assert(condition, message) { if (!condition) throw new Error(message); }

async function descargar(ctx, executionId, uri) {
  const response = await fetch(`${ctx.base}/executions/${executionId}/file?path=${encodeURIComponent(uri)}`, { headers: ctx.headers });
  return { status: response.status, body: response.ok ? Buffer.from(await response.arrayBuffer()) : undefined };
}

// Guarda ejecución, logs y archivos publicados como artefactos para la
// búsqueda del centinela, y devuelve la ejecución y sus logs.
async function recolectar(ctx, id, label) {
  const execution = await request(ctx.base, `/executions/${id}`, { method: 'GET' }, ctx.headers);
  const logs = await request(ctx.base, `/logs/${id}`, { method: 'GET' }, ctx.headers);
  await writeFile(path.join(ctx.artifacts, `${label}.exec.json`), JSON.stringify(execution, null, 2));
  await writeFile(path.join(ctx.artifacts, `${label}.logs.json`), JSON.stringify(logs, null, 2));
  const publicados = {};
  for (const task of tarea(execution, 'publicar_logs')) {
    const file = await descargar(ctx, id, task.outputs.uri);
    assert(file.status === 200, `${label}: el archivo de logs publicado no se pudo descargar (${file.status}).`);
    publicados.logs = file.body.toString('utf8');
    await writeFile(path.join(ctx.artifacts, `${label}.logs-publicados.ion`), file.body);
  }
  return { execution, logs, publicados };
}

async function ejecutar(ctx, flowId, inputs, label) {
  const id = await start(ctx.base, namespace, flowId, { imagen, ...inputs }, ctx.headers);
  ctx.ejecuciones.push(id);
  console.log(`  ${label}: ejecución ${id}`);
  await waitExecution(ctx.base, id, ctx.headers);
  return { id, ...(await recolectar(ctx, id, label)) };
}

function eventos(logs) {
  return logs.map((log) => { try { return JSON.parse(log.message); } catch { return undefined; } })
    .filter((evento) => evento && typeof evento.etapa === 'string' && typeof evento.estado === 'string');
}

function assertLogsPublicados(resultado, label, esperado) {
  const [publicar] = tarea(resultado.execution, 'publicar_logs');
  assert(publicar?.state.current === 'SUCCESS', `${label}: publicar_logs no terminó en SUCCESS.`);
  assert(resultado.publicados.logs?.includes(esperado), `${label}: el archivo de logs publicado no contiene ${esperado}.`);
}

async function escenariosLogs(ctx) {
  console.log('Logs: genérico con dos organizaciones...');
  const exito = await ejecutar(ctx, 'plantilla-generico', { sistema_externo: 'fixture-exito' }, 'logs-generico');
  assert(exito.execution.state.current === 'SUCCESS', `Genérico terminó en ${exito.execution.state.current}.`);
  const fin = eventos(exito.logs).filter((evento) => evento.etapa === 'fin' && evento.estado === 'completada');
  assert(fin.length === 2, `Genérico: se esperaban 2 eventos fin/completada y hubo ${fin.length}.`);
  assert(fin.every((evento) => evento.ejecucion === exito.id && !Number.isNaN(Date.parse(evento.timestamp))), 'Genérico: eventos sin ejecución o timestamp válidos.');
  assertLogsPublicados(exito, 'Genérico', '\\"etapa\\":\\"fin\\"');

  console.log('Logs: dedicado con falla técnica...');
  const tecnica = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-tecnica' }, 'logs-tecnica');
  ctx.estadoTecnica = tecnica.execution.state.current;
  const [clasificar] = tarea(tecnica.execution, 'clasificar_y_alertar');
  assert(clasificar && !clasificar.outputs?.evaluationResult, 'Dedicado técnica: la clasificación de alertas cambió.');
  const ultima = eventos(tecnica.logs).filter((evento) => evento.estado === 'completada').at(-1);
  assert(ultima?.etapa === 'sesion', `Dedicado técnica: la última etapa completada debía ser sesion y fue ${ultima?.etapa}.`);
  assertLogsPublicados(tecnica, 'Dedicado técnica', '\\"estado\\":\\"fallida\\"');
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Descarga las capturas publicadas por cada despacho y las deja como
// artefactos; devuelve, por taskrun, los nombres de archivo publicados.
async function capturasPublicadas(ctx, resultado, label) {
  const publicaciones = [];
  for (const [index, task] of tarea(resultado.execution, 'publicar_evidencia').entries()) {
    const nombres = Object.keys(task.outputs?.outputFiles ?? {});
    for (const [nombre, uri] of Object.entries(task.outputs?.outputFiles ?? {})) {
      const file = await descargar(ctx, resultado.id, uri);
      assert(file.status === 200 && file.body.subarray(0, 4).equals(png), `${label}: la captura ${nombre} no es un PNG descargable.`);
      await writeFile(path.join(ctx.artifacts, `${label}-${index}-${nombre}`), file.body);
    }
    // El valor de la iteración (organización) vive en el taskrun padre.
    const padre = resultado.execution.taskRunList.find((item) => item.id === task.parentTaskRunId);
    publicaciones.push({ estado: task.state.current, valor: padre?.value, nombres });
  }
  return publicaciones;
}

async function archivosEnHost(ctx, executionId) {
  return Number(await docker(['exec', 'obs-ssh-x', 'sh', '-c', `find '${ctx.evidenciaBase}/${executionId}' -type f 2>/dev/null | wc -l`]));
}

async function escenariosEvidencia(ctx) {
  console.log('Evidencia: genérico con dos organizaciones...');
  const generico = await ejecutar(ctx, 'plantilla-generico', { sistema_externo: 'fixture-exito', evidencia_visual: 'true' }, 'evidencia-generico');
  assert(generico.execution.state.current === 'SUCCESS', `Genérico con evidencia terminó en ${generico.execution.state.current}.`);
  const porOrganizacion = await capturasPublicadas(ctx, generico, 'evidencia-generico');
  assert(porOrganizacion.length === 2 && new Set(porOrganizacion.map((item) => item.valor)).size === 2, 'Genérico: se esperaba una publicación por organización.');
  for (const item of porOrganizacion) {
    assert(item.estado === 'SUCCESS' && item.nombres.length === 2, `Genérico: publicación ${item.estado} con ${item.nombres.length} capturas.`);
    assert(item.nombres.every((nombre) => /^\d{8}T\d{9}Z-(sesion|fin)\.png$/.test(nombre)), `Genérico: nombres fuera de contrato: ${item.nombres.join(', ')}.`);
  }
  assert(await archivosEnHost(ctx, generico.id) === 0, 'Genérico: quedaron capturas en el host después de publicarlas.');
  const [conCapturas] = tarea(generico.execution, 'publicar_evidencia');
  ctx.muestra = { id: generico.id, captura: Object.values(conCapturas.outputs.outputFiles)[0], logs: tarea(generico.execution, 'publicar_logs')[0].outputs.uri, cantidadLogs: generico.logs.length };

  console.log('Evidencia: dedicado con falla técnica...');
  const tecnica = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-tecnica', evidencia_visual: 'true' }, 'evidencia-tecnica');
  assert(tecnica.execution.state.current === ctx.estadoTecnica, `Dedicado técnica con evidencia terminó en ${tecnica.execution.state.current} y sin evidencia en ${ctx.estadoTecnica}.`);
  const [clasificar] = tarea(tecnica.execution, 'clasificar_y_alertar');
  assert(clasificar && !clasificar.outputs?.evaluationResult, 'Dedicado técnica con evidencia: la clasificación de alertas cambió.');
  const [capturasFalla] = await capturasPublicadas(ctx, tecnica, 'evidencia-tecnica');
  assert(capturasFalla?.nombres.some((nombre) => nombre.endsWith('-proceso.png')), 'Dedicado técnica: falta la captura del fallo.');

  console.log('Evidencia: dedicado con falla de captura del worker...');
  const captura = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-captura-fallida', evidencia_visual: 'true' }, 'evidencia-captura-fallida');
  assert(captura.execution.state.current === 'SUCCESS', `Falla de captura terminó en ${captura.execution.state.current}.`);
  assert(eventos(captura.logs).some((evento) => evento.etapa === 'evidencia' && evento.estado === 'fallida'), 'Falla de captura: falta el evento evidencia/fallida.');

  console.log('Evidencia: dedicado sin evidencia...');
  const sinEvidencia = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.y, sistema_externo: 'fixture-exito' }, 'evidencia-deshabilitada');
  assert(sinEvidencia.execution.state.current === 'SUCCESS', `Sin evidencia terminó en ${sinEvidencia.execution.state.current}.`);
  assert(tarea(sinEvidencia.execution, 'publicar_evidencia').every((task) => task.state.current === 'SKIPPED'), 'Sin evidencia: publicar_evidencia no debía ejecutarse.');
  assert(await archivosEnHost(ctx, sinEvidencia.id) === 0, 'Sin evidencia: el despacho creó capturas.');

  console.log('Evidencia: carpeta del host no disponible...');
  await docker(['exec', 'obs-ssh-x', 'chmod', '0500', ctx.evidenciaBase]);
  try {
    const sinCarpeta = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.y, sistema_externo: 'fixture-exito', evidencia_visual: 'true' }, 'evidencia-sin-carpeta');
    assert(sinCarpeta.execution.state.current === 'SUCCESS', `Sin carpeta terminó en ${sinCarpeta.execution.state.current}.`);
    assert(sinCarpeta.logs.some((log) => log.message.includes('Carpeta de evidencia no disponible')), 'Sin carpeta: falta el evento de evidencia no disponible.');
    const [publicacion] = await capturasPublicadas(ctx, sinCarpeta, 'evidencia-sin-carpeta');
    assert(publicacion && publicacion.nombres.length === 0, 'Sin carpeta: no debía publicarse ninguna captura.');
  } finally {
    await docker(['exec', 'obs-ssh-x', 'chmod', '0700', ctx.evidenciaBase]);
  }
}

async function limpiar(ctx, retencion, label) {
  const inputs = { namespace };
  if (retencion !== undefined) inputs.retencion_dias = retencion;
  const id = await start(ctx.base, namespace, 'limpieza-evidencia', inputs, ctx.headers);
  console.log(`  ${label}: ejecución ${id}`);
  const execution = await waitExecution(ctx.base, id, ctx.headers);
  return { execution, purga: tarea(execution, 'purgar_evidencia_vencida')[0] };
}

async function escenariosLimpieza(ctx) {
  const { muestra } = ctx;
  console.log('Limpieza: plazo por defecto (30 días)...');
  const vigente = await limpiar(ctx, undefined, 'limpieza-30');
  assert(vigente.execution.state.current === 'SUCCESS' && vigente.purga.outputs.storagesCount === 0, 'Limpieza 30: no debía borrar evidencia reciente.');
  assert((await descargar(ctx, muestra.id, muestra.captura)).status === 200, 'Limpieza 30: la captura reciente dejó de estar disponible.');

  console.log('Limpieza: plazo inválido...');
  const invalida = await limpiar(ctx, '-1', 'limpieza-invalida');
  assert(invalida.execution.state.current === 'FAILED' && !invalida.purga, 'Limpieza inválida: debía fallar sin purgar.');
  assert((await descargar(ctx, muestra.id, muestra.captura)).status === 200, 'Limpieza inválida: borró evidencia.');

  console.log('Limpieza: plazo 0 (todo lo terminado está vencido)...');
  const vencida = await limpiar(ctx, '0', 'limpieza-0');
  const { purga } = vencida;
  assert(vencida.execution.state.current === 'SUCCESS' && purga.outputs.storagesCount > 0, 'Limpieza 0: no purgó evidencia vencida.');
  assert(purga.outputs.executionsCount === 0 && purga.outputs.logsCount === 0 && purga.outputs.metricsCount === 0, 'Limpieza 0: borró ejecuciones, logs o métricas.');
  assert((await descargar(ctx, muestra.id, muestra.captura)).status !== 200, 'Limpieza 0: la captura vencida sigue disponible.');
  assert((await descargar(ctx, muestra.id, muestra.logs)).status !== 200, 'Limpieza 0: el archivo de logs publicado vencido sigue disponible.');
  const execution = await request(ctx.base, `/executions/${muestra.id}`, { method: 'GET' }, ctx.headers);
  const logs = await request(ctx.base, `/logs/${muestra.id}`, { method: 'GET' }, ctx.headers);
  assert(execution.state.current === 'SUCCESS' && logs.length === muestra.cantidadLogs, 'Limpieza 0: la ejecución o sus logs cambiaron.');
  const [organizaciones] = await db(`select count(*) from public.conexiones where organizacion_id in ('${ctx.x}','${ctx.y}');`, ctx.dbContainer);
  assert(organizaciones === '4', 'Limpieza 0: se modificaron datos de Supabase.');

  console.log('Limpieza: segunda corrida idempotente...');
  const repetida = await limpiar(ctx, '0', 'limpieza-0-repetida');
  assert(repetida.execution.state.current === 'SUCCESS' && repetida.purga.outputs.storagesCount === 0, 'Limpieza repetida: volvió a borrar archivos.');
}

let ctx;
let work;
try {
  work = await mkdtemp(path.join(os.tmpdir(), 'observabilidad-'));
  const stack = await localStack(work);
  ctx = { ...stack, artifacts: path.join(work, 'artifacts'), ejecuciones: [] };
  await mkdir(ctx.artifacts);
  await buildFixtureImages();
  const x = await provisionOrganization(ctx.dbContainer, 'fixture-obs-x', 22061);
  ctx.x = x.id;
  const y = await provisionOrganization(ctx.dbContainer, 'fixture-obs-y', 22062);
  ctx.y = y.id;
  const vaultIds = await Promise.all(secretNames.map(async (name) => (await db(`select vault.create_secret('${sentinel}','${name}');`, ctx.dbContainer))[0]));
  await db(`insert into public.conexiones(organizacion_id,sistema_externo,credencial_vault_id) values ('${ctx.x}','fixture-exito','${vaultIds[0]}'),('${ctx.y}','fixture-exito','${vaultIds[1]}'),('${ctx.x}','fixture-tecnica','${vaultIds[2]}'),('${ctx.x}','fixture-captura-fallida','${vaultIds[3]}');`, ctx.dbContainer);
  const envX = path.join(work, 'x.env'); const envY = path.join(work, 'y.env');
  await writeFile(envX, workerEnv(ctx.x, x.password, ctx.supabasePort)); await writeFile(envY, workerEnv(ctx.y, y.password, ctx.supabasePort));
  // La base de evidencia se monta con la misma ruta absoluta que resuelve el
  // daemon Docker, así el bind mount del worker y el sftp ven la misma carpeta.
  ctx.evidenciaBase = await docker(['exec', ctx.kestra, 'printenv', 'ENV_EVIDENCIA_DIR_HOST']);
  assert(ctx.evidenciaBase.startsWith('/'), 'Kestra no tiene ENV_EVIDENCIA_DIR_HOST; recrealo con pnpm dev:kestra.');
  const montaje = ['-v', `${ctx.evidenciaBase}:${ctx.evidenciaBase}`];
  await startSshHost('obs-ssh-x', '22061', ctx.publicKey, envX, montaje);
  await startSshHost('obs-ssh-y', '22062', ctx.publicKey, envY, montaje);
  await docker(['exec', 'obs-ssh-x', 'sh', '-c', `chown fixture:fixture '${ctx.evidenciaBase}' && chmod 0700 '${ctx.evidenciaBase}'`]);
  for (const [id, source] of flows) {
    const copia = path.join(work, `${id}.yml`);
    const content = await readFile(source, 'utf8');
    assert(/^namespace: platform\.orquestacion$/m.test(content), `${source} no declara el namespace esperado.`);
    await writeFile(copia, content.replace(/^namespace: platform\.orquestacion$/m, `namespace: ${namespace}`));
    await publish(ctx.base, copia, namespace, id, ctx.headers);
  }
  await publish(ctx.base, 'infra/kestra/flows/alertas.yml', 'platform.alertas', 'alertas', ctx.headers);

  await escenariosLogs(ctx);
  await escenariosEvidencia(ctx);
  await escenariosLimpieza(ctx);

  await writeFile(path.join(ctx.artifacts, 'kestra-internal-storage.txt'), await docker(['exec', ctx.kestra, 'sh', '-c', `grep -rF -e '${sentinel}' -e '${Buffer.from(sentinel).toString('base64')}' /app/storage /tmp/kestra-wd 2>/dev/null; echo fin-busqueda`]));
  await command('node', ['infra/kestra/test-secretos-orquestacion.mjs', '--artifact-directory', ctx.artifacts], { env: { ...process.env, CREDENCIAL_CENTINELA: sentinel } });
  console.log('OK: observabilidad validada en ejecuciones reales sin apariciones del centinela.');
} finally {
  for (const [id] of flows) await fetch(`${ctx?.base}/flows/${namespace}/${id}`, { method: 'DELETE', headers: ctx?.headers }).catch(() => undefined);
  if (ctx?.evidenciaBase) {
    for (const id of ctx.ejecuciones) await docker(['exec', 'obs-ssh-x', 'rm', '-rf', `${ctx.evidenciaBase}/${id}`]).catch(() => undefined);
  }
  await Promise.all(containers.map((name) => docker(['rm', '-f', name]).catch(() => undefined)));
  await removeOrganizations(ctx?.dbContainer, [ctx?.x, ctx?.y], secretNames);
  if (work) await rm(work, { recursive: true, force: true });
}
