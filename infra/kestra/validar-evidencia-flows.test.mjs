// Contrato estático de observabilidad de las plantillas de despacho y de la
// limpieza de evidencia (spec 20260925-133820). No reemplaza la ejecución real
// de validar-evidencia-e2e.mjs: fija las piezas que esa ejecución ejercita.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plantillas = ['infra/kestra/flows/plantilla-dedicado.yml', 'infra/kestra/flows/plantilla-generico.yml'];
const leer = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');

// Devuelve el bloque YAML que empieza en la línea `- id: <id>` y termina en el
// siguiente elemento de la misma indentación o menor.
function bloqueTarea(content, id) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^\\s*- id: ${id}$`).test(line));
  assert.notEqual(start, -1, `falta la tarea ${id}`);
  const indent = lines[start].indexOf('-');
  const end = lines.findIndex((line, index) => index > start && line.trim() && (line.search(/\S/) < indent || (line.search(/\S/) === indent && line.trimStart().startsWith('- '))));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

for (const file of plantillas) {
  test(`${file} publica los logs del despacho como output en éxito y error`, async () => {
    const content = await leer(file);
    assert.match(content, /-e KESTRA_EJECUCION_ID="\{\{ execution\.id \}\}"/);
    const finalDeFlow = content.slice(content.lastIndexOf('\nfinally:\n'));
    assert.ok(content.includes('\nfinally:\n'), 'falta el finally de flow');
    const logs = bloqueTarea(finalDeFlow, 'publicar_logs');
    assert.match(logs, /type: io\.kestra\.plugin\.core\.log\.Fetch/);
    assert.match(logs, /tasksId:\n\s+- despacho_ssh/);
    assert.match(logs, /allowFailure: true/);
    assert.match(logs, /allowWarning: true/);
  });

  test(`${file} monta y publica evidencia solo cuando está habilitada`, async () => {
    const content = await leer(file);
    assert.match(bloqueTarea(content, 'evidencia_visual'), /type: BOOLEAN\n\s+required: false/);
    const efectiva = '{{ inputs.evidencia_visual ?? envs.evidencia_visual }}';
    const inicio = content.indexOf('# Evidencia visual (spec 20260925-133820)');
    const run = content.indexOf('docker run --rm', inicio);
    assert.ok(inicio !== -1 && run > inicio, 'falta la preparación de evidencia antes de docker run');
    const preparacion = content.slice(inicio, run);
    assert.ok(preparacion.includes(`EVIDENCIA_VISUAL="${efectiva}"`));
    assert.doesNotMatch(preparacion, />&2/, 'la evidencia no puede escribir en stderr');
    assert.match(preparacion, /find "\$EVIDENCIA_BASE" -mindepth 1 -maxdepth 1 -type d -mtime \+\{\{ envs\.evidencia_retencion_dias \}\}/);
    assert.match(preparacion, /\n\s*set --\n\s*if \[ "\$EVIDENCIA_VISUAL" = "true" \]; then\n[\s\S]*set -- -v "\$EVIDENCIA_CARPETA:\/evidencia:rw" -e EVIDENCIA_DIR=\/evidencia[\s\S]*\n\s*fi\n\s*$/);
    assert.equal(content.split('/evidencia:rw').length, 2, 'el montaje de evidencia debe existir una sola vez');
    assert.match(content.slice(run), /^docker run --rm \\\n[\s\S]*-e EVIDENCIA_VISUAL="\$EVIDENCIA_VISUAL" \\\n\s+"\$@" \\\n/);

    const publicar = bloqueTarea(content, 'publicar_evidencia');
    for (const esperado of ['type: io.kestra.plugin.fs.sftp.Downloads', `runIf: "${efectiva}"`, 'rootDir: false', 'action: DELETE', 'maxFiles: 50', 'allowFailure: true', 'allowWarning: true', "keyfile: \"{{ secret('ORQUESTACION_SSH_PRIVATE_KEY') }}\""]) {
      assert.ok(publicar.includes(esperado), `publicar_evidencia no contiene ${esperado}`);
    }
    assert.match(publicar, /from: "\{\{ envs\.evidencia_dir_host \}\}\/\{\{ execution\.id \}\}\/\{\{ [^}]+organizacion_id \}\}\/"/);
    const antesDePublicar = content.slice(0, content.indexOf('- id: publicar_evidencia'));
    assert.match(antesDePublicar, /\n(\s+)finally:\n\s+# Publica las capturas[^\n]*\n[^\n]*\n\s+$/, 'publicar_evidencia debe vivir en el finally de la secuencia de despacho');
  });
}

test('limpieza-evidencia purga solo almacenamiento vencido, a diario y con plazo válido', async () => {
  const content = await leer('infra/kestra/flows/limpieza-evidencia.yml');
  assert.match(content, /^id: limpieza-evidencia$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule\n\s+cron: "[^"]+"/);
  const validar = bloqueTarea(content, 'validar_retencion');
  assert.match(validar, /type: io\.kestra\.plugin\.core\.execution\.Assert/);
  assert.match(validar, /\| length\) >= 1 and [^\n]+\| length\) <= 5 \}\}/);
  assert.ok(validar.includes("| replace({'0': '', '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7': '', '8': '', '9': ''}) | length) == 0"), 'la retención debe validarse como entero sin signo');
  const purgar = bloqueTarea(content, 'purgar_evidencia_vencida');
  assert.ok(content.indexOf('- id: validar_retencion') < content.indexOf('- id: purgar_evidencia_vencida'), 'la validación debe correr antes de purgar');
  assert.match(purgar, /type: io\.kestra\.plugin\.core\.execution\.PurgeExecutions/);
  for (const flag of ['purgeExecution: false', 'purgeLog: false', 'purgeMetric: false', 'purgeStorage: true']) assert.ok(purgar.includes(flag), `falta ${flag}`);
  assert.match(purgar, /endDate: "\{\{ now\(\) \| dateAdd\(-1 \* \(\(inputs\.retencion_dias \?\? envs\.evidencia_retencion_dias\) \| number\), 'DAYS'\) \}\}"/);
  const estados = purgar.slice(purgar.indexOf('states:')).split('\n').slice(1).filter((line) => /^\s+- /.test(line)).map((line) => line.trim().slice(2));
  assert.deepEqual(estados.sort(), ['CANCELLED', 'FAILED', 'KILLED', 'SUCCESS', 'WARNING']);
  assert.doesNotMatch(content, /jdbc|ssh\.|sftp\./i, 'la limpieza no toca bases de datos ni hosts');
});
