---
owner: operacion
sources:
  - infra/kestra/flows/entregar-webhooks-api.yml
  - infra/kestra/flows/purgar-api-llamadas.yml
  - supabase/migrations/20270224110204_api_suscripciones_entregas.sql
  - supabase/migrations/20261018180100_stock_evento_actualizado.sql
---

# Cola de eventos trabada

**Trigger:** el outbox/cola crece, los workers no procesan o las ejecuciones quedan `en curso`.
**Impacto:** stock/actividad/importaciones no se actualizan; datos derivados atrasados.
**Dueño:** operación/desarrollo.

## Pasos

1. Ver el estado de ejecuciones y la cola (tablas de outbox/ejecuciones, panel de runs).
2. Distinguir **sin worker** (no hay consumidor) de **evento venenoso** (falla siempre).
3. Si no hay worker: verificar Kestra/worker y credenciales; relanzar.
4. Si es venenoso: aislar el evento, registrar el error y corregir; no borrar la cola a ciegas.
5. Reintentar de forma idempotente; confirmar que no se duplican efectos.

## Cola `stock.actualizado` (MSF-231)

- Hay consumidor para los eventos que la API avisa (`stock.actualizado`, `precio.actualizado`, `venta.registrada`): el flow
  `entregar-webhooks-api` (cada minuto, namespace `platform.api`) los reclama con `private.api_reclamar_eventos_api`
  (lease de 2700 s, 5 intentos), los reparte a las suscripciones activas en `public.api_entregas` y los confirma con
  `private.resolver_evento`. Una cola `pendiente` que crece con ese flow apagado o en rojo es una alerta; el reintento de cada aviso vive en
  `api_entregas` (5 intentos con espera de 60 s × 2^(intentos-1); estado final `agotada`), no en la cola de eventos. Un tipo de evento
  que ese flow no reclama sigue sin consumidor y puede quedar `pendiente` sin bloquear la escritura de stock.
- La purga de eventos terminados y sin entregas vivas la hace `purgar-api-llamadas` (04:30 diario).
- Revisar el estado: `select estado, count(*) from public.cola_eventos group by estado;` y, para los avisos de la API, `select estado, count(*) from public.api_entregas group by estado;`.
- Un evento `agotada` se revisa a mano; no se borra la cola a ciegas.
- El reclamo y la resolución (`private.reclamar_eventos` / `private.resolver_evento`) solo los ejecuta
  `kestra_orquestacion` (o un superusuario). El flow debe pasar el mismo `p_max_intentos` a ambos.
- Contrato, estados y reversión: [Stock único y alertas](../stock-unico-y-alertas.md).

## Verificación

- La cola baja y las ejecuciones terminan `exitosa`.
- Los datos derivados (stock/actividad) coinciden con el evento.
- No quedan locks/ejecuciones colgadas.

## Escalado

Si el evento afecta datos de negocio: escalar a orquestación/Dev; no editar datos a mano sin evidencia.

> **CI (2026-10-24):** el job `web` de Validate corre 3 shards reales (cada uno ~1/3 de la suite). Antes el flag no se aplicaba y cada shard corría la suite completa hasta el timeout de 30 min (AGE-1049).

> **CI (2026-10-27):** los `.md` de raíz (`CLAUDE.md`, `AGENTS.md`) ya no cuentan como cambio de la app web. Antes, un PR sólo de docs encendía el e2e sin `build` y moría con *"Falta apps/web/dist"*; ahora, si el e2e corre, el `build` corre antes.

> **CI (2026-11-12):** el paso «avisar el link del visor en el PR» de `validate.yml` ya no falla si el runner no trae `gh` (la imagen de `infra/runner/Dockerfile` no lo instala): avisa en el log y sigue. Antes salía con 127 y dejaba rojo el job `application` aunque sus tests pasaran.

> **CI (2026-11-16, actualizado 2026-11-18):** el job `chequeos` de Validate (antes `application`) corre `pnpm test:correo:verificar-salida` (MSF-532): la suite del guion de verificación de salida del correo. Es Node puro (sin base ni red): vigila que el contrato `{resultado, nuevo, enviado}` de la Edge Function `solicitar-acceso` y el guion sigan de acuerdo, para que el guion no pueda dar un verde falso.
