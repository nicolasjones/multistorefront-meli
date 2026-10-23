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

## Verificación

- La cola baja y las ejecuciones terminan `exitosa`.
- Los datos derivados (stock/actividad) coinciden con el evento.
- No quedan locks/ejecuciones colgadas.

## Escalado

Si el evento afecta datos de negocio: escalar a orquestación/Dev; no editar datos a mano sin evidencia.


---

> Revisado 2026-10-22 contra las fuentes actuales (`sources` del manifest). Sin cambios de contrato en esta página.
