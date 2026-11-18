---
owner: tecnico
sources:
  - specs/20261028-100000-service-cobro-y-avisos
  - specs/20270323-100000-service-ideas-futuras-v2
  - infra/kestra/flows/reparaciones-aviso-correo.yml
  - infra/kestra/flows/reparaciones-aviso-whatsapp.yml
  - supabase/migrations/20270201200133_reparacion_avisos.sql
  - supabase/migrations/20270201200134_avisar_cliente_reparacion.sql
  - supabase/migrations/20270201200135_avisos_de_reparacion.sql
  - supabase/migrations/20270201200136_avisos_reparacion_flow.sql
  - supabase/migrations/20270418000403_reparacion_avisos_whatsapp_envio.sql
---

# Service técnico · Avisos al cliente por cambio de estado

F-SVC-14 (MSF-424) · épica MSF-232 · spec `specs/20261028-100000-service-cobro-y-avisos/`.

Cuando una reparación cambia de estado, el taller puede **avisar por correo al cliente**. El aviso nunca bloquea ni
revierte el cambio de estado: la pantalla primero cambia el estado y **después** pide el aviso; si el aviso falla, el
estado queda cambiado y se informa el error. El detalle de la reparación (`/service-tecnico/reparaciones/:id`) tiene
la casilla **«Avisar al cliente»** junto al selector de estado (destildada por defecto), el botón **«Avisar al
cliente»** del encabezado (avisa el estado actual sin cambiarlo) y la sección **«Avisos al cliente»** con el
historial (Pendiente / Enviado / Fallido) y **«Reenviar»**.

## Modelo (Principio VII: esquema)

| Tabla | Esquema | Por qué | RLS |
|-------|---------|---------|-----|
| `dominio.reparacion_avisos` (nueva) | `dominio` | Historial de avisos de una reparación: entidad del producto Service, no plataforma. | Por `organizacion_id`, nivel `service_tecnico` (`lectura`/`edicion`) y tienda accesible. Sin `insert/update/delete` para `authenticated`; `anon` sin acceso. `authenticated` lee solo columnas sin el correo del cliente (`destinatario`) ni la ejecución: el historial completo sale por `avisos_de_reparacion`. |

Columnas: `estado_id` y `estado_nombre` (copia del estado avisado), `destinatario` (correo del cliente **al pedir** el
aviso), `estado_envio` (`pendiente` | `enviado` | `fallido`), `intentos`, `error` (motivo fijo y corto, ≤ 500),
`solicitado_por`, `solicitado_en`, `enviado_en`, `ejecucion_id`. FK compuestas por organización hacia la reparación,
el estado y la tienda. Índice único parcial `reparacion_avisos_pendiente_uq` sobre `(reparacion_id, estado_id) where
estado_envio = 'pendiente'`: **un solo aviso pendiente por reparación y estado**.

La **outbox** (`public.capacidades_ejecucion`, `ejecuciones_worker`, `despachos_ejecucion`) solo recibe filas por la
RPC. Se usa la conexión `comprobantes-pdf` que ya usa el envío de presupuestos (spec 019): sin conexión ni proveedor
nuevos. Una organización sin esa conexión recibe un error claro (`P0001`, hint `sin_conexion`) y no se crea nada.

Migraciones (aditivas, con reversión en el encabezado):

- `20270201200133_reparacion_avisos.sql` — la tabla, sus índices y su RLS.
- `20270201200134_avisar_cliente_reparacion.sql` — RPC que encola el aviso.
- `20270201200135_avisos_de_reparacion.sql` — RPC de lectura del historial.
- `20270201200136_avisos_reparacion_flow.sql` — funciones `private` del flow y cierre de pendientes vencidos.

## RPC

| RPC | Qué hace | Permisos |
|-----|----------|----------|
| `public.avisar_cliente_reparacion(p_reparacion uuid, p_estado_id uuid default null)` | En **una transacción**: bloquea la reparación (`for update`), crea el aviso `pendiente` del estado pedido (por defecto el actual) con el correo **actual** del cliente y deja la orden de despacho `enviar-aviso-reparacion-<aviso>`. Devuelve `{ resultado: 'encolado' \| 'sin_correo', aviso_id }`. Idempotente: con un pendiente del mismo estado devuelve ese. Sin correo válido → `sin_correo`, no encola. | `service_tecnico` en `edicion` y tienda accesible. `42501` sin permiso, `P0002` inexistente o ajena, `55000` anulada, `22023` estado inexistente. `revoke … from public, anon` + `grant execute … to authenticated`. |
| `public.avisos_de_reparacion(p_reparacion uuid)` | Historial, más reciente primero: estado, destinatario, resultado, motivo, fechas y **nombre** de quien lo pidió (nunca su correo). Antes de leer cierra como fallidos los pendientes vencidos. | `service_tecnico` en `lectura` o más y tienda accesible. Mismos `revoke`/`grant`. |

«Reenviar» es la misma RPC con el `estado_id` del aviso original: crea un aviso **nuevo** con el correo actual del
cliente. Solo con `edicion`; disponible en avisos Enviados y Fallidos (no en Pendientes).

## Flow de Kestra

`infra/kestra/flows/reparaciones-aviso-correo.yml` (namespace `producto.service`, corre cada minuto), con el patrón de
`comprobantes-correo`:

1. Reclama solo las órdenes `enviar-aviso-reparacion-*` (`private.reclamar_despachos_capacidad`).
2. Resuelve los datos con `private.datos_aviso_reparacion(aviso)`: destinatario, cliente, tienda, número `R-000N`,
   equipo (modelo), estado y su descripción. **Sin importes ni costos.**
3. Si el aviso sigue pendiente, envía el correo por el SMTP existente (`KESTRA_SMTP_*`, sin variables nuevas) con **3
   reintentos**, y lo cierra con `private.cerrar_aviso_reparacion(aviso, null)` (`enviado`).
4. Si el correo falla tras los reintentos, lo cierra como `fallido` con el motivo fijo «No se pudo enviar el correo»
   (nunca el mensaje del SMTP, que puede traer hosts o credenciales) y confirma la orden para no reenviar en bucle.

Las dos funciones `private` solo las ejecuta `kestra_orquestacion`; son idempotentes (un segundo cierre no cambia
nada). La entrega es **al menos una vez**: si Kestra se corta entre enviar y cerrar, el reclamo vence y el correo puede
salir dos veces. Un aviso pendiente de más de 15 minutos, o cuya orden quedó agotada o cancelada, se cierra como
fallido («El correo tardó demasiado en enviarse. Probá de nuevo.») al consultar el historial o pedir otro aviso, para
que «Reenviar» no quede bloqueado.

**Robustez de los flows de aviso** (`reparaciones-aviso-correo.yml` y `reparaciones-aviso-whatsapp.yml`): corren de a una ejecución (`concurrency: limit 1, behavior CANCEL`: si la anterior sigue en curso, la nueva se descarta), cada tarea tiene un `timeout` y el reclamo de las órdenes dura más que el peor caso de una corrida (1800 s en el de correo y 1200 s en el de WhatsApp, anotado en el propio flow como `reclamo-s`/`peor-caso-s`). Si el flow falla, un bloque `errors:` avisa al soporte por el subflow `platform.alertas/aviso-fallo-flujo` (solo el nombre de la tarea y el id de la ejecución, no el mensaje de error).

### Plantilla (provisoria, spec *Decisiones abiertas* 3)

- Asunto: «Tu reparación R-000N: <estado> · <tienda>».
- Cuerpo: saludo con el nombre del cliente, tienda y número, equipo, estado y la descripción del estado. Todos los
  valores se escapan en el HTML; los textos del asunto van sin saltos de línea.

## WhatsApp: el aviso que manda el servidor (MSF-952 · S-1 de MSF-118)

Es el seguimiento **S-1** que la spec `specs/20270323-100000-service-ideas-futuras-v2` dejó trazado (D-1): el aviso por
WhatsApp **no** es un enlace `wa.me` que abre la persona, sino un aviso que **manda el servidor** a un proveedor de
mensajería, con los estados `pendiente → enviado/fallido` del mismo modelo y **sin tocar** el aviso por correo.

| Qué | Cómo |
|-----|------|
| Canal | `dominio.reparacion_avisos.canal` (`correo` \| `whatsapp`) y `clave_envio` (la clave de idempotencia que se manda al proveedor) |
| Consentimiento | `dominio.clientes.acepta_whatsapp` (interruptor «Acepta avisos por WhatsApp» de la ficha del cliente). Sin consentimiento **no se encola nada** |
| Teléfono | `private.telefono_whatsapp` (celular y, si no hay, teléfono) con la misma regla que `normalizarNumero` del front: solo dígitos en formato internacional. Sin número seguro no se encola |
| RPC | `public.avisar_cliente_whatsapp(p_reparacion uuid, p_estado_id uuid default null)` → `{ resultado: 'encolado' \| 'sin_consentimiento' \| 'sin_telefono', aviso_id }` |
| Flow | `infra/kestra/flows/reparaciones-aviso-whatsapp.yml` (namespace `producto.service`, cada minuto) |

El botón **«Avisar por WhatsApp»** del encabezado del detalle encola el aviso del estado actual (con `edicion` y
reparación no anulada) y **«Reenviar»** de la sección «Avisos al cliente» reenvía por el **mismo canal** del aviso que
se está viendo. En el historial, los avisos de WhatsApp se marcan con el canal y muestran el número del cliente.

**El aviso por correo no cambia.** Como el índice de aviso pendiente pasó a ser por (reparación, estado, **canal**),
`public.avisar_cliente_reparacion` se recrea en la misma migración (mismo nombre, misma firma, mismos permisos y
mismo comportamiento) para buscar **solo** su canal: un aviso de WhatsApp encolado no puede tapar al de correo ni al
 revés, y viceversa. El pgTAP cubre que conviven los dos del mismo estado.

El flow entrega el mensaje al proveedor y lo cierra como `enviado`; si el proveedor falla tras 3 reintentos, lo cierra
como `fallido` con el motivo fijo «No se pudo enviar el WhatsApp» (nunca el mensaje del proveedor, que puede traer
tokens o credenciales). Un aviso pendiente de más de 15 minutos, o cuya orden quedó agotada o cancelada, se cierra
como fallido («El WhatsApp tardó demasiado en enviarse. Probá de nuevo.»).

### El proveedor (decisión de negocio pendiente)

El proveedor de mensajería **lo elige y lo contrata el cliente** (D-1 de MSF-118: cuesta por conversación y exige
plantillas aprobadas y consentimiento). El código habla con un **contrato mínimo**, en la tarea `enviar_whatsapp` del
flow:

```json
{ "telefono": "5491122334455", "mensaje": "Hola Ana, te escribimos de San Javucho. Tu reparación R-0001 (Nintendo Switch) está en estado «En diagnóstico».", "plantilla": "reparacion_estado", "clave": "<clave_envio>" }
```

- `WHATSAPP_API_URL`: la URL del proveedor (vacía hasta que se contrate).
- `WHATSAPP_PLANTILLA`: el nombre de la plantilla aprobada por el proveedor.
- `SECRET_WHATSAPP_TOKEN`: el token del proveedor, **en base64** y solo en `infra/kestra/.env` (nunca en Git).

La plantilla del mensaje es fija y transaccional (saludo, tienda, número, equipo, estado y la descripción del estado),
**sin importes ni costos**. `clave` es la clave de idempotencia del aviso: si el proveedor la respeta, un reintento no
manda el mensaje dos veces. Mientras no haya proveedor configurado, los avisos se cierran como `fallido`.

Migración: `20270418000403_reparacion_avisos_whatsapp_envio.sql` (aditiva, con reversión en el encabezado).

## Actividad

`reparacion.aviso_solicitado` (al encolar), `reparacion.aviso_enviado` y `reparacion.aviso_fallido` (al cerrar el
aviso, con quien lo pidió como actor). El aviso de WhatsApp agrega `reparacion.aviso_whatsapp_solicitado` al encolarlo
(sin el número del cliente) y usa los mismos dos eventos al cerrarlo (el detalle dice «por WhatsApp»). Ver
`docs/actividad.md`.

## Pruebas

- pgTAP `supabase/tests/database/service_avisos.test.sql` (`pnpm test:db`).
- pgTAP `supabase/tests/database/service_aviso_whatsapp.test.sql` (MSF-952: modelo, consentimiento, teléfono, RPC y
  cierre del flow) (`pnpm test:db`).
- Flow: `pnpm test:kestra:reparaciones-aviso` (`infra/kestra/flows/reparaciones-aviso-correo.test.mjs`) y
  `pnpm test:kestra:reparaciones-aviso-whatsapp`
  (`infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs`).
- Vitest `apps/web/src/pages/service-tecnico/reparacion.avisos.test.tsx` (`pnpm test:web`).

## Reversión

Migración posterior que quite, en este orden: `drop function private.expirar_avisos_reparacion(uuid)`,
`private.cerrar_aviso_reparacion(uuid, text)`, `private.aplicar_cierre_aviso_reparacion(uuid, text)`,
`private.datos_aviso_reparacion(uuid)`, `public.avisos_de_reparacion(uuid)`, `public.avisar_cliente_reparacion(uuid,
uuid)` y `drop table dominio.reparacion_avisos`. Quitar el flow del despliegue de Kestra y revertir el merge de la
historia (`git revert -m 1`). El cambio de estado de las reparaciones no depende de nada de esto.

Para el aviso de WhatsApp (MSF-952), la reversión es la que dice el encabezado de
`20270418000403_reparacion_avisos_whatsapp_envio.sql`: quitar `public.avisar_cliente_whatsapp` y
`private.telefono_whatsapp`, el disparador del consentimiento, las columnas `canal` y `clave_envio` (y los índices
que las usan), restaurar `public.avisos_de_reparacion`, `public.avisar_cliente_reparacion` y las funciones `private`
del flow a su versión anterior, y retirar el flow `reparaciones-aviso-whatsapp` del despliegue de Kestra.
