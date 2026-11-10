---
owner: producto
sources: []
---

# Actualizar precios en bloque

## Para qué sirve

Cuando el costo o el precio de lista cambian para muchos productos al mismo tiempo (una lista de precios nueva del proveedor, una variación del dólar, un ajuste de margen), cargarlos uno por uno lleva tiempo y se presta a errores. Esta pantalla te deja **subir o bajar muchos costos y precios de una sola vez**, con una **vista previa** que te muestra cómo queda cada producto **antes** de tocar nada. Recién cuando confirmás se aplica el cambio, y se aplica **de todo o nada**: si algo falla, no cambia ni un solo producto.

Los importes se cargan **sin IVA**. Cuando el precio cambia, **todas las tiendas lo ven al instante**: el precio de cada tienda se calcula en el momento en que se consulta, así que no queda ninguna copia guardada que pueda quedar desactualizada.

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Abrir la pantalla y cambiar precios de lista | Administrador y Operador |
| Ver y cambiar los **costos** | Solo Administrador |
| Entrar a la pantalla | Mostrador, Depósito, Administración, Técnico y Consulta no la ven |

Si tu rol no tiene permiso de edición de productos, la pantalla no se abre: el sistema te avisa que no tenés acceso a esa sección.

## Dónde lo encontrás

En el menú de la izquierda: **Catálogo → Productos**. En el listado, arriba a la derecha, está el botón **Actualizar precios**.

Esta pantalla es **de toda la organización**, no de una tienda: no depende del selector de empresa de la barra superior y el cambio aplica a todas las empresas por igual.

## Elegir cómo se define el cambio

Arriba de todo están dos opciones:

| Opción | Cuándo usarla |
|---|---|
| **Por porcentaje** | Cuando el cambio es el mismo para todos los productos del alcance (por ejemplo, «subir un 10 %»). |
| **Por planilla** | Cuando cada producto lleva un valor distinto (por ejemplo, el costo nuevo que te pasó cada proveedor). |

### Por porcentaje

1. En **Qué cambia** elegí **Precio de lista**, **Costo** o **Costo y precio de lista**. Las opciones de costo solo aparecen si tu rol puede ver los costos.
2. En **Alcance** elegí **Todos los productos activos** o una categoría. Si elegís una categoría, entran también sus subcategorías.
3. En **Porcentaje** escribí el número: un número positivo **sube** y uno negativo **baja**. Por ejemplo, `10` sube un 10 % y `-5` baja un 5 %. El porcentaje tiene que ser mayor a −100 % (un −100 % o menos dejaría el precio en cero).

El resultado se redondea a dos decimales en la moneda del producto.

### Por planilla

1. Hacé clic en **Descargar plantilla CSV** y abrila con tu planilla.
2. Completá la columna **SKU** (obligatoria) y, al menos una de las dos: **costo** o **precio_lista**. Los importes van **sin IVA**. La planilla admite hasta 5.000 filas por vez.
3. Volvé a la pantalla y hacé clic en **Elegir archivo CSV** para subirla.

El archivo puede estar separado por comas o por punto y coma, y venir con la marca de fin de archivo o con saltos de línea de Windows: el sistema lo lee igual.

## Ver la vista previa antes de aplicar

1. Hacé clic en **Ver vista previa**. Todavía no se cambió ningún producto.
2. Arriba de la tabla vas a ver tres números: cuántos productos **se actualizan**, cuántos quedan **sin cambio** y cuántos tienen **error**.
3. En la tabla, cada producto muestra el **precio de lista antes → después** (y también el **costo** antes → después, si tu rol lo ve). La columna **Resultado** dice «Se actualiza», «Sin cambio» o el motivo del error.

Si alguna fila tiene error, no se puede confirmar: la pantalla te lo avisa y te pide corregir las filas y volver a generar la vista previa. Los errores se muestran uno por uno, con el número de fila y el motivo (por ejemplo, un SKU que no existe o repetido).

Cuando la vista previa está limpia, hacé clic en **Confirmar actualización**. Se abre un cuadro que dice cuántos productos se van a actualizar y que **se aplica todo junto: si algo falla, no se cambia nada**. Hacé clic en **Aplicar**.

Al terminar vas a ver «Listo: se actualizaron N productos.» y la indicación de que todas las empresas ya muestran los precios nuevos.

## Si algo cambió mientras mirabas la vista previa

Si otra persona editó alguno de los productos entre la vista previa y la confirmación, el sistema **no aplica nada** y te avisa: «Un producto cambió desde la vista previa. No se aplicó nada: generá la vista previa de nuevo.». Volvé a generar la vista previa, revisá y confirmá de nuevo.

Lo mismo pasa si hacés doble clic o reintentás: la operación se aplica **una sola vez**.

## Qué cambia y qué no

| Sí cambia | No cambia |
|---|---|
| El precio de lista del producto | La moneda del producto (dólares o pesos) |
| El costo del producto (si tu rol lo ve) | Los precios por escala (x5, x10, x50) |
| | Los precios propios de una empresa, si los cargaste |
| | Las promociones de precio ya programadas |
| | Nada de Mercado Libre |

Los **precios por escala** quedan como estaban: si subís el precio de lista, una escala puede quedar por debajo. Es una historia aparte.

## Qué queda registrado

Cada lote aplicado queda anotado en la [Actividad](actividad.md), con quién lo hizo y cuándo. El detalle del lote **no incluye los importes de costo**: si tu rol no tiene acceso a Rentabilidad, no ves los costos en ninguna parte de esta pantalla.

## Casos comunes

- **Quiero subir un 10 % a una categoría.** Entrá a **Actualizar precios**, elegí **Por porcentaje**, **Qué cambia** = Precio de lista, **Alcance** = la categoría, **Porcentaje** = 10, y confirmá.
- **El proveedor me pasó los costos nuevos.** Descargá la plantilla, pegá los costos por SKU, subila y revisá la vista previa fila por fila antes de aplicar.
- **Un producto no tiene costo cargado.** En modo porcentaje no se le inventa uno: solo cambia el precio de lista. En modo planilla, sí se puede cargar el costo.
- **No me deja confirmar.** Hay filas con error: arriba de la tabla te las señala. Corregí la planilla o cambiá el alcance y volvé a generar la vista previa.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **Tu rol no puede actualizar precios** | Pedile al Administrador que lo haga o que te dé permiso de edición en Productos. |
| **Tu rol no puede cambiar costos** | El costo se cambia solo con permiso de Rentabilidad. Sacá el costo del cambio o pedile permiso al Administrador. |
| **El porcentaje tiene que ser mayor a −100 %** | Un porcentaje de −100 % o menos dejaría el precio en cero. |
| **Ingresá el porcentaje** | El campo está vacío: escribí un número. |
| **La actualización admite hasta 5.000 productos por vez; elegí una categoría** | El alcance es demasiado grande. Dividilo por categorías. |
| **Un producto cambió desde la vista previa…** | Otra persona editó un producto: generá la vista previa de nuevo. |
| **No pudimos completar la operación. Probá de nuevo en unos minutos.** | Falló la conexión. Probá otra vez. |

<!-- TODO (dueño: documentación de producto): capturas de la pantalla «Actualizar precios» (los dos modos, la vista previa y el cuadro de confirmación) en docs/producto/img/precios-masivos/. No se pudieron generar porque la herramienta de capturas del manual (`pnpm docs:capturas` y `pnpm demo:dataset`) no existe en este repo y el código de la épica todavía no está en `main`; ver la página técnica. -->

Ver también: [Precios, escalas e IVA](precios-e-iva.md), [Cotización del dólar](precios-dolar.md), [Promociones de precio](promociones.md) y [Rentabilidad](rentabilidad.md).
