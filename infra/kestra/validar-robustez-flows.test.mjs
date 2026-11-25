// Robustez operativa de los flows de Kestra (auditoría MSF-647: MSF-707, 708, 709, 710, 714).
// Contrato estático: errores avisados, concurrencia en los flows que corren seguido, timeouts en toda tarea que
// habla con algo externo, reclamos coherentes con el peor caso, purga del almacenamiento y verificación de
// restauración que falla ante un error real. No reemplaza una corrida en un Kestra real (docs/copias-y-restauracion.md).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const DIR = 'infra/kestra/flows';
const flows = readdirSync(DIR)
  .filter((f) => f.endsWith('.yml'))
  .map((f) => ({ archivo: f, id: f.replace(/\.yml$/, ''), texto: readFileSync(`${DIR}/${f}`, 'utf8').replace(/\r\n/g, '\n') }));
const leer = (id) => flows.find((f) => f.id === id).texto;

// Subflows de aviso y plantillas sin disparador propio: no se exigen a sí mismos un aviso.
const SIN_AVISO = new Set(['aviso-fallo-flujo', 'aviso-fallo-copias', 'aviso-fallo-api', 'alertas']);
const programados = flows.filter((f) => /^\s+cron: "/m.test(f.texto) && !SIN_AVISO.has(f.id));

const minutosEntreCorridas = (cron) => {
  const campo = cron.trim().split(/\s+/)[0];
  if (campo === '*') return 1;
  const m = campo.match(/^\*\/(\d+)$/);
  return m ? Number(m[1]) : Infinity;
};

test('hay flows programados que verificar', () => {
  assert.ok(programados.length >= 25, `solo ${programados.length}`);
});

test('todo flow programado tiene bloque errors: con aviso (MSF-709)', () => {
  for (const f of programados) {
    const errors = f.texto.match(/^errors:\n([\s\S]*?)(?=^\S)/m);
    assert.ok(errors, `${f.id}: falta el bloque errors:`);
    assert.match(errors[1], /(flowId: aviso-fallo-(flujo|copias|api)|registrar_evento_monitoreo)/, `${f.id}: el errors: debe avisar o registrar el fallo del monitor`);
  }
});

test('el aviso de fallo genérico no viaja el mensaje de error y limita la concurrencia', () => {
  const aviso = leer('aviso-fallo-flujo');
  assert.match(aviso, /concurrency:\n {2}limit: 1\n {2}behavior: CANCEL/);
  for (const f of programados.filter((x) => x.texto.includes('flowId: aviso-fallo-flujo'))) {
    assert.doesNotMatch(f.texto.slice(f.texto.search(/^errors:/m)), /errorLogs\(\)/, `${f.id}: el motivo no debe incluir el mensaje del error (puede traer secretos o datos de personas)`);
  }
});

test('todo flow que corre cada 15 minutos o menos tiene concurrency (MSF-710)', () => {
  for (const f of programados) {
    const crons = [...f.texto.matchAll(/^\s+cron: "([^"]+)"/gm)].map((m) => minutosEntreCorridas(m[1]));
    if (Math.min(...crons) > 15) continue;
    assert.match(f.texto, /^concurrency:\n {2}limit: \d+\n {2}behavior: (CANCEL|QUEUE|FAIL)/m, `${f.id}: falta concurrency`);
  }
});

const TIPOS_CON_TOPE = [
  'io.kestra.plugin.jdbc.postgresql.Query',
  'io.kestra.plugin.notifications.mail.MailSend',
  'io.kestra.plugin.core.http.Request',
  'io.kestra.plugin.core.http.Download',
  'io.kestra.plugin.scripts.shell.Commands',
  'io.kestra.plugin.fs.ssh.Command',
];

// Devuelve las tareas (bloques `- id:`) de un tipo dado, con su texto, ignorando comentarios.
function tareasDeTipo(texto, tipo) {
  const lineas = texto.split('\n');
  const res = [];
  for (let i = 0; i < lineas.length; i += 1) {
    const m = lineas[i].match(/^(\s*)type: (\S+)\s*$/);
    if (!m || m[2] !== tipo) continue;
    const ind = m[1].length;
    let j = i;
    while (j >= 0 && !/^\s*- id:/.test(lineas[j])) j -= 1;
    if (j < 0 || lineas[j].search(/\S/) + 2 !== ind) continue;
    let k = i + 1;
    while (k < lineas.length) {
      const l = lineas[k];
      if (l.trim() && !l.trim().startsWith('#') && l.search(/\S/) < ind) break;
      if (/^\s*- id:/.test(l) && l.search(/\S/) === ind - 2) break;
      k += 1;
    }
    res.push({ id: lineas[j].replace(/^\s*- id:\s*/, ''), bloque: lineas.slice(j, k).join('\n'), ind });
  }
  return res;
}

test('toda tarea de red, base, correo o script de un flow programado tiene timeout (MSF-709)', () => {
  for (const f of programados) {
    for (const tipo of TIPOS_CON_TOPE) {
      for (const t of tareasDeTipo(f.texto, tipo)) {
        assert.match(t.bloque, new RegExp(`^ {${t.ind}}timeout: PT`, 'm'), `${f.id}/${t.id}: falta timeout`);
      }
    }
  }
});

test('el reclamo es mayor o igual que el peor caso declarado y figura en el SQL (MSF-710)', () => {
  const conAnotacion = flows.filter((f) => /# reclamo-s: \d+ · peor-caso-s: \d+/.test(f.texto));
  assert.ok(conAnotacion.length >= 5, 'los flows con reclamo declaran su peor caso');
  for (const f of conAnotacion) {
    const [, reclamo, peor] = f.texto.match(/# reclamo-s: (\d+) · peor-caso-s: (\d+)/);
    assert.ok(Number(reclamo) >= Number(peor), `${f.id}: reclamo ${reclamo} s < peor caso ${peor} s`);
    assert.match(f.texto, new RegExp(`\\b${reclamo}\\b[^\\n]*\\)`), `${f.id}: el SQL debe usar el reclamo declarado (${reclamo} s)`);
  }
});

test('respaldo-postgres borra del almacenamiento de Kestra los archivos de su ejecución (MSF-707)', () => {
  const t = leer('respaldo-postgres');
  assert.match(t, /^finally:\n[\s\S]*type: io\.kestra\.plugin\.core\.storage\.PurgeCurrentExecutionFiles/m);
  const v = leer('verificar-restauracion');
  assert.match(v, /^finally:\n[\s\S]*PurgeCurrentExecutionFiles/m, 'la copia traída para verificar tampoco queda');
});

test('purgar-almacenamiento-kestra purga ejecuciones, logs, métricas y archivos con retención en días (MSF-707)', () => {
  const t = leer('purgar-almacenamiento-kestra');
  assert.match(t, /type: io\.kestra\.plugin\.core\.execution\.PurgeExecutions/);
  for (const clave of ['purgeExecution', 'purgeLog', 'purgeMetric', 'purgeStorage']) assert.match(t, new RegExp(`${clave}: true`));
  assert.match(t, /envs\.kestra_retencion_ejecuciones_dias/);
  assert.doesNotMatch(t, /- RUNNING|- CREATED|- QUEUED/, 'no toca ejecuciones en curso');
  assert.match(t, /cron: "/);
});

test('alerta-ausencia-respaldos falla si no hay copia reciente de la base ni de las imágenes (MSF-709)', () => {
  const t = leer('alerta-ausencia-respaldos');
  assert.doesNotMatch(t, /rclone lsf [^\n]*--max-age/, 'rclone lsf --max-age no filtra directorios: la fecha sale del nombre');
  assert.match(t, /exit 1/);
  assert.match(t, /flowId: aviso-fallo-copias/);
  assert.match(t, /cron: "30 6 \* \* \*"/);
  assert.match(t, /envs\.respaldos_ausencia_horas/);
});

test('los respaldos tienen timeout en pg_dump, copia a destino y copia de imágenes (MSF-709)', () => {
  for (const id of ['respaldo-postgres', 'respaldo-imagenes', 'verificar-restauracion', 'retencion-copias', 'alerta-ausencia-respaldos']) {
    for (const t of tareasDeTipo(leer(id), 'io.kestra.plugin.scripts.shell.Commands')) {
      assert.match(t.bloque, /^ {4,}timeout: PT/m, `${id}/${t.id}: falta timeout`);
    }
  }
});

// --- MSF-708: la verificación de restauración falla ante un error real de pg_restore ---

const patronEsperados = () => {
  const m = leer('verificar-restauracion').match(/PATRON_ESPERADOS='(.+)'\n/);
  assert.ok(m, 'falta PATRON_ESPERADOS');
  return m[1];
};
const inesperados = (lineas) => {
  try {
    return execFileSync('grep', ['-Ev', patronEsperados()], { input: lineas.join('\n'), encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
};

test('verificar-restauracion ya no tolera cualquier error de pg_restore (MSF-708)', () => {
  const t = leer('verificar-restauracion');
  assert.doesNotMatch(t, /pg_restore[^\n]*\|\| true/, 'pg_restore no puede ir con `|| true`');
  assert.match(t, /pg_restore --list/, 'valida el índice del archivo');
  assert.match(t, /errores no esperados/);
  assert.match(t, /no se restauró/, 'cada tabla con datos del índice debe existir');
  assert.match(t, /networkMode: none/);
});

test('el filtro acepta solo los errores esperados de un Postgres sin Supabase y rechaza el resto (MSF-708)', () => {
  const esperados = [
    'pg_restore: error: could not execute query: ERROR:  role "supabase_admin" does not exist',
    'pg_restore: error: could not execute query: ERROR:  extension "pg_graphql" is not available',
    'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
    'pg_restore: error: could not execute query: ERROR:  permission denied to create event trigger "x"',
  ];
  assert.deepEqual(inesperados(esperados), []);
  const reales = [
    'pg_restore: error: COPY failed for table "organizaciones": ERROR:  invalid input syntax for type integer: "x"',
    'pg_restore: error: could not execute query: ERROR:  relation "public.ventas" does not exist',
    'pg_restore: error: unexpected end of file',
    'pg_restore: error: could not read from input file: end of file',
  ];
  assert.deepEqual(inesperados([...esperados, ...reales]), reales);
});

// --- MSF-736: procesos zombi (chrome-headless <defunct>) ---

test('todo `docker run` de un worker lleva --init y tope de procesos (MSF-736)', () => {
  let total = 0;
  for (const f of flows) {
    for (const m of f.texto.matchAll(/^\s*docker run --rm \\\n([\s\S]*?)\n\s*\S*\{\{ (?:envs\.\w+|inputs\.imagen) \}\}/gm)) {
      total += 1;
      assert.match(m[1], /--init \\/, `${f.id}: falta --init`);
      assert.match(m[1], /--pids-limit /, `${f.id}: falta --pids-limit`);
    }
  }
  assert.ok(total >= 7, `solo se encontraron ${total} docker run`);
});

test('los contenedores de larga vida usan init: true (MSF-736)', () => {
  for (const [archivo, servicio] of [['infra/runner/compose.yaml', 'runner'], ['infra/playwright/compose.yaml', 'playwright'], ['infra/kestra/compose.yaml', 'kestra'], ['infra/superset/compose.yaml', 'superset'], ['infra/nango/compose.yaml', 'nango-server']]) {
    const texto = readFileSync(archivo, 'utf8');
    const bloque = texto.match(new RegExp(`^  ${servicio}:\\n([\\s\\S]*?)(?=^  \\S|^\\S|(?![\\s\\S]))`, 'm'));
    assert.ok(bloque, `${archivo}: no se encontró el servicio ${servicio}`);
    assert.match(bloque[1], /^ {4}init: true$/m, `${archivo}/${servicio}: falta init: true`);
  }
});

// --- MSF-712: workers por referencia inmutable ---

test('todo flow que despacha un worker rechaza tags mutables antes del pull (MSF-712)', () => {
  const patron = /grep -Eq '(\^local\/\|@sha256:\[0-9a-f\]\{64\}\$\|:\[0-9a-f\]\{40\}\$)'/;
  const conDocker = flows.filter((f) => f.texto.includes('- docker image inspect'));
  assert.ok(conDocker.length >= 7);
  for (const f of conDocker) {
    const guarda = f.texto.match(patron);
    assert.ok(guarda, `${f.id}: falta la guarda de imagen inmutable`);
    assert.ok(f.texto.indexOf(guarda[0]) < f.texto.indexOf('- docker image inspect'), `${f.id}: la guarda va antes del pull`);
  }
  const ok = (imagen) => {
    try {
      execFileSync('sh', ['-c', `printf '%s' "$1" | grep -Eq '^local/|@sha256:[0-9a-f]{64}$|:[0-9a-f]{40}$'`, 'sh', imagen]);
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(ok('ghcr.io/o/r-worker-x:latest'), false);
  assert.equal(ok('ghcr.io/o/r-worker-x'), false);
  assert.equal(ok(`ghcr.io/o/r-worker-x@sha256:${'a'.repeat(64)}`), true);
  assert.equal(ok(`ghcr.io/o/r-worker-x:${'b'.repeat(40)}`), true);
  assert.equal(ok('local/worker-x:latest'), true);
});

test('los sondeos de alta frecuencia no reproducen corridas perdidas tras una caída (recoverMissedSchedules: NONE)', () => {
  // Los respaldos, depuraciones y resúmenes diarios/semanales/mensuales SÍ recuperan la corrida perdida (default de Kestra).
  const sondeos = [];
  for (const f of flows) {
    const bloques = f.texto.split(/^  - id: /m).slice(1).filter((b) => /type: io\.kestra\.plugin\.core\.trigger\.Schedule/.test(b));
    for (const b of bloques) {
      const cron = b.match(/^\s+cron: "([^"]+)"/m)?.[1];
      if (cron && minutosEntreCorridas(cron) <= 15) sondeos.push({ f, b });
    }
  }
  assert.ok(sondeos.length >= 20, `solo ${sondeos.length}`);
  for (const { f, b } of sondeos) assert.match(b, /^\s+recoverMissedSchedules: NONE$/m, `${f.id}: falta recoverMissedSchedules: NONE`);
});
