// Contrato estático de reintentos de las plantillas de despacho (bug
// reintentos-credencial-invalida). Kestra 1.3.35 no condiciona `retry` por
// código de salida: una falla no reintentable (código 78 o marca
// CREDENCIAL_INVALIDA:) termina el paso SSH en 0 con un output y la tarea JDBC
// siguiente (resolver_resultado_despacho) corta la secuencia sin relanzar el
// worker. No reemplaza la ejecución real de validar-reintentos-e2e.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const plantillas = ['infra/kestra/flows/plantilla-dedicado.yml', 'infra/kestra/flows/plantilla-generico.yml'];
const leer = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');

function bloqueTarea(content, id) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^\\s*- id: ${id}$`).test(line));
  assert.notEqual(start, -1, `falta la tarea ${id}`);
  const indent = lines[start].indexOf('-');
  const end = lines.findIndex((line, index) => index > start && line.trim() && (line.search(/\S/) < indent || (line.search(/\S/) === indent && line.trimStart().startsWith('- '))));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

for (const file of plantillas) {
  test(`${file} reintenta solo fallas técnicas del despacho`, async () => {
    const content = await leer(file);
    const ssh = bloqueTarea(content, 'despacho_ssh');
    assert.match(ssh, /retry:\n\s+type: exponential\n\s+maxAttempts: 3/, 'el retry técnico debe conservarse');
    const run = ssh.indexOf('docker run --rm');
    assert.ok(run !== -1, 'falta docker run');
    const posterior = ssh.slice(run);
    assert.match(posterior, /\{\{ inputs\.imagen \}\} 2>"\$WORKER_STDERR" \|\| WORKER_RC=\$\?\n/, 'el código y el stderr del worker deben capturarse sin cortar el script');
    assert.match(ssh, /WORKER_STDERR=\$\(mktemp\)/);
    assert.match(ssh, /WORKER_RC=0\n/);
    assert.match(posterior, /cat "\$WORKER_STDERR" >&2/, 'el stderr sanitizado del worker debe seguir llegando a Kestra');
    assert.match(posterior, /\[ "\$WORKER_RC" -eq 78 \]/, 'falta el código contractual 78');
    assert.match(posterior, /grep -q '\^CREDENCIAL_INVALIDA:' "\$WORKER_STDERR"/, 'falta la compatibilidad con workers que solo emiten la marca');
    assert.match(posterior, /printf '::\{"outputs":\{"no_reintentable":"%s"\}\}::\\n' "\$NO_REINTENTABLE"\n\s+exit 0/, 'la falla no reintentable debe publicar el motivo y terminar en 0');
    assert.match(posterior, /\n\s+exit "\$WORKER_RC"\n/, 'las fallas técnicas deben conservar su código para el retry');
    assert.match(posterior, /case "\$NO_REINTENTABLE" in CREDENCIAL_INVALIDA\|EJECUCION_NO_EN_CURSO\|YA_EN_CURSO\|CAPACIDAD_NO_HABILITADA\|CONFIGURACION_INVALIDA\) ;; \*\) NO_REINTENTABLE=NO_REINTENTABLE ;; esac/, 'el motivo debe limitarse a la lista contractual');
  });

  test(`${file} corta la secuencia en la única tarea posterior al despacho`, async () => {
    const content = await leer(file);
    const resultado = bloqueTarea(content, 'resolver_resultado_despacho');
    assert.match(resultado, /type: io\.kestra\.plugin\.jdbc\.postgresql\.Query/);
    assert.match(resultado, /sql: select private\.resolver_resultado_despacho\(CAST\(:conexion_id AS uuid\), :no_reintentable\);/);
    assert.match(resultado, /no_reintentable: "\{\{ outputs\.despacho_ssh[^}]*\.vars\.no_reintentable \?\? '' \}\}"/);
    assert.doesNotMatch(resultado, /retry:/, 'la falla no reintentable no puede reintentarse');
    assert.doesNotMatch(content, /- id: (marcar_conexion_activa|cortar_no_reintentable)$/m);
    assert.doesNotMatch(content, /io\.kestra\.plugin\.core\.execution\.(Fail|Assert)/, 'una tarea extra en la secuencia agota el heap de Kestra 1.3.35 al guardar el genérico');
    const ssh = content.indexOf('- id: despacho_ssh');
    assert.ok(ssh < content.indexOf('- id: resolver_resultado_despacho'), 'resolver_resultado_despacho va después de despacho_ssh');
    // Desde despacho_ssh hasta el finally de la secuencia hay exactamente dos tareas.
    const indent = content.slice(content.lastIndexOf('\n', ssh) + 1, ssh);
    const secuencia = content.slice(ssh - indent.length, content.indexOf(`\n${indent.slice(2)}finally:`, ssh));
    const hermanas = [...secuencia.matchAll(new RegExp(`^${indent}- id: (\\S+)$`, 'gm'))].map((m) => m[1]);
    assert.deepEqual(hermanas, ['despacho_ssh', 'resolver_resultado_despacho']);
    assert.match(bloqueTarea(content, 'clasificar_y_alertar'), /contains 'CREDENCIAL_INVALIDA:'/);
  });

  test(`${file} documenta agotar la orden outbox ante una falla no reintentable`, async () => {
    const content = await leer(file);
    const cabecera = content.slice(0, content.indexOf('\ninputs:'));
    assert.match(cabecera, /no_reintentable/);
    assert.match(cabecera, /agotar/);
  });
}
