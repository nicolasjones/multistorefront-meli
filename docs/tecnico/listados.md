---
owner: tecnico
sources:
  - apps/web/src
---

# Listados: carga infinita e imagen de producto (MSF-789)

**Épica:** MSF-789 — Listados con carga infinita (lazy loading) e imagen de producto en todas las pantallas.
**Historias:** piezas compartidas · Ventas · Stock · Clientes y contactos · Resto (proveedores, consultas, historial,
service técnico y precios).
**Alcance de entrega:** `refine` (`apps/web`). **Sin** migraciones propias, sin Kestra, sin Superset y sin workers.
**Sin spec de Spec Kit:** el trabajo se hizo directamente desde Claude Code y la épica queda en Backlog a propósito
para que ningún poller la tome.
**Guía de producto (manual de usuario):** [Cómo se muestran las listas](../producto/listados.md).

> **Estado (verificado en git el 2026-11-04).** El código está mergeado en `origin/dokploy`: `19636f0c`
> (PR #697, «merge: carga infinita e imagen de producto en todas las pantallas»), más los merges por historia
> `84d52c30` (Ventas), `f02fa2ef` (Stock), `877f33ac` (Clientes), `6c8c8cb3` (Resto) y `eb975d94` (Actividad). La
> regla quedó escrita en la constitución 1.10.0 y en `CLAUDE.md`/`AGENTS.md` (commit `d059ecf0`).
> **El código todavía no está en `main`**: esta página describe el árbol de `dokploy`, verificado commit por commit.
> Las piezas que entran con esos merges son `components/pagina/CargaInfinita.tsx`,
> `hooks/useListadoAcumulado.ts`, `hooks/useImagenesProductos.ts` e `lib/imagenesPrincipales.ts`;
> `components/base/MiniaturaProducto.tsx` ya existía (es la miniatura de la pantalla Productos) y la épica le
> agrega la vista ampliada.

## La regla (Principio VI, constitución 1.10.0)

Texto de la constitución (`d059ecf0`, «Listados e imágenes»):

- Todo listado del panel **carga por tandas desde el servidor** a medida que la persona llega al final
  (`IntersectionObserver`), **sumando cada tanda a lo ya mostrado**. Las pantallas nuevas **no usan paginación
  numerada** (`TablePagination`); las existentes se migran de forma gradual.
- **Buscar, filtrar u ordenar reinicia la lista**; el **total sigue visible**.
- Tiene que existir un **«Cargar más» operable con teclado** y los estados de carga, error con reintento y fin de
  lista usan los patrones compartidos.
- Una excepción (totales por página, una exportación que depende de la página) **se justifica en la spec y el
  plan**. En esta épica **ninguna pantalla pidió excepción**: la lista se migró completa, sin dejar paginación
  numerada en ningún lado.
- Las **miniaturas de imagen en listados conservan su tamaño chico** y ofrecen una **vista ampliada al pasar el
  mouse** mediante el componente compartido `MiniaturaProducto`; no se admiten miniaturas ni zooms propios por
  pantalla.

Verificado sobre `origin/dokploy`: en `apps/web/src` **no queda ningún `TablePagination`**
(`git grep TablePagination origin/dokploy -- apps/web/src` no devuelve coincidencias). La paginación queda sólo en
la capa de datos: las RPC y las vistas siguen paginando en el servidor.

## Piezas compartidas

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| Pie del listado | `apps/web/src/components/pagina/CargaInfinita.tsx` | Centinela con `IntersectionObserver` (margen de anticipo `400px`), botón «Cargar más», indicador de carga (`role="status"`, «Cargando más resultados»), error con «Reintentar» y fin de lista («No hay más resultados.») |
| Acumulación sobre hook paginado | `apps/web/src/hooks/useListadoAcumulado.ts` → `useListadoAcumulado` | **Suma** las páginas que ya entrega el hook de datos de la pantalla: no se reescribe la capa de datos (RPC, vista, react-query…) |
| Acumulación en memoria | `apps/web/src/hooks/useListadoAcumulado.ts` → `useListadoLocal` | Para listados que ya tienen **todas** las filas en el navegador (paginación del lado del cliente). **Hoy no lo usa ninguna pantalla** (ver *Fuera de alcance*) |
| Imágenes de producto | `apps/web/src/hooks/useImagenesProductos.ts` | `Map<productoId, urlFirmada>` con la imagen principal de los productos **visibles**; pide sólo los que faltan o los que están por vencer |
| Consulta de imágenes | `apps/web/src/lib/imagenesPrincipales.ts` | Lee `dominio.producto_imagenes`, ordena por `posicion` y firma la primera imagen de cada producto |
| Miniatura con zoom | `apps/web/src/components/base/MiniaturaProducto.tsx` | Miniatura 40×40 (`tokens.forma.ladoMiniatura`), radio 8 (`tokens.forma.radioMiniatura`), borde `tokens.color.fondoAlterno`; popper flotante de 280×280 al pasar el mouse |

### Cómo funciona `useListadoAcumulado`

Se apoya **encima** del hook de datos que la pantalla ya tenía (el que pide «la página N»): cada página que llega se
suma a las anteriores. No hay que reescribir RPC, vistas ni react-query.

```tsx
const listado = useListadoAcumulado({
  items: filas,        // las filas de la página actual, tal como las entrega el hook de datos
  pagina, setPagina,   // la página que se está pidiendo
  total,               // total de filas del servidor (para saber si hay más)
  cargando,            // true mientras llega la página `pagina`
  reinicio: filtros,   // cambia → descarta lo acumulado y vuelve a la tanda 1
})
```

- **Las páginas ya completas se guardan en una referencia**, en el momento de pedir la siguiente (`cargarMas`), no
  en un efecto: no hay estado que se actualice en cada render, así que no entra en bucle aunque `items` sea un
  arreglo nuevo en cada render.
- **`reinicio`** es la clave de todo lo que cambia el resultado (búsqueda, filtros, orden, empresa). Cuando cambia,
  se descarta lo acumulado y `setPagina(1)`.
- `items` debe ser **el arreglo que entrega el hook de datos** (referencia estable entre renders); no se arma uno
  nuevo en cada render.
- `hayMas` es `filas.length < total` (y falso si la última tanda vino vacía); `cargandoMas` es `cargando && pagina > 1`.
- Si la tanda siguiente falla, la pantalla **conserva lo ya cargado** y muestra el error al pie con «Reintentar»:
  `hayError` + `onCargarMas` reintentan **esa misma tanda**, no la siguiente.

La variante `useListadoLocal(items, tamano = 25, reinicio)` es para el caso contrario: el listado ya tiene todas
las filas en memoria y las va mostrando de a `tamano`.

## Cómo migrar una pantalla a carga infinita

1. Quitar `TablePagination` y su `labelDisplayedRows`; el contador total («N resultados») se conserva.
2. Pasar a la pantalla lo que ya tenía (`pagina`, `setPagina`, `total`, las filas de la página y si está cargando)
   por `useListadoAcumulado` y mostrar `listado.filas` en lugar de las filas de la página:

   ```tsx
   const listado = useListadoAcumulado({ items: datos.filas, pagina, setPagina, total: datos.total, cargando, reinicio: filtros })
   // …
   <ContenidoAdaptable items={listado.filas} … />
   <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={falloTanda} onCargarMas={listado.cargarMas} />
   ```
3. `reinicio` es todo lo que cambia el resultado (búsqueda, filtros, orden, empresa): cambia → vuelve a la tanda 1.
4. `items` debe ser el arreglo que entrega el hook de datos (referencia estable entre renders); no se arma uno nuevo en
   cada render.
5. Si la tanda siguiente falla, el error se muestra al pie con «Reintentar» (`hayError`) y no tira abajo lo ya cargado.
6. Acciones que cambian las filas (activar/desactivar, borrar, importar) recargan **desde la primera tanda**.
7. La exportación y los totales siguen usando los filtros, no la página visible.

Para agregar la **imagen principal** en una columna que ya muestra un producto:

```tsx
const imagenes = useImagenesProductos(listado.filas.map((fila) => fila.producto_id))
// …en la celda, junto al nombre:
<MiniaturaProducto alt="" src={imagenes.get(fila.producto_id)} />
```

Sin imagen se dibuja el marcador vacío del mismo tamaño y, si falla la carga de imágenes, el listado se muestra igual.
No se agranda la miniatura para no romper el ancho de la fila.

!!! note "TODO · la guía corta de `docs/listados.md`"
    **Dueño:** quien integre la rama `dokploy` en `main`. Durante la épica se escribió una guía breve en
    `docs/listados.md` (rama `dokploy`, PR #697) con la misma receta de migración. Cuando esa rama entre, ese archivo
    queda como un segundo texto sobre lo mismo: hay que **reducirlo a un puntero** a esta página (o eliminarlo) para
    no dejar dos guías sobre la misma regla.

## Pantallas migradas

«Tanda» = cuántas filas pide cada vez al servidor. «Reinicia» = qué devuelve el listado a la primera tanda.

| Pantalla | Ruta | Archivo | Tanda | Reinicia cuando cambia | Miniatura |
|---|---|---|---|---|---|
| Productos | `/productos` | `pages/productos/list.tsx` | 25 | texto, estado, tienda, categoría, orden | ya la tenía |
| Stock actual | `/stock` | `pages/stock/list.tsx` | 25 | búsqueda, estado, depósito | sí |
| Movimientos | `/stock/movimientos` | `pages/stock/movimientos.tsx` | 25 | producto | sí |
| Faltantes de stock | `/stock/faltantes` | `pages/stock/faltantes.tsx` | 25 | empresa u organización | sí |
| Más vendidos | `/stock/mas-vendidos` | `pages/stock/mas-vendidos.tsx` | 25 | tienda, período | sí |
| Toma de inventario | `/stock/toma-inventario` | `pages/stock/toma-inventario.tsx` | no pagina (trae todo) | — | sí |
| Historial de ingresos | `/stock/ingresos` | `components/stock/HistorialIngresos.tsx` | 25 | fechas, proveedor, empresa, producto, operador | sí |
| Archivo de ingresos | (en `/stock/ingresos`) | `components/stock/ArchivoIngresos.tsx` | 25 | — | no: el archivo guarda el producto como texto |
| Comprobantes | `/ventas/comprobantes` | `pages/ventas/comprobantes.tsx` | 12 | filtros | no |
| Presupuestos | `/ventas/presupuestos` | `pages/ventas/presupuestos.tsx` | 25 | texto, estado, empresa | no |
| Devoluciones (RMA) | `/ventas/devoluciones` | `pages/ventas/devoluciones.tsx` | 8 | empresa, forma de RMA | sí (ver *Datos*) |
| Faltantes de ventas | `/ventas/faltantes` | `pages/ventas/faltantes.tsx` | 10 | empresa | sí (ver *Datos*) |
| Despacho | `/ventas/despacho` | `pages/ventas/despacho.tsx` | 10 | búsqueda, estado, empresa | no |
| Pagos | `/ventas/pagos` | `pages/ventas/pagos/list.tsx` | 9 | empresa, cuenta de cobro, «solo con saldo» | no |
| Cuentas de cobro | `/ventas/cuentas-cobro` | `pages/ventas/cuentas-cobro/list.tsx` | 10 | empresa, estado | no |
| Transportes (Terminales) | `/ventas/transportes` | `pages/ventas/transportes/list.tsx` | 25 | organización, empresa activa, empresa de la tabla | no |
| Contrarreembolsos | (en `/ventas/transportes`) | `components/ventas/ContrarreembolsosTabla.tsx` | 10 | organización, empresa activa, empresa de la tabla | no |
| Clientes | `/clientes` | `pages/clientes/list.tsx` | 25 | texto, tipo, archivados, empresa, cuenta web | no |
| Clientes inactivos | `/clientes` (solapa) | `components/clientes/ClientesInactivos.tsx` | 25 | días, tipo, consumidor final, empresa | no |
| Ranking por facturación | `/clientes` (solapa) | `components/clientes/RankingClientes.tsx` | 25 | período, tipo, IVA, empresa, producto, categoría, provincia | no |
| Ranking por dimensión | `/clientes` (solapa) | `components/clientes/RankingClientes.tsx` | 25 | ídem | no |
| Ranking comparado | `/clientes` (solapa) | `components/clientes/RankingComparado.tsx` | 25 | período, comparación, tipo, IVA, empresa | no |
| Compras del cliente | `/clientes/show/:id` | `components/clientes/ComprasCliente.tsx` | 10 | cliente | no |
| Reparaciones del cliente | `/clientes/show/:id` | `components/clientes/ReparacionesDeCliente.tsx` | 25 | cliente, tipo de reparación | no |
| Correo masivo · destinatarios | `/clientes/correo-masivo` | `pages/clientes/correo-masivo/nueva.tsx` | 25 | texto, tipo, empresa, cuenta web, marcados | no |
| Correo masivo · historial | `/clientes/correo-masivo/historial` | `pages/clientes/correo-masivo/historial.tsx` | 25 | empresa | no |
| Correo masivo · detalle | `/clientes/correo-masivo/historial/:id` | `pages/clientes/correo-masivo/detalle.tsx` | 50 | campaña | no |
| Contactos | `/contactos` | `pages/contactos/list.tsx` | 25 | empresa, texto | no |
| Consultas | `/consultas` | `pages/consultas/list.tsx` | 25 | empresa, estado, texto, fechas, revisión | sí |
| Interés por WhatsApp (diálogo) | en `/consultas` | `pages/consultas/InteresWhatsappDialog.tsx` | no pagina (trae todo) | — | sí |
| Proveedores | `/proveedores` | `pages/proveedores/list.tsx` | 25 | texto, estado, empresa | no |
| Productos del proveedor | `/proveedores/show/:id` | `components/proveedores/ProductosDelProveedor.tsx` | 10 | proveedor | sí |
| Historial (ventas, cobros) | `/historial` | `pages/historial/list.tsx` | 25 | pestaña, empresa, texto | no |
| Historial de cotizaciones | `/historial` (solapa) | `pages/historial/CotizacionesTab.tsx` | 25 | texto | no |
| Reparaciones (service) | `/service-tecnico/reparaciones` | `pages/service-tecnico/reparaciones.tsx` | 25 | período, serie, técnico, empresa | no |
| Ítems de la reparación (repuestos) | en la ficha de la reparación | `components/service/ItemsReparacion.tsx` | no pagina (trae todo) | — | sí (sólo repuestos con producto del catálogo) |
| «Así quedan los precios» | en Precios | `components/precios/TablaAsiQuedan.tsx` | no pagina (trae todo) | — | sí |
| Líneas del comprobante | `/ventas/comprobantes/:id` | `components/ventas/LineasComprobante.tsx` | no pagina (trae todo) | — | sí |
| Actividad | `/actividad` | `pages/actividad/list.tsx` | 10 | período, empresa, actor, tipo, texto | no |
| Catálogo de la tienda pública (MSF-845) | `/catalogo`, `/categoria/:id` y `/catalogo?q=` | `pages/tienda-publica/secciones-catalogo/ListadoProductos.tsx` + `hooks/useCatalogoPublico.ts` | 24 | host, filtros, orden, `q` | no aplica |

Los tamaños de tanda salen de cada capa de datos: `TAMANO_PAGINA_PRODUCTOS` (`lib/productosListado.ts`),
`TAMANO_PAGINA_MOVIMIENTOS` (`hooks/useMovimientos.ts`), `TAMANO_PAGINA_FALTANTES` (`lib/faltantes.ts`),
`TAMANO_PAGINA_MAS_VENDIDOS` (`lib/masVendidos.ts`), `TAMANO_PAGINA_INGRESOS` (`hooks/useIngresos.ts`),
`TAMANO_PAGINA_ARCHIVO_INGRESOS` (`hooks/useArchivoIngresos.ts`), `TAMANO_PAGINA_COMPROBANTES`
(`hooks/useComprobantes.ts`), `TAMANO_PAGINA_RMA` (`lib/rma.ts`), `TAMANO_PAGINA_HISTORIAL`
(`hooks/useHistorialVentasCobros.ts`), `TAMANO_PAGINA_REPARACIONES` (`lib/reparacionesListado.ts`),
`TAMANO_PAGINA_REPARACIONES_CLIENTE` (`lib/reparacionesDeCliente.ts`), `TAMANO_PAGINA_CONSULTAS`
(`lib/consultas.ts`), `TAMANO_PAGINA_CONTACTOS` (`lib/contactos.ts`), `TAMANO_PAGINA_ACTIVIDAD`
(`lib/actividad.ts`) y constantes locales (`TAMANO_TANDA`, `TAMANO_PAGINA`) en cada pantalla.

La **tienda pública** (MSF-845, merge `5af16204`, PR #897) no usa `useListadoAcumulado`: tiene su propio
`useCatalogoPublico` porque cada tanda sale de una RPC pública distinta (`catalogo_pagina_por_dominio` o
`busqueda_pagina_por_dominio`) y firma las imágenes de esa tanda. Reutiliza el mismo pie
`CargaInfinita`, reinicia al cambiar host, filtros, orden o `q`, y no escribe la tanda en la URL. Detalle
técnico y guía de prueba en
[Catálogo y ficha · Carga infinita](tienda-catalogo-y-ficha.md#carga-infinita-en-los-listados-msf-845).

## Datos

**Sin cambios de esquema en la épica.** El rango de la épica (`f91cb9e4..19636f0c`) no toca `supabase/migrations`:
no se crea ni se altera ninguna tabla, columna, vista ni RPC. El [DER y `datos.md`](datos.md) **no cambian**.

- **Imagen principal:** se lee `dominio.producto_imagenes` (`producto_id`, `posicion`, `ruta`) y se firma la primera
  imagen de cada producto en el bucket privado `productos-imagenes`
  (`apps/web/src/lib/productoImagenes.ts`: `SEGUNDOS_URL_FIRMADA = 300`, o sea 5 minutos; la vida útil de la URL en
  el hook es `SEGUNDOS_URL_FIRMADA - 30`).
- **Sin miniatura propia:** si el producto no tiene imagen, la celda dibuja el marcador vacío del mismo tamaño; si
  falla la firma, **el listado se muestra igual** (`useImagenesProductos` captura el error y lo registra por
  consola).
- **Pedido de imágenes por tanda:** `useImagenesProductos` arma la clave con los ids **de las filas ya cargadas**, así
  que cada tanda pide sólo sus imágenes y no las anteriores.
- **Sin columna nueva:** la miniatura va **dentro de la columna de producto que ya existía**. No se agregó ninguna
  columna a ninguna tabla.

### `producto_id` en Faltantes de ventas y Devoluciones (RMA)

Las dos pantallas muestran la miniatura en la columna **Producto**, pero sus RPC no devolvían `producto_id`:

- `public.listar_faltantes` (definida en `20270112130300_faltantes_listar.sql`) devuelve `producto` y `sku` del
  producto, pero **no** `producto_id`.
- `public.listar_rma` / `private.listar_rma_sesion` (definidas en `20270113100200_listar_rma.sql` y
  `20270113120300_listar_rma_vinculo.sql`) devuelven el nombre del primer ítem, pero **no** `producto_id`.

La migración que lo resuelve es **`supabase/migrations/20270204100000_ventas_listados_producto_id.sql`** (recrea
`public.listar_faltantes`, `private.listar_rma_sesion` y `public.listar_rma` con `producto_id`; `drop function` +
`create` con la misma firma, y la reversión documentada en el encabezado). **Esa migración está en la rama
`origin/feat/ventas-faltantes-rma-producto-id` (commit `d8345089`, PR #694 abierto contra `dokploy`) y NO está mergeada en `dokploy` ni en `main`**:
hasta que se integre, esas dos pantallas muestran el nombre del producto **sin** miniatura, porque el código ya
pide `producto_id` y la base todavía no lo devuelve.

!!! warning "TODO · migración de `producto_id`"
    **Dueño:** quien cierre el PR de `origin/feat/ventas-faltantes-rma-producto-id`. Mergear la migración y
    verificar la miniatura en «Ventas · Faltantes» y «Ventas · Devoluciones». El encabezado de la migración ya
    documenta el camino de reversión (recrear las funciones con las definiciones de `20270112130300_faltantes_listar.sql`
    y `20270113120300_listar_rma_vinculo.sql`).

## API

**Sin RPC ni endpoints nuevos.** Cada pantalla sigue llamando a su consulta de siempre, con `p_pagina`/`p_tamano` (las
que usan RPC) o con `range` de PostgREST (las que usan vistas): la capa de datos no se reescribió. Lo que cambia es
que `useListadoAcumulado` **suma** las páginas en lugar de reemplazar la anterior.

- **Totales y exportaciones:** siguen usando los filtros, no la tanda visible. Exportar sigue trayendo todas las
  filas del filtro.
- **Acciones que cambian filas** (activar/desactivar, borrar, importar, conciliar, marcar un contrarreembolso como
  cobrado, avisar faltantes, aceptar un presupuesto) **recargan desde la primera tanda**.
- **Error de una tanda:** la pantalla conserva lo ya cargado y muestra el error al pie con «Reintentar»; no tira
  abajo el listado.

## Empresa activa

El cambio de empresa activa es un `reinicio` más: descarta las filas acumuladas, vuelve a la tanda 1 y **no** deja
ver filas de la empresa anterior. Cada pantalla declara su propia clave (`reinicio`): `empresaId`,
`{ empresaId, estado }`, `[empresaId, estado, textoAplicado, desde, hasta, revision]`, `[textoAplicado, estado,
empresaId, version]`, etc. En los listados donde la empresa se resuelve en el servidor, la RLS y
`private.organizacion_id()` siguen siendo la autoridad.

## Cómo probarlo

> Aplica sobre el código de la rama `dokploy` (o DEV, ya desplegado). Los pasos son los mismos para cualquier
> persona del equipo: no hace falta leer código.

### Prerrequisitos

- **Rol:** Administrador (o cualquier rol con lectura en las secciones necesarias: Catálogo, Stock, Ventas,
  Clientes, Contactos, Consultas, Proveedores, Service técnico, Actividad).
- **Datos:** más de una tanda de filas en al menos un listado (por ejemplo, 60 clientes o 60 movimientos de stock) y
  al menos un producto **con imagen** cargado en el catálogo, para ver la miniatura. Se siembran con el seed local o
  con fixtures; **nunca** en producción.
- **URL:** local (`pnpm dev:supabase` + `pnpm dev:refine:host`) o DEV.

### Pasos

1. Entrá a **Catálogo → Productos** (`/productos`). **Ves** el listado con el contador arriba («N productos») y
   **abajo un botón «Cargar más»**; no hay botones de página.
2. Bajá hasta el final del listado. **Ves** que las filas siguientes se suman a las que ya estaban, sin perder las
   anteriores.
3. Volvé arriba y hacé clic en «Cargar más». **Ves** que se suman las siguientes y el foco sigue en el botón (se
   puede repetir con el teclado).
4. Llegá al final del listado. **Ves** el mensaje «No hay más resultados.» y el botón desaparece.
5. Escribí en el buscador otra cosa. **Ves** que la lista vuelve a arrancar desde la primera tanda (sólo la primera
   tanda) y el contador se actualiza.
6. En **Stock → Stock actual** (`/stock`), mirá la columna **Producto**. **Ves** la foto chica del producto al lado
   del nombre; **sin** foto se ve un marcador del mismo tamaño.
7. Pasá el mouse por esa miniatura. **Ves** la imagen ampliada al costado, sin que la fila cambie de ancho.
8. En **Stock → Faltantes** (`/stock/faltantes`), avisá a los clientes de un faltante. **Ves** que la lista vuelve a
   la primera tanda y que «seleccionar todos» toma las filas cargadas.
9. En **Actividad** (`/actividad`), **ves** el total de eventos y el botón «Cargar más»; **no** hay «Anterior» ni
   «Siguiente».
10. En **Ventas → Comprobantes** (`/ventas/comprobantes`), buscá y filtrá. **Ves** que el listado arranca de nuevo y
    que el contador y el botón **Exportar** siguen tomando el filtro completo, no sólo lo que está cargado.
11. Bajá hasta el final de **Clientes** (`/clientes`). **Ves** «No hay más resultados.» al terminar.
12. Cambiá la **empresa activa** en la barra superior. **Ves** que la lista vuelve a la primera tanda y que no
    quedan filas de la empresa anterior.

### Resultado esperado

- **Given** un listado con más filas que una tanda, **When** la persona llega al final del scroll o pulsa
  «Cargar más», **Then** se suman las filas siguientes a las ya mostradas y el total de arriba no cambia.
- **Given** un listado cargado, **When** la persona busca, filtra, ordena o cambia de empresa, **Then** la lista
  vuelve a la primera tanda y no quedan filas del ámbito anterior.
- **Given** una fila que referencia un producto con imagen, **When** la persona pasa el mouse por la miniatura,
  **Then** ve la imagen ampliada sin que la fila cambie de ancho; si el producto no tiene imagen, la celda muestra el
  marcador vacío.
- **Given** una tanda que falla, **When** la persona llega al final, **Then** ve «No pudimos cargar más resultados.»
  con «Reintentar» y conserva lo que ya estaba cargado.

### Cómo automatizarlo

**Todavía no existe ningún E2E de la épica** (queda **pendiente de automatizar**): el rango de la épica no toca
`apps/web/e2e/`. La cobertura actual es Vitest (hooks y componentes) y el E2E preexistente de cada pantalla.

Rótulos propuestos para `apps/web/e2e/` — la épica no tiene `tasks.md`, así que los `T0yy` son **tentativos** y se
ajustan al abrir el seguimiento:

| Recorrido | Rótulo |
|---|---|
| Carga por tandas con el scroll y con «Cargar más» (teclado) | `[MSF-789:T001]` |
| Reinicio a la primera tanda al buscar, filtrar o cambiar de empresa | `[MSF-789:T002]` |
| Error de una tanda con «Reintentar» y fin de lista («No hay más resultados.») | `[MSF-789:T003]` |
| Miniatura del producto y vista ampliada al pasar el mouse | `[MSF-789:T004]` |
| Conteo total y exportación: el filtro completo, no la tanda visible | `[MSF-789:T005]` |

## Pruebas

- **Vitest** (en `origin/dokploy`): `hooks/useListadoAcumulado.test.ts` (acumulación, reinicio, tanda vacía),
  `hooks/useImagenesProductos.test.tsx` (pide sólo lo que falta), `lib/imagenesPrincipales.test.ts` (primera imagen
  por posición), `components/pagina/CargaInfinita.test.tsx`, `components/base/MiniaturaProducto.test.tsx` y los tests
  de cada pantalla migrada (`pages/stock/list.test.tsx`, `pages/ventas/comprobantes.test.tsx`,
  `pages/clientes/list.test.tsx`, `pages/consultas/list.test.tsx`, `pages/contactos/list.test.tsx`,
  `pages/proveedores/list.test.tsx`, `pages/historial/list.test.tsx`, `pages/actividad/list.test.tsx`,
  `components/clientes/*.test.tsx`, `components/stock/*.test.tsx`, `components/ventas/*.test.tsx`).
- **pgTAP:** sin cambios (la épica no agrega ni altera base; la migración de `producto_id` es de otra rama).
- **E2E:** sin cambios (ver *Cómo automatizarlo*).

## Fuera de alcance y pendientes

- **`useListadoLocal` no lo usa ninguna pantalla.** Queda disponible para el caso de listados que ya traen todas las
  filas en memoria, pero hoy no hay ninguno: el chequeo de código muerto (`knip`, que corre `pnpm calidad`) puede
  marcarlo como export sin uso. **TODO (dueño: quien mantenga el panel):** usarlo o quitarlo en una limpieza aparte.
- **Catálogo visible de la tienda** (`pages/empresas/tienda/pestanas/catalogo.tsx`): **no** se migró y **no** lleva
  miniatura. Renderiza el catálogo completo de la tienda, así que pedir las imágenes de todas las filas de una vez
  haría un `in()` enorme. Queda pendiente hasta migrarlo a carga infinita.
- **Historial de lotes** (`components/stock/HistorialLotes.tsx`): usa su propio botón «Ver más» por cursor (no era
  `TablePagination`) y **no** se migró. El detalle de movimientos de un lote (sólo nombre y SKU) queda como estaba.
- **Historial de cargas de la cotización** (`components/cotizacion/TablaHistorial.tsx`, en `pages/cotizacion/index.tsx`):
  es paginado **por cursor** (no era `TablePagination`) y **no** se migró: conserva los botones «Anterior» y
  «Siguiente» con el número de página. El «Historial de cotizaciones» de `/historial`, que sí es un listado, sí
  quedó migrado.
- **Tienda pública (resuelto por MSF-845):** el catálogo, la categoría y los resultados de búsqueda
  dejaron la paginación por URL (`?pagina=<n>`) y usan carga infinita; un `?pagina=N` viejo se ignora.
  Ver [Catálogo y ficha · Carga infinita](tienda-catalogo-y-ficha.md#carga-infinita-en-los-listados-msf-845).
- **Migración de `producto_id`** (rama `origin/feat/ventas-faltantes-rma-producto-id`): ver *Datos*.
- **Capturas del manual:** las pantallas migradas todavía no tienen capturas nuevas del comportamiento de carga
  infinita ni de la miniatura. La herramienta de captura del manual (`pnpm docs:capturas`,
  `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo**; lo más cercano es
  `pnpm --filter @platform/web pantallas:capturar`, que renderiza el prototipo y, con `PANTALLAS_APP_URL` y un
  `storageState` de Playwright, también las rutas de la app. **TODO (dueño: quien cierre la documentación del
  manual):** regenerar las capturas de `docs/producto/img/` de las pantallas migradas y agregarlas al manual. Hasta
  entonces el manual describe el comportamiento **sin imágenes nuevas**: no se inventó ninguna.

## Reversión

La épica no cambia la base, así que el camino de reversión es el del código:

- Un `git revert -m 1` del merge de la épica (`19636f0c`) devuelve el panel a la paginación numerada. Como las RPC
  siguen paginando igual, **no** hace falta tocar migraciones.
- La tienda pública (MSF-845) se revierte con `git revert -m 1` del merge `5af16204`; como no hay
  migraciones, la base no cambia.
- Si se revierte sólo la parte de la imagen, alcanza con volver a `MiniaturaProducto` sin `src` (la celda queda con el
  marcador vacío) o con dejar de pedir las imágenes: `useImagenesProductos` no tira abajo la pantalla si falla.
- Si se revierte la migración `20270204100000_ventas_listados_producto_id.sql` (cuando se integre), su encabezado
  documenta el camino: recrear `public.listar_faltantes`, `private.listar_rma_sesion` y `public.listar_rma` con las
  definiciones de `20270112130300_faltantes_listar.sql` y `20270113120300_listar_rma_vinculo.sql`.
