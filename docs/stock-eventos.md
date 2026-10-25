---
owner: producto
sources: [specs]
---
# Stock · eventos `stock.actualizado` y cola durable (F-STK-04, MSF-249)

Spec: `specs/20261018-180000-stock-unico-y-alertas/` (épica MSF-231). Esta guía es el contrato contra el que se
construye el consumidor de Etapa 2 (MSF-123, envío de stock a Mercado Libre). En el Hito 2 **solo se emite**: no hay
consumidor, worker ni flow de Kestra.

## Stock único

Hay una sola cantidad por producto y organización (`dominio.existencias`, MSF-136), compartida por todas las
empresas y canales. La única vía de escritura es `public.registrar_movimiento_stock`, que serializa por producto
(`select … for update`) y rechaza el saldo negativo (disparador F-STK-06). La prueba de concurrencia real
(`apps/web/e2e/stock-concurrencia.e2e.ts`) lanza 20 salidas de 1 unidad sobre stock 10: 10 aceptadas, 10 rechazadas
con «No hay stock suficiente», stock 0, 10 movimientos y 10 eventos de salida.

## Contrato del evento

Tipo `stock.actualizado`. Se emite un evento por cada movimiento aceptado (entrada, salida o ajuste), en la misma
transacción: si la RPC se revierte, no hay evento. Definir el stock mínimo no es un movimiento y no emite.

| Campo de `carga` | Significado |
|------------------|-------------|
| `organizacion_id` | Organización dueña del stock. |
| `producto_id` | Producto afectado. |
| `movimiento_id` | Id del movimiento en `dominio.movimientos_stock`; es también la clave de idempotencia. |
| `tipo_movimiento` | `entrada`, `salida` o `ajuste`. |
| `cantidad` | **Cantidad resultante** del producto tras el movimiento (el saldo), no la cantidad informada. |
| `diferencia` | Cambio con signo sobre la cantidad vigente (`+5` entrada de 5, `-2` salida de 2; en un ajuste, contado − anterior). |
| `ocurrido_en` | Instante de emisión bajo el lock del producto (`clock_timestamp()`, `timestamptz`, ISO 8601): estrictamente creciente por producto, no el `now()` de la transacción. |

Un consumidor debe tratar `cantidad` como el valor que vale ahora para ese producto; ante eventos fuera de orden gana
el de `ocurrido_en` más reciente.

## Cola `public.cola_eventos`

Esquema `public` (Principio VII): es infraestructura transversal de eventos de dominio, no una entidad de negocio de
Stock. Columnas: `id`, `organizacion_id`, `tipo`, `clave_idempotencia`, `carga` (jsonb), `estado`, `intentos`,
`proximo_intento_en`, `reclamada_en`, `vence_en`, `ultimo_error_sanitizado`, `created_at`, `updated_at`.

- **Idempotencia**: `unique (organizacion_id, tipo, clave_idempotencia)`; el disparador inserta con `on conflict do
  nothing`, de modo que un reintento no duplica el evento.
- **Estados**: `pendiente` → `reclamada` → `completada`; o de vuelta a `pendiente` (reintento) hasta `agotada`.
- **Seguridad**: RLS con select solo del Administrador de la organización; `authenticated` no tiene privilegios de
  escritura; `anon` no tiene ninguno. La escribe solo el disparador `private.emitir_stock_actualizado()`
  (*security definer*, sin ejecución para `public/anon/authenticated`).

### Reclamo, lease y reintentos

`private.reclamar_eventos(p_tipo, p_limite, p_duracion_reclamo_seg, p_max_intentos)` y
`private.resolver_evento(p_evento_id, p_intento, p_accion, p_motivo_sanitizado, p_demora_seg, p_max_intentos)` replican
los límites de la outbox del template (`reclamar_despachos_ejecucion` / `resolver_despacho_ejecucion`): límite 1–100,
lease 1–3600 s (300 s por defecto), demora 60 s y 3 intentos máximos por defecto. Solo las ejecuta un superusuario o
`kestra_orquestacion`.

- El reclamo usa `for update skip locked`: cada evento lo recibe un solo consumidor.
- Un reclamo no confirmado antes de `vence_en` vuelve a `pendiente` en el siguiente reclamo
  (`ultimo_error_sanitizado = 'RECLAMO_VENCIDO'`), o pasa a `agotada` si ya alcanzó `p_max_intentos` (1–20, 3 por defecto).
- `confirmar` completa el evento; `liberar` lo devuelve a `pendiente` con espera `p_demora_seg × 2^(intentos−1)` o lo
  pasa a `agotada` al alcanzar `p_max_intentos`; `agotar` lo cierra como agotado.
- Se rechaza (`RECLAMO_NO_VIGENTE`) resolver un intento vencido o reemplazado por otro reclamo.
- Sin consumidor, los eventos quedan `pendiente`: no se pierden y no bloquean la escritura de stock.

## Por qué no se reutiliza `despachos_ejecucion`

Su `ejecucion_id` es `not null unique` hacia `ejecuciones_worker`: está atada a órdenes de ejecución de worker y no
admite eventos de dominio sin ejecución. Se copió el **modelo** (estados, lease, reintentos, error sanitizado), no el
código, para que el futuro consumidor lo trate igual. Decisión aprobada por Nicolás el 2026-10-18.

## Cómo lo consumirá MSF-123 (Etapa 2)

Un flow de Kestra o un worker llamará a `reclamar_eventos('stock.actualizado', n, lease)`, enviará el stock a Mercado
Libre y resolverá cada evento con `confirmar`, `liberar` (falla transitoria) o `agotar` (falla definitiva). Los
eventos de `agotada` se revisan a mano. Nada de eso existe todavía.

## Reversión

Las tres migraciones son aditivas y no tocan datos existentes. Se revierten con una migración posterior (exportar
antes los eventos pendientes si importan):

```sql
drop trigger movimientos_stock_emitir_evento on dominio.movimientos_stock;
drop function private.emitir_stock_actualizado();
drop function private.reclamar_eventos(text, integer, integer, integer);
drop function private.resolver_evento(uuid, integer, text, text, integer, integer);
drop function private.reclamar_eventos_interno(text, integer, integer, integer);
drop function private.resolver_evento_interno(uuid, integer, text, text, integer, integer);
drop table public.cola_eventos;
```

Migraciones: `20261018180000_stock_cola_eventos.sql`, `20261018180100_stock_evento_actualizado.sql`,
`20261018180200_cola_eventos_reclamo.sql`, `20261018180300_cola_eventos_correcciones.sql` (orden por `ocurrido_en`, reclamo vencido → `agotada`, tope de 20 intentos), `20261018180500_cola_eventos_interno_revoke_service_role.sql` (revoca `service_role` de las `*_interno`), `20261018180400_cola_eventos_interno.sql` (lógica en `*_interno` sin guarda de rol para poder probarla en CI; las públicas conservan la guarda; reclamo vencido deja siempre `RECLAMO_VENCIDO`).

`p_max_intentos` (def. 3) existe en `reclamar_eventos` y en `resolver_evento`: el flow de Kestra debe pasar el mismo valor a ambos.

## Pruebas

- pgTAP `supabase/tests/database/stock_cola_eventos.test.sql` (SC-002, SC-003, SC-005).
- E2E de concurrencia `apps/web/e2e/stock-concurrencia.e2e.ts` (SC-001; con Supabase local, ver `docs/e2e-app.md`).
- `rls_en_toda_tabla` y `aislamiento_organizaciones` recorren `public` y `dominio` y cubren la tabla nueva.
