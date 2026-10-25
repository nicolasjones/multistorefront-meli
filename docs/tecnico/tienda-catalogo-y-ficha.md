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
| `publico.categorias_por_dominio(host)` | `{ categorias: [{ id, nombre, padre_id, productos }] }` o `null`. Categorías visibles en el orden de Catálogo (raíces primero, luego posición); `productos` cuenta solo efectivos de esa categoría directa. |
| `publico.catalogo_pagina_por_dominio(host, categoria = null, solo_con_stock = false, precio_max = null, orden = 'relevancia', pagina = 1)` | `{ total, pagina, tamano: 24, categorias[], productos[] }` o `null`. Cada producto: `id`, `nombre`, `precio`, `disponible`, `imagen`, `categoria_id`, `destacado`. |
| `publico.producto_por_dominio(host, producto)` | `{ id, nombre, descripcion, sku, categoria {id, nombre}, precio, disponible, compatibilidad, imagenes [{posicion, ruta}] }` o `null`. |
| `publico.imagen_publica(ruta)` | `true` si la ruta del bucket es una imagen de un producto efectivo de una tienda activa. |

### Catálogo: filtros, orden y normalización

- **Filtros:** `categoria` (solo productos de esa categoría), `solo_con_stock` (por
  `private.disponible_publico`) y `precio_max` (sobre el precio final).
- **Orden:** `relevancia` (destacados primero, luego nombre e id), `precio_asc` y `precio_desc`
  (desempate por nombre e id; los productos sin precio van al final).
- **Normalización sin error:** orden desconocido → `relevancia`; página < 1 o nula → 1; `precio_max` ≤ 0
  o nulo → sin límite; categoría oculta o ajena → lista vacía (no error); página fuera de rango → lista
  vacía con el `total` real. La UI, con `?pagina=` mayor a la última, redirige con `replace` a la última
  página (`secciones-catalogo/ListadoProductos.tsx`).
- **Tamaño de página:** constante `24` dentro de la función (D3). Para cambiarlo se toca un solo valor.

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

`private.disponible_publico(producto)` devuelve **solo un booleano**: `true` si
`dominio.existencias.cantidad > 0`, el mismo criterio que `private.productos_con_stock()`. Nunca se
exponen cantidades, mínimos ni «últimas unidades». La elección manual `a_pedido` / `stock_entrante` se
ignora (D6). Cuando Stock cierre depósitos y reservas (MSF-292) se cambia **solo** esa función (D4).

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
| `/catalogo` | «Todos los productos» con filtros, orden y paginación | `rutas/catalogo.tsx`, `secciones-catalogo/ListadoProductos.tsx` |
| `/categoria/:categoriaId` | Listado de una categoría visible | `rutas/categoria.tsx` + el mismo listado |
| `/producto/:productoId` | Ficha con galería, precio, disponibilidad y compatibilidad | `rutas/producto.tsx`, `ficha/*` |
| cualquier otra | La misma 404 amable | `PaginaNoEncontrada.tsx` |

- **Layout:** `layout/LayoutTienda.tsx` pone la marca, el menú de categorías y la columna «Categorías» del
  pie; comparte `{ tienda, host, categorias }` por el outlet (`useContextoTienda`).
- **Categorías:** `lib/tiendaCategorias.ts` y `hooks/useCategoriasTienda.ts` hacen una sola llamada por
  tienda; si falla, el menú queda en «Inicio» con «Reintentar».
- **Catálogo:** componentes `catalogo/PanelFiltros.tsx`, `catalogo/Ordenar.tsx`,
  `catalogo/TarjetaProducto.tsx`, `catalogo/Paginacion.tsx` y `catalogo/EstadoVacio.tsx`;
  `lib/tiendaListado.ts` es el cliente de la RPC y el parser/serializador de la URL; el hook es
  `hooks/useCatalogoPublico.ts`.
- **URL compartible:** `categoria`, `stock=1`, `max=<pesos>`, `orden=<relevancia|precio_asc|precio_desc>`
  y `pagina=<n>`. Abrir la URL restaura el estado; cambiar un filtro u orden vuelve a la página 1; los
  valores inválidos se ignoran. Filtrar no recarga la página.
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
| pgTAP de categorías (aislamiento, conteos, `null`, columnas) | `supabase/tests/database/tienda_categorias_publicas.test.sql` |
| pgTAP de disponibilidad (paridad con `productos_con_stock`, sin cantidades) | `supabase/tests/database/tienda_disponibilidad_publica.test.sql` |
| pgTAP de catálogo (filtros, órdenes, paginación, normalización, paridad de precio, imágenes, columnas) | `supabase/tests/database/tienda_catalogo_publico.test.sql` |
| pgTAP de ficha (campos, `null` en los cinco casos, compatibilidad opcional) | `supabase/tests/database/tienda_ficha_publica.test.sql` |
| Vitest + axe de layout, 404, listado, ficha y etiqueta | `apps/web/src/pages/tienda-publica/EnrutadorTienda.test.tsx`, `ListadoProductos.test.tsx`, `RutaCatalogo.test.tsx`, `FichaProducto.test.tsx`, `disponibilidad/EtiquetaDisponibilidad.test.tsx` y `lib/tiendaListado.test.ts` |
| E2E con las dos tiendas del seed | `apps/web/e2e/tienda-categorias.e2e.ts`, `tienda-catalogo.e2e.ts`, `tienda-ficha.e2e.ts`, `tienda-disponibilidad.e2e.ts` |

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
| **D3** tamaño de página | 24, constante de la función | Un solo valor |
| **D4** stock reservado | Hoy «Disponible» = `existencias.cantidad > 0` | Solo `private.disponible_publico` |
| **D6** disponibilidad manual | Se ignora `a_pedido` / `stock_entrante` | `private.disponible_publico` |
| **D7** SKU público | Se muestra el SKU del producto; en blanco no aparece | Una fila de `ficha/DatosProducto.tsx` |
| **D9** sin precio calculable | Precio `null`: sin precio, al final de los órdenes por precio y fuera del filtro de máximo | Ajustar `precio_final_publico` |
| **D10** categorías sin slug | Rutas por id (`/categoria/:categoriaId`) | Requiere una columna en Catálogo |
| **D11** subcategorías | Un producto se lista en su categoría directa; sin agregar hijas | Cambiar la consulta |

## Límites y deuda

- **Rendimiento móvil no medido.** El entorno de cierre no tenía Docker, así que no hubo stack local con
  el seed ni cifras. Queda trazado en **MSF-552** (seguimiento). Protocolo: build y preview con las dos
  tiendas del seed, Lighthouse móvil sobre `/catalogo` y `/producto/:id`, y medición de
  `publico.catalogo_pagina_por_dominio` con un catálogo de cientos de productos.
- **Techo de diseño:** la RPC calcula precio y disponibilidad para todo el catálogo efectivo antes de
  filtrar y paginar. Se asume hasta unos pocos cientos de productos visibles por tienda (cifra de diseño,
  no medida); por encima conviene calcular el precio solo al filtrar u ordenar por precio y medir.
- **URLs firmadas de una hora:** una pestaña abierta más de una hora ve «Sin imagen» hasta recargar.
- **Sin caché** de las respuestas públicas.
- **Fuera de alcance:** buscador e inicio (MSF-191), WhatsApp y contacto (MSF-212), compra y cuentas
  (MSF-176/237), «Productos relacionados», «Últimas unidades · quedan N», slugs de categoría y agregación
  de subcategorías.

## Diferencias con el prototipo

- La paginación no está dibujada en el prototipo; se usa el control del kit.
- «Últimas unidades · quedan N» queda fuera porque expone el stock exacto.
- «Consultar por WhatsApp» y «Productos relacionados» de la ficha quedan fuera de esta épica.
- El buscador del encabezado es de MSF-191.
- Los estados vacíos y la 404 se dibujan con los componentes del kit, no copiando el HTML del prototipo.
