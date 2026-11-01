# Fix MSF-645 — CI en rojo del PR #519

- `database`: `service_cobro.test.sql:124` sembraba un repuesto sin stock; desde MSF-390 agregar un repuesto del catálogo descuenta stock (`mover_stock_reparacion`). Fixture: stock 10 en el depósito principal; la aserción «el cobro no mueve stock» compara contra el conteo previo (`mov_base`).
- `web (2)`: `comprobante.cobros.test.tsx` encontraba dos «Cargando contenido»; se aísla `HistorialComprobante` como ya se hacía con Envío y Despacho.
- `quality`: commitlint rechazaba 4 mensajes del rango (`merge…`, 2× «Spec de…»); se reescribieron como `chore`/`docs(MSF-232)` (contenido idéntico, sólo cambian los hashes).
- `validacion` sólo agrega los jobs anteriores. No se tocó el descuento por cliente ni migraciones.
