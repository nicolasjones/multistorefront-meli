# Implementation Plan: Stock · Stock depósitos y reservas

**Spec**: `specs/20261022-180000-stock-depositos-y-reservas/spec.md` · **Rama**: `epic/MSF-292-stock-stock-depositos-y-reservas` · **Delivery scope**: `refine`, `supabase`

## Resumen técnico

Se agrega un nivel «depósito» **debajo** del stock único de MSF-136/MSF-231 sin tocar su contrato externo: `dominio.existencias` conserva el total (suma de depósitos) y gana `reservado`; `dominio.existencias_deposito` guarda cantidad/reservado por producto y depósito; el libro `movimientos_stock` gana `deposito_id` (F-STK-14) y `traslado_id` (F-STK-15). Toda escritura pasa por RPC *security definer* que serializan con `select … for update` sobre `existencias` (mismo mecanismo que MSF-136). **Disponible = cantidad − reservado** y es la barrera contra negativos.

## Esquemas (Principio VII — re-verificar en cada fase)

Ver la tabla del spec. Todas las tablas nuevas (`depositos`, `depositos_empresas`, `existencias_deposito`, `reservas_stock`) son **`dominio`** (negocio de Stock) con RLS por organización; `cola_eventos` (`public`) no se altera. El estado actual se verificó con el repo y las migraciones: existen `existencias`, `movimientos_stock`, `motivos_movimiento`, `empresas`, `productos`, `registrar_movimiento_stock`, `private.emitir_stock_actualizado`; **no existe** una `vista_stock_actual` con ese nombre (el listado de MSF-231 lee de `existencias`) ni nada de depósitos/reservas → las crean las migraciones de esta épica. `private.disponibilidad_producto`/`productos_con_stock` y `productos.disponibilidad_manual` viven en la migración `20261022120000` de MSF-179, **aún no integrada** en la base (prerrequisito de F-STK-16, spec D-1).

## Migraciones (aditivas; cada historia trae la suya y no se encadenan entre sí)

| Historia | Archivo | Contenido | Reversión (migración posterior) |
|----------|---------|-----------|----------------------------------|
| F-STK-14 | `20261023100000_depositos_tablas.sql` | tablas, `existencias.reservado`, `movimientos_stock.deposito_id`, backfill (D-9), RLS, Realtime | exportar; `drop table existencias_deposito, depositos_empresas, depositos`; `drop column deposito_id, reservado` |
| F-STK-14 | `20261023100100_depositos_gestion.sql` | RPC crear/editar/por defecto/activar | `drop function` de cada RPC |
| F-STK-14 | `20261023100200_stock_movimiento_deposito.sql` | `private.aplicar_movimiento_deposito`, `registrar_movimiento_stock(+p_deposito)` | restaurar la versión de `20261017140100` + `20261017170000` |
| F-STK-14 | `20261023100300_stock_evento_deposito.sql` | carga ampliada de `stock.actualizado` | restaurar `emitir_stock_actualizado` de `20261018180100` |
| F-STK-14 | `20261023100400_stock_lecturas_deposito.sql` | vista/RPC de lectura por depósito y `listar_movimientos_stock` ampliada | restaurar la RPC anterior; `drop view` |
| F-STK-15 | `20261023110000_stock_traslado.sql` | `movimientos_stock.traslado_id`, `trasladar_stock`, motivo de sistema, omisión del evento en traslados | restaurar `emitir_stock_actualizado`; `drop function`; `drop column traslado_id` |
| F-STK-16 | `20261023120000_stock_reservas.sql` | `reservas_stock`, `reservar_stock`, `liberar_reserva`, `descontar_reserva` | `drop table reservas_stock` (exportar antes) y funciones |
| F-STK-16 | `20261023120100_disponibilidad_con_reservas.sql` | cuerpos de `private.disponibilidad_producto` / `productos_con_stock` sobre el disponible | restaurar los cuerpos de `20261022120000` |
| F-STK-16 | `20261023120200_stock_evento_reserva.sql` | disparador de evento sobre `reservas_stock` | `drop trigger/function` |

Cada migración conserva `revoke … from public, anon` y `grant execute … to authenticated` en toda RPC de `public` (regla del proyecto; el pgTAP de `anon` falla si no). Los timestamps son tentativos: se ajustan al último de la rama base al implementar.

## Frontend (`apps/web/src/pages/stock/`)

- `depositos.tsx` (+ `DepositoDialog.tsx`, `lib/depositos.ts`): pestaña y ruta `/stock/depositos`; tabla del prototipo; filtro por empresa activa (hook de empresa activa existente, consultas invalidadas al cambiar — Principio VIII).
- `PestanasStock.tsx`: agrega la pestaña «Depósitos de mercadería».
- `NuevoMovimientoDialog.tsx`: campo «Depósito de mercadería».
- `list.tsx`: columnas Reservado/Disponible, control de depósito, acción «Trasladar» (F-STK-15, `TrasladarDialog.tsx`); `useExistenciasRealtime` suscribe también `existencias_deposito`.
- `movimientos.tsx`: columnas Depósito, Reserv., Disp.
- Sin pantallas para F-STK-16 (lo consume el formulario de venta de otra épica).

## Pruebas (pruebas-plataforma)

pgTAP (modelo/aislamiento/anon, disponible, traslado, reservas), E2E de concurrencia por RPC (patrón de `stock-concurrencia.e2e.ts`), Vitest de las pantallas (incluye cambio de empresa) y el E2E de la épica en el cierre. Evidencia local de cada una en el commit.

## Documentación (docs:check)

`docs/stock-depositos.md`, `docs/stock-traslados.md`, `docs/stock-reservas.md` (una por historia, para no pisarse), e índice en `docs/stock.md` y `docs/stock-eventos.md` (carga ampliada) desde la tarea de cierre.

## Riesgos

Contrato de `registrar_movimiento_stock` y del evento (alto riesgo, gate humano); concurrencia sobre el disponible; backfill del total; F-STK-16 depende de MSF-179 integrada.
