# Service técnico · Repuestos que descuentan stock (F-SVC-10)

Historia **MSF-390**, épica **MSF-217** · spec en `specs/20261028-100000-service-repuestos-y-stock/`
(FR-001…FR-013, SC-001…SC-003). Los repuestos de una reparación dejan de ser un renglón informativo
(`docs/service-items.md`, MSF-199) y pasan a mover stock real del depósito de mercadería elegido.

## Qué ve la persona del taller

- «Agregar repuesto»: al elegir un producto del catálogo aparece **«Depósito de mercadería de donde se
  descuenta»** (botones segmentados con los depósitos **activos**, el por defecto preseleccionado) y la nota
  **«Disponible en <depósito>: N u.»**. Si la cantidad supera lo disponible la nota agrega «(falta stock: pedí el
  repuesto al proveedor)».
- Al confirmar, el repuesto se agrega y se descuenta en el mismo paso: **«Repuesto agregado · se descuenta de
  <depósito>»**. Si no alcanza, el error es **«No hay stock suficiente»** y no queda nada guardado.
- La tabla de repuestos suma la columna **DEPÓSITO DE MERCADERÍA** (nombre, o «—» si el ítem no mueve stock) y la
  ayuda de «Repuestos» aclara que el descuento ocurre **al agregar**. La épica manda sobre el prototipo, que decía
  «al marcar la reparación como Entregado» (spec, *Decisiones abiertas* 2).
- Sin movimiento: mano de obra, repuesto libre (sin producto) y productos **«a pedido»**.
- Si cambia la empresa activa con el diálogo abierto, se cierra con aviso (Principio VIII) y al reabrirlo vuelve a
  consultar la disponibilidad.

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Cambio |
|-------|--------|
| `dominio.reparacion_items` | `deposito_id` (FK compuesta a `dominio.depositos`, solo repuestos con producto) y `stock_estado` |
| `dominio.movimientos_stock` | `origen` (`service`), `reparacion_id` (FK compuesta a `dominio.reparaciones`) y `referencia` |

Ninguna tabla nueva ni en `public`. `stock_estado`: `sin_movimiento` (por defecto, también los ítems anteriores a la
épica: sin retroactivo), `descontado`, `pendiente`, `consumido`, `devuelto`. Solo se devuelve lo `descontado`
(F-SVC-11); esta historia solo escribe `sin_movimiento` y `descontado`.

## Contrato

- `agregar_item_reparacion(..., p_deposito_id uuid default null)`: **BREAKING**, la firma de 6 parámetros desaparece.
  Nulo = depósito por defecto; el depósito debe ser activo y de la organización (`22023`, hint `deposito_id`).
  Inserta el ítem, descuenta y recalcula los totales en **una sola transacción**. Gate `edicion` de `service_tecnico`.
- `depositos_para_repuesto(p_producto_id)`: depósitos activos con `cantidad`, `reservado` y `disponible`; gate
  `service_tecnico` en `lectura`/`edicion` (el técnico no necesita Stock).
- `obtener_reparacion` y las RPC que devuelven la reparación suman por ítem `deposito_id`, `deposito_nombre` y
  `stock_estado`; las claves anteriores no cambian.
- `private.mover_stock_reparacion(...)`: función interna, **sin `grant`** a `authenticated`. No se usa
  `registrar_movimiento_stock` porque exige Stock en `edicion` y un motivo elegido.

## Libro, barrera y concurrencia

- Cada descuento inserta en `dominio.movimientos_stock` una salida con `origen = 'service'`, `reparacion_id`,
  depósito, actor, fecha y `referencia = reparacion:<id>:item:<item>:salida` (índice único parcial por
  `(organizacion_id, referencia)` donde `origen = 'service'`: reintentar no duplica). Motivo de sistema «Repuesto de
  reparación». El saldo del libro sigue siendo el total único.
- La barrera es la de `private.aplicar_movimiento_deposito` (F-STK-14): bloquea sobre el **disponible** del depósito
  (cantidad − reservado) y falla con `23514` «No hay stock suficiente» revirtiendo ítem, movimiento y totales.
- Dos cargas simultáneas del último artículo se serializan por el `for update` de `dominio.existencias` por producto:
  gana una, la otra recibe `23514`; el saldo nunca es negativo.

## Pruebas

- pgTAP `service_repuestos_stock.test.sql` (SC-001) y `service_repuestos_concurrencia.test.sql` (SC-002):
  `pnpm test:db -- service_repuestos_stock service_repuestos_concurrencia`.
- Vitest `components/service/ItemsReparacion.test.tsx` (SC-003):
  `pnpm test:web -- AgregarRepuestoDialog ItemsReparacion`.

## Reversión

Las migraciones son aditivas (columnas con valor por defecto, funciones). Para volver atrás, en una migración
posterior: restaurar `agregar_item_reparacion` de 6 parámetros (`20261022100300`) y `private.reparacion_json`
(`20261022100500`), `drop function` de `depositos_para_repuesto` y `private.mover_stock_reparacion`, y quitar las
columnas nuevas (los encabezados de cada migración traen el detalle). Los movimientos con origen `service` ya
hechos no se deshacen solos: el libro es de solo agregado, hay que exportarlos y compensar el stock a mano.

## Límite conocido de esta historia

Hasta F-SVC-11, quitar un repuesto `descontado` o anular la reparación **todavía no devuelve** el stock: la devolución
idempotente es la siguiente historia de la épica.
