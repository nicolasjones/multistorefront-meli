// Contrato estático del flow reparaciones-aviso-whatsapp (MSF-952, S-1 de MSF-118): reclama solo las órdenes
// `enviar-aviso-whatsapp-*`, entrega el mensaje al proveedor de mensajería con la plantilla aprobada, cierra el
// aviso como enviado o fallido con un motivo fijo y no lleva importes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOW = 'infra/kestra/flows/reparaciones-aviso-whatsapp.yml';

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
  assert.match(content, /^id: reparaciones-aviso-whatsapp$/m);
  assert.match(content, /^namespace: producto\.service$/m);
  assert.match(content, /type: io\.kestra\.plugin\.core\.trigger\.Schedule/);
  assert.match(content, /cron: "\* \* \* \* \*"/);
});

test('reclama solo las órdenes enviar-aviso-whatsapp-* con un límite y un reclamo acotados', async () => {
  const content = await leer();
  assert.match(content, /private\.reclamar_despachos_capacidad\('enviar-aviso-whatsapp-', 5, 1200\)/);
  assert.doesNotMatch(content, /reclamar_despachos_ejecucion/, 'el reclamo genérico tomaría órdenes de otros productos');
  assert.doesNotMatch(content, /enviar-aviso-reparacion-/, 'no reclama las órdenes del aviso por correo');
  assert.match(content, /detalle->>'aviso_id' as aviso_id/, 'el flow necesita el aviso a despachar');
});

test('entrega el mensaje al proveedor con el teléfono, la plantilla y la clave de idempotencia', async () => {
  const envio = tarea(await leer(), 'enviar_whatsapp');
  assert.match(envio, /type: io\.kestra\.plugin\.core\.http\.Request/);
  assert.match(envio, /method: POST/);
  assert.match(envio, /contentType: application\/json/);
  assert.match(envio, /uri: "\{\{ envs\.whatsapp_api_url \}\}"/, 'la URL del proveedor sale del entorno');
  assert.match(envio, /Authorization: "Bearer \{\{ secret\('WHATSAPP_TOKEN'\) \}\}"/, 'el token del proveedor es un secreto');
  assert.match(envio, /"telefono": fromJson\([^)]*\)\.destinatario/);
  assert.match(envio, /"plantilla": envs\.whatsapp_plantilla/, 'la plantilla aprobada sale del entorno');
  assert.match(envio, /"clave": fromJson\([^)]*\)\.clave_envio/, 'la clave de idempotencia viaja al proveedor');
  assert.match(envio, /\| toJson/, 'el cuerpo se arma en JSON (los valores de negocio van escapados)');
});

test('la plantilla del mensaje lleva cliente, tienda, reparación, equipo y estado, sin importes', async () => {
  const envio = tarea(await leer(), 'enviar_whatsapp');
  for (const campo of ['cliente', 'empresa', 'numero', 'equipo', 'estado', 'descripcion']) {
    assert.match(envio, new RegExp(`datos\\)\\.${campo}`), `el mensaje lleva ${campo}`);
  }
  assert.match(envio, /"Hola " ~/, 'la plantilla empieza con el saludo');
  assert.doesNotMatch(envio, /total|importe|precio|costo|\$/i, 'el mensaje no lleva importes ni costos');
});

test('no manda el aviso por correo ni toca el flujo del correo', async () => {
  const content = await leer();
  assert.doesNotMatch(content, /MailSend|kestra_smtp/i, 'este flow es el del canal WhatsApp');
});

test('solo envía si el aviso está pendiente y solo cierra una vez', async () => {
  const content = await leer();
  for (const id of ['enviar_whatsapp', 'cerrar_enviado']) {
    assert.match(tarea(content, id), /runIf: .*accion == 'enviar'/, `${id} corre solo si el aviso está pendiente`);
  }
  assert.match(content, /when x\.d->>'estado_envio' = 'pendiente' then 'enviar' else 'nada'/, 'un aviso ya cerrado no reenvía');
  assert.match(tarea(content, 'cerrar_enviado'), /cerrar_aviso_reparacion\(CAST\(:aviso_id AS uuid\), NULL\)/, 'éxito = cierre sin motivo');
  assert.match(tarea(content, 'resolver_outbox'), /resolver_despacho_ejecucion\(.*'confirmar'/);
});

test('un fallo del proveedor reintenta 3 veces y luego cierra el aviso como fallido con un motivo fijo', async () => {
  const content = await leer();
  assert.match(tarea(content, 'enviar_whatsapp'), /retry:\s+type: constant\s+maxAttempts: 3/);
  assert.match(tarea(content, 'cerrar_aviso_fallido'), /cerrar_aviso_reparacion\(CAST\(:aviso_id AS uuid\), 'No se pudo enviar el WhatsApp'\)/);
  assert.match(tarea(content, 'confirmar_despacho'), /resolver_despacho_ejecucion\(.*'agotar', 'AVISO_FALLIDO'/);
  assert.doesNotMatch(content, /errorLogs\(\)/, 'el mensaje del proveedor no se guarda: puede traer tokens o credenciales');
});

test('la base se consulta con el rol de servicio de Kestra y parámetros, sin concatenar', async () => {
  const content = await leer();
  assert.match(content, /username: kestra_orquestacion/);
  assert.match(content, /CAST\(:aviso_id AS uuid\)/);
  assert.doesNotMatch(content, /aviso_id\s*=\s*'\{\{/, 'el id nunca se interpola dentro del SQL');
});
