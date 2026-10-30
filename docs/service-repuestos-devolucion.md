# Devolución de repuestos al quitar o anular (F-SVC-11)

Historia F-SVC-11 de la épica MSF-217 ([spec](../specs/20261028-100000-service-repuestos-y-stock/spec.md), FR-020…FR-027).
Complementa [service-repuestos-stock.md](./service-repuestos-stock.md): lo que se descontó al agregar un repuesto vuelve al
depósito original cuando se quita el ítem o se anula la reparación.

## Reglas

- **Quitar** (`quitar_item_reparacion`): si el ítem está `descontado`, registra una **entrada** al depósito original
  (libro de movimientos con origen `service`, la reparación y `referencia` `reparacion:<id>:item:<item>:devolucion`),
  borra el ítem y recalcula los totales, todo en una transacción. La pantalla avisa en la confirmación que las unidades
  vuelven al depósito y recarga la reparación.
- **Anular** (`anular_reparacion(p_id, p_motivo, p_consumidos uuid[] default '{}')`): en la misma transacción devuelve
  cada repuesto `descontado` (queda `devuelto`). Los ids de `p_consumidos` quedan `consumido` y **no** vuelven al stock;
  deben ser repuestos `descontado` de esa reparación, sin repetir (si no, `22023`, hint `consumidos`, y no se anula nada).
  El diálogo lista los repuestos descontados con «Consumido, no se devuelve» (por defecto se devuelve todo); la fila de
  una reparación anulada se marca «Devuelto» o «Consumido» en la columna de depósito.
- **Sin movimiento**: ítems `pendiente`, `sin_movimiento` (libres, «a pedido», mano de obra) no tocan el stock.
- **Depósito inactivo**: la devolución va igual al depósito original (la mercadería vuelve físicamente ahí, FR-026).
- **Reparación entregada**: conserva el comportamiento de MSF-182 (se puede anular) pero no devuelve stock ni admite marcar consumidos.

## Idempotencia

`private.devolver_stock_item_reparacion` lee el ítem con `for update` y solo actúa si está `descontado`; el segundo intento
de quitar encuentra el ítem inexistente (`P0002`) y el índice único parcial de `referencia` en `movimientos_stock` impide
cualquier doble entrada. Orden de bloqueo: reparación → ítem → existencias (igual que al agregar).

## Seguridad

La función interna no se ejecuta desde la API (`revoke` a `public, anon, authenticated`). Las RPC públicas exigen `edicion`
en Service técnico, respetan la tienda accesible y no las ejecuta `anon`. Sin tablas nuevas (Principio VII: todo en `dominio`).

## Reversión

Migraciones `20270116100700_reparacion_item_quitar_devolucion.sql` y `20270116100800_reparaciones_anular_devolucion.sql`
(aditivas en datos; renumeradas al integrar `dokploy` para no compartir versión con las migraciones de cobros). Para volver atrás, una migración posterior restaura `quitar_item_reparacion(uuid)` y
`anular_reparacion(uuid, text)` de sus versiones previas y elimina `private.devolver_stock_item_reparacion`; las entradas
ya registradas en el libro no se deshacen solas. Contrato que cambia: la firma de `anular_reparacion` (`apps/web/src/lib/reparaciones.ts`).
