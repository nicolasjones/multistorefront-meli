// Contrato estático del flow comprobantes-correo (MSF-245, FR-024): reclama solo las órdenes
// `enviar-presupuesto-correo-*`, adjunta el PDF, usa el SMTP de Kestra y cierra el envío como enviado o fallido.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/comprobantes-correo.yml';

const sinComentarios = (content) => content
  .split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const leer = async () => sinComentarios(await readFile(FLOW, 'utf8'));

/** Texto de una tarea (desde su `- id:` hasta el siguiente `- id:` del mismo nivel). */
const tarea = (content, id) => {
  const inicio = content.search(new RegExp(`^( *)- id: ${id}$`, 'm'));
  assert.ok(inicio >= 0, `existe la tarea ${id}`);
  const resto = content.slice(inicio);
  const sangria = /^( *)- id:/.exec(resto)[1];
  const siguiente = resto.slice(1).search(new RegExp(`^${sangria}- id:`, 'm'));
  return siguiente < 0 ? resto : resto.slice(0, siguiente + 1);
};

test('tiene id, namespace del producto y corre cada minuto', async () => {
  const content = await leer();
  assert.match(content, /^id: comprobantes-correo$/m);
  assert.match(content, /^namespace: producto\.ventas$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama solo las órdenes enviar-presupuesto-correo-* con un límite y un reclamo acotados', async () => {
  const content = await leer();
  assert.match(content, /private\.reclamar_despachos_capacidad\('enviar-presupuesto-correo-', 5, 900\)/);
  assert.doesNotMatch(content, /reclamar_despachos_ejecucion/, 'el reclamo genérico tomaría órdenes de otros productos');
  assert.doesNotMatch(content, /generar-documento-venta-/, 'no reclama las órdenes de generación de PDF');
  assert.match(content, /detalle->>'envio_id' as envio_id/, 'el flow necesita el envío a despachar');
});

test('envía el correo con el PDF adjunto usando el SMTP KESTRA_SMTP_*', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  for (const campo of ['host', 'port', 'username', 'password', 'transportStrategy', 'from']) {
    assert.match(correo, new RegExp(`${campo}: "\\{\\{ envs\\.kestra_smtp_`), `${campo} sale de KESTRA_SMTP_*`);
  }
  assert.match(correo, /to: ".*datos\)\.destinatario/);
  assert.match(correo, /attachments:\s+- name: "presupuesto-.*\.pdf"/);
  assert.match(correo, /uri: "\{\{ outputs\.descargar_pdf/);
  assert.match(correo, /\| escape/, 'los datos de negocio se escapan en el cuerpo HTML');
});

test('baja el PDF del bucket privado con un secreto de Kestra, sin claves en el YAML', async () => {
  const content = await leer();
  const descarga = tarea(content, 'descargar_pdf');
  assert.match(descarga, /envs\.comprobantes_storage_url \}\}\/storage\/v1\/object\/comprobantes-documentos\//);
  assert.match(descarga, /Authorization: "Bearer \{\{ secret\('COMPROBANTES_STORAGE_KEY'\) \}\}"/);
  assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{10,}/, 'ningún JWT literal en el flow');
});

test('solo envía cuando el PDF está generado y solo cierra una vez', async () => {
  const content = await leer();
  for (const id of ['descargar_pdf', 'enviar_correo', 'cerrar_enviado']) {
    assert.match(tarea(content, id), /runIf: .*accion == 'enviar'/, `${id} corre solo si el PDF está listo`);
  }
  assert.match(tarea(content, 'cerrar_fallido'), /runIf: .*accion == 'fallar'/);
  assert.match(content, /when x\.d->>'estado_envio' <> 'pendiente' then 'nada'/, 'un envío ya cerrado no reenvía');
  assert.match(tarea(content, 'cerrar_enviado'), /cerrar_envio_correo\(CAST\(:envio_id AS uuid\), NULL\)/, 'éxito = cierre sin error');
});

test('espera el PDF liberando la orden con demora acotada y confirma en los demás casos', async () => {
  const resolver = tarea(await leer(), 'resolver_outbox');
  assert.match(resolver, /resolver_despacho_ejecucion\(.*:accion, NULL, 30, 20\)/);
  assert.match(resolver, /== 'esperar' \? 'liberar' : 'confirmar'/);
});

test('un fallo del correo reintenta 3 veces y luego cierra el envío como fallido con un motivo fijo', async () => {
  const content = await leer();
  assert.match(tarea(content, 'enviar_correo'), /retry:\s+type: constant\s+maxAttempts: 3/);
  assert.match(tarea(content, 'descargar_pdf'), /retry:\s+type: constant\s+maxAttempts: 3/);
  assert.match(tarea(content, 'cerrar_envio_fallido'), /cerrar_envio_correo\(CAST\(:envio_id AS uuid\), 'No se pudo enviar el correo'\)/);
  assert.match(tarea(content, 'confirmar_despacho'), /resolver_despacho_ejecucion\(.*'agotar', 'ENVIO_FALLIDO'/);
  assert.doesNotMatch(content, /errorLogs\(\)/, 'el mensaje del SMTP no se guarda: puede traer hosts o credenciales');
});

test('la base se consulta con el rol de servicio de Kestra y parámetros, sin concatenar', async () => {
  const content = await leer();
  assert.match(content, /username: kestra_orquestacion/);
  assert.match(content, /CAST\(:envio_id AS uuid\)/);
  assert.doesNotMatch(content, /envio_id\s*=\s*'\{\{/, 'el id nunca se interpola dentro del SQL');
});
