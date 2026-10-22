# Catálogo de productos

Spec: `specs/20261017-120000-catalogo-alta-y-edicion/` (épica MSF-456). Cubre alta (F-CAT-02), SKU único (F-CAT-03),
edición (F-CAT-04), imágenes (F-CAT-05) y estado activo/inactivo (F-CAT-06). Permisos: `docs/permisos-por-rol.md`;
aislamiento: `docs/aislamiento-por-organizacion.md`; eventos: `docs/actividad.md`.

## Alcance y seguimiento

- Fuera de esta épica (diferencias con el prototipo): categoría y reemplazo de la grilla mínima por el listado real
  (MSF-160); proveedor (MSF-205). El código de barras se entregó como seguimiento (MSF-529); ver también `docs/proveedores.md`.
- El E2E de punta a punta «crear, editar, subir fotos y desactivar» queda pendiente de fixtures por rol: ver
  `docs/e2e-app.md`. Mientras tanto lo cubren pgTAP (`catalogo_*`) y Vitest (`pages/productos`, `lib/productos*`).

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

RPC `public.actualizar_producto(p_id, p_actualizado_en, nombre, descripcion, sku, compatible_con, moneda, precio, costo)`
(F-PRV-03 suma `p_proveedor_id`, `p_codigo_proveedor` y `p_cambiar_proveedor`, ver `docs/proveedores.md`),
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
- Formulario: aviso «Faltan datos obligatorios», diálogo «Descartar cambios», bloque «Precio y costo» (ver
  «Precio y costo en pesos o dólares» más abajo), ayuda del SKU «Se genera solo si lo dejás vacío», costo solo con edición en
  Rentabilidad. Sin stock inicial.
- Diferencias con el prototipo: sin variantes, relacionados, escalas, video ni
  categoría (la agrega MSF-160); el proveedor y su código se cargan en el formulario (F-PRV-03, ver `docs/proveedores.md`); tras guardar se confirma en la misma pantalla porque la ficha llega con F-CAT-04.

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

## Imágenes del producto (F-CAT-05, migración `20261017120500`)

- **Tabla `dominio.producto_imagenes`** (entidad del negocio → `dominio`; `rls_en_toda_tabla` la recorre): `producto_id`,
  `organizacion_id` (FK compuesta, no puede apuntar a un producto de otra organización), `posicion` 1..4 y `ruta`.
  La imagen de menor `posicion` es la **principal**; al quitar una no se renumera, la siguiente pasa a ser la principal.
- **RLS**: select con `lectura`/`edicion` en `productos`; insert y delete con `edicion`. Sin UPDATE (no se reordena ni
  reemplaza). `anon` sin privilegios. El insert es por columnas: el llamador no fija `creado_en`.
- **Tope de 4 y formato en la base**, también ante llamada directa: disparador `producto_imagenes_tope` (candado
  asesor por producto; rechaza la quinta con `23514`), `posicion between 1 and 4` (`23514`), único `(producto_id, posicion)`
  (`23505`), `ruta` con extensión jpg/jpeg/png/webp y prefijo `<organizacion_id>/<producto_id>/` propio (`23514`).
- **Storage**: bucket privado `productos-imagenes` (plataforma; patrón de `logos-organizacion`), 2 MB, solo
  `image/jpeg|png|webp` (sin SVG). Políticas sobre `storage.objects`: lectura con acceso a Productos de la organización;
  alta solo con `edicion` y sobre un producto de la propia organización; baja con `edicion`. Sin política UPDATE.
- **Pantalla**: `ImagenesProducto` dentro de `FormularioProducto` (alta y edición). Valida en el cliente (tipo, 2 MB, 4 como
  máximo) con mensajes claros; los archivos se **suben al guardar** el producto. Si una imagen falla el producto queda
  guardado y se ofrece «Reintentar subida»; si falla el registro de la fila se borra el archivo recién subido. Quitar
  borra primero la fila y después el archivo (si el archivo no se borra, se avisa). Con solo lectura se ven las imágenes
  sin agregar ni quitar. Las vistas usan URLs firmadas de 5 minutos.
- **Límites conocidos**: el tipo se valida por `file.type` (lo declara el cliente, igual que el bucket); no se verifican los
  bytes del archivo, y al ser un bucket privado con URL firmada el riesgo es bajo. La política de alta de Storage exige
  `<organizacion>/<producto>/<archivo>` con extensión jpg/jpeg/png/webp. Si se borra la fila pero falla el borrado del
  archivo, este queda huérfano en el bucket (se avisa al usuario); no hay barrido automático de huérfanos. Al guardar, la
  edición llama a `actualizar_producto` solo si cambian los datos del formulario; «Reintentar» repite subidas y borrados fallidos.
- **Actividad**: `producto.imagen_agregada` y `producto.imagen_eliminada` (trigger `producto_imagenes_registrar_actividad`,
  misma transacción, solo con sesión). El detalle nombra el producto y nunca lleva la ruta ni el costo.
- **Pruebas**: pgTAP `catalogo_producto_imagenes` (aislamiento en tabla y Storage, roles, quinta imagen, formato, eventos);
  Vitest de `lib/productoImagenes`, `ImagenesProducto` y las pantallas de alta y edición.
- **Reversión** (migración posterior, no en el mismo PR; exportar y vaciar el bucket antes): quitar los disparadores
  `producto_imagenes_registrar_actividad` y `producto_imagenes_tope`, las funciones
  `private.registrar_actividad_producto_imagen()` y `private.limitar_imagenes_producto()`, las tres políticas
  `productos_imagenes_*` de `storage.objects`, el bucket `productos-imagenes` y la tabla `dominio.producto_imagenes`.

## Reversión (migraciones `20261017120100` y `20261017120200`)

Aditivas. Se revierten en una migración posterior (no en el mismo PR): `drop trigger productos_registrar_actividad`,
`drop function private.registrar_actividad_producto()`, `drop function public.crear_producto(...)`,
`drop trigger productos_normalizar`, `drop function private.normalizar_producto()`,
`drop table dominio.producto_costos`, `drop table dominio.productos` (exportar los datos antes).

## Código de barras (MSF-529, migración `20261019120000`)

- `dominio.productos.codigo_barras` (esquema `dominio`): opcional, **13 dígitos** (`productos_codigo_barras_formato`; no se valida
  el dígito verificador porque hay códigos internos) y **único por organización** (índice parcial
  `productos_org_codigo_barras_uidx`). Otra organización puede repetirlo. Solo por producto: el de variantes es de otra épica.
- `crear_producto` suma `p_codigo_barras`; `actualizar_producto` suma `p_codigo_barras` + `p_cambiar_codigo_barras`
  (default `false` = sin cambio; el formulario siempre manda `true`, nulo = quitar). Se reemplazan las firmas anteriores
  (cambio de contrato); permisos: `authenticated` sí, `anon` no.
- Pantalla: campo «Código de barras (EAN-13)» en alta y edición; `23505` → «Ese código de barras ya existe». El listado no
  suma columna: el inventario del prototipo (`Productos.inventory.json`) no la tiene (solo figura entre las columnas a exportar).
- Reversión: restaurar las RPC y disparadores de `20261018190600`, luego `drop index dominio.productos_org_codigo_barras_uidx`
  y `alter table dominio.productos drop column codigo_barras` (exportar los datos antes).

## Precio y costo en pesos o dólares (F-PRE-01, MSF-115, épica MSF-114)

Spec: `specs/20261022-120000-precios-e-iva/`. Todo aditivo; el cálculo se hace **al leer**, no se guarda ningún importe en pesos.

- `dominio.cotizacion_inicial` (esquema `dominio`: dato de negocio de la organización): una fila por organización, `valor > 0`
  (`numeric(14,4)`), `updated_at` (avanza solo si el valor cambia). RLS por organización; lectura con `productos`; escritura
  con `empresas` = `edicion` (Administrador); sin DELETE; `anon` sin privilegios. La RPC `public.fijar_cotizacion_inicial(p_valor)`
  (`security invoker`; `42501` sin permiso, `23514` valor inválido, `22003` fuera de rango) es idempotente. La carga con pantalla y el
  recálculo masivo son de MSF-116: hasta entonces `private.a_pesos` es el único punto de lectura de la cotización.
- `private.a_pesos(importe, moneda, organizacion)`: ARS igual; USD × cotización con `round(…, 2)`; **sin cotización → `null`**
  (no se inventa un valor). `private.precio_central_ars(producto)` es el precio de lista en pesos sin IVA.
- Vista `public.productos_precio_costo` (`security_invoker`, lectura para `authenticated`): `precio_central_ars`, `cotizacion`,
  `cotizacion_fecha`, `costo_ars` y `margen` = (neto − costo en pesos) / neto. El costo sale de `producto_costos` con LEFT JOIN: sin la
  sección `rentabilidad` la RLS no entrega esa fila y `costo_ars`/`margen` quedan en `null`.
- Actividad: `producto.precio_actualizado` ante un cambio de moneda, de precio de lista (antes → después) o de costo; sin evento si no
  cambió nada ni al crear el producto. El detalle del **costo no lleva importes** (la Actividad la ve quien no tiene `rentabilidad`).
  Convive con `producto.editado`.
- Pantalla: el formulario de alta y edición reemplaza el campo «Precio en pesos: No disponible» por el bloque «Precio y costo»
  (`components/precios/`): vista previa en pesos, hint «costo $ … · con dólar $ … (fecha)», aviso «Cargá la cotización» si falta y
  «Margen estimado (escala x1)» solo con `rentabilidad`. El botón `Cotización →` queda deshabilitado hasta la pantalla del dólar
  (MSF-116). La vista previa espeja `private.a_pesos` (`lib/precios.ts`) solo mientras se escribe; la autoridad es la base.
- Reversión (migración posterior; exportar antes los datos): `drop trigger producto_costos_registrar_precio on dominio.producto_costos`,
  `drop trigger productos_registrar_precio on dominio.productos`, `drop function private.registrar_precio_costo_producto()`,
  `drop function private.registrar_precio_producto()`, `drop view public.productos_precio_costo`,
  `drop function private.precio_central_ars(uuid)`, `drop function private.a_pesos(numeric, text, uuid)`,
  `drop function public.fijar_cotizacion_inicial(numeric)`, `drop table dominio.cotizacion_inicial`.

## Regla de precio por empresa (F-PRE-07, MSF-172, épica MSF-114)

Spec: `specs/20261022-120000-precios-e-iva/`. Aditivo; el neto de cada empresa se **calcula al leer** desde el precio central (F-PRE-01).

- `dominio.precios_empresa` (esquema `dominio`: regla de negocio de cada empresa): una fila por empresa (`empresa_id` único),
  `base` ∈ {`central`, `central_ajuste`}, `ajuste_pct` (`numeric(7,3)`, `> −100`), `redondeo_pesos` = 10 y `updated_at` (avanza solo ante
  un cambio real). FK compuesta `(empresa_id, organizacion_id)` → `dominio.empresas` (por eso `empresas` suma
  `unique (id, organizacion_id)`). RLS por organización; lectura con `empresas` ≥ `lectura`; escritura con `empresas` = `edicion`;
  sin DELETE; `anon` sin privilegios. **Sin fila, la empresa es «Igual al central».**
- `public.guardar_regla_precio_empresa(p_empresa, p_base, p_ajuste_pct, p_updated_at)` (`security invoker`): valida base y ajuste,
  bloqueo optimista por `updated_at` (`40001`; `null` si la empresa aún no tenía regla), idempotente (repetir lo ya guardado no da
  conflicto ni evento). Con «Igual al central» el ajuste se guarda en 0. Errores: `42501` sin permiso, `23514` inválido, `22003`
  fuera de rango, `P0002` empresa inexistente en la organización.
- Cálculo (`private.aplicar_regla_precio`, única fórmula): `neto = central` o `round(central × (1 + ajuste/100) / 10) × 10`
  («Al $ 10 más cercano», mitad hacia arriba). `private.precio_neto_empresa(producto, empresa)` lo aplica a un producto; es el único
  punto de extensión para el «precio propio por empresa» (MSF-352); aún sin consumidor, conserva el `grant` a `authenticated` porque pgTAP
  lo ejercita con RLS (es `security invoker`, no amplía acceso). La moneda de la tienda es ARS.
- Vista `public.precios_empresa_neto` (`security_invoker`): `central_ars` y `neto_ars` por producto y empresa. **Solo devuelve filas a
  quien tiene la sección `empresas`** (lectura o edición): la regla vive bajo esa sección y, sin verla, el cálculo saldría «Igual al
  central» (un precio engañoso). **La vista es productos × empresas**: los consumidores deben filtrar por `empresa_id` o `producto_id`. Un consumidor de otra sección (p. ej. Ventas) necesitará ampliar esa lectura en su historia.
  `public.previsualizar_precios_empresa(empresa, base, ajuste, muestra)` calcula en el servidor una muestra de productos activos con
  una regla **sin guardar** (misma fórmula); la pantalla no recalcula.
- Actividad: `empresa.regla_precio_actualizada` (antes → después, con la empresa) ante un cambio real; sin evento si no cambió.
- Pantalla: `/empresas/edit/:id/precios`, pestaña «Precios y moneda» de la ficha de la empresa (junto a «General»), protegida por la
  sección `empresas` («Acceso restringido» sin acceso; solo lectura con `lectura`). Una empresa por ruta: al abrir otra
  (`Cambiar a <otra> ↔`) se reinician la regla, el formulario, la vista previa y los avisos. Pendiente de otras historias: «Precios que
  ve el cliente» (IVA, F-PRE-12), «precio propio» (MSF-352) y el destino de `Cotización →` (MSF-116).
- Reversión (migración posterior; exportar antes los datos): `drop function public.previsualizar_precios_empresa(uuid, text, numeric, integer)`,
  `drop view public.precios_empresa_neto`, `drop function private.precio_neto_empresa(uuid, uuid)`,
  `drop function private.aplicar_regla_precio(numeric, text, numeric, integer)`,
  `drop function public.guardar_regla_precio_empresa(uuid, text, numeric, timestamptz)`,
  `drop trigger precios_empresa_registrar on dominio.precios_empresa`, `drop function private.registrar_regla_precio_empresa()`,
  `drop function private.describir_regla_precio(text, numeric)`, `drop trigger precios_empresa_tocar on dominio.precios_empresa`,
  `drop function private.tocar_precios_empresa()`, `drop table dominio.precios_empresa`,
  `alter table dominio.empresas drop constraint empresas_id_organizacion_key`.
