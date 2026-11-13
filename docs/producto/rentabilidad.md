---
owner: producto
sources: []
---

# Ver la rentabilidad: costos y márgenes

## Para qué sirve

La pantalla **Rentabilidad** te muestra cuánto ganás con cada producto en cada tienda: el margen, comparado con el costo. Te avisa cuando algo se vende por debajo del costo o casi, para que lo corrijas a tiempo.

## Quién puede hacerlo

Con los permisos que trae el sistema por defecto:

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Ver todas las pestañas, cambiar el **umbral de margen bajo** y cargar, editar o dar de baja los **costos adicionales**. Es quien carga los costos. |
| **Administración** | Ver todas las pestañas, incluidos los costos adicionales, sin cambiar el umbral ni editarlos. |
| **Operador, Mostrador, Depósito, Técnico y Consulta** | No acceden: ven el aviso «No tenés acceso a esta sección». Tampoco ven el costo de los productos en el listado ni en la ficha. |

Los costos y los márgenes son datos sensibles: solo los ve quien tiene acceso a esta pantalla. El Administrador puede cambiar esto en [Usuarios y roles](usuarios-y-roles.md).

![Pantalla No tenés acceso a esta sección con el aviso Tu rol (Operador) no incluye Rentabilidad y los botones Solicitar acceso y Volver al inicio](img/rentabilidad/07-acceso-restringido.png)

*Un usuario con rol Operador que intenta entrar a Rentabilidad ve este aviso.*

![Listado de Productos visto por un Operador, sin la columna Costo](img/rentabilidad/08-productos-sin-costo.png)

*El mismo listado de Productos visto con rol Operador: no aparece la columna **Costo**.*

## Dónde lo encontrás

En el menú de la izquierda: **Análisis → Rentabilidad**. La pantalla tiene seis pestañas: **Resumen**, **Por producto**, **Comparativo**, **Historia**, **Ventas reales** y **Costos adicionales**.

La mayoría de las pestañas compara todas las empresas del negocio juntas y no cambia con la empresa que tengas elegida arriba. La excepción es **Costos adicionales**, que muestra los costos de la empresa activa (o de todas con «Todas las tiendas»). **Ventas reales** también muestra todas las empresas.

## Cómo se calcula el margen

El margen es lo que te queda de cada venta, sobre el precio sin IVA:

- **Margen** = Precio − Costo − Costos adicionales − Comisión
- **Margen %** = Margen ÷ Precio

Algunas aclaraciones:

- El **precio** es el que tiene la tienda, sin IVA. El **costo** es el del producto en pesos, sin IVA (si está en dólares, se pasa a pesos con la cotización de hoy).
- Los **costos adicionales** son los que cargues en **Costos adicionales** para esa tienda: un porcentaje sobre el precio neto o un monto por unidad. Si no cargaste ninguno, el margen es igual al de siempre.
- Las tiendas propias no cobran comisión, así que hoy la comisión es cero.
- Es una **estimación con los datos disponibles**: además de los costos adicionales que cargues, no incluye otros impuestos ni envíos que no hayas dado de alta.
- Si a un producto le falta el costo (o la cotización, si está en dólares), no aparece con margen: no se inventa un número.
- Solo cuentan los productos y las tiendas activos.
- Se calcula en el momento: si cambia el costo, el dólar, el ajuste de precio de una tienda o un costo adicional, el margen cambia solo.

### Qué significa el estado

| Estado | Cuándo |
|---|---|
| **OK** | El margen % es igual o mayor que el umbral de margen bajo. |
| **Bajo** | El margen % es positivo pero menor que el umbral. |
| **Negativo** | El margen % es menor que cero: se vende por debajo del costo. |

## Pestaña Resumen

Muestra:

- Una **tarjeta por empresa** con la cantidad de productos, el margen promedio en porcentaje y en pesos por unidad, y cuántos productos tienen margen bajo o negativo.
- Un bloque **Consolidado** con el total del negocio.
- La tarjeta **Cómo se calcula**, con las fórmulas.
- Un aviso en amarillo: «Hay productos que se venden por debajo del costo o casi. Revisalos en Por producto.», con el botón **Ver detalle**. Si no hay productos en riesgo, el aviso no aparece.

Si todavía no hay productos con margen, ves el mensaje «Todavía no hay productos con margen calculado»: cargá el costo de tus productos (y la cotización del dólar, si están en USD).

### Cambiar el umbral de margen bajo

Es el porcentaje por debajo del cual un producto se marca como «Bajo». Viene en 10 %.

1. En **Resumen**, hacé clic en **Umbral de margen bajo** (solo lo ve el Administrador).

![Pantalla Rentabilidad con el botón Umbral de margen bajo resaltado con el número 1](img/rentabilidad/02-boton-umbral.png)

*Paso 1: el botón **Umbral de margen bajo** está arriba a la derecha.*

2. Escribí el porcentaje, por ejemplo «10» o «12,5». Tiene que ser mayor que 0 y hasta 100.
3. Hacé clic en **Guardar**. Vas a ver «Umbral de margen bajo guardado.» y el tablero se actualiza.

![Cuadro Umbral de margen bajo con el valor 10 por ciento y los botones Cancelar y Guardar](img/rentabilidad/03-umbral.png)

*Pasos 2 y 3: el porcentaje actual (10 %) y el botón **Guardar**.*

## Pestaña Por producto

Una fila por producto y por tienda, con **Producto** (nombre y SKU), **Canal**, **Precio**, **Costo**, **Comisión**, **Margen**, **Margen %** y **Estado**. Arriba aparece el total de filas. Los márgenes negativos se resaltan.

Usá los filtros de la parte superior para ver «Todos», «Bajo o negativo» o «Solo negativo», y para elegir una tienda. Si llegás desde **Ver detalle**, el filtro «Bajo o negativo» ya viene puesto. Si no hay coincidencias, ves «Sin resultados».

## Pestaña Comparativo

Pone el **mismo producto lado a lado en cada tienda**, para ver dónde ganás de más o de menos. Cada fila muestra el margen % de cada empresa, la **diferencia** entre la mejor y la peor (en puntos porcentuales) y cuál es la mejor y la peor.

- Solo entran productos con margen calculado en **dos o más** empresas.
- Podés buscar por producto o SKU y ordenar por «Mayor diferencia primero» o «Menor diferencia primero».
- Usa los valores de hoy. Para ver cómo cambió en el tiempo, usá **Historia**.

## Pestaña Historia

Elegís **un producto** y ves cómo evolucionó su margen, con la cotización del dólar y el costo que regían en cada fecha. Sirve para entender si el margen cambió por el dólar o por un cambio de costo.

- Un gráfico con el margen % de cada empresa a lo largo del tiempo, y una tabla con **Fecha**, **Empresa**, **Cotización**, **Costo**, **Neto**, **Margen** y **Margen %**.
- Los puntos de la serie son cada cambio de costo y cada carga de la cotización del dólar.
- Un producto en pesos no se mueve con el dólar: su línea solo cambia si cambia el costo.
- Se usa el precio de hoy de la tienda: no se reconstruyen precios de lista pasados.
- Si falta información, ves «Sin historia para este producto».

## Pestaña Ventas reales

Muestra el margen de **lo que realmente vendiste** en un período, no una estimación con los precios de hoy. Sirve para saber cuánto ganaste de verdad con las ventas confirmadas.

- Arriba ves los **totales del período**: vendido, costo, costos adicionales, margen y margen %. También aparece el estado del margen (OK, Bajo o Negativo).
- Debajo, una tabla **por empresa** y otra **por producto**, con unidades, vendido, costo, costos adicionales, margen y margen %.
- Elegís el **rango de fechas** en el propio tablero.
- Solo cuentan las ventas confirmadas y con el costo guardado en el momento de la venta. Las ventas confirmadas antes de que se guardara el costo **no figuran**: no se inventa un costo.
- Los costos adicionales que se descuentan son los **vigentes hoy**, no los de la fecha de la venta.
- Si en el período no hubo ventas, ves «Sin ventas en este período» y la ayuda para elegir otro rango.
- Muestra todas las empresas del negocio: no cambia con la empresa activa.

## Pestaña Costos adicionales

Acá cargás los costos que querés descontar del margen además del costo del producto, por ejemplo **Envío**, **Impuestos** o **Comisión de la plataforma**.

La tabla muestra **Costo**, **Empresa**, **Tipo** y **Valor**. Arriba ves los costos de la empresa activa; con «Todas las tiendas», los de todas las tiendas a las que tenés acceso.

### Cargar un costo adicional

1. Hacé clic en **Nuevo costo adicional** (solo lo ve el Administrador).
2. Escribí un **nombre**, por ejemplo «Envío». Admite hasta 80 caracteres.
3. Elegí el **tipo**:
   - **Porcentaje sobre el neto**: se descuenta ese porcentaje del precio sin IVA. Tiene que estar entre 0 y 100.
   - **Monto por unidad**: se descuentan esos pesos por cada unidad vendida.
4. Escribí el **valor**. Podés usar coma decimal, por ejemplo «12,5».
5. En **Aplica a**, marcá una o varias empresas. Se crea el mismo costo en cada empresa marcada.
6. Hacé clic en **Guardar**. Ves el aviso «Costo «…» creado.» o «Costo «…» creado en N empresas.».

Podés cargar el mismo costo en varias tiendas de una vez. Si falla en alguna, el diálogo queda abierto con el error de la empresa que falló y las que sí se guardaron quedan creadas.

### Editar o dar de baja

- **Editar** cambia el nombre, el tipo o el valor. La empresa **no** se puede cambiar: si el costo va en otra tienda, dalo de baja y creá uno nuevo.
- **Dar de baja** lo saca de la lista y deja de descontarse del margen. El cambio también se refleja en **Ventas reales**, porque esa pestaña usa los costos adicionales vigentes.
- No puede haber dos costos activos con el mismo nombre en la misma empresa.
- Si cambiás la empresa activa con el formulario abierto, se cierra sin guardar y te avisa. Volvé a abrirlo para cargar el costo en la tienda nueva.

Administración puede ver la lista, pero los botones de edición son solo del Administrador.

## Casos comunes

- **Quiero saber qué productos pierden plata.** Entrá a **Por producto** y filtrá por «Solo negativo», o hacé clic en **Ver detalle** en el aviso del Resumen.
- **Cambió el dólar y quiero ver cómo afectó el margen.** Usá **Historia** con el producto que te interesa.
- **Quiero saber cuánto gané con lo que vendí este mes.** Usá **Ventas reales** y elegí el rango de fechas.
- **El margen no cierra con el costo del producto.** Revisá si la tienda tiene **costos adicionales** cargados: se descuentan además del costo.
- **Un producto no aparece.** Revisá que tenga costo cargado y que esté activo (ver [Productos y categorías](catalogo-productos.md)). Si está en dólares, verificá que haya una [cotización cargada](precios-dolar.md).

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **No pudimos cargar esta información.** | Usá el botón **Reintentar**, si aparece. Si sigue fallando, avisá al equipo de soporte. |
| **El tablero de Rentabilidad todavía no está disponible para tu organización.** | Pedíselo al equipo de soporte. |
| **Ingresá un porcentaje mayor a 0 y hasta 100, por ejemplo 10 o 12,5.** | Corregí el umbral. |
| **Otra persona cambió el umbral mientras lo editabas.** | Cerrá el cuadro y volvé a abrirlo. |
| **Tu rol no puede cambiar el umbral de margen bajo.** | Solo lo cambia el Administrador. |
| **Tu rol no puede editar los costos adicionales de esta empresa.** | Solo el Administrador los carga, edita y da de baja. |
| **Ya hay un costo con ese nombre en esa empresa.** | Elegí otro nombre o editá el costo existente. |
| **Ingresá un nombre para el costo.** | Completá el campo **Nombre**. |
| **El porcentaje debe estar entre 0 y 100.** | Corregí el valor del costo de tipo porcentaje. |
| **No podés cargar costos para esa empresa.** | Elegí una empresa a la que tengas acceso. |
| **No tenés acceso a esta sección** | Tu rol no incluye Rentabilidad. Usá **Solicitar acceso** o pedile acceso al Administrador. |

![Pantalla Rentabilidad con el aviso No pudimos cargar esta información y la tarjeta Cómo se calcula](img/rentabilidad/01-resumen.png)

*Si el tablero todavía no está disponible para tu organización, ves este aviso; la tarjeta «Cómo se calcula» se muestra igual.*

Por ahora no se incluyen las publicaciones de Mercado Libre.
