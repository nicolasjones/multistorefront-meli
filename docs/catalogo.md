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
  `/productos` es el listado con búsqueda, filtros, orden y paginación en servidor (ver «Listado»); los productos
  inactivos se listan con la etiqueta «Inactivo». Con permiso de edición suma «Nuevo producto», «Editar» y Activar/Desactivar
  por fila; con solo lectura no hay acciones. El alta, la ficha y la grilla se descargan bajo demanda (`lazy`).
- Formulario: aviso «Faltan datos obligatorios», diálogo «Descartar cambios», «Precio en pesos: No disponible»
  (lo entrega Precios, MSF-114), ayuda del SKU «Se genera solo si lo dejás vacío», costo solo con edición en
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

## Listado (F-CAT-01, MSF-252, migraciones `20261020120000` y `20261020120100`)

`/productos` (Catálogo → Productos) lee `public.v_productos_listado` y resuelve **en el servidor** la búsqueda, el filtro, el orden y la paginación (25 por página, pie «desde–hasta de N», `range` + `count`). La vista es de **`public`** (es una vista, no una tabla; no se crea ninguna tabla), `security_invoker = true` —rige la RLS de `dominio.productos` y `dominio.producto_imagenes`—, sin acceso de `anon` y **sin costo ni precio** (Decisión 5). Columnas del contrato: `id, organizacion_id, nombre, sku, activo, imagen_ruta, updated_at, empresa_ids` (esta última desde F-CAT-07); las historias F-CAT-07 y F-CAT-08 (y MSF-179/202) solo agregan columnas **al final**. `imagen_ruta` es la de menor posición del bucket privado; la app la firma por página.

- **Columnas**: Producto (miniatura, nombre, SKU), Precio, Costo, Margen y Stock (todas «—» hasta Precios, Costo, Rentabilidad y Stock), Estado y acciones (Editar, Activar/Desactivar, solo con edición en Productos).
- **Búsqueda**: por nombre o SKU, parcial y sin distinguir mayúsculas (`ilike`), con espera de tipeo de 300 ms, 80 caracteres como máximo, comodines `%`/`_` escapados y `, ( ) " \` descartados (`filtroBusquedaProductos`). Vuelve a la página 1.
- **Filtros**: Todos e Inactivos. «Sin stock», «Stock bajo» y «Sin vincular a ML» se ven deshabilitados con su explicación hasta que lleguen Stock y Mercado Libre. «Limpiar filtros» aparece cuando hay alguno activo.
- **Orden**: por encabezado Producto y Estado (tabla ancha) y, en cualquier ancho —incluidas las tarjetas de <600 px—, con el selector «Ordenar por» (Producto, SKU, Estado) y el botón Ascendente/Descendente; desempate estable por `id`. La búsqueda quita también el comodín `*` de PostgREST.
- **Estados**: carga, «Todavía no hay productos cargados.» (catálogo vacío), «No hay productos que coincidan» + «Probá con otra búsqueda o limpiá los filtros.» y error con «Reintentar».
- **Índices** (`dominio.productos`): GIN trigram sobre `nombre` y `sku` y btree `(organizacion_id, nombre, id)` / `(organizacion_id, sku, id)`. Se indexa la columna cruda (no `lower(...)`, como decía la tarea T002) porque PostgREST expresa `ilike`/`order` sobre la columna y un índice sobre `lower()` no se usaría. Requiere `pg_trgm`.
- **Pruebas**: pgTAP `catalogo_listado.test.sql` (aislamiento, `anon`, sin costo, comodines escapados) y `catalogo_listado_plan.test.sql` (10 000 productos sembrados; `explain` de la condición `ilike` sobre la vista usa los índices trigram y `explain` del orden usa los btree). El plan de búsqueda se mide sin el filtro de organización: con el catálogo de una sola organización ese filtro no discrimina y, a 10 000 filas, el planner prefiere el btree por organización; el trigram es el único índice que resuelve el `ilike` y rinde cuando el catálogo crece. Se ejecutan en el CI (job `database`); localmente hace falta `pnpm dev:supabase`.
- **Reversión** (migración posterior, no en el mismo PR): `drop view public.v_productos_listado;` y `drop index dominio.productos_nombre_trgm_idx, dominio.productos_sku_trgm_idx, dominio.productos_org_nombre_orden_idx, dominio.productos_org_sku_orden_idx;`.
- **Sin cambios** en la ruta `/productos`, los permisos ni las acciones de F-CAT-06.

## Empresas que venden el producto (F-CAT-07, MSF-276, migraciones `20261020130000`, `20261020130100` y `20261020130200`)

El catálogo es único y compartido; cada producto se publica solo en las empresas (tiendas) que se elijan. **Sin cantidad fija de empresas**: ningún código asume dos.

- **Tabla** `dominio.producto_empresa` (esquema **`dominio`**: relación de negocio, junto a `productos` y `empresas`): PK `(producto_id, empresa_id)`, `organizacion_id`, `creado_en`; FKs **compuestas** `(producto_id, organizacion_id)` y `(empresa_id, organizacion_id)` que impiden cruzar organizaciones (la migración suma `unique (id, organizacion_id)` a `dominio.empresas`, aditivo). RLS: lectura con `lectura`/`edicion` en `productos`; insert/delete con `edicion`; **sin UPDATE** y sin privilegios para `anon`. Un producto nuevo no se vende en ninguna empresa hasta marcarlas.
- **Escritura** `public.definir_empresas_producto(p_producto_id, p_empresa_ids uuid[])` → cantidad que queda. `security invoker`; exige `edicion` en `productos` (`42501`); `P0002` producto inexistente; `22023` empresa de otra organización/inexistente o valores vacíos (sin cambios parciales). **Atómica e idempotente**: calcula el delta, inserta lo que falta y borra lo que sobra, con candado por producto; repetir la lista no cambia nada. `revoke … public, anon` / `grant execute … authenticated`.
- **Actividad** `producto.empresas_actualizadas`: triggers por sentencia sobre `producto_empresa`, misma transacción, solo con sesión y **solo ante cambios reales**; un único evento por guardado con detalle «Cambió las empresas del producto <nombre> (SKU …): agregó A, B; quitó C». Sin precios ni costo. Ver `docs/actividad.md`.
- **Formulario** (`EmpresasProducto` dentro de `FormularioProducto`, alta y edición): «Empresas que lo venden», texto «El producto y su stock son únicos y compartidos. Cada tienda lo publica con su propio precio y estado.», una fila por empresa de la organización (nombre, «Precio: —» hasta Precios/MSF-114, interruptor `role="switch"` con el nombre de la empresa) y la nota «Visible en … y ….» / «No se muestra en ninguna store: el producto no aparece en el catálogo público.». El prototipo muestra también el dominio web de cada tienda: `dominio.empresas` todavía no lo guarda, por eso no se muestra. Con solo lectura los interruptores quedan deshabilitados (y la base rechaza la llamada directa). Alta: el producto se crea primero y las empresas se guardan después; si fallan, el producto queda creado y se ofrece **«Reintentar empresas»** con lo elegido. Edición: si solo cambian las empresas no se llama a `actualizar_producto` (no sube `updated_at`).
- **Listado**: `v_productos_listado` suma `empresa_ids` **al final** (`create or replace view`, todas las columnas previas intactas; F-CAT-08 vuelve a repetir la definición completa). Columna «Visible en» con un chip por empresa (relleno si la vende, contorno si no; el `aria-label` dice «se vende»/«no se vende»). El filtro de tienda (Todas las tiendas / una por empresa) **sigue la empresa activa** (`useFiltroPorEmpresaActiva`) y se resuelve en el servidor (`empresa_ids @> {empresa}`); elegir otra tienda acá no cambia la empresa activa persistida. **Rendimiento (justificado):** `empresa_ids` es un `array_agg` correlacionado, así que el filtro por tienda no usa `producto_empresa_empresa_idx`: evalúa, por cada producto de la organización, un subselect por la PK `(producto_id, empresa_id)`. El volumen es el de un catálogo por organización (miles de productos, un puñado de empresas) y la consulta ya viene acotada por `organizacion_id` y paginada; a esa escala el costo es un recorrido de la organización con búsquedas por PK, por eso no se agrega un `explain`. Si el catálogo crece a decenas de miles, la salida es filtrar con `exists` sobre `producto_empresa` (usa el índice por empresa) en una migración posterior. Un producto nuevo no tiene empresas: con una tienda activa filtrando no aparece hasta elegir «Todas las tiendas» o marcarle una tienda; el texto de ayuda del listado lo avisa.
- **Pruebas**: pgTAP `catalogo_producto_empresa.test.sql` (aislamiento, FK cruzada, permisos por rol, empresa ajena, atomicidad, idempotencia, evento sin precios, RLS de la tabla) y Vitest (`EmpresasProducto`, `productoEmpresas`, `create`/`edit`/`list`). Los pgTAP corren en el CI (job `database`); localmente hace falta `pnpm dev:supabase`.
- **Reversión** (migración posterior, no en el mismo PR): `drop trigger producto_empresa_actividad_baja/alta on dominio.producto_empresa;` `drop function private.registrar_actividad_empresas_baja(), private.registrar_actividad_empresas_alta(), private.registrar_actividad_empresas_producto(uuid, uuid, text, text), public.definir_empresas_producto(uuid, uuid[]);` `drop table dominio.producto_empresa;` `alter table dominio.empresas drop constraint empresas_id_organizacion_uk;` y `create or replace view public.v_productos_listado` con la definición de `20261020120000` (sin `empresa_ids`).

## Categorías (F-CAT-08, MSF-298, migraciones `20261020140000`, `20261020140100` y `20261020140200`)

Catálogo → Categorías (`/categorias`, sección `categorias`, ruta con `RequiereAccesoSeccion`, carga diferida) administra el árbol del menú de cada tienda. **Dos niveles**: categoría raíz y subcategoría (el prototipo dice «hasta 3.er nivel»; la Decisión 1 de la spec fija 2). El orden es manual por posición, no alfabético.

- **Tablas** (esquema **`dominio`**: estructura de negocio del catálogo): `dominio.categorias` (`nombre` recortado de 1–100, `padre_id`, `posicion`, `organizacion_id`) y `dominio.categorias_empresa` (visibilidad por tienda: PK `(categoria_id, empresa_id)`, `organizacion_id`). FKs **compuestas** con `organizacion_id`; borrar el padre sube al hijo a raíz (`on delete set null (padre_id)`). RLS por organización y por la sección `categorias` (lectura/edición; nunca `puede_escribir()`), sin privilegios para `anon`. Grants por columna: el llamador no fija `organizacion_id` ni `updated_at`.
- **Reglas en la base** (FR-015/FR-016): nombre único por nivel sin distinguir mayúsculas ni espacios extremos (`(organizacion_id, padre, lower(btrim(nombre)))`); el padre debe ser raíz, una categoría con hijos no puede tener padre y nadie es su propio padre. Se valida sobre el estado **final** con un disparador de restricción diferido, así un reordenado válido no falla por estados intermedios. Toda escritura toma el mismo candado asesor por organización (`pg_advisory_xact_lock`), de modo que dos reordenados/ediciones simultáneos se serializan.
- **Escritura** (tres RPC `security invoker`, atómicas, `revoke … public, anon` / `grant execute … authenticated`):
  - `public.guardar_categoria(p_id, p_nombre, p_padre_id, p_empresa_ids)` → id (alta si `p_id` es nulo). `42501` sin permiso, `22023` datos inválidos, `P0002` padre/categoría inexistente, `23505` nombre repetido en el nivel, `23514` viola los 2 niveles, `23505`/`23514` también al mover. La visibilidad se reemplaza en la misma transacción.
  - `public.reordenar_categorias(p_orden)` recibe `[{id, padre_id, posicion}]`, persiste padre y posición en una sola sentencia y valida los 2 niveles sobre el resultado. Devuelve cuántas filas cambiaron.
  - `public.eliminar_categoria(p_id)` sube las subcategorías a raíz, deja los productos sin categoría (`on delete set null (categoria_id)`) y devuelve `{productos, subcategorias}` afectados; si una subcategoría choca de nombre con una raíz rechaza con `23505` y no borra nada.
- **Asignación al producto** (`public.asignar_categoria_producto(p_producto_id, p_categoria_id)`): `security invoker`, exige `edicion` en `productos`; `p_categoria_id` nulo quita la categoría. La FK compuesta impide asignar una categoría de otra organización.
- **Actividad** (FR-023): `categoria.creada|editada|reordenada|eliminada` y `producto.categoria_asignada`, en la misma transacción, solo con sesión y solo ante cambios reales; los detalles no llevan datos sensibles. Ver `docs/actividad.md`.
- **Pantalla**: árbol con conteo de productos por categoría (los de una raíz incluyen los de sus subcategorías), chips de visibilidad por tienda, «Expandir todo»/«Contraer todo», filtro de tienda que sigue la empresa activa y se puede limpiar, y estados de carga, vacío («Todavía no hay categorías.») y error con «Reintentar». Con solo lectura se ve el árbol sin acciones.
- **Reordenar**: arrastrar y soltar HTML5 nativo (sin librería) y Subir/Bajar por teclado; ambos persisten con `reordenar_categorias`. Un movimiento que viola los 2 niveles se rechaza con un aviso visible y no se aplica.
- **Formulario** (`FormularioCategoria`, Nueva/Editar): Nombre, Categoría padre (solo raíces; una categoría con subcategorías no ofrece padre), Visible en por empresa (una casilla por empresa, las inactivas se marcan como tales), ruta resultante «Padre > Hija» y Cancelar/Guardar. El nombre vacío se marca en el campo; el duplicado se avisa **conservando lo escrito** (chequeo en la app y, si el servidor lo rechaza, también se conserva).
- **Eliminar** (`EliminarCategoriaDialogo`): texto del prototipo con productos directos y subcategorías afectadas («… Los productos quedan sin categoría y las subcategorías suben un nivel.») y confirmación atómica con el botón deshabilitado mientras trabaja.
- **Producto**: `SelectorCategoria` opcional en alta y edición, con «Sin categoría», raíces y subcategorías en ruta «Padre > Hija». Si la categoría actual no está en la lista (p. ej. sin permiso de lectura en Categorías) se conserva y se avisa, sin mostrar el id técnico.
- **Listado**: `v_productos_listado` suma **al final** `categoria_id`, `categoria_ruta` («Padre > Hija») y `categoria_ids` (`[hija, padre]` o `[raíz]`). La columna «Categoría» muestra la ruta o «—»; el filtro por categoría se resuelve en el servidor y elegir una raíz incluye sus subcategorías (`categoria_ids` contiene el id elegido). El contrato previo de columnas no cambia. Rendimiento: `categoria_ids` es una columna calculada de la vista, así que `contains` sobre ella no usa `productos_categoria_idx` (recorre los productos de la organización, ya acotados por RLS); es aceptable con los catálogos actuales y no se midió con volúmenes grandes — si el listado se vuelve lento, filtrar por `categoria_id in (raíz + hijas)` para aprovechar el índice. Si la categoría filtrada se elimina, el listado descarta el filtro. Con la vista filtrada por tienda, Subir/Bajar intercambia con la hermana visible más cercana.
- **Pruebas**: pgTAP `catalogo_categorias.test.sql` (2 niveles, nombre único por nivel, RLS por sección y organización, reordenado y concurrencia con el candado asesor, eliminar, asignación, eventos, `rls_en_toda_tabla`; SC-004/SC-005) y Vitest (`lib/categorias`, `ArbolCategorias`, `FormularioCategoria`, `EliminarCategoriaDialogo`, `SelectorCategoria`, `pages/categorias/list`, `productos/list|create|edit`). Los pgTAP corren en el CI (job `database`); localmente hace falta `pnpm dev:supabase`.
- **Límites conocidos** (aceptados): las lecturas de la pantalla (`categorias`, `categorias_empresa`, `v_categorias_productos`) no paginan y PostgREST corta en `max-rows` (1000 por defecto): con más filas, los chips «Visible en», el filtro por tienda y los conteos quedarían incompletos; el volumen esperado (decenas de categorías) queda muy por debajo, y si crece hay que paginar con `range`. `reordenar_categorias` recibe el árbol completo calculado en el cliente: con dos editores simultáneos **gana el último** y puede revertir un movimiento ajeno (el candado asesor solo serializa, no fusiona). El `DELETE` directo sobre `dominio.categorias` sigue concedido a quien edita la sección (RLS acota por organización, sin fuga entre organizaciones), pero no toma el candado ni ordena las subcategorías como `eliminar_categoria`: la app solo usa la RPC. Al cambiar de **organización** la pantalla vacía el árbol, reinicia la expansión, cierra los diálogos y recarga (Principio VIII). En la vista filtrada por tienda, el conteo de la raíz suma solo sus productos directos y los de las subcategorías visibles.
- **Reversión** (migración posterior, no en el mismo PR): `drop trigger productos_actividad_categoria on dominio.productos;` `drop function private.registrar_actividad_producto_categoria(), public.asignar_categoria_producto(uuid, uuid);` `drop view public.v_categorias_productos;` `alter table dominio.productos drop column categoria_id;` `create or replace view public.v_productos_listado` con la definición de `20261020130200` (sin categoría); `drop trigger categorias_actividad_alta/cambio/baja on dominio.categorias;` `drop function private.registrar_actividad_categoria_alta(), private.registrar_actividad_categoria_cambio(), private.registrar_actividad_categoria_baja(), private.ruta_categoria(uuid), public.guardar_categoria(uuid, text, uuid, uuid[]), public.reordenar_categorias(jsonb), public.eliminar_categoria(uuid);` `drop table dominio.categorias_empresa, dominio.categorias;` y `drop function private.normalizar_categoria(), private.validar_categorias_dos_niveles();`.
- **Sin cambios** en las rutas ni en los permisos existentes: la sección `categorias` ya existía en la matriz de permisos.
