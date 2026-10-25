---
owner: producto
sources: [apps/web/src, specs]
---
# Service técnico · Ítems y costos de la reparación (F-SVC-06)

Historia **MSF-362**, épica **MSF-199** · spec en
`specs/20261022-100000-service-listado-items-e-impresion/`. Completa el detalle de MSF-182 con la
mano de obra y los repuestos que se le cobran al cliente.

## Qué ve la persona del taller

En `/service-tecnico/reparaciones/:id`, debajo de «Cliente y equipo», aparece la sección
**«Mano de obra y repuestos»**:

- Tabla de **mano de obra**: CONCEPTO, CANT., PRECIO, SUBTOTAL y «Subtotal mano de obra».
- Tabla de **repuestos**: PRODUCTO (con el SKU del catálogo cuando está vinculado), CANT., PRECIO,
  SUBTOTAL y «Subtotal repuestos».
- Resumen **Mano de obra / Repuestos / Total al cliente**. El Total al cliente se puede seleccionar
  con un clic para copiarlo: el cobro se carga a mano en Ventas hasta que llegue F-SVC-13.
- Con la acción **`ver_costos`**, la **Ganancia estimada** (Total al cliente − costos internos)
  aparece dentro de la tarjeta «Costo interno» de MSF-182. Sin la acción, la base manda `null` y no
  se muestra.
- Con `service_tecnico` en **`edicion`** y la reparación **abierta**: «Agregar mano de obra»,
  «Agregar repuesto» y la acción de quitar por fila (con confirmación). Las entregadas, las
  anuladas y las de nivel `lectura` se ven completas pero sin acciones.

Los importes están en ARS **sin IVA**. La sección no muestra la columna DEPÓSITO: los ítems P0 **no
mueven stock** ni existencias (el descuento de repuestos del depósito es de MSF-217).

## Modelo de datos

Esquema (Constitución, Principio VII): `dominio.reparacion_items` es una entidad de negocio del
taller (qué se cobra por una reparación) → **`dominio`**, nunca `public`. Las dos columnas nuevas de
`dominio.reparaciones` siguen en **`dominio`**. Las RPC viven en `public` (contrato de la app) y las
ayudas internas en `private`.

### `dominio.reparacion_items` (nueva)

| Columna | Detalle |
|---------|---------|
| `id` | uuid, PK |
| `organizacion_id` | uuid, default `private.organizacion_id()`; FK a `organizaciones` |
| `reparacion_id` | uuid, FK compuesta `(reparacion_id, organizacion_id)` |
| `tipo` | `mano_obra` \| `repuesto` |
| `descripcion` | obligatoria, recortada, ≤ 200 caracteres |
| `producto_id` | opcional; FK compuesta `(producto_id, organizacion_id)`; solo si `tipo = 'repuesto'` |
| `cantidad` | entero entre 1 y 9999 |
| `precio_unitario` | `numeric(10,2)` ARS sin IVA, ≥ 0 (máximo 99.999.999,99) |
| `subtotal` | generada: `round(cantidad × precio_unitario, 2)` |
| `creado_en` / `creado_por` | fecha del servidor y autor de la sesión |

Las FK compuestas impiden apuntar a una reparación o a un producto de **otra organización**. Hay
índices por `(reparacion_id, creado_en)` y por `producto_id` no nulo.

**RLS**: `select` para `authenticated` con `organizacion_id = private.organizacion_id()`, nivel
`lectura`/`edicion` de `service_tecnico` y la tienda de la reparación dentro de
`private.empresas_accesibles()`. **Sin** políticas ni grants de `insert`/`update`/`delete`: la tabla
solo la escriben las RPC `security definer`. `anon` no tiene privilegios.

### `dominio.reparaciones`: totales derivados

`total_mano_obra` y `total_repuestos` son `numeric(14,2) not null default 0` (≥ 0), **de cara al
cliente** (no son los costos internos). Tienen `grant select` por columna a `authenticated` y **sin**
grant de escritura: solo las toca `private.recalcular_totales_reparacion`. El total al cliente es la
suma de ambas y se calcula al leer (`reparacion_json`), no se almacena por separado.

## RPC (`public`, `security definer`, `search_path = ''`)

Todas llevan `revoke execute … from public, anon` y `grant execute … to authenticated`. La
organización sale de la sesión, nunca del llamador. Los errores de validación usan `22023` con el
campo afectado en `hint`; sin permiso `42501`; reparación o ítem de otra organización / tienda
inaccesible `P0002`; reparación entregada o anulada `55000`.

| RPC | Qué hace |
|-----|----------|
| `agregar_item_reparacion(p_reparacion_id, p_tipo, p_descripcion, p_producto_id, p_cantidad, p_precio)` | Valida tipo, descripción (≤ 200), cantidad entera 1–9999 y precio 0–99.999.999,99. Un `producto_id` solo se acepta en un repuesto **activo de la organización**; si la descripción llega vacía se completa con el nombre del producto (el precio **no** se precarga). Inserta el ítem, recalcula los totales y devuelve la reparación completa con `items`. |
| `quitar_item_reparacion(p_item_id)` | Ubica la reparación del ítem de la organización, aplica la misma compuerta (permiso, tienda, situación abierta) y recalcula los totales en la misma transacción. |

`public.obtener_reparacion` (y las RPC de escritura que devuelven el mismo documento) ahora incluyen
`items` (orden de carga), `total_mano_obra`, `total_repuestos`, `total_cliente` y
`ganancia_estimada`. La ganancia es `null` sin la acción `ver_costos`, igual que los costos internos
de MSF-182; las claves anteriores del contrato no cambian.

### Permisos y situaciones

- Sin `edicion` en `service_tecnico` no se agrega ni se quita (`42501`). Con `lectura` se leen los
  ítems de las tiendas accesibles.
- Una reparación **anulada**, **entregada** (`entrega_real`) o con un estado que **cierra** rechaza
  altas y bajas con `55000` (FR-024).
- No se mueve stock ni se tocan existencias.

## Concurrencia e idempotencia

`private.bloquear_reparacion_para_items(id)` valida la sesión y bloquea la fila de la reparación con
`for update`. Cada alta/baja recalcula los totales dentro de la **misma transacción**, así dos cargas
simultáneas se serializan y ninguna pisa el total de la otra. El recálculo es una función de los
ítems (no acumula), por lo que reintentar la operación no duplica importes. El recálculo actualiza
`updated_at`; el detalle recarga la reparación después de cada operación para no provocar un falso
conflicto (`40001`) en el siguiente «Guardar».

La prueba pgTAP no puede abrir dos transacciones reales: verifica que la compuerta común contiene
`for update` y que las dos RPC la llaman junto con el recálculo.

## Actividad

Las altas y bajas registran `reparacion.item_agregado` y `reparacion.item_quitado` con
`private.registrar_actividad`, en la misma transacción, con el código visible (`R-0001`) y la
descripción del ítem; nunca ids. Sin sesión (migraciones, sembrados) no se registra nada. Ver
`docs/actividad.md`.

## Piezas de la interfaz

- `apps/web/src/lib/reparacionItems.ts`: tipos, validación de pantalla, subtotal en vivo, llamadas a
  las RPC, mapeo de `22023`/`42501`/`55000`/`P0002` a mensajes claros y búsqueda de productos activos
  por Nombre o SKU (reutiliza `filtroBusquedaStock` de `lib/stock.ts`).
- `components/service/ItemsReparacion.tsx`: sección, tablas, subtotales, Total al cliente copiable y
  confirmación de quitar.
- `components/service/AgregarManoObraDialog.tsx`, `AgregarRepuestoDialog.tsx` y el cuerpo común
  `AgregarItemDialog.tsx`: campos del prototipo, «Subtotal:» en vivo, validación antes de enviar,
  errores de la base en el campo y mensaje de éxito (snack en el detalle). Se cargan con `lazy`.
- `pages/service-tecnico/reparacion.tsx`: integra la sección y los botones; con `lectura`, entregada
  o anulada no se ofrecen acciones.

## Pruebas

- pgTAP `supabase/tests/database/service_items.test.sql` (SC-004): totales tras agregar/quitar,
  bloqueo `for update`, cantidad/precio inválidos, entregada y anulada rechazadas, producto
  ajeno/inactivo, ganancia enmascarada sin `ver_costos`, aislamiento entre organizaciones, `anon` sin
  ejecución, actividad y ausencia de movimientos de stock; además `rls_en_toda_tabla` sigue verde.
- Vitest `components/service/ItemsReparacion.test.tsx` y `pages/service-tecnico/reparacion.test.tsx`
  (SC-005): tablas, subtotales, Total al cliente, errores de cantidad y precio, quitar con
  confirmación, solo lectura, ganancia oculta sin `ver_costos` y botones ocultos con `lectura`.

## Migraciones y reversión

Todas son **aditivas** y llevan su camino de reversión en el encabezado (en una migración posterior,
no en este PR; exportar antes los datos):

| Migración | Contenido | Reversión |
|-----------|-----------|-----------|
| `20261022100100_reparacion_items.sql` | tabla, índices, RLS y grants | `drop table dominio.reparacion_items;` |
| `20261022100200_reparaciones_totales.sql` | columnas derivadas, `private.recalcular_totales_reparacion` y la compuerta `private.bloquear_reparacion_para_items` | `drop function` de las dos ayudas y `drop column` de los totales |
| `20261022100300_reparacion_item_agregar.sql` | `agregar_item_reparacion` | `drop function public.agregar_item_reparacion(...)` |
| `20261022100400_reparacion_item_quitar.sql` | `quitar_item_reparacion` | `drop function public.quitar_item_reparacion(uuid)` |
| `20261022100500_reparaciones_leer_items.sql` | `private.reparacion_json` con ítems, totales y ganancia | restaurar la versión de `20261020110300` |
| `20261022100600_reparacion_items_actividad.sql` | disparadores de actividad | `drop trigger`/`drop function` de alta y baja |

Orden inverso: actividad → lectura → quitar → agregar → totales → tabla.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.
