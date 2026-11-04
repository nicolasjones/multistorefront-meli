# Listados: carga infinita e imagen de producto

Regla de la constitución (Principio VI, 1.10.0): los listados del panel **no usan paginación numerada**. Cargan por
tandas desde el servidor al llegar al final del scroll y suman cada tanda a lo ya mostrado. Los listados que
mencionan productos muestran su **imagen principal** como miniatura con zoom al pasar el mouse.

## Piezas compartidas

| Pieza | Para qué |
|---|---|
| `components/pagina/CargaInfinita` | Pie del listado: `IntersectionObserver` (400 px de anticipo), botón «Cargar más» operable con teclado, indicador de carga, error con «Reintentar» y «No hay más resultados.». |
| `hooks/useListadoAcumulado` | Suma las páginas que ya entrega el hook de datos de la pantalla (RPC, vista, react-query…): no se reescribe la capa de datos. |
| `hooks/useListadoLocal` | Igual para listados que ya tienen TODAS las filas en memoria (paginación del lado del cliente). |
| `hooks/useImagenesProductos` | `Map<productoId, urlFirmada>` con la imagen principal de los productos visibles; pide solo los que faltan. |
| `components/base/MiniaturaProducto` | Miniatura 40×40 con zoom (280×280) al pasar el mouse. |

## Cómo migrar una pantalla

1. Quitar `TablePagination` y su `labelDisplayedRows`; el contador total («N resultados») se conserva.
2. Pasar a la pantalla lo que ya tenía (`pagina`, `setPagina`, `total`, las filas de la página y si está cargando) por `useListadoAcumulado`
   y mostrar `listado.filas` en lugar de las filas de la página:

   ```tsx
   const listado = useListadoAcumulado({ items: datos.filas, pagina, setPagina, total: datos.total, cargando, reinicio: filtros })
   // …
   <ContenidoAdaptable items={listado.filas} … />
   <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={falloTanda} onCargarMas={listado.cargarMas} />
   ```
3. `reinicio` es todo lo que cambia el resultado (búsqueda, filtros, orden, empresa): cambia → vuelve a la tanda 1.
4. `items` debe ser el arreglo que entrega el hook de datos (referencia estable entre renders); no se arma uno nuevo en cada render.
5. Si la tanda siguiente falla, el error se muestra al pie con «Reintentar» (`hayError`) y no tira abajo lo ya cargado.
6. Acciones que cambian las filas (activar/desactivar, borrar, importar) recargan **desde la primera tanda**.
7. La exportación y los totales siguen usando los filtros, no la página visible.

## Imagen principal en listados con productos

Si la fila tiene el `producto_id`, `useImagenesProductos(listado.filas.map((f) => f.producto_id))` entrega la URL
firmada (vida de 5 minutos, se renueva sola) y la celda usa `<MiniaturaProducto alt="" src={imagenes.get(id)} />` junto
al nombre. Sin imagen se dibuja el marcador vacío del mismo tamaño. No se agranda la miniatura para no romper el ancho
de la fila. Si falla la carga de imágenes, el listado se muestra igual.

## Excepciones

Un listado puede conservar su paginación solo si hay una razón de negocio (totales por página, una exportación que
depende de la página visible). Se justifica en la spec y su plan y se anota acá.

Sin excepciones en Clientes y Contactos: todos sus listados (clientes, inactivos, ranking, compras y reparaciones de la ficha, correo masivo y contactos) usan carga infinita.
