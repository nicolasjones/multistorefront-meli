# Implementation Plan: Stock · Stock lotes e inventario

**Spec**: `specs/20261024-120000-stock-lotes-e-inventario/spec.md` · **Contratos**: `contracts/stock-lotes-e-inventario.md`
**Branch**: `epic/MSF-131-stock-stock-lotes-e-inventario` · **Delivery scope**: `refine`, `supabase`

## Resumen

Dos historias independientes sobre la RPC existente `registrar_movimiento_stock`:

- **F-STK-10**: `dominio.lotes_stock` + `movimientos_stock.lote_id`, RPC `registrar_lote_stock` (transacción única que llama a `registrar_movimiento_stock` por línea), lecturas de historial y pestaña «Carga en lote».
- **F-STK-11**: motivo de sistema «Toma de inventario», RPC `confirmar_toma_inventario` (un ajuste por producto con diferencia) y pestaña «Toma de inventario». Sin tabla nueva.

## Contexto técnico

- Stack: Refine + MUI (`apps/web/src/pages/stock/*`, `PestanasStock.tsx`), Supabase self-hosted, pgTAP en `supabase/tests/database/`, Vitest.
- Base reutilizada (verificada en migraciones): `registrar_movimiento_stock` con `p_deposito` (`20261023120200`), motivos y siembra (`20261017140000`), libro inmutable (`20261017150000`/`180000`), stock sin negativos (`20261017170000`), patrón de idempotencia de `ingresos_mercaderia` (`20261021180000/100`), `private.registrar_actividad`.
- El grafo (`graphify-out/graph.json`) existe; el estado de tablas/RPC se confirmó contra las migraciones, no se actualizó el grafo.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I. Aislamiento | `dominio.lotes_stock` con RLS por `organizacion_id`; lectura con nivel `lectura`/`edicion`; sin policies de insert/update/delete para `authenticated` (solo la RPC `security definer`). |
| II. Spec antes de código | Esta spec; requisitos FR/SC referenciados por tarea. |
| III. Idempotencia y auditoría | `clave_idempotencia` única por organización; actor y fecha en el lote; actividad `stock.lote_registrado`; la toma es naturalmente idempotente (ajuste al valor contado). |
| VI. Panel | Dos pestañas dentro de Stock, rutas `/stock/lote` y `/stock/toma-inventario`, estados compartidos, 320/768/1440 px. |
| VII. Esquemas | `dominio.lotes_stock` y `lote_id` → `dominio` (entidad del producto). Re-verificar en tareas, implementación y PR. |
| VIII. Empresa activa | No aplica (stock único por organización); declarado en la matriz. |

## Diseño por historia

### F-STK-10
1. Migración `…_stock_lotes_tabla.sql`: tabla, numeración correlativa por organización (bloqueo por organización al asignar), `lote_id` en movimientos con FK compuesta `(lote_id, organizacion_id)`, RLS solo lectura, trigger de inmutabilidad como en el libro.
2. Migración `…_stock_registrar_movimiento_lote.sql`: `drop` + `create` de `registrar_movimiento_stock` con `p_lote` (contrato aditivo de alto riesgo; se re-otorgan grants, `revoke ... from public, anon`).
3. Migración `…_stock_registrar_lote.sql`: `registrar_lote_stock`, `listar_lotes_stock`, `listar_movimientos_lote`.
4. UI: `pages/stock/lote.tsx` (formulario + historial + detalle), pestaña en `PestanasStock`, ruta en `App.tsx`.

### F-STK-11
1. Migración `…_stock_motivo_toma_inventario.sql`: motivo de sistema por organización (siembra + trigger de organizaciones nuevas + relleno).
2. Migración `…_stock_confirmar_toma.sql`: `confirmar_toma_inventario`.
3. UI: `pages/stock/toma-inventario.tsx` (categoría → tabla Contado/diferencia → confirmar → resultado), pestaña y ruta.

Cada historia trae SU migración con su timestamp; no se encadenan entre sí. Archivos compartidos (`PestanasStock.tsx`, `App.tsx`): cada historia agrega **una línea propia** (pestaña/ruta); el merge es aditivo.

## Riesgos

- Cambiar la firma de `registrar_movimiento_stock` (contrato de alto riesgo, `BREAKING` declarado): revisar llamadores y la prueba de `anon`.
- Concurrencia: la numeración del lote y los ajustes de la toma serializan por organización/producto con los bloqueos que ya usa `registrar_movimiento_stock`; pgTAP/test de concurrencia en la historia.
- Defaults pendientes de OK de Nicolás: D1…D4 de la spec.

## Documentación (obligatoria)

`docs/stock-lotes-e-inventario.md` (guía), fila en `docs/roadmap-template.md` al cerrar, comentarios de migración con reversión, `pnpm docs:check` verde.
