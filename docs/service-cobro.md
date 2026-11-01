# Service técnico · Cobro con comprobante de Ventas

F-SVC-13 (MSF-418) · épica MSF-232 · spec `specs/20261028-100000-service-cobro-y-avisos/`.

La reparación **se cobra generando un comprobante de Ventas**: no hay comprobante propio de Service. Desde el
detalle de la reparación (`/service-tecnico/reparaciones/:id`) se genera una **factura en `borrador`** en la tienda
de la reparación y con su cliente, con una línea por ítem; después se confirma y se cobra en Ventas como cualquier
otra factura. El detalle muestra el **comprobante asociado** y Ventas muestra su **origen**.

## Modelo (Principio VII: esquema)

No hay tablas nuevas: se agregan columnas a dos tablas de `dominio` (dominio del producto), sin tocar su RLS.

| Tabla | Columna | Regla |
|-------|---------|-------|
| `dominio.comprobantes_venta` | `origen_tipo text` (`reparacion`), `origen_id uuid` | Van juntas o ninguna (`comprobantes_venta_origen_check`). Solo las escribe `generar_comprobante_reparacion`; no son editables desde la app. Índice único parcial `comprobantes_venta_origen_vigente_uk` sobre `(organizacion_id, origen_tipo, origen_id) where origen_tipo is not null and estado <> 'anulada'`: **un solo comprobante vigente por reparación**, también bajo concurrencia. Una factura anulada libera el origen. |
| `dominio.comprobantes_venta_lineas` | `sin_stock boolean not null default false` | Marca la línea que **no mueve stock**. Solo esas líneas admiten `producto_id`, `deposito_id` y `escala` nulos (`comprobantes_venta_lineas_sin_stock_check`). Las líneas de catálogo quedan igual (`sin_stock = false`). |

**`sin_stock` no es `a_pedido`**: `a_pedido` **reserva** stock; `sin_stock` no reserva ni descuenta nada. Las
funciones de stock (`confirmar_comprobante`, `private.revertir_venta_comprobante`,
`private.devolver_stock_nota_credito`) saltean esas líneas; `emitir_nota_credito` copia la marca a la línea
acreditada; `guardar_lineas_comprobante` conserva las líneas `sin_stock` cuando se editan las de catálogo y las
suma a los totales; el documento (PDF) y la lectura de notas de crédito las muestran con `left join` de depósito
para que la línea sin depósito no desaparezca.

Migraciones (aditivas, con reversión en el encabezado):

- `supabase/migrations/20270121120100_comprobantes_origen.sql` — columnas de origen, checks e índice único parcial.
- `supabase/migrations/20270121120200_lineas_sin_stock.sql` — columna `sin_stock`, check y las funciones de stock.
- `supabase/migrations/20270121120300_generar_comprobante_reparacion.sql` — RPC de generación + `private.alicuota_general`.
- `supabase/migrations/20270121120400_comprobante_de_reparacion.sql` — RPC de lectura del comprobante vigente.
- `supabase/migrations/20270121120500_obtener_comprobante_origen.sql` — `obtener_comprobante` expone el origen (aditivo).

## RPC

| RPC | Qué hace | Permisos |
|-----|----------|----------|
| `public.generar_comprobante_reparacion(p_reparacion uuid)` | Genera (o devuelve) la factura en `borrador` de la reparación. Devuelve `{ comprobante_id, creado }`. | `service_tecnico` en `edicion` **y** `ventas` en `edicion` en la tienda de la reparación. `revoke … from public, anon` + `grant execute … to authenticated`. |
| `public.comprobante_de_reparacion(p_reparacion uuid)` | Devuelve `{ id, numero, tipo, estado, total, empresa_id, empresa }` del comprobante **vigente** (no anulado) o `null`. | `service_tecnico` en `lectura` o más y tienda accesible. Mismos `revoke`/`grant`. |

Errores (mensajes en castellano, los muestra la app tal cual):

| Código | Cuándo | Mensaje |
|--------|--------|---------|
| `42501` | falta `service_tecnico` en `edicion` o `ventas` en `edicion` en la tienda | «Tu rol no puede generar el comprobante de una reparación» / «Tu rol no puede crear comprobantes en la tienda de esta reparación» |
| `P0002` | la reparación no existe o su tienda no es accesible | «La reparación no existe» |
| `55000` | la reparación está anulada | «La reparación está anulada: no se puede generar su comprobante» |
| `22023` | sin ítems, tienda desactivada o cliente archivado | «La reparación no tiene ítems: cargá mano de obra o repuestos para generar el comprobante», etc. |

## Alícuota (provisoria)

*Decisiones abiertas 1 de la spec; a confirmar con el cliente.* La alícuota de cada línea sale de **Precios e IVA**:

- **Repuesto vinculado al catálogo** → la alícuota efectiva del producto (`private.alicuota_producto`: la del
  producto o, si no tiene, la de su categoría).
- **Mano de obra y repuesto libre** → la **alícuota general vigente** de la organización
  (`private.alicuota_general`: la activa al 21 %, si no la mayor activa no exenta; 0 % si no hay ninguna).

No hay porcentajes escritos en el código: salen de `dominio.alicuotas_iva` (Precios e IVA, F-PRE-12). Si el cliente
quiere presupuesto o sin IVA, cambia solo la RPC.

## Idempotencia y concurrencia

- La reparación se toma **`for update`**: dos personas que pulsan a la vez se serializan; la segunda ve el
  comprobante que dejó la primera y recibe `{ creado: false }`.
- El **índice único parcial** por origen vigente es el respaldo en la base: si dos transacciones se escapan al
  bloqueo, la segunda recibe `unique_violation` y devuelve el comprobante existente en lugar de crear otro.
- Con el comprobante **anulado**, la reparación vuelve a poder generar uno nuevo; el anulado queda como historial
  (el índice no lo cubre porque filtra `estado <> 'anulada'`).

## Pantalla

- **Detalle de la reparación** (`/service-tecnico/reparaciones/:id`): el botón **«Generar comprobante»** vive en la
  sección «Mano de obra y repuestos», junto al «Total al cliente». Se ofrece solo con `service_tecnico` y `ventas`
  en `edicion`, con la reparación no anulada, con ítems y **sin** comprobante vigente. Mientras genera, el botón
  queda deshabilitado («Generando comprobante…»); un error se muestra al lado (no se traga en silencio) y el botón
  queda disponible para reintentar.
- **Tarjeta «Comprobante asociado»**: número, tipo, estado (chip del catálogo de Ventas), tienda, total con IVA y
  el enlace **«Abrir en Ventas»** (`/ventas/comprobantes/:id`) **solo** si la persona tiene `ventas` en la tienda.
  Estados de carga, error (con «Reintentar») y vacío.
- **Ventas** (`/ventas/comprobantes/:id`): el comprobante muestra **«Origen: Reparación R-000N»** con enlace al
  detalle de Service **solo** si la persona tiene acceso a `service_tecnico`; sin acceso, el texto se muestra sin
  enlace. Las líneas `sin_stock` se ven en solo lectura, con la marca «No descuenta stock».
- **Empresa activa (Principio VIII)**: el detalle de la reparación y el comprobante son de una sola tienda. Al
  cambiar la empresa activa se recarga la consulta del comprobante y se descarta el de la tienda anterior; en
  Ventas, el error de un cambio de estado no sobrevive al cambio de comprobante ni de tienda.

## Actividad

`reparacion.comprobante_generado` («Generó la factura %s de la reparación %s»), registrada por
`private.registrar_actividad` **en la misma transacción** que la generación. Ver `docs/actividad.md`.

## Pruebas

- pgTAP `supabase/tests/database/service_cobro.test.sql` (`pnpm test:db`): borrador con cliente, tienda y origen;
  idempotencia (segunda llamada y respaldo del índice); regenerar tras anular; sin ítems / anulada / cliente
  archivado; permisos `service_tecnico` + `ventas`; tienda y organización ajenas; `anon` sin ejecución; RLS en
  `public` y `dominio`.
- pgTAP `supabase/tests/database/service_cobro_stock.test.sql` (`pnpm test:db`): confirmar y anular con líneas
  `sin_stock` no genera movimientos ni reservas; las líneas de catálogo siguen descontando y devolviendo (regresión
  de MSF-159); editar conserva las líneas de Service; la nota de crédito copia la marca.
- Vitest `apps/web/src/pages/service-tecnico/reparacion.comprobante.test.tsx` y
  `apps/web/src/pages/ventas/comprobante.origen.test.tsx` (`pnpm test:web`): botón según permisos/ítems/anulada/
  comprobante vigente, tarjeta con sus estados y su enlace, error al generar y al cargar, cambio de empresa, y el
  origen visible en Ventas.

## Reversión

Todo es aditivo y reversible con una migración posterior:

1. `drop function public.generar_comprobante_reparacion(uuid);` y `drop function public.comprobante_de_reparacion(uuid);`
   (y `drop function private.alicuota_general(uuid);`).
2. Restaurar el cuerpo de `public.obtener_comprobante` de `20261203200300_lineas_rpc.sql` (saca `origen_tipo`,
   `origen_id`, `origen_numero` y `sin_stock` de la salida).
3. Restaurar las siete funciones de stock de sus migraciones originales (`20261204140000`, `20261212120100`,
   `20261212120300`, `20261212120400`, `20261203200300`, `20261211120200`, `20261212120600`).
4. `drop index dominio.comprobantes_venta_origen_vigente_uk;` y quitar las constraints de origen y de `sin_stock`.
5. `alter table dominio.comprobantes_venta_lineas alter column producto_id set not null, alter column deposito_id set not null, alter column escala set not null;`
   (primero hay que borrar o migrar las filas con `sin_stock`).
6. `alter table dominio.comprobantes_venta_lineas drop column sin_stock;` y
   `alter table dominio.comprobantes_venta drop column origen_id, drop column origen_tipo;`

Los comprobantes ya generados **no se borran solos**: se anulan en Ventas (y ahí quedan como historial).

## Visibilidad de datos entre secciones

- `comprobante_de_reparacion` (Service) muestra número, total y estado del comprobante a quien tiene `service_tecnico`
  en lectura, sin exigir `ventas`; el enlace al comprobante sí exige `ventas` (decisión de FR-004).
- `obtener_comprobante` (Ventas) devuelve `origen_numero` («R-000N») solo con `service_tecnico` en lectura o más;
  sin ese permiso queda `null` (la pantalla muestra el origen sin número).
