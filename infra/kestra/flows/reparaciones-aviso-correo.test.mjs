// Contrato estático del flow reparaciones-aviso-correo (MSF-424, FR-022, FR-024, SC-005): reclama solo las órdenes
// `enviar-aviso-reparacion-*`, envía el correo por el SMTP de Kestra con los reintentos pedidos, cierra el aviso como
// enviado o fallido con un motivo fijo, escapa el HTML y no lleva importes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/reparaciones-aviso-correo.yml';

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
  assert.match(content, /^id: reparaciones-aviso-correo$/m);
  assert.match(content, /^namespace: producto\.service$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama solo las órdenes enviar-aviso-reparacion-* con un límite y un reclamo acotados', async () => {
  const content = await leer();
  assert.match(content, /private\.reclamar_despachos_capacidad\('enviar-aviso-reparacion-', 5, 900\)/);
  assert.doesNotMatch(content, /reclamar_despachos_ejecucion/, 'el reclamo genérico tomaría órdenes de otros productos');
  assert.doesNotMatch(content, /enviar-presupuesto-correo-/, 'no reclama las órdenes de presupuestos');
  assert.match(content, /detalle->>'aviso_id' as aviso_id/, 'el flow necesita el aviso a despachar');
});

test('envía el correo por el SMTP KESTRA_SMTP_* con asunto y cuerpo de la plantilla', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  assert.match(correo, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  for (const campo of ['host', 'port', 'username', 'password', 'transportStrategy', 'from']) {
    assert.match(correo, new RegExp(`${campo}: "\\{\\{ envs\\.kestra_smtp_`), `${campo} sale de KESTRA_SMTP_*`);
  }
  assert.match(correo, /to: ".*datos\)\.destinatario/);
  assert.match(correo, /subject: "Tu reparación .*\.numero.*: .*\.estado.* · .*\.empresa/, 'asunto: número, estado y tienda');
  for (const campo of ['cliente', 'empresa', 'numero', 'equipo', 'estado', 'descripcion']) {
    assert.match(correo, new RegExp(`datos\\)\\.${campo} \\| escape`), `el cuerpo lleva ${campo} escapado`);
  }
});

test('el HTML escapa todo valor de negocio', async () => {
  const correo = tarea(await leer(), 'enviar_correo');
  const cuerpo = correo.slice(correo.indexOf('htmlTextContent'), correo.indexOf('retry:'));
  const valores = cuerpo.match(/\{\{[^}]*\}\}/g) ?? [];
  assert.ok(valores.length >= 6);
  for (const valor of valores) assert.match(valor, /\| escape/, `${valor} sin escapar`);
});

test('no lleva importes ni costos en el correo ni se piden a la base', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /total|importe|precio|costo|\$/i);
});

test('solo envía si el aviso está pendiente y solo cierra una vez', async () => {
  const content = await leer();
  for (const id of ['enviar_correo', 'cerrar_enviado']) {
    assert.match(tarea(content, id), /runIf: .*accion == 'enviar'/, `${id} corre solo si el aviso está pendiente`);
  }
  assert.match(content, /when x\.d->>'estado_envio' = 'pendiente' then 'enviar' else 'nada'/, 'un aviso ya cerrado no reenvía');
  assert.match(tarea(content, 'cerrar_enviado'), /cerrar_aviso_reparacion\(CAST\(:aviso_id AS uuid\), NULL\)/, 'éxito = cierre sin motivo');
  assert.match(tarea(content, 'resolver_outbox'), /resolver_despacho_ejecucion\(.*'confirmar'/);
});

test('un fallo del correo reintenta 3 veces y luego cierra el aviso como fallido con un motivo fijo', async () => {
  const content = await leer();
  assert.match(tarea(content, 'enviar_correo'), /retry:\s+type: constant\s+maxAttempts: 3/);
  assert.match(tarea(content, 'cerrar_aviso_fallido'), /cerrar_aviso_reparacion\(CAST\(:aviso_id AS uuid\), 'No se pudo enviar el correo'\)/);
  assert.match(tarea(content, 'confirmar_despacho'), /resolver_despacho_ejecucion\(.*'agotar', 'AVISO_FALLIDO'/);
  assert.doesNotMatch(content, /errorLogs\(\)/, 'el mensaje del SMTP no se guarda: puede traer hosts o credenciales');
});

test('la base se consulta con el rol de servicio de Kestra y parámetros, sin concatenar', async () => {
  const content = await leer();
  assert.match(content, /username: kestra_orquestacion/);
  assert.match(content, /CAST\(:aviso_id AS uuid\)/);
  assert.doesNotMatch(content, /aviso_id\s*=\s*'\{\{/, 'el id nunca se interpola dentro del SQL');
  assert.doesNotMatch(content, /secret\(/, 'no usa secretos nuevos');
});
