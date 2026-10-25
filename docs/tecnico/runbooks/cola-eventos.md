---
owner: operacion
sources:
  - .github/workflows
  - infra
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

- En el Hito 2 **no hay consumidor**: es normal que los eventos queden `pendiente` y la cola crezca. No
  bloquea la escritura de stock.
- Revisar el estado: `select estado, count(*) from public.cola_eventos group by estado;`.
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
