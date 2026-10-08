// Validación real de reintentos (bug reintentos-credencial-invalida):
// publica las plantillas en el Kestra local del template, despacha el worker
// fixture por un host SSH fixture y verifica que una falla no reintentable
// lanza el worker una sola vez, que un reintento técnico de una ejecución ya
// cerrada no vuelve a abrir sesión y que las fallas técnicas se siguen
// reintentando. Solo usa el stack multistorefront-meli-*.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFixtureImages, command, db, docker, fixtureWorkerTag as imagen, localStack, provisionOrganization,
  publish, removeOrganizations, request, start, startSshHost, waitExecution, workerEnv,
} from './e2e-comun.mjs';

const sentinel = 'CENTINELA_REINTENTOS_NO_PERSISTIR';
const run = crypto.randomUUID();
const containers = ['reint-ssh-x'];
const sistemas = ['fixture-credencial', 'fixture-tecnica', 'fixture-tecnica-cierra', 'fixture-exito'];
const secretNames = sistemas.map((sistema) => `fixture-reint-${run}-${sistema}`);
// Namespace propio: no pisa los flows platform.orquestacion del Kestra local.
const namespace = `prueba.reintentos.r${run.slice(0, 8)}`;
const flows = [['plantilla-generico', 'infra/kestra/flows/plantilla-generico.yml'], ['plantilla-dedicado', 'infra/kestra/flows/plantilla-dedicado.yml']];

const tarea = (execution, id) => execution.taskRunList?.filter((task) => task.taskId === id) ?? [];
function assert(condition, message) { if (!condition) throw new Error(message); }

function eventos(logs) {
  return logs.filter((log) => log.taskId === 'despacho_ssh')
    .map((log) => { try { return JSON.parse(log.message); } catch { return undefined; } })
    .filter((evento) => evento && typeof evento.etapa === 'string' && typeof evento.estado === 'string');
}
const contar = (lista, etapa, estado) => lista.filter((evento) => evento.etapa === etapa && evento.estado === estado).length;

async function ejecutar(ctx, flowId, inputs, label) {
  const id = await start(ctx.base, namespace, flowId, { imagen, ...inputs }, ctx.headers);
  ctx.ejecuciones.push(id);
  console.log(`  ${label}: ejecución ${id}`);
  await waitExecution(ctx.base, id, ctx.headers);
  const execution = await request(ctx.base, `/executions/${id}`, { method: 'GET' }, ctx.headers);
  const logs = await request(ctx.base, `/logs/${id}`, { method: 'GET' }, ctx.headers);
  await writeFile(path.join(ctx.artifacts, `${label}.exec.json`), JSON.stringify(execution, null, 2));
  await writeFile(path.join(ctx.artifacts, `${label}.logs.json`), JSON.stringify(logs, null, 2));
  const [ssh] = tarea(execution, 'despacho_ssh');
  const [clasificar] = tarea(execution, 'clasificar_y_alertar');
  return { id, execution, logs, eventos: eventos(logs), intentos: ssh?.attempts?.length ?? 0, credencial: Boolean(clasificar?.outputs?.evaluationResult), clasificada: Boolean(clasificar) };
}

const estadoConexion = async (ctx, sistema) => (await db(`select estado from public.conexiones where id = '${ctx.conexiones[sistema]}';`, ctx.dbContainer))[0];
const reactivar = async (ctx, sistema) => db(`select private.marcar_conexion_activa('${ctx.conexiones[sistema]}');`, ctx.dbContainer);
async function nuevaEjecucion(ctx, sistema) {
  const [id] = await db(`insert into public.ejecuciones_worker(organizacion_id,conexion_id,capacidad_id,origen,actor) select organizacion_id, conexion_id, id, 'kestra', null from public.capacidades_ejecucion where conexion_id = '${ctx.conexiones[sistema]}' returning id;`, ctx.dbContainer);
  return id;
}

function assertCredencialSinReintento(resultado, label, { clasifica = true } = {}) {
  assert(resultado.intentos === 1, `${label}: despacho_ssh tuvo ${resultado.intentos} intentos; una credencial inválida no se reintenta.`);
  assert(contar(resultado.eventos, 'inicio', 'iniciada') === 1, `${label}: el worker se lanzó ${contar(resultado.eventos, 'inicio', 'iniciada')} veces.`);
  const [deteccion] = tarea(resultado.execution, 'detectar_tipo_falla');
  assert(deteccion?.outputs?.value?.includes('CREDENCIAL_INVALIDA:'), `${label}: el handler no recibió la marca de credencial.`);
  if (clasifica) assert(resultado.clasificada && resultado.credencial, `${label}: la falla no se clasificó como credencial.`);
  const [corte] = tarea(resultado.execution, 'resolver_resultado_despacho');
  assert(corte?.state.current === 'FAILED' && corte.attempts.length === 1, `${label}: resolver_resultado_despacho no cortó la secuencia en un intento.`);
}

async function escenarios(ctx) {
  console.log('Genérico: credencial inválida...');
  const generico = await ejecutar(ctx, 'plantilla-generico', { sistema_externo: 'fixture-credencial' }, 'generico-credencial');
  // La clasificación del genérico falla antes y después de este arreglo (lee
  // outputs.detectar_tipo_falla sin el índice de la iteración); es un defecto
  // propio, ver Follow-ups en .specify/bugs/reintentos-credencial-invalida/fix.md.
  // Acá se valida lo del bug: un intento, un lanzamiento y la marca al handler.
  assertCredencialSinReintento(generico, 'Genérico credencial', { clasifica: false });

  console.log('Dedicado: credencial inválida...');
  await reactivar(ctx, 'fixture-credencial');
  const dedicado = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-credencial' }, 'dedicado-credencial');
  assertCredencialSinReintento(dedicado, 'Dedicado credencial');
  assert(dedicado.execution.state.current === 'FAILED', `Dedicado credencial terminó en ${dedicado.execution.state.current}.`);
  assert(await estadoConexion(ctx, 'fixture-credencial') === 'credencial_invalida', 'Dedicado credencial: la conexión no quedó credencial_invalida.');

  console.log('Dedicado: falla técnica que cierra la ejecución (caso Xubio)...');
  const cerrada = await nuevaEjecucion(ctx, 'fixture-tecnica-cierra');
  const cierra = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-tecnica-cierra', ejecucion_id: cerrada }, 'dedicado-tecnica-cierra');
  assert(cierra.intentos === 2, `Técnica que cierra: se esperaban 2 intentos (técnico + verificación) y hubo ${cierra.intentos}.`);
  assert(contar(cierra.eventos, 'inicio', 'iniciada') === 2, 'Técnica que cierra: el worker debía lanzarse dos veces.');
  assert(contar(cierra.eventos, 'sesion', 'completada') === 1, 'Técnica que cierra: el reintento abrió sesión con la ejecución ya cerrada.');
  assert(contar(cierra.eventos, 'inicio', 'fallida') === 1, 'Técnica que cierra: falta el evento de ejecución no en curso.');
  assert(cierra.clasificada && !cierra.credencial, 'Técnica que cierra: la falla no se clasificó como técnica.');
  const [estado, motivo] = (await db(`select estado || '|' || coalesce(motivo_sanitizado,'') from public.ejecuciones_worker where id = '${cerrada}';`, ctx.dbContainer))[0].split('|');
  assert(estado === 'fallida' && motivo === 'FALLA_TECNICA_SANITIZADA', `Técnica que cierra: la ejecución quedó ${estado}/${motivo}.`);

  console.log('Dedicado: éxito con ejecución en curso...');
  const vigente = await nuevaEjecucion(ctx, 'fixture-exito');
  const exito = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-exito', ejecucion_id: vigente }, 'dedicado-exito-en-curso');
  assert(exito.execution.state.current === 'SUCCESS', `Éxito en curso terminó en ${exito.execution.state.current}.`);
  assert(exito.intentos === 1 && contar(exito.eventos, 'fin', 'completada') === 1, 'Éxito en curso: el worker no completó en un intento.');
  assert(exito.eventos.every((evento) => evento.ejecucion === vigente), 'Éxito en curso: los eventos no usan EJECUCION_ID.');
  await db(`update public.ejecuciones_worker set estado = 'exitosa', finalizada_en = now() where id = '${vigente}';`, ctx.dbContainer);

  console.log('Worker de otra organización: la verificación se rechaza...');
  const ajena = await nuevaEjecucion(ctx, 'fixture-exito');
  let rechazo = '';
  try {
    await docker(['run', '--rm', '-e', 'PGHOST=host.docker.internal', '-e', `PGPORT=${ctx.supabasePort}`, '-e', 'PGDATABASE=postgres', '-e', `PGUSER=worker_${ctx.y.replaceAll('-', '')}`, '-e', `PGPASSWORD=${ctx.passwordY}`, '--entrypoint', 'psql', imagen, '-v', 'ON_ERROR_STOP=1', '-Atqc', `select private.ejecucion_worker_en_curso('${ajena}')`]);
  } catch (error) { rechazo = error.message; }
  assert(rechazo.includes('NO_AUTORIZADO'), 'Otra organización: el worker pudo consultar una ejecución ajena.');
  await db(`update public.ejecuciones_worker set estado = 'fallida', finalizada_en = now() where id = '${ajena}';`, ctx.dbContainer);

  console.log('Dedicado: falla técnica transitoria (el retry se conserva)...');
  const tecnica = await ejecutar(ctx, 'plantilla-dedicado', { organizacion_id: ctx.x, sistema_externo: 'fixture-tecnica' }, 'dedicado-tecnica');
  assert(tecnica.intentos === 3, `Técnica: se esperaban 3 intentos y hubo ${tecnica.intentos}.`);
  assert(tecnica.clasificada && !tecnica.credencial, 'Técnica: la falla no se clasificó como técnica.');
  assert(tarea(tecnica.execution, 'resolver_resultado_despacho').length === 0, 'Técnica: se resolvió el despacho de una falla técnica.');
}

let ctx;
let work;
try {
  work = await mkdtemp(path.join(os.tmpdir(), 'reintentos-'));
  const stack = await localStack(work);
  ctx = { ...stack, artifacts: path.join(work, 'artifacts'), ejecuciones: [], conexiones: {} };
  await mkdir(ctx.artifacts);
  await buildFixtureImages();
  const x = await provisionOrganization(ctx.dbContainer, 'fixture-reint-x', 22071);
  ctx.x = x.id;
  // Y no tiene host SSH: solo aporta un rol worker de otra organización.
  const y = await provisionOrganization(ctx.dbContainer, 'fixture-reint-y', 22072);
  ctx.y = y.id; ctx.passwordY = y.password;
  for (const [index, sistema] of sistemas.entries()) {
    const [vault] = await db(`select vault.create_secret('${sentinel}','${secretNames[index]}');`, ctx.dbContainer);
    const [conexion] = await db(`insert into public.conexiones(organizacion_id,sistema_externo,credencial_vault_id) values ('${ctx.x}','${sistema}','${vault}') returning id;`, ctx.dbContainer);
    ctx.conexiones[sistema] = conexion;
    await db(`insert into public.capacidades_ejecucion(organizacion_id,conexion_id,clave) values ('${ctx.x}','${conexion}','reintentos-${sistema}');`, ctx.dbContainer);
  }
  const envX = path.join(work, 'x.env');
  await writeFile(envX, workerEnv(ctx.x, x.password, ctx.supabasePort));
  await startSshHost('reint-ssh-x', '22071', ctx.publicKey, envX);
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
  console.log('OK: reintentos validados en ejecuciones reales sin apariciones del centinela.');
} finally {
  for (const [id] of flows) await fetch(`${ctx?.base}/flows/${namespace}/${id}`, { method: 'DELETE', headers: ctx?.headers }).catch(() => undefined);
  await Promise.all(containers.map((name) => docker(['rm', '-f', name]).catch(() => undefined)));
  await removeOrganizations(ctx?.dbContainer, [ctx?.x, ctx?.y], secretNames);
  if (work) await rm(work, { recursive: true, force: true });
}
