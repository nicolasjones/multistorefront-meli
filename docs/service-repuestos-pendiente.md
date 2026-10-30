# Repuesto pendiente de stock (F-SVC-12)

Historia F-SVC-12 de la épica MSF-217 ([spec](../specs/20261028-100000-service-repuestos-y-stock/spec.md), FR-030…FR-033).
Complementa [service-repuestos-stock.md](./service-repuestos-stock.md): cuando falta stock, el repuesto se puede cargar igual
y queda **pendiente de stock**, sin descontar nada.

## Qué es «pendiente»

- Al agregar un repuesto del catálogo sin stock suficiente en el depósito elegido, el diálogo muestra «No hay stock
  suficiente», el disponible y el botón **Dejar pendiente**.
- `agregar_item_reparacion(..., p_deposito_id, p_dejar_pendiente boolean default false)`: con `p_dejar_pendiente` y falta de stock
  carga el ítem con `stock_estado = 'pendiente'` y el depósito elegido, **sin movimiento** y sumado al total al cliente. Si hay
  stock, descuenta como siempre; sin la marca, el rechazo `23514` sigue igual y no deja rastro.
- La fila del detalle muestra la marca **«Pendiente de stock»** (`MarcaStockItem`).

## Indicador del listado

`listar_reparaciones` conserva su firma y suma `pendientes_stock` por fila: repuestos `pendiente` de reparaciones **no anuladas ni
entregadas**. El listado (tabla y tarjeta móvil) muestra «Pendiente de stock» bajo el estado cuando es mayor que cero.

## Cómo se resuelve

No hay un paso automático: se quita el ítem pendiente (no mueve stock, el indicador se apaga) y se vuelve a agregar cuando
el stock ingresó, o se deja como está. Un pendiente no se descuenta solo al entrar stock.

Fuera de alcance de F-SVC-12 (fuente: `specs/20261028-100000-service-repuestos-y-stock/spec.md`):
- **Resolución al ingresar mercadería** (pendiente → disponible, descuento con un clic): decisión 5 de la spec («no hay descuento
  automático posterior… resolver pendiente como acción es otra historia») y FR-030…FR-032, que no la incluyen.
- **Filtro de pendientes en el listado**: FR-032 y el escenario 4 de la US3 piden solo el indicador `pendientes_stock`; un filtro
  cambiaría la firma de `listar_reparaciones` (la spec exige conservarla) y no figura en `design/pantallas/`. Los filtros del
  listado son de F-SVC-04. Ambos quedan como seguimiento trazado, no como alcance de esta historia.

## Seguridad

Sin tablas nuevas (Principio VII: todo en `dominio`). Misma barrera que agregar: `edicion` en Service técnico, tienda accesible, reparación
abierta; `anon` sin ejecución (`revoke ... from public, anon`, `grant ... to authenticated`).

## Reversión

Migraciones `20270116100900_reparacion_item_agregar_pendiente.sql` y `20270116101000_reparaciones_listar_pendientes.sql` (aditivas en
datos). Para volver atrás, una migración posterior elimina `agregar_item_reparacion` de 8 parámetros y restaura la de 7
(`20270116100400`) y la versión previa de `listar_reparaciones` (`20261022110200`). Los ítems ya `pendiente` quedan como están.
Contrato que cambia: la firma de `agregar_item_reparacion` (`apps/web/src/lib/reparacionItems.ts`).
