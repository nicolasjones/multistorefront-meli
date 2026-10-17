# Catálogo de productos

Spec: `specs/20261017-120000-catalogo-alta-y-edicion/` (épica MSF-456). Este documento crece con cada
historia; hoy cubre **F-CAT-02 · Alta de producto** (MSF-458).

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Contenido | RLS |
|---|---|---|
| `dominio.productos` | nombre, SKU, descripción, «Compatible con» (`text[]`), moneda (`USD`/`ARS`), precio de lista sin IVA, `activo` | `organizacion_id = private.organizacion_id()`; select con `lectura`/`edicion` en `productos`; insert/update con `edicion`; **sin DELETE** (se desactiva, no se borra) |
| `dominio.producto_costos` | costo, separado para restringirlo por fila | select con `lectura`/`edicion` en `rentabilidad`; insert/update con `edicion` en `rentabilidad`; sin DELETE |

- Ambas son entidades del negocio del producto → `dominio`. `rls_en_toda_tabla` las recorre.
- Grants por columna: el llamador no fija `creado_en`/`updated_at` ni cambia `organizacion_id`; `anon` no tiene
  privilegios. La FK compuesta `(producto_id, organizacion_id)` impide un costo apuntando a otra organización.
- La base normaliza al escribir (`private.normalizar_producto`): nombre recortado y no vacío, SKU recortado,
  «Compatible con» sin vacíos ni repetidos.

## Alta (`public.crear_producto`)

RPC `security invoker` (rige RLS): exige `edicion` en `productos`; el costo exige `edicion` en `rentabilidad`
(Operador: error `42501`, y 0 filas de `producto_costos` en lectura). Valida moneda, precio `> 0` con hasta
2 decimales y nombre. **No recibe stock** ni organización (sale de la sesión). `grant ... to authenticated`,
`revoke ... from public, anon`. Importes: hasta 12 enteros y 2 decimales (`numeric(14,2)`; el formulario lo valida y
`22003` se mapea a un mensaje claro). Cada valor de «Compatible con» admite hasta 100 caracteres: el trigger
`normalizar_producto` rechaza con `22023` en vez de descartar en silencio.

## Edición (F-CAT-04, migración `20261017120400`)

RPC `public.actualizar_producto(p_id, p_actualizado_en, nombre, descripcion, sku, compatible_con, moneda, precio, costo)`,
`security invoker` (rige RLS): exige `edicion` en `productos`; el costo exige `edicion` en `rentabilidad`
(Operador: `42501`). **Bloqueo optimista**: `p_actualizado_en` es el `updated_at` leído al abrir la ficha; si la
fila cambió se rechaza con `40001` (la pantalla avisa, conserva lo escrito y ofrece recargar) y `P0002` si el
producto no existe o es de otra organización. `p_costo` nulo = no tocar el costo (no hay baja de costo todavía).
El disparador `productos_updated_at_real` hace que `updated_at` solo avance ante cambios reales (o de costo), y
`producto.editado` se registra solo en ese caso, sin costo. Ruta `/productos/:id/edit` con guard de sección; con
solo lectura se ve la ficha sin guardar y con lectura en Rentabilidad el costo se ve deshabilitado. La entrada
desde una grilla llega con F-CAT-06.

Reversión (migración posterior): `drop trigger productos_registrar_actividad_edicion`, `drop trigger
productos_updated_at_real`, `drop function private.registrar_actividad_producto_editado()`,
`drop function private.conservar_updated_at_producto()`, `drop function public.actualizar_producto(...)`.

## Pantalla

- Menú **Catálogo → Productos** (`/productos`, ícono Inventory2, sección `productos`, audiencia organización).
  `/productos` es la grilla mínima de solo lectura (F-CAT-06): nombre, SKU y estado; los productos inactivos se
  listan con la etiqueta «Inactivo». Con permiso de edición suma «Nuevo producto», «Editar» y Activar/Desactivar
  por fila; con solo lectura no hay acciones. El alta, la ficha y la grilla se descargan bajo demanda (`lazy`).
- Formulario: aviso «Faltan datos obligatorios», diálogo «Descartar cambios», «Precio en pesos: No disponible»
  (lo entrega Precios, MSF-114), ayuda del SKU «Se genera solo si lo dejás vacío», costo solo con edición en
  Rentabilidad. Sin stock inicial.
- Diferencias con el prototipo: sin variantes, relacionados, escalas, proveedor, código de barras, video ni
  categoría (la agrega MSF-160); tras guardar se confirma en la misma pantalla porque la ficha llega con F-CAT-04.

## Estado activo / inactivo (F-CAT-06, migración `20261017120600`)

- `public.cambiar_estado_producto(p_id, p_activo)`: `security invoker` (rige RLS: `edicion` en `productos`),
  `revoke … public, anon` + `grant … authenticated`. Solo escribe `activo`: nombre, SKU, precio, costo e imágenes
  quedan intactos (no hay DELETE: se desactiva, no se borra). Idempotente (el mismo estado no escribe ni registra).
- El cambio avanza `updated_at` (una ficha abierta en otra pestaña detecta el conflicto al guardar). Desde la
  ficha, tras cambiar el estado se recarga para tomar ese `updated_at`; lo no guardado en el formulario se pierde
  (la UI lo avisa junto al botón: «Guardá tus cambios antes de cambiar el estado»).
- Actividad: `producto.activado` / `producto.desactivado` (trigger `registrar_actividad_producto_estado`, también ante
  un UPDATE directo de `activo`); detalle «Activó|Desactivó el producto <nombre> (SKU …)», sin costo ni precio.
  El estado no cuenta como `producto.editado`.
- Reversión (migración posterior): `drop trigger productos_registrar_actividad_estado`,
  `drop function private.registrar_actividad_producto_estado()`, `drop function public.cambiar_estado_producto(uuid, boolean)`.
- pgTAP `catalogo_estado_producto`; Vitest `pages/productos/list.test.tsx` y `edit.test.tsx`.

## Actividad

`producto.creado` (trigger `registrar_actividad_producto`, misma transacción, solo con sesión); `producto.activado` / `producto.desactivado` los registra `registrar_actividad_producto_estado` (ver arriba). El detalle lleva
«Creó el producto <nombre> (SKU …)» y **nunca** costo ni precio.

## SKU único (F-CAT-03, migración `20261017120300`)

- Único por organización sin distinguir mayúsculas ni espacios extremos: índice `dominio.productos_org_sku_uidx`
  sobre `(organizacion_id, lower(btrim(sku)))`. Es el árbitro de las altas simultáneas: una gana, la otra recibe `23505`.
  Otra organización puede repetir el SKU.
- SKU vacío (alta o edición) → la base genera `PRD-` + 8 hexadecimales en mayúsculas
  (`private.asegurar_sku_producto`, disparador `productos_sku`), con reintento ante colisión; uno cargado a mano se respeta.
  La migración rellena los SKU vacíos de F-CAT-02. Antes de aplicarla hay una consulta de duplicados en su encabezado.
- La pantalla mapea `23505` a «Ese SKU ya existe» y conserva lo cargado (`mensajeDeError` en `lib/productos.ts`).
- Reversión: `drop trigger productos_sku`, `drop function private.asegurar_sku_producto()`,
  `drop index dominio.productos_org_sku_uidx` (los SKU generados quedan como datos válidos).

## Reversión (migraciones `20261017120100` y `20261017120200`)

Aditivas. Se revierten en una migración posterior (no en el mismo PR): `drop trigger productos_registrar_actividad`,
`drop function private.registrar_actividad_producto()`, `drop function public.crear_producto(...)`,
`drop trigger productos_normalizar`, `drop function private.normalizar_producto()`,
`drop table dominio.producto_costos`, `drop table dominio.productos` (exportar los datos antes).
