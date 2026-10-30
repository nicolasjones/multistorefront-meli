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

- `20270116120600_reparacion_avisos.sql` — la tabla, sus índices y su RLS.
- `20270116120700_avisar_cliente_reparacion.sql` — RPC que encola el aviso.
- `20270116120800_avisos_de_reparacion.sql` — RPC de lectura del historial.
- `20270116120900_avisos_reparacion_flow.sql` — funciones `private` del flow y cierre de pendientes vencidos.

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

### Plantilla (provisoria, spec *Decisiones abiertas* 3)

- Asunto: «Tu reparación R-000N: <estado> · <tienda>».
- Cuerpo: saludo con el nombre del cliente, tienda y número, equipo, estado y la descripción del estado. Todos los
  valores se escapan en el HTML; los textos del asunto van sin saltos de línea.

## Actividad

`reparacion.aviso_solicitado` (al encolar), `reparacion.aviso_enviado` y `reparacion.aviso_fallido` (al cerrar el
aviso, con quien lo pidió como actor). Ver `docs/actividad.md`.

## Pruebas

- pgTAP `supabase/tests/database/service_avisos.test.sql` (`pnpm test:db`).
- Flow: `pnpm test:kestra:reparaciones-aviso` (`infra/kestra/flows/reparaciones-aviso-correo.test.mjs`).
- Vitest `apps/web/src/pages/service-tecnico/reparacion.avisos.test.tsx` (`pnpm test:web`).

## Reversión

Migración posterior que quite, en este orden: `drop function private.expirar_avisos_reparacion(uuid)`,
`private.cerrar_aviso_reparacion(uuid, text)`, `private.aplicar_cierre_aviso_reparacion(uuid, text)`,
`private.datos_aviso_reparacion(uuid)`, `public.avisos_de_reparacion(uuid)`, `public.avisar_cliente_reparacion(uuid,
uuid)` y `drop table dominio.reparacion_avisos`. Quitar el flow del despliegue de Kestra y revertir el merge de la
historia (`git revert -m 1`). El cambio de estado de las reparaciones no depende de nada de esto.
