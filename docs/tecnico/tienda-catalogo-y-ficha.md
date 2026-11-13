---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Tienda pública: catálogo y ficha (MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/spec.md` · plan y contratos en la misma carpeta.
Épica **MSF-167** (F-TDA-11, F-TDA-12, F-TDA-13 y F-TDA-18), merge `7d51d0b` (PR #317).
Depende de [MSF-147 (dominio, identidad, catálogo visible)](tienda-dominio-e-identidad.md), MSF-114 (precio
e IVA) y MSF-231 (stock). Resumen de producto y límites:
[Tiendas online: catálogo y ficha](../producto/tiendas-online.md).
Correcciones posteriores sobre estas funciones: [MSF-825 (demo frente al prototipo)](tienda-demo-vs-prototipo.md).
La carga por tandas del catálogo, la categoría y los resultados de búsqueda llega con **MSF-845** (ver
[Carga infinita en los listados](#carga-infinita-en-los-listados-msf-845)).

## Alcance de entrega

- **`supabase`:** cuatro migraciones **aditivas**, sin tablas nuevas; solo funciones de lectura.
- **`refine`:** front público en `apps/web/src/pages/tienda-publica/`; no hay pantallas nuevas en el panel.
- **Sin** `workers`, `kestra`, `superset` ni Compose nuevo.

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-11 | `supabase/migrations/20261023150000_tienda_categorias_publicas.sql` | `publico.categorias_por_dominio(text)` | `drop function publico.categorias_por_dominio(text)` |
| F-TDA-18 | `supabase/migrations/20261023150100_tienda_disponibilidad_publica.sql` | `private.disponible_publico(uuid)` | `drop function private.disponible_publico(uuid)` |
| F-TDA-12 | `supabase/migrations/20261023150200_tienda_catalogo_publico.sql` | `private.precio_final_publico`, `private.imagen_publica`, `publico.imagen_publica`, política `productos_imagenes_select_anon`, `publico.catalogo_pagina_por_dominio` | `drop` de la función del catálogo, la política y las tres funciones |
| F-TDA-13 | `supabase/migrations/20261023150300_tienda_ficha_publica.sql` | `publico.producto_por_dominio(text, uuid)` | `drop function publico.producto_por_dominio(text, uuid)` |

Orden lógico: F-TDA-18 antes de F-TDA-12/13 (lo usan) y F-TDA-12 antes de F-TDA-13 (usa precio e
imágenes). Cada migración trae su reversión en el encabezado.

## Modelo de datos: sin cambios de esquema

La épica **no crea ni altera tablas**. `publico` sigue siendo un esquema **solo de funciones** (sin
tablas); las tablas leídas son las existentes de MSF-147, Catálogo, Precios y Stock.

| Objeto | Esquema | Naturaleza | Acceso |
|---|---|---|---|
| `publico.categorias_por_dominio(host)` | `publico` | Función `stable` / `security definer`, lista blanca | `anon` y `authenticated` |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | `publico` | Ídem; devuelve `jsonb` | `anon` y `authenticated` |
| `publico.producto_por_dominio(host, producto)` | `publico` | Ídem; devuelve `jsonb` | `anon` y `authenticated` |
| `publico.imagen_publica(ruta)` | `publico` | Envoltorio `security definer` de `private.imagen_publica`; devuelve booleano | `anon` y `authenticated` |
| `private.disponible_publico(producto)` | `private` | Lógica interna; solo booleano | Sin `execute` para roles de API |
| `private.precio_final_publico(producto, empresa)` | `private` | Lógica interna de precio | Sin `execute` para roles de API |
| `private.imagen_publica(ruta)` | `private` | Respaldo de la política de storage | Sin `execute` para roles de API |
| Política `productos_imagenes_select_anon` | `storage` | `select` para `anon` sobre `storage.objects`, bucket `productos-imagenes`, acotada por `publico.imagen_publica` | `anon` |

Tablas existentes que participan del grafo de lectura: `dominio.tiendas`, `dominio.empresas`,
`dominio.categorias`, `dominio.categorias_tienda`, `dominio.productos`, `dominio.producto_empresa`,
`dominio.productos_tienda`, `dominio.producto_imagenes`, `dominio.existencias`,
`dominio.precios_empresa`, `dominio.producto_precios_escala` y `dominio.alicuotas_iva`.
No hay ERD nuevo porque no hay cambio de esquema; el modelo del catálogo está en
[Datos y DER](datos.md#modelo-del-catálogo-msf-160) y su [ERD interactivo](../diagrams/msf-160-erd.html).

### Visibilidad efectiva

Se reutiliza una sola definición, `private.catalogo_tienda_efectivo(empresa)` (MSF-147): un producto es
**efectivo** si está activo, su fila en `dominio.productos_tienda` no lo oculta (`visible`) y su
categoría —y la categoría padre— no están ocultas en `dominio.categorias_tienda`. Sin fila se toma el
valor predeterminado (visible). El catálogo, las categorías y la ficha parten de esa misma regla; por eso
un producto oculto no aparece ni entrando por URL.

## Contratos públicos

Todas las funciones de `publico` son `security definer`, `stable`, `set search_path = ''`, normalizan el
`host` con `private.normalizar_host`, filtran por `dominio.empresas.activa` y devuelven una **lista
blanca** de campos. Host desconocido, host inválido y empresa desactivada devuelven **el mismo `null`**
(anti-enumeración). Nunca devuelven `organizacion_id`, costos, existencias, proveedor ni códigos internos.
Cada una hace `revoke execute … from public` y `grant execute … to anon, authenticated`.

| Función | Devuelve |
|---|---|
| `publico.categorias_por_dominio(host)` | `{ categorias: [{ id, nombre, padre_id, productos, imagen }] }` o `null`. Categorías visibles en el orden de Catálogo (raíces primero, luego posición); `productos` cuenta los efectivos de la categoría **y de sus subcategorías** y **las categorías sin productos visibles no se devuelven** (MSF-825). `imagen` es la ruta del bucket de la imagen principal de un producto visible de la categoría o de sus subcategorías, o `null` (MSF-841). |
| `publico.catalogo_pagina_por_dominio(host, categoria = null, solo_con_stock = false, precio_max = null, orden = 'relevancia', pagina = 1)` | `{ total, pagina, tamano: 24, categorias[], productos[] }` o `null`. Cada producto: `id`, `nombre`, `precio`, `disponible`, `imagen`, `categoria_id`, `destacado`. Filtrar por una categoría **incluye su subárbol** (MSF-825). |
| `publico.producto_por_dominio(host, producto)` | `{ id, nombre, descripcion, sku, categoria {id, nombre}, precio, disponible, compatibilidad, imagenes [{posicion, ruta}] }` o `null`. |
| `publico.imagen_publica(ruta)` | `true` si la ruta del bucket es una imagen de un producto efectivo de una tienda activa. |

### Catálogo: filtros, orden y normalización

- **Filtros:** `categoria` (productos de esa categoría **y de sus subcategorías**, MSF-825),
  `solo_con_stock` (por `private.disponible_publico`) y `precio_max` (sobre el precio final).
- **Orden:** `relevancia` (destacados primero, luego nombre e id), `precio_asc` y `precio_desc`
  (desempate por nombre e id; los productos sin precio van al final).
- **Normalización sin error:** orden desconocido → `relevancia`; página < 1 o nula → 1; `precio_max` ≤ 0
  o nulo → sin límite; categoría oculta o ajena → lista vacía (no error); página fuera de rango → lista
  vacía con el `total` real. La UI **no pide** una página fuera de rango: desde MSF-845 la lista es
  acumulativa y un `?pagina=N` viejo se ignora (ver
  [Carga infinita en los listados](#carga-infinita-en-los-listados-msf-845)).
- **Tamaño de página:** constante `24` dentro de la función (D3), que es también la tanda de la carga
  infinita. Para cambiarlo se toca un solo valor.

### Precio público

`private.precio_final_publico(producto, empresa)` compone las fórmulas únicas de Precios:
`private.a_pesos` → `private.aplicar_regla_precio` → `private.aplicar_iva`. Respeta el interruptor
`dominio.precios_empresa.mostrar_con_iva`: con IVA devuelve el `final` de `private.precio_para`; sin IVA,
el `neto`. La alícuota se resuelve **inline** (la propia del producto o, si no, la de su categoría) porque
`private.alicuota_producto` se acota a la sesión y bajo `anon` no devolvería nada; el pgTAP de paridad con
`private.precio_para` evita la deriva. Si el precio no es calculable (USD sin cotización), devuelve
`null`: la tarjeta y la ficha no muestran precio, el producto queda al final en los órdenes por precio y
no pasa el filtro de precio máximo (D9).

### Disponibilidad

`private.disponible_publico(producto)` devuelve **solo un booleano**: `true` si hay unidades disponibles, con el
mismo criterio que `private.productos_con_stock()`. Nunca se exponen cantidades, mínimos ni «últimas unidades». La
elección manual `a_pedido` / `stock_entrante` se ignora (D6). Con MSF-292, `private.productos_con_stock()` y
`private.disponibilidad_producto` pasan a evaluar el **disponible** (`cantidad − reservado > 0`; migración
`20261023130200_disponibilidad_con_reservas.sql`), así que el stock reservado deja de contarse como disponible (D4).

!!! warning "Pendiente"
    MSF-292 no toca `private.disponible_publico`: esa función conserva el criterio anterior hasta que se la alinee
    con `private.productos_con_stock()`. Dueño: Catálogo / Tiendas online.

### Imágenes (D1, supuesto)

El bucket `productos-imagenes` sigue **privado**. `anon` lee solo las imágenes que
`private.imagen_publica` acepta (producto activo, no oculto, categoría visible, tienda activa); la
política `productos_imagenes_select_anon` llama al envoltorio `publico.imagen_publica` porque `anon` no
tiene `USAGE` sobre `private`. Como un `<img>` no manda cabeceras, `apps/web/src/lib/imagenProducto.ts`
pide **URLs firmadas de una hora** con la clave pública, en una sola llamada por página; si una ruta no
se firma o la imagen no carga (`onError`), la tarjeta muestra «Sin imagen». Si D1 se resuelve con URL
pública o firmada por el servidor, cambia solo ese archivo y la política.
`publico.imagen_publica` es invocable directo por `anon`: permite confirmar si una ruta es imagen pública,
algo que esas rutas ya permiten leer; riesgo bajo aceptado.

## Front público

Rutas registradas por archivo en `apps/web/src/pages/tienda-publica/rutas/*.tsx` (contrato en
`rutas/LEEME.md`); `EnrutadorTienda.tsx` las carga con `import.meta.glob` y `lazy`, excluye
`*.test.tsx` y agrega `*` → `PaginaNoEncontrada`.

| Ruta | Pantalla | Archivos |
|---|---|---|
| `/` | Inicio de la tienda | `rutas/inicio.tsx` (MSF-147) |
| `/catalogo` | «Todos los productos» con filtros, orden y carga infinita | `rutas/catalogo.tsx`, `secciones-catalogo/ListadoProductos.tsx` |
| `/categoria/:categoriaId` | Listado de una categoría visible | `rutas/categoria.tsx` + el mismo listado |
| `/producto/:productoId` | Ficha con galería, precio, disponibilidad y compatibilidad (con MSF-212, botón «Consultar por WhatsApp») | `rutas/producto.tsx`, `ficha/*` |
| cualquier otra | La misma 404 amable | `PaginaNoEncontrada.tsx` |

- **Layout:** `layout/LayoutTienda.tsx` pone la marca, el menú de categorías y la columna «Categorías» del
  pie; comparte `{ tienda, host, categorias }` por el outlet (`useContextoTienda`). Desde MSF-841 el layout
  también monta la identidad, la barra superior y el pie oscuro del prototipo (ver
  [Diseño del prototipo](tienda-diseno-del-prototipo.md)).
- **Categorías:** `lib/tiendaCategorias.ts` y `hooks/useCategoriasTienda.ts` hacen una sola llamada por
  tienda; si falla, el menú queda en «Inicio» con «Reintentar».
- **Catálogo:** componentes `catalogo/PanelFiltros.tsx`, `catalogo/Ordenar.tsx`,
  `catalogo/TarjetaProducto.tsx` y `catalogo/EstadoVacio.tsx`; el pie es el componente compartido
  `components/pagina/CargaInfinita.tsx` (desde MSF-845, ver
  [Carga infinita en los listados](#carga-infinita-en-los-listados-msf-845)). `lib/tiendaListado.ts` es el
  cliente de la RPC y el parser/serializador de la URL; el hook es `hooks/useCatalogoPublico.ts`.
- **URL compartible:** `categoria`, `stock=1`, `max=<pesos>` y `orden=<relevancia|precio_asc|precio_desc>`;
  no lleva número de tanda ni de página. Abrir la URL restaura el estado; cambiar un filtro u orden
  reinicia la lista desde la primera tanda; los valores inválidos se ignoran y un `pagina=<n>` viejo se
  ignora. Filtrar no recarga la página.
- **Ficha:** `ficha/Galeria.tsx` (principal = menor posición, hasta 4 miniaturas, la elegida con
  `aria-pressed`, «Sin imagen» si no hay o si ninguna URL carga), `ficha/Ampliacion.tsx` (diálogo MUI con
  foco atrapado, cierre por botón y Esc, texto alternativo), `ficha/DatosProducto.tsx` (migas, nombre,
  categoría, precio, `EtiquetaDisponibilidad`, descripción, bloque «SKU» / «Categoría» /
  «Disponibilidad», nota y «Ver más productos» → `/catalogo`) y `ficha/Compatibilidad.tsx` (no se
  renderiza sin datos). Lectura: `lib/tiendaFicha.ts` y `hooks/useFichaProducto.ts`.
- **Estados:** carga, vacío y error del kit; el listado vacío dice «No encontramos productos» con la
  sugerencia y «Limpiar filtros». Las imágenes de la ficha usan `loading="lazy"`.
- **Accesibilidad:** teclado y lector de pantalla; el estado de disponibilidad se comunica con texto, no
  solo color; se verifica a 320 / 768 / 1440 px.

## Carga infinita en los listados (MSF-845)

La regla de listados (Principio VI) se aplicó al listado público a pedido de Nicolás: «en todas las
tiendas quiero lazy loading infinito». Merge `5af16204` (PR #897), commits `1120b9fe` (carga infinita) y
`bf907222` (accesibilidad, carreras y tests de reinicio).

- **Alcance:** `secciones-catalogo/ListadoProductos.tsx`, que montan `/catalogo`,
  `/categoria/:categoriaId` y los resultados (`/catalogo?q=`). Es el único listado público paginado; el
  menú, el inicio y los relacionados son acotados. Se eliminó `catalogo/Paginacion.tsx` y no queda
  `Pagination` en la tienda pública.
- **Datos:** sin cambios de esquema ni RPC. Se sigue llamando a `publico.catalogo_pagina_por_dominio` o
  `publico.busqueda_pagina_por_dominio` con `pagina` creciente (tanda de 24). La página ya no forma parte
  de `FiltrosCatalogo` ni de la URL (`lib/tiendaListado.ts`): `parsearFiltros` ignora `?pagina=` y
  `serializarFiltros` no lo escribe; `leerPaginaCatalogo`/`leerPaginaBusqueda` reciben la tanda aparte.
- **Hook:** `hooks/useCatalogoPublico.ts` guarda el acumulado por clave `(host, filtros, q, intento)`; la
  primera tanda se pide al cambiar la clave y `cargarMas` suma la siguiente de a una, deduplicando por
  `id`, firmando las imágenes de cada tanda y exponiendo `hayMas`, `cargandoMas`, `errorMas` y
  `esperaMas`. Una tanda vacía con `total` mayor corta la carga (`agotado`). Un contador de generación
  descarta respuestas tardías, incluso en el ciclo A→B→A.
- **Pie:** `components/pagina/CargaInfinita.tsx` (`IntersectionObserver` con margen de 400 px y «Cargar
  más» operable con teclado). El botón queda montado con `aria-busy`/`aria-disabled` mientras carga para
  no perder el foco; una región viva `aria-live` anuncia «Cargando más resultados», «N productos más
  cargados» y «No hay más resultados»; al terminar, el foco pasa al texto de fin. El error conserva lo
  cargado y «Reintentar» pide la misma tanda.
- **Reinicio:** cambiar búsqueda, filtro u orden descarta lo acumulado, vuelve a la primera tanda y lleva
  el scroll al inicio del listado (`scrollIntoView` de la sección «Productos»). `q`, filtros y orden siguen
  en la URL.
- **Límite de búsquedas:** si una tanda siguiente choca con el límite de pedidos, el hook corta antes de
  firmar imágenes y devuelve `esperaMas`; el pie muestra «Hiciste muchas búsquedas seguidas, esperá unos
  segundos y reintentá» y «Reintentar» queda deshabilitado hasta que pase la espera.
- **Enlaces viejos:** `?pagina=N` (incluidos `0`, negativos o `999`) se ignora, no redirige y arranca de
  la primera tanda. El parámetro permanece en la URL hasta el siguiente cambio de filtro. La canónica y el
  `noindex` no cambian.
- **Límites:** sin virtualización, pensado para catálogos de pocos cientos de productos por tienda
  (seguimiento si supera ~500); al volver desde la ficha no se conservan las tandas ya cargadas porque el
  estado vive en el hook, no en la URL ni en una caché.
- **Reversión:** `git revert -m 1` del merge de la épica; no hay migraciones que revertir.
- **Verificación:** Vitest `components/pagina/CargaInfinita.test.tsx`,
  `pages/tienda-publica/ListadoProductos.test.tsx`, `lib/tiendaListado.test.ts` y
  `lib/tiendaBusqueda.pagina.test.ts` (incluye axe a 320/768/1440 px y los estados de carga, error y fin).
  El E2E `apps/web/e2e/tienda-catalogo.e2e.ts` se migró de enlaces de paginación a «Cargar más», pero no
  se corrió en el cierre (requiere stack local); quedó validado con `tsc` y lint.

!!! warning "TODO · capturas del manual"
    **Dueño:** Documentación / Tiendas online. Faltan capturas nuevas del catálogo con «Cargar más», el
    estado de carga y el fin de lista para `docs/producto/img/tiendas-online/`. El comando `pnpm
    docs:capturas` **no existe en este repo**; lo más cercano es `pnpm --filter @platform/web
    pantallas:capturar` con `PANTALLAS_APP_URL` y un `storageState` de Playwright, sobre el seed de
    `pnpm dev:supabase`. No se pudo generar en el cierre (sin stack local) y no se inventó ninguna imagen.

## Cómo probarlo (MSF-845)

### Prerrequisitos

- **Rol:** visitante anónimo; no hace falta usuario ni sesión.
- **Datos:** una tienda del seed con **más de 24 productos visibles** en una categoría. El E2E siembra 26
  (`MASIVOS = 26`): 24 en la primera tanda y 2 en la segunda. Se levanta con `pnpm dev:supabase` (aplica
  `supabase/seed.sql`) y la web servida.
- **URL:** `http://mundojc.localhost:4300/catalogo` o `http://sanjavucho.localhost:4300/catalogo` (los
  subdominios de `localhost` resuelven a loopback en Chromium), o el entorno DEV.

### Pasos

1. Entrá a una categoría desde el menú de la tienda. **Ves** la primera tanda de tarjetas, el contador
   total («N productos») y **ningún** control de páginas numeradas.
2. Bajá hasta el final del listado o hacé clic en **Cargar más**. **Ves** que las tarjetas siguientes se
   suman a las anteriores y la URL **no** cambia.
3. Tabulá hasta **Cargar más** y presioná Enter. **Ves** que se pide otra tanda y el foco no se pierde;
   con un lector de pantalla se anuncia «Cargando más resultados» y «N productos más cargados».
4. Llegá al final. **Ves** «No hay más resultados.» y el botón desaparece.
5. Cambiá un filtro (por ejemplo **Solo con stock**), el orden o la búsqueda. **Ves** que la lista vuelve
   a la primera tanda, el scroll sube al inicio del listado y la URL conserva filtro, orden y `q`.
6. Abrí un enlace viejo con `?pagina=2`. **Ves** que se ignora: no redirige y arranca de la primera
   tanda; el total sigue siendo el del servidor.
7. Cortá la red o interceptá la RPC de la tanda siguiente. **Ves** «No pudimos cargar más resultados.»
   con **Reintentar**, sin perder las tarjetas ya cargadas.
8. Superá el límite de búsquedas (30 por minuto). **Ves** «Hiciste muchas búsquedas seguidas, esperá unos
   segundos y reintentá» y **Reintentar** deshabilitado hasta que pase la espera.

### Resultado esperado

- **Given** una categoría con más productos que una tanda, **When** la persona llega al final o usa
  «Cargar más», **Then** las tarjetas siguientes se suman a las ya mostradas, el total no cambia y la URL
  no incorpora un número de página.
- **Given** un listado cargado, **When** la persona busca, filtra u ordena, **Then** la lista vuelve a la
  primera tanda, el scroll sube al inicio y el criterio nuevo queda en la URL.
- **Given** una tanda que falla, **When** la persona la reintenta, **Then** se conserva lo cargado y se
  vuelve a pedir esa misma tanda.
- **Given** un enlace viejo `?pagina=N`, **When** se abre, **Then** no rompe ni redirige: arranca desde la
  primera tanda.

### Cómo automatizarlo

El E2E existente `apps/web/e2e/tienda-catalogo.e2e.ts` ya recorre el menú, los filtros, el orden, la
carga por «Cargar más»/scroll, el fin de lista y el `?pagina=N` ignorado. **No se corrió en el cierre**
(requiere el stack local) y su título todavía no lleva rótulo. Para atarlo a la cobertura:

| Recorrido | Rótulo propuesto |
|---|---|
| Primera tanda, scroll/«Cargar más», suma sin cambiar la URL y fin de lista | `[MSF-845:T001]` |
| Reinicio a la primera tanda al buscar, filtrar u ordenar, con scroll al inicio | `[MSF-845:T002]` |
| `?pagina=N` viejo ignorado y sin paginación numerada | `[MSF-845:T003]` |
| Error de una tanda con «Reintentar» sin perder lo cargado | `[MSF-845:T004]` |
| «Cargar más» con teclado y anuncios de la región viva | `[MSF-845:T005]` |
| Límite de búsquedas: aviso y «Reintentar» deshabilitado hasta la espera | `[MSF-845:T006]` |

La cobertura determinista de hoy es Vitest: `CargaInfinita.test.tsx`, `ListadoProductos.test.tsx`,
`tiendaListado.test.ts` y `tiendaBusqueda.pagina.test.ts`. Los recorridos T001–T006 quedan **pendientes de
automatizar en E2E** (dueño: Tiendas online).

## Aislamiento y seguridad

- `anon` ejecuta **solo** funciones de `publico`; no tiene privilegios sobre `public`, `dominio` ni
  `private`. Las tablas conservan su RLS por organización y las funciones `security definer` la saltean a
  propósito, filtrando por el host y `empresa.activa`.
- Todas las funciones devuelven la **misma respuesta** para dominio desconocido, producto/categoría
  inexistente, oculta o ajena: no se puede enumerar qué existe.
- Lista blanca de campos: nunca costos, existencias, proveedor, códigos internos ni `organizacion_id`.
- Los textos (nombre, descripción, compatibilidad) se renderizan como nodos de React; HTML o `<script>`
  se ven literales. No hay `dangerouslySetInnerHTML` en el front público.
- El navegador usa la clave pública; ninguna clave de servicio se expone. El E2E siembra desde Node y
  aborta si `SUPABASE_URL` no es local.
- La política de storage acota la lectura anónima a imágenes de productos efectivamente visibles de
  tiendas activas; no abre el bucket.

## Operación

- **PostgREST:** para que la tienda pública funcione, el esquema `publico` debe estar expuesto
  (`PGRST_DB_SCHEMAS` / `SUPABASE_API_SCHEMAS` incluye `publico` y `dominio`), como quedó configurado en
  MSF-147. Si falta, las rutas devuelven 404 al resolver el dominio.
- **Hosts:** el front decide por `Host`; `VITE_PANEL_HOSTS` debe listar **todos** los hosts del panel de
  cada entorno. Cualquier host que no figure se sirve como tienda (o «Volvemos pronto»). Es la misma
  operación de MSF-147.
- **Migraciones:** aplicar en orden (`150000`, `150100`, `150200`, `150300`). Son aditivas y su reversión
  está en el encabezado de cada archivo; no se destruyen tablas ni datos.
- **Sin caché:** cada carga hace una llamada por RPC; si el tráfico lo exige, se cachea en el borde o con
  una vista materializada (no implementado).

## Verificación

| Qué | Archivos |
|---|---|
| pgTAP de categorías (aislamiento, conteos, `null`, columnas; con MSF-825, conteo con subcategorías, categorías sin productos y total del listado igual al de la tarjeta) | `supabase/tests/database/tienda_categorias_publicas.test.sql` |
| pgTAP de disponibilidad (paridad con `productos_con_stock`, sin cantidades) | `supabase/tests/database/tienda_disponibilidad_publica.test.sql` |
| pgTAP de catálogo (filtros, órdenes, paginación, normalización, paridad de precio, imágenes, columnas) | `supabase/tests/database/tienda_catalogo_publico.test.sql` |
| pgTAP de ficha (campos, `null` en los cinco casos, compatibilidad opcional) | `supabase/tests/database/tienda_ficha_publica.test.sql` |
| Vitest + axe de layout, 404, listado, ficha, carga infinita y etiqueta | `apps/web/src/pages/tienda-publica/EnrutadorTienda.test.tsx`, `ListadoProductos.test.tsx`, `RutaCatalogo.test.tsx`, `FichaProducto.test.tsx`, `disponibilidad/EtiquetaDisponibilidad.test.tsx`, `lib/tiendaListado.test.ts`, `lib/tiendaBusqueda.pagina.test.ts` y `components/pagina/CargaInfinita.test.tsx` |
| E2E con las dos tiendas del seed (la carga infinita se migró de enlaces de paginación a «Cargar más»; no se corrió en el cierre) | `apps/web/e2e/tienda-categorias.e2e.ts`, `tienda-catalogo.e2e.ts`, `tienda-ficha.e2e.ts`, `tienda-disponibilidad.e2e.ts` |

```bash
pnpm dev:supabase
pnpm --filter @platform/web test:e2e tienda-categorias
pnpm --filter @platform/web test:e2e tienda-catalogo
pnpm --filter @platform/web test:e2e tienda-ficha
pnpm --filter @platform/web test:e2e tienda-disponibilidad
```

## Decisiones y supuestos

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** imágenes | Bucket privado + política de `anon` acotada + URLs firmadas de una hora | `lib/imagenProducto.ts` y una migración |
| **D2** producto en ambas tiendas | Destacados por tienda (MSF-147) y precio por empresa (MSF-114); la épica no agrega nada nuevo | Confirmación del cliente; sin cambio de código de esta épica |
| **D3** tamaño de página | 24, constante de la función; es la tanda de la carga infinita (MSF-845) | Un solo valor |
| **D4** stock reservado | Hoy «Disponible» = `existencias.cantidad > 0` | Solo `private.disponible_publico` |
| **D6** disponibilidad manual | Se ignora `a_pedido` / `stock_entrante` | `private.disponible_publico` |
| **D7** SKU público | Se muestra el SKU del producto; en blanco no aparece | Una fila de `ficha/DatosProducto.tsx` |
| **D9** sin precio calculable | Precio `null`: sin precio, al final de los órdenes por precio y fuera del filtro de máximo | Ajustar `precio_final_publico` |
| **D10** categorías sin slug | Rutas por id (`/categoria/:categoriaId`) | Requiere una columna en Catálogo |
| **D11** subcategorías | Un producto se lista en su categoría directa; **MSF-825** agregó el subárbol al filtro por categoría y al conteo de la tarjeta | Cambiar la consulta |

## Límites y deuda

- **Rendimiento móvil no medido.** El entorno de cierre no tenía Docker, así que no hubo stack local con
  el seed ni cifras. Queda trazado en **MSF-552** (seguimiento). Protocolo: build y preview con las dos
  tiendas del seed, Lighthouse móvil sobre `/catalogo` y `/producto/:id`, y medición de
  `publico.catalogo_pagina_por_dominio` con un catálogo de cientos de productos.
- **Techo de diseño (resuelto por MSF-825):** la RPC calculaba precio y disponibilidad para todo el
  catálogo efectivo antes de filtrar y paginar. Con el volumen real de la demo (2.204 productos por
  tienda) eso daba 44 s y un *timeout* bajo `anon`: la función ahora calcula el precio solo para la
  página salvo que el orden o el tope de precio lo necesiten. Ver
  [MSF-825](tienda-demo-vs-prototipo.md#causa-raiz).
- **URLs firmadas de una hora:** una pestaña abierta más de una hora ve «Sin imagen» hasta recargar.
- **Carga infinita sin virtualización (MSF-845):** se acumulan las tarjetas en el DOM; el diseño asume
  pocos cientos de productos por tienda (si un catálogo supera ~500, evaluar virtualizar o conservar el
  acumulado). Al volver desde la ficha se arranca de la primera tanda: el estado vive en el hook, no en la
  URL ni en una caché.
- **Sin caché** de las respuestas públicas.
- **Fuera de alcance:** buscador e inicio (MSF-191, documentados en
  [Tienda pública: inicio, búsqueda y móvil](tienda-inicio-busqueda-movil.md)), compra y cuentas
  (MSF-176/237), «Productos relacionados», «Últimas unidades · quedan N», slugs
  de categoría y agregación de subcategorías (**entregada por MSF-825**: el filtro por categoría ya
  incluye sus hijas).
- **WhatsApp y contacto (MSF-212)** ya están entregados: el botón «Consultar por WhatsApp» de la ficha
  y la página `/contacto` están documentados en
  [Tienda pública: WhatsApp y contacto](tienda-whatsapp-y-contacto.md).

## Diferencias con el prototipo

- El prototipo no dibuja paginación ni carga infinita; desde MSF-845 el pie usa el componente compartido
  del panel («Cargar más», carga, error con «Reintentar» y fin de lista).
- «Últimas unidades · quedan N» queda fuera porque expone el stock exacto.
- «Consultar por WhatsApp» lo entrega **MSF-212** (con su diálogo y el mensaje armado): ver
  [Tienda pública: WhatsApp y contacto](tienda-whatsapp-y-contacto.md).
- «Productos relacionados» queda fuera de esta épica.
- El buscador del encabezado es de MSF-191: ver
  [Tienda pública: inicio, búsqueda y móvil](tienda-inicio-busqueda-movil.md).
- Los estados vacíos y la 404 se dibujan con los componentes del kit, no copiando el HTML del prototipo.
