# Implementation Plan: Service técnico · Service repuestos y stock

**Branch**: `epic/MSF-217-service-tecnico-service-repuestos-y-stoc` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md) | **Épica**: MSF-217

## Summary

Los repuestos de una reparación pasan de «renglón informativo» (MSF-199) a movimiento de stock real. `agregar_item_reparacion` descuenta del depósito elegido en la misma transacción que inserta el ítem; `quitar_item_reparacion` y `anular_reparacion` devuelven lo descontado (idempotente); si falta stock el taller puede «Dejar pendiente» y el listado lo señala. Una sola base de stock: la barrera es la de `private.aplicar_movimiento_deposito` (F-STK-14), que ya serializa por producto.

## Technical Context

- **Stack**: TypeScript + React + Refine + MUI (`apps/web`), Supabase self-hosted (Postgres, RPC, pgTAP). Sin Kestra, Superset ni workers.
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), E2E (`apps/web/e2e/*.e2e.ts`).
- **Validación**: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
- **Verificado en el árbol** (no inventado): `dominio.existencias_deposito` y `dominio.depositos` (`20261023120000`), `private.aplicar_movimiento_deposito` (`20261023120200`, barrera «No hay stock suficiente» `23514`, `for update` por producto), `dominio.movimientos_stock` (sin `origen` ni `reparacion_id` todavía), vista `public.stock_por_deposito`, `dominio.reservas_stock` y `disponibilidad_manual = 'a_pedido'` (`20261023130100`), `dominio.reparacion_items`, `agregar_item_reparacion`, `quitar_item_reparacion`, `private.bloquear_reparacion_para_items`, `private.recalcular_totales_reparacion` (`202610221001xx`), `anular_reparacion` (`20261020120300`), `listar_reparaciones` (`20261022110200`), patrón de devolución en `20261212120300_devolver_stock_nota_credito.sql`. En el código: `components/service/{AgregarRepuestoDialog,ItemsReparacion,AnularDialog}.tsx`, `lib/{reparacionItems,reparaciones,depositos}.ts`.
- **Nombre en conflicto resuelto**: el repo llama `existencias_deposito` a la **tabla** y `stock_por_deposito` a la **vista** de lectura; no hay dos modelos. Esta épica usa ambos con ese sentido.
- **Por qué no `public.registrar_movimiento_stock`**: exige `stock` en `edicion` y un motivo activo; el Técnico no tiene Stock. Se usa el mismo camino que ya siguen las notas de crédito y el despacho (`aplicar_movimiento_deposito` + inserción en el libro) dentro de una función interna `private.mover_stock_reparacion`; el libro recibe `origen = 'service'` y `reparacion_id`.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Aislamiento | Columnas nuevas en tablas con RLS vigente; FK compuestas con `organizacion_id`; pgTAP de aislamiento entre dos organizaciones. |
| II Especificar primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | Devolución idempotente (índice único parcial por `referencia` + ítem borrado bajo `for update`); movimientos con actor, fecha, origen y reparación. |
| IV Despliegues independientes | Solo `refine` + `supabase`. |
| V Simplicidad | Sin tablas nuevas, sin extensión, sin worker; reutiliza la barrera de F-STK-14. |
| VI Panel operable | Sin pantallas ni rutas nuevas (el detalle y el listado ya existen); estados de carga/error/éxito del kit, teclado y 320/768/1440 px. Los diálogos ya se cargan diferidos. |
| VII Esquemas | **Re-verificado**: `dominio.reparacion_items` (columnas nuevas) → `dominio`; `dominio.movimientos_stock` (columnas nuevas) → `dominio`; `dominio.reparaciones`, `existencias_deposito`, `depositos`, `reservas_stock` → `dominio` sin cambio. Ninguna tabla nueva; RPC en `public`, ayudas en `private`. |
| VIII Contexto de empresa | Detalle: la reparación ya tiene su tienda. El indicador del listado hereda el filtro de empresa (MSF-199 FR-005). Diálogos: se cierran al reencuadrarse la pantalla (FR-012). |
| VIII (bis) Documentación | Una guía por historia + índice y roadmap en el cierre. |

## Decisiones de diseño

- **Estado de stock por ítem** (`stock_estado`): `sin_movimiento` (mano de obra, repuesto libre, «a pedido», ítems anteriores a esta épica), `descontado`, `pendiente`, `consumido`, `devuelto`. Es la fuente de verdad de la devolución: solo se devuelve lo `descontado`.
- **Sin retroactivo**: los ítems cargados antes de esta épica quedan `sin_movimiento`; no se descuentan ni se devuelven.
- **Idempotencia**: `referencia = 'reparacion:<id>:item:<item>:salida|devolucion'` con índice único parcial `where origen = 'service'`; el segundo intento no inserta ni mueve stock.
- **Concurrencia**: el `for update` de `existencias` por producto serializa dos repuestos del último artículo; el segundo ve el saldo y recibe `23514`.
- **Devolución al depósito original** aunque hoy esté inactivo (la mercadería vuelve físicamente ahí; no es una entrada nueva). Ver *Decisiones abiertas* 4.
- **Cada historia trae su migración**: F-SVC-10 las columnas y el descuento, F-SVC-11 la devolución (reemplaza `quitar_item_reparacion` y `anular_reparacion`), F-SVC-12 el pendiente (reemplaza `agregar_item_reparacion` y suma `pendientes_stock` al listado). El orden entre historias lo fija la tabla del final de `tasks.md`.

## Project Structure

```text
supabase/migrations/
  20270113100100_stock_movimientos_origen_service.sql   # F-SVC-10 (origen, reparacion_id, referencia en el libro)
  20270113100200_reparacion_items_deposito.sql          # F-SVC-10 (deposito_id, stock_estado)
  20270113100300_service_mover_stock.sql                # F-SVC-10 (private.mover_stock_reparacion)
  20270113100400_reparacion_item_agregar_stock.sql      # F-SVC-10 (agregar con depósito)
  20270113100500_depositos_para_repuesto.sql            # F-SVC-10 (selector de depósito)
  20270113100600_reparaciones_leer_stock.sql            # F-SVC-10 (ítems con depósito y stock_estado)
  20270113110100_reparacion_item_quitar_devolucion.sql  # F-SVC-11
  20270113110200_reparaciones_anular_devolucion.sql     # F-SVC-11
  20270113120100_reparacion_item_agregar_pendiente.sql  # F-SVC-12
  20270113120200_reparaciones_listar_pendientes.sql     # F-SVC-12
supabase/tests/database/
  service_repuestos_stock.test.sql, service_repuestos_concurrencia.test.sql,
  service_repuestos_devolucion.test.sql, service_repuestos_pendiente.test.sql
apps/web/src/
  lib/reparacionItems.ts, lib/reparaciones.ts, lib/reparacionesListado.ts
  components/service/{AgregarRepuestoDialog,ItemsReparacion,AnularDialog}.tsx (editados)
  components/service/{SelectorDepositoRepuesto,AvisoSinStock,MarcaStockItem}.tsx (nuevos)
  pages/service-tecnico/{reparacion,reparaciones}.tsx (editados)
apps/web/e2e/service-repuestos-stock.e2e.ts
docs/service-repuestos-stock.md, service-repuestos-devolucion.md, service-repuestos-pendiente.md
```
