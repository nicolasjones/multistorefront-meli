---
owner: producto
sources:
  - specs
---

# Catálogo de productos

Spec: `specs/20261017-120000-catalogo-alta-y-edicion/` (épica MSF-456). Cubre alta (F-CAT-02), SKU único (F-CAT-03),
edición (F-CAT-04), imágenes (F-CAT-05) y estado activo/inactivo (F-CAT-06). La épica MSF-160
(`specs/20261020-120000-catalogo-listado-y-categorias/`) agrega el listado con búsqueda y filtros (F-CAT-01), las
empresas que venden cada producto (F-CAT-07) y las categorías (F-CAT-08). Construcción interna de MSF-160:
[Catálogo: listado, empresas y categorías](tecnico/catalogo.md). Permisos: `docs/permisos-por-rol.md`; aislamiento:
`docs/aislamiento-por-organizacion.md`; eventos: `docs/actividad.md`.

## Qué resuelve y para quién

- **Quien administra el catálogo** encuentra cualquier producto en segundos: busca por nombre o SKU, filtra por
  estado y tienda, ordena y pagina sin traer todo el catálogo.
- **Quien decide la publicación** marca en qué empresas (tiendas) se vende cada producto; el producto y su stock son
  únicos y compartidos, y cada tienda lo publica con su propio precio cuando llegue Precios.
- **Quien arma el menú de las tiendas** organiza categorías y subcategorías (dos niveles), decide en qué tiendas se
  ven y las reordena.

## Alcance y seguimiento

- MSF-160 entregó el listado real (reemplaza la grilla mínima), la categoría del producto y las empresas que lo
  venden. Queda fuera de alcance: proveedor (MSF-205), exportar e importar CSV, acciones masivas, destacado,
  newsletter, borrado de productos, IVA de categoría (F-PRE-12, MSF-114), etiquetas de stock (F-CAT-17) y los
  valores de precio, costo, margen y stock (se muestran «—» hasta sus componentes).
- El E2E de punta a punta «crear, editar, subir fotos y desactivar» queda pendiente de fixtures por rol: ver
  `docs/e2e-app.md`. Mientras tanto lo cubren pgTAP (`catalogo_*`) y Vitest (`pages/productos`, `pages/categorias`,
  `lib/productos*`, `lib/categorias*`).

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

MSF-160 suma, en el mismo esquema `dominio`, `producto_empresa` (empresas que venden el producto), `categorias` y
`categorias_empresa` (visibilidad por tienda), y la columna `productos.categoria_id`. La lectura del listado pasa por
la vista `public.v_productos_listado` (sin costo ni precio). DER, columnas, RLS y reversión:
[Catálogo: listado, empresas y categorías](tecnico/catalogo.md#modelo-de-datos-der).

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
  `/productos` es el listado con búsqueda, filtros, orden y paginación en servidor (ver «Listado»); los productos
  inactivos se listan con la etiqueta «Inactivo». Con permiso de edición suma «Nuevo producto», «Editar» y
  Activar/Desactivar por fila; con solo lectura no hay acciones. El alta, la ficha, el listado y las categorías se
  descargan bajo demanda (`lazy`).
- Menú **Catálogo → Categorías** (`/categorias`, ícono Category, sección `categorias`, audiencia organización):
  árbol de dos niveles con visibilidad por tienda (ver «Categorías»).
- Formulario: aviso «Faltan datos obligatorios», diálogo «Descartar cambios», «Precio en pesos: No disponible»
  (lo entrega Precios, MSF-114), ayuda del SKU «Se genera solo si lo dejás vacío», costo solo con edición en
  Rentabilidad, sección «Empresas que lo venden» y selector de categoría opcional. Sin stock inicial.
- Diferencias con el prototipo: sin variantes, relacionados, escalas, proveedor, video ni acciones masivas; las
  categorías son de dos niveles; el IVA de categoría y los valores de precio, costo, margen y stock quedan para sus
  épicas. Ver «Diferencias con el prototipo (MSF-160)».

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

MSF-160 agrega `producto.empresas_actualizadas`, `producto.categoria_asignada`, `categoria.creada`, `categoria.editada`,
`categoria.reordenada` y `categoria.eliminada`. Se registran en la misma transacción, solo con sesión y solo ante
cambios reales; el detalle es legible y no lleva ids, precios ni costo. Ver [Actividad](actividad.md) y el detalle
técnico en [Catálogo: listado, empresas y categorías](tecnico/catalogo.md#actividad).

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

## Listado (F-CAT-01)

`/productos` muestra una tabla (tarjetas en pantallas angostas) paginada en el servidor, de 25 productos por página,
con el pie «desde–hasta de N». La búsqueda, el filtro, el orden y la paginación se resuelven en la base; el navegador
nunca trae el catálogo completo.

- **Columnas**: Producto (miniatura, nombre y SKU), Precio, Costo, Margen y Stock (las cuatro con «—» hasta Precios,
  Costo, Rentabilidad y Stock), Categoría, «Visible en» (un chip por empresa: relleno si la vende, contorno si no) y
  Estado (Activo/Inactivo). Con edición en Productos suma «Editar» y Activar/Desactivar por fila.
- **Buscar por nombre o SKU**: parcial, sin distinguir mayúsculas; espera 300 ms desde la última tecla y acepta hasta
  80 caracteres. `%` y `_` se buscan como texto; la coma, los paréntesis, las comillas, el asterisco y la barra
  invertida no se interpretan. Al buscar vuelve a la página 1.
- **Filtros**: «Todos» e «Inactivos» funcionan; «Sin stock», «Stock bajo» y «Sin vincular a ML» se ven deshabilitados
  con la explicación de que llegan con Stock y Mercado Libre. «Limpiar filtros» restablece búsqueda, estado, tienda y
  categoría.
- **Orden**: por Producto, SKU o Estado, ascendente o descendente, con desempate estable por id. En la tabla se ordena
  por el encabezado; en las tarjetas, con el selector «Ordenar por».
- **Estados**: carga, catálogo vacío («Todavía no hay productos cargados.»), sin coincidencias («No hay productos que
  coincidan» + «Probá con otra búsqueda o limpiá los filtros.») y error con «Reintentar».
- **Permisos**: con solo lectura se ve el listado sin acciones; la base igual rechaza cualquier escritura. La ruta sigue
  protegida por la sección `productos`.

## Empresas que venden el producto (F-CAT-07)

El catálogo es único y compartido: cada producto se publica solo en las empresas (tiendas) que se elijan. La pantalla
no asume una cantidad fija de empresas.

- **Alta y edición del producto**: sección «Empresas que lo venden» con el texto «El producto y su stock son únicos y
  compartidos. Cada tienda lo publica con su propio precio y estado.», una fila por empresa con nombre, «Precio: —»
  hasta Precios e interruptor accesible. Un producto nuevo no se vende en ninguna empresa hasta marcarla; se muestra
  «No se muestra en ninguna store: el producto no aparece en el catálogo público.» o la lista de tiendas donde se ve.
- **Guardado**: al guardar se reemplazan las empresas en una sola operación atómica; repetir la misma selección no
  cambia nada. Solo se aceptan empresas de la propia organización. Si el producto ya se creó y falla el guardado de
  empresas, el producto queda creado y se ofrece «Reintentar empresas» sin perder lo elegido.
- **Listado**: «Visible en» muestra un chip por empresa y el filtro de tienda (Todas las tiendas / cada empresa) se
  resuelve en el servidor. Filtrar por una tienda trae solo los productos que se venden ahí; un producto sin empresas
  aparece con «Todas las tiendas».
- **Actividad**: un cambio real deja «Cambió las empresas del producto <nombre> (SKU …): agregó …; quitó …», sin
  precios ni costo.
- **Solo lectura**: las empresas se ven, pero los interruptores y la llamada directa a la RPC quedan rechazados.

## Categorías (F-CAT-08)

Catálogo → Categorías (`/categorias`) administra el menú de las tiendas. Hay **dos niveles**: categoría raíz y
subcategoría; el orden es manual (no alfabético) y se guarda por posición.

- **Árbol**: muestra cada categoría con la cantidad de subcategorías y de productos (los de una raíz incluyen los de sus
  subcategorías), la visibilidad por tienda y las acciones. «Expandir todo» y «Contraer todo» abren o cierran el árbol.
- **Nueva/Editar**: pide Nombre (obligatorio), Categoría padre (opcional; solo raíces, «Ninguna (categoría raíz)») y
  Visible en (una casilla por empresa; al crear se marcan todas). Muestra la ruta resultante («Joysticks > Cableados»).
  Un nombre repetido en el mismo nivel —sin distinguir mayúsculas ni espacios extremos— se rechaza conservando lo
  escrito, y la base lo vuelve a validar.
- **Dos niveles**: no se puede crear una subcategoría dentro de otra subcategoría ni mover una categoría con
  subcategorías debajo de otra; la base lo rechaza aunque la pantalla falle.
- **Reordenar y mover**: arrastrar y soltar con el mouse y Subir/Bajar con el teclado. Un movimiento inválido se avisa
  y no se aplica. Con una tienda filtrada, Subir/Bajar intercambia con la hermana visible más cercana; arrastrar y
  soltar opera sobre el árbol completo.
- **Eliminar**: el diálogo «Eliminar categoría» informa cuántos productos y subcategorías se ven afectados. Al confirmar,
  los productos quedan sin categoría y las subcategorías suben a raíz. Si una subcategoría choca de nombre con una raíz,
  no se elimina nada y se pide renombrarla.
- **Visibilidad por tienda**: una categoría se ve solo en las tiendas marcadas. El filtro de tienda de la pantalla
  muestra el árbol de esa tienda.
- **Asignación al producto**: el alta y la edición tienen un selector de categoría opcional (raíz o subcategoría, con la
  ruta «Padre > Hija»). El listado suma la columna Categoría; filtrar por una raíz incluye sus subcategorías.
- **Permisos**: la sección `categorias` decide lectura o edición. Con solo lectura se ve el árbol sin acciones; sin
  acceso, el guard de la ruta bloquea la pantalla.
- **Actividad**: alta, edición, reordenado y eliminación dejan un evento legible; asignar o quitar la categoría de un
  producto deja `producto.categoria_asignada`.

## Empresa activa

- **Productos**: el filtro de tienda sigue a la empresa activa de la barra superior y se puede sobreescribir con los
  chips de la pantalla sin cambiar la empresa persistida. Al cambiar la empresa activa se vuelve a consultar el listado
  y la página vuelve a 1; si la empresa elegida no tiene productos, se ve el estado sin coincidencias y «Limpiar
  filtros» vuelve a «Todas las tiendas».
- **Categorías**: la empresa activa filtra qué categorías se ven y el árbol se recarga al cambiarla. Las categorías son
  de la organización (no de una empresa): un diálogo abierto sigue siendo válido y no guarda datos de otra organización.
  Al cambiar de organización se vacía el árbol, se reinicia la expansión y se cierran los diálogos.

## Diferencias con el prototipo (MSF-160)

- Categorías de **dos niveles** (raíz y subcategoría); el prototipo menciona «hasta 3.er nivel» y el roadmap decía
  «multinivel».
- **Sin IVA** de categoría (lo agrega Precios, MSF-114) y sin acciones masivas, exportar, importar CSV, destacado,
  newsletter ni borrado de productos.
- Precio, Costo, Margen y Stock se muestran **«—»** hasta que lleguen sus componentes; los filtros de stock y Mercado
  Libre se ven deshabilitados.
- En «Empresas que lo venden» no se muestra el dominio web de cada tienda porque `dominio.empresas` todavía no lo
  guarda.
- La estética sale del sistema de diseño (MSF-117); el prototipo es referencia visual, no pixel a pixel.

## Pendientes y dueños

- **Precio por empresa** en el listado y en «Empresas que lo venden»: Precios (MSF-114).
- **Costo, margen y stock** en el listado, y los filtros de stock: Costo y disponibilidad (MSF-179), Rentabilidad
  (MSF-120) y Stock (Hito 2).
- **Filtro «Sin vincular a ML»**: Mercado Libre (Etapa 2).
- **IVA de categoría**: F-PRE-12 (MSF-114).
- **Exportar/importar y edición masiva**: MSF-202 y MSF-218.
- **E2E de punta a punta del catálogo** con fixtures por rol: dueño del equipo de pruebas; hoy lo cubren pgTAP y Vitest.

## Reversión (migraciones `20261017120100` y `20261017120200`)

Aditivas. Se revierten en una migración posterior (no en el mismo PR): `drop trigger productos_registrar_actividad`,
`drop function private.registrar_actividad_producto()`, `drop function public.crear_producto(...)`,
`drop trigger productos_normalizar`, `drop function private.normalizar_producto()`,
`drop table dominio.producto_costos`, `drop table dominio.productos` (exportar los datos antes).
