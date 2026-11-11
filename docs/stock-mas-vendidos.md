# Stock · Reporte de productos más vendidos (F-STK-18)

Pestaña **Más vendidos** de Stock (`/stock/mas-vendidos`): qué productos se vendieron más en un período,
con unidades vendidas y su posición en el ranking. Spec:
`specs/20261024-130000-stock-carga-exportacion-y-avisos/` (US5, FR-401…FR-408, SC-401, SC-402).

**No hay prototipo** de esta pantalla: se construye con los componentes compartidos del panel y queda
anotado en el PR (FR-401). Las columnas, el período y el filtro salen de los requisitos.

Migración de la historia (aditiva, con reversión en el encabezado):
`20261213100500_productos_mas_vendidos.sql` (la RPC `public.productos_mas_vendidos`). No crea tablas
nuevas: lee `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas` y `dominio.productos`.
Usa una versión **nueva y mayor** a propósito: con el número que nombra `tasks.md` (`20261206130000`) la
migración quedaba por debajo de la cola ya aplicada en dokploy y no se aplicaba nunca (guard
`scripts/verificar-migraciones.mjs`: «versión REUSADA»).

## Qué cuenta

La RPC `public.productos_mas_vendidos(p_desde, p_hasta, p_empresa_id, p_pagina, p_tamano)` suma las
**unidades** (`cantidad`) de las líneas de comprobantes que **cuentan como facturados**:

- El predicado es un único lugar: `private.comprobante_cuenta_como_facturado` (hoy: factura que no está
  en borrador ni anulada). Por lo tanto **no suman** los presupuestos, los borradores ni las anuladas.
- Las líneas **«A pedido» sí suman**: se vendieron igual.
- Cuenta la **fecha del comprobante** (`dominio.comprobantes_venta.fecha`), la de la venta.
- El **orden** lo calcula la base: unidades descendente y, en empate, el nombre del producto (y el id como
  último desempate, para que el orden sea estable). La **posición es global** (no de la página) y
  `total_filas` es el total del ranking, no el de la página. La pantalla no reordena ni recalcula nada:
  solo pagina de a 25.

## Período

Atajos **Este mes · Mes anterior · Últimos 90 días · Año en curso** y rango manual **Desde/Hasta**, con las
mismas reglas que el ranking de clientes (`lib/periodosRanking.ts`):

- Las fechas son `YYYY-MM-DD` y el «hoy» se calcula en la zona de la organización
  (`America/Argentina/Buenos_Aires`), no en la del navegador.
- El **rango máximo es de 5 años**. El control de la pantalla es una comodidad: el **servidor revalida**
  el período y responde `22023` («El rango máximo es de 5 años.») si el rango no entra.
- El período por defecto es **el mes en curso**.
- Un rango inválido se marca en el campo y **no sale a la base**: «Hasta no puede ser anterior a Desde» y
  «El rango máximo es de 5 años» (el mismo tope que el del ranking de clientes, con el mismo texto).

## Tienda

- El filtro de tienda es el compartido `FiltroEmpresa` («Todas las tiendas» + una por empresa) y la
  pantalla sigue a la **empresa activa** de la barra superior (Principio VIII).
- Solo cuentan las ventas de las **tiendas con `ventas` en `lectura`/`edicion`** para quien consulta
  (`private.nivel_ventas_en_empresa`). Sin elegir tienda, se ve el conjunto de las tiendas visibles.
- `p_empresa_id` acota a una tienda. Una tienda **ajena** (de otra organización o sin `ventas` visible)
  devuelve **cero filas**, no un error.
- Un comprobante **sin tienda** (`empresa_id` nula, de las ventas cargadas antes de que existiera la tienda)
  no tiene tienda visible: **no suma**.

## Empresa activa (Principio VIII)

Al cambiar el ámbito —organización, tienda o período— la pantalla **se reencuadra en el mismo render**: la
paginación vuelve a la página 1, la consulta de la nueva empresa sale una sola vez (no se pide una página
que ya no corresponde) y lo anterior se descarta de inmediato. Nunca se muestran filas ni totales de la
empresa o del período anterior, y una respuesta tardía de la empresa anterior no pisa la nueva («última
petición gana», en `hooks/useMasVendidos.ts`).

Si la persona acota el reporte a una tienda desde el filtro de la pantalla, esa elección **vale hasta que
cambie la empresa activa**: cuando cambia, el filtro vuelve a seguirla (mecanismo compartido
`useFiltroPorEmpresaActiva`) y el reporte se recalcula para la nueva empresa.

## Permisos y seguridad

- La RPC es **`security definer` con `search_path = ''`**; la organización sale de la **sesión**
  (`private.organizacion_id()`), nunca de un argumento. `revoke … from public, anon` y
  `grant execute … to authenticated` explícitos.
- Exige la sección **`stock` en `lectura`/`edicion`** (`private.nivel_seccion('stock')`): sin permiso,
  `42501` («Sin permiso para ver los productos más vendidos.»).
- La **pestaña** no se limita a `edicion` (a diferencia de «Actualizar por Excel»): el reporte se puede
  leer con `lectura` o `edicion` en Stock (FR-401). La **ruta** está protegida por la sección `stock`
  (`RequiereAccesoSeccion`) y por organización activa.
- El filtro de tiendas usa el mecanismo compartido de empresas accesibles: **otra organización nunca ve
  filas** y la base es la autorización real (la UI solo evita mostrar lo que no corresponde).

## Estados

Los compartidos del panel: **cargando**, **vacío** («No hay ventas en el período» / «Probá con otro rango
de fechas o con otra tienda.»), **error con reintento** («No pudimos cargar los productos más vendidos.») y
un aviso en vivo con el total de productos para el lector de pantalla.

## Paginación

**25 por página** (tope del servidor: 200). La tabla muestra Posición · Producto (nombre y SKU) ·
Unidades vendidas; en anchos angostos (por debajo del breakpoint `sm`, 600 px) se condensa en tarjetas
(componente compartido `ContenidoAdaptable`).

## Rendimiento

- El filtro por período y por tienda usa los índices que ya existen: `comprobantes_venta_fecha_idx
  (organizacion_id, fecha)` y `comprobantes_venta_empresa_fecha_idx (organizacion_id, empresa_id, fecha desc)`.
  El cruce con las líneas usa el índice de `unique (comprobante_id, orden)` de
  `dominio.comprobantes_venta_lineas`.
- El agregado se hace **en la base** (una fila por producto con `sum(cantidad)`) y la RPC devuelve **una sola
  página** (25 por defecto, tope 200): la pantalla nunca trae el ranking completo.
- La visibilidad por tienda se resuelve con `private.nivel_ventas_en_empresa`, la misma función que usan las
  demás RPC de ventas: el filtro es por tienda, no por comprobante.
- La RPC es `stable`: repetir el mismo período no cambia el resultado ni el plan.

## Reversión

Migración aditiva. Para deshacer (en una migración posterior):

```sql
drop function public.productos_mas_vendidos(date, date, uuid, integer, integer);
```

Además: quitar la pestaña «Más vendidos» de `PestanasStock.tsx`, la ruta `/stock/mas-vendidos` de
`App.tsx` y el enlace en `docs/stock.md`. La pantalla **no deja datos persistidos**: es de solo lectura.

## Pruebas

- pgTAP `supabase/tests/database/productos_mas_vendidos.test.sql`: suma solo líneas de facturas que
  cuentan (presupuestos, borradores y anuladas no suman), incluye «A pedido», el período y la tienda
  elegidos, el orden y el desempate, tienda ajena → 0 filas, `anon` sin ejecución y sin sesión `42501`.
- Vitest `apps/web/src/lib/masVendidos.test.ts`: la capa de datos (la RPC con período, tienda y página; el
  total que llega como texto; el período por defecto y el máximo de 5 años).
- Vitest `apps/web/src/hooks/useMasVendidos.test.tsx`: al cambiar la tienda o el período no quedan filas
  del ámbito anterior.
- Vitest `apps/web/src/pages/stock/mas-vendidos.test.tsx`: columnas y paginación de a 25, el filtro de
  tienda y el reencuadre al cambiar de empresa (incluido que la elección de la pantalla se descarta cuando
  cambia la empresa activa de la barra superior), los atajos y el rango Desde/Hasta —incluido el máximo de
  5 años— los estados de carga, vacío y error con reintento, el nombre accesible de la tabla y el aviso en
  vivo del total, y la pestaña y la ruta visibles con `lectura`/`edicion` (FR-401).
