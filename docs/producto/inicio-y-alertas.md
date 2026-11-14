---
owner: producto
sources: []
---

# Inicio: el tablero, las alertas y la búsqueda de productos

## Para qué sirve

Inicio es la primera pantalla que ves al entrar. En pocos segundos te muestra lo que tu rol puede resolver hoy: el estado de tus empresas, el stock, las consultas nuevas y el dólar, junto con una lista de alertas que te llevan directo a la pantalla donde se arreglan. Debajo, un **tablero** con las ventas y el stock del período que elegiste, un resumen de cómo rinde cada tienda, de qué depósito salió la mercadería, los últimos movimientos que hizo el equipo y un listado de movimientos por producto. Además, desde cualquier pantalla podés buscar un producto con el campo de búsqueda de la barra superior.

Cada persona ve solamente lo que su rol permite: si no tenés acceso a una sección (por ejemplo, Consultas), su tarjeta, sus alertas y sus resultados de búsqueda no aparecen.

## La pantalla de Inicio

Se abre con el ítem **Inicio** del menú. Arriba ves un saludo con tu nombre («Buen día, …») y la fecha. Debajo aparecen, según tu rol:

| Qué ves | Qué muestra | Quién lo ve |
|---|---|---|
| **Accesos directos** | Botones **Nuevo comprobante**, **Registrar movimiento** y **Nuevo producto**. | Solo quien puede editar la sección correspondiente (Ventas, Stock, Productos). Con permiso de solo lectura no aparecen. |
| **Tus empresas** | Las empresas a las que tenés acceso, con la empresa activa marcada. Un enlace **Ver empresas** te lleva a la pantalla de empresas. | Todos. Si todavía no tenés empresas asignadas, lo dice. |
| **Stock hoy** | Cuántos productos están sin stock y cuántos bajo el mínimo. El enlace **Ver stock** abre Stock. | Quien puede ver Stock. |
| **Consultas nuevas** | Cuántas consultas nuevas hay sin atender en la empresa activa. El enlace **Abrir consultas** abre la bandeja. | Quien puede ver Consultas. |
| **Dólar** | La cotización vigente. Si hoy todavía no se cargó, avisa «Todavía no se cargó el dólar de hoy» y, si podés editar la cotización, ofrece **Cargar ahora**. | Quien puede ver la cotización del dólar. |
| **Qué hacer hoy** | La lista de alertas (ver más abajo). | Ver abajo. |
| **El tablero** | Ventas y stock del período, gráfico, resumen por tienda, salidas por depósito, actividad reciente y el listado de movimientos por producto. | Quien puede ver Ventas, Stock o Actividad. |

Cosas para tener en cuenta:

- **Cada tarjeta carga por su cuenta.** Si una falla, esa tarjeta muestra «No pudimos cargar este dato» y el resto sigue funcionando.
- Si tu rol todavía no tiene ninguna sección habilitada, Inicio te lo avisa: «Tu rol todavía no tiene secciones habilitadas».
- «Registrar movimiento» te lleva a Stock, donde está el botón **Nuevo movimiento**.
- Las tarjetas y alertas de Mercado Libre y de precios en revisión **todavía no existen**: se van a mostrar cuando esas funciones estén activas en tu organización.

## El tablero de ventas y stock

El tablero aparece debajo de las alertas. Es un resumen del negocio que podés filtrar por período, tienda y depósito, sin entrar a Reportes.

Solo se muestra si tu rol tiene al menos una de estas secciones: **Ventas**, **Stock** o **Actividad**. Cada bloque se muestra por separado: si no tenés Ventas no ves las cifras de ventas, si no tenés Stock no ves el stock ni el listado de movimientos, y si solo tenés Actividad ves únicamente la actividad reciente.

### Los filtros

Arriba del tablero hay tres filtros. Todos se aplican a la vez a todo lo que está debajo.

| Filtro | Opciones | Qué acota |
|---|---|---|
| **Período** | **Hoy**, **7 días**, **Este mes** o **Rango** | Las ventas, los movimientos y la actividad del período. Arranca en **Este mes**. |
| **Tienda** | **Todas las tiendas** o el nombre de una tienda | Las **ventas** y las **devoluciones**. El stock es de toda la organización. |
| **Depósito** | **Todos los depósitos** o el nombre de uno | El stock, las salidas y los movimientos. Además, con un depósito elegido, las ventas se miden con las líneas de ese depósito. |

Cosas a tener en cuenta:

- El filtro **Tienda** arranca en la empresa que tenés elegida arriba en la barra superior. Si elegís **Todas las tiendas**, ves la suma de todas. **Este filtro no cambia la empresa activa**: es solo un filtro del tablero. Si en cambio cambiás la empresa activa desde la barra superior, el tablero vuelve a seguirla (y descarta la tienda que habías elegido en el filtro).
- Los filtros quedan en la dirección de la página: podés copiar el enlace y mandarlo a otra persona que ve lo mismo que vos.
- Si elegís **Rango**, aparecen dos campos, **Desde** y **Hasta**. Si la fecha de fin es anterior a la de inicio, el campo te avisa y el tablero sigue con el último período válido. Un período no puede superar **366 días**.
- Si elegís un depósito que ya no existe en tu organización, el filtro vuelve a **Todos los depósitos**.

### Ventas del período

Es una tarjeta con cinco números. Todos hablan del período y de la tienda que elegiste.

| Indicador | Qué muestra |
|---|---|
| **Ventas (con IVA)** | Cuánto se vendió en el período, con el IVA incluido. |
| **Comprobantes** | Cuántas facturas se emitieron. Las notas de crédito no cuentan como comprobante. |
| **Ticket promedio (con IVA)** | Cuánto se gastó en promedio por factura. |
| **Unidades vendidas** | Cuántas unidades se vendieron, ya descontadas las devoluciones. |
| **Devoluciones (con IVA)** | Cuánto se devolvió y cuántas unidades. |

Debajo de cada número, cuando hay un período anterior comparable, ves cuánto cambió: «+12,4 % vs período anterior» y si subió o bajó. Si no hay período anterior con el que comparar, dice «Sin período anterior para comparar».

Las notas de crédito **restan** de las ventas, y los presupuestos y comprobantes anulados no cuentan. Si en el período no hubo nada, la tarjeta avisa «No hay ventas en este período».

Si elegís un depósito, las ventas se calculan con las **líneas de ese depósito**: por eso una nota de crédito sin líneas (de importe o de descuento) no se descuenta y el número de devoluciones puede quedar en cero.

Si tu rol puede ver **Reportes de ventas**, estos números tienen enlace: te llevan a esa pantalla con el período ya elegido.

### Stock hoy

Es una tarjeta con seis números. El stock **no depende del período**: es el stock de ahora.

| Indicador | Qué muestra |
|---|---|
| **Stock actual** | Cuántas unidades hay en stock. |
| **Reservado** | Cuántas unidades están reservadas para pedidos en curso. |
| **Disponible para vender** | El stock menos lo reservado. |
| **Sin stock** | Cuántos productos se quedan sin unidades para vender. |
| **Stock bajo** | Cuántos productos están por debajo de su mínimo. |
| **Ajustes de stock** | Cuántos movimientos de ajuste hubo en el período, y cuántas unidades entraron. |

Cuando elegís un depósito, estos números son los de ese depósito. Los indicadores **Sin stock** y **Stock bajo** tienen enlace: te llevan a Stock con el filtro puesto.

Dos detalles para no compararlos mal con otras pantallas:

- El tablero cuenta **solo los productos activos** y, si elegiste un depósito, compara el disponible de ese depósito contra el mínimo general del producto. El listado de Stock, en cambio, usa el estado global de cada producto: por eso los dos números pueden no coincidir.
- El número de **Ajustes de stock** cuenta los **movimientos** de ajuste del período (no las unidades). El detalle de **Entradas en el período** suma las unidades que entraron, pero deja afuera los traslados, las devoluciones de cliente y las anulaciones de factura.

### El gráfico «Ventas y stock en el tiempo»

Debajo de las dos tarjetas hay un gráfico con dos series: las **unidades vendidas** por día (barras) y el **stock al cierre de cada día** (línea). Si tu rol solo puede ver Stock, solo aparece la línea de stock.

- Podés pasar el mouse por el gráfico para ver el detalle de cada día.
- Si no podés usar el gráfico, abrí **Ver los datos como tabla**: está la misma información en una tabla con el **Día**, las **Unidades vendidas** y el **Stock al cierre**.
- Si en el período no hubo ventas ni movimientos de stock, el gráfico dice «Sin datos en el período».

### Resumen por tienda

Una fila por tienda con la cantidad de **unidades vendidas** en el período y una barra que compara una tienda con otra.

- Si tu rol tiene permiso de ver la **rentabilidad**, cada fila además muestra los **Ingresos (con IVA)** y el **Margen estimado**.
- El margen es una **estimación**: se calcula con el costo que quedó guardado en cada línea al confirmar el comprobante. Si a una venta no se le cargó el costo, esa venta queda afuera del cálculo y la fila dice «Margen estimado: sin costo cargado».
- Si tenés ese permiso y una tienda no tuvo ventas en el período, su fila dice «Sin ventas en el período».
- Las tiendas que ves son las que tenés habilitadas: no hay una lista fija.

### Salidas por depósito

Una fila por depósito con las **unidades que salieron** en el período y el **stock actual** de ese depósito. Si elegiste un depósito en el filtro, aparece solo ese.

### Actividad reciente

Los últimos diez movimientos del equipo en el período y en la tienda elegida: qué se hizo, cuándo, quién lo hizo y en qué tienda. Cada fila tiene un botón **Ver** y al final está **Ver todo**, que lleva a la pantalla de Actividad.

- Si elegiste un depósito, la tarjeta te avisa: «La actividad no se filtra por depósito: se muestra la de toda la organización».
- Si en el período no pasó nada, dice «Sin actividad en este período».

### Movimientos por producto

Al pie del tablero hay un listado con **una fila por producto** y doce columnas. Solo lo ves si tenés permiso de Stock.

| Columna | Qué muestra |
|---|---|
| **Producto** | El nombre. Si hacés clic, se abre la edición del producto. |
| **SKU** | El código del producto. |
| **Categoría** | A qué categoría pertenece. |
| **Stock inicial** | Cuánto había al empezar el período. |
| **Entradas** | Cuánto entró en el período. |
| **Salidas** | Cuánto salió en el período. |
| **Ajustes** | Los ajustes, en más o en menos. |
| **Stock actual** | Cuánto hay ahora. |
| **Mínimo** | El mínimo que se le puso al producto. |
| **Ventas** | Las unidades vendidas. Solo aparece si tenés permiso de Ventas. |
| **Último movimiento** | La fecha del último movimiento. |
| **Estado** | **En alerta**, **Quieto** o **Normal**. |

Sobre el listado podés:

- Cambiar la **vista rápida**: **Todos**, **En alerta** (los que están en su mínimo o debajo) o **Quietos** (los que no se movieron en el período).
- **Buscar producto o SKU** por nombre o por código.
- Filtrar por **Categoría**.
- Elegir **Ordenar por** y la dirección (**↑ Ascendente** / **↓ Descendente**). También podés ordenar haciendo clic en el encabezado de una columna.
- **Exportar** a un archivo CSV con lo mismo que estás viendo. El botón solo lo ves si tu rol puede exportar Stock.

Detalles a tener en cuenta:

- El listado se va **cargando de a poco** a medida que bajás: abajo aparece **Cargar más** y, arriba, «Mostrando N de M productos».
- Las **entradas, salidas y ajustes** de esta lista cuentan **todos** los movimientos del período (incluidos traslados, devoluciones y anulaciones). Por eso la lista cuadra: stock inicial + entradas − salidas + ajustes = stock actual. En cambio, el número de **entradas** del bloque «Stock hoy» excluye esos movimientos: los dos números pueden diferir.
- La vista **Quietos** quiere decir «sin movimientos en el período»: por eso puede incluir productos que estén en alerta.
- Si elegiste una tienda en el filtro, el listado muestra **solo los productos de esa tienda** y las ventas de esa tienda.
- Si el producto no se movió, el estado es **Quieto**; si está en su mínimo o por debajo, es **En alerta** (tiene prioridad); el resto es **Normal**.
- Si no hay nada para mostrar, dice «Sin movimientos para estos filtros» y tenés el botón **Limpiar filtros**. Si la carga falla, «No pudimos cargar los movimientos por producto.» con **Reintentar**.

## Cargar el dólar del día desde Inicio

En la tarjeta **Dólar** de Inicio, si todavía no se cargó la cotización de hoy, aparece el aviso «Todavía no se cargó el dólar de hoy» con el botón **Cargar ahora**. Ese botón solo lo ven quienes pueden **cargar** la cotización (con los permisos de fábrica, el Administrador y Administración).

1. Hacé clic en **Cargar ahora**. Se abre el cuadro **Cargar dólar del día**.
2. Escribí el valor en **Dólar del día (pesos por dólar)**. Serven los formatos «1490», «1490,50» o «1.490,5». Debajo ves el **Anterior** (el valor con el que se calculan hoy los precios) y la **Variación** contra ese valor.
3. Mientras escribís, el cuadro te muestra **qué va a cambiar**: una tarjeta por tienda con cuántos precios se modifican y una tabla de muestra con el precio de hoy y el nuevo. **Todavía no se guardó nada**: esto es solo una vista previa.
4. Si la variación **supera el 15 %** (o el valor que tenga configurado tu organización), aparece el aviso **Variación inusual** y tenés que tildar «Revisé el valor y quiero aplicarlo igual» para poder seguir.
5. Si la variación es **menor que el umbral configurado** (1 % de arranque), el sistema no recalcula precios: avisa **Sin recálculo** y el botón se llama **Registrar cotización**. El valor queda anotado en el historial, pero los precios siguen igual.
6. Hacé clic en **Aplicar y recalcular** (o **Registrar cotización**). Se guarda la cotización con la fecha y tu nombre, y el aviso te dice «Cotización aplicada · N precios recalculados».
7. Si te arrepentís o cerrás el cuadro, no se guarda nada: cancelá.

Cosas a tener en cuenta:

- Si la cotización es **una por empresa**, la carga es de la empresa que tengas elegida arriba. Con **Todas mis empresas** en la barra superior, el botón queda deshabilitado hasta que elijas una.
- Si el valor que escribís se aleja **más de 10 veces** del valor vigente, el sistema no te pide la vista previa y no te deja aplicar: casi siempre es un error de tipeo. Revisá el número.
- Un valor negativo, cero o vacío no se acepta: el campo te avisa y no se guarda nada.
- Si **otra persona cambia el dólar** mientras vos revisás, el sistema lo detecta: te recalcula la vista previa y desmarca la casilla de confirmación, así que hay que revisar de nuevo.
- Cuando el dólar de hoy **ya está cargado**, la tarjeta ofrece **Corregir cotización**: el mismo cuadro, que avisa «Ya se cargó hoy: esto reemplaza la cotización».
- La carga desde Inicio **reemplaza** una cotización que alguien había dejado a medio cargar en la pantalla de Cotización del dólar.

El detalle de la pantalla de Cotización del dólar está en [Cargar la cotización del dólar](precios-dolar.md).

### Empresa activa

El stock y el dólar son de toda la organización, así que no cambian al elegir otra empresa. Las consultas nuevas sí se acotan a la **empresa activa** de la barra superior. El tablero, en cambio, tiene su propio filtro de **Tienda**: arranca en la empresa activa y el filtro no la modifica.

Cuando cambiás de empresa en la barra superior, Inicio vuelve a cargar todas sus tarjetas, alertas y bloques, y no queda ningún dato de la empresa anterior. Con **Todas mis empresas** ves lo de todas las empresas a las que accedés.

## Alertas: «Qué hacer hoy»

La tarjeta **Qué hacer hoy** ocupa todo el ancho de Inicio y lista lo que está pendiente. Cada alerta tiene un enlace que te lleva a la pantalla donde se resuelve.

| Alerta | Cuándo aparece | A dónde te lleva |
|---|---|---|
| Productos sin stock | Hay productos activos sin stock disponible. | Stock |
| Stock bajo | Hay productos activos por debajo del mínimo. | Stock |
| Consultas sin atender | Hay consultas nuevas que nadie tomó. | Consultas |
| Dólar sin cargar | Hoy todavía no se confirmó la cotización del dólar. | Cotización del dólar |
| Margen negativo | Hay productos que se venden con margen negativo. Aparece solo si Rentabilidad está disponible en tu sistema. | Rentabilidad |

- **Solo ves las alertas de secciones que tu rol puede ver.** Y, si trabajás con una empresa, las de esa empresa más las de toda la organización.
- Las alertas **no se actualizan al instante**: el sistema las recalcula cada 15 minutos. Si pasó más de una hora desde el último cálculo, te lo avisa: «Las alertas se calcularon por última vez a las HH:MM y pueden estar desactualizadas». Si nunca se calcularon, dice «Todavía no se calcularon las alertas».
- Cuando no hay nada pendiente ves **Sin alertas** y el mensaje «No hay nada pendiente por resolver».
- Si falla la carga, aparece «No pudimos cargar este dato» con el botón **Reintentar**.

## Búsqueda global de productos

El campo de búsqueda está en la barra superior y se ve en todas las pantallas del panel.

1. Hacé clic en el campo y escribí **al menos 2 letras** del nombre o del código (SKU) del producto. No importa si usás mayúsculas o tildes, y el nombre tolera errores leves de tipeo.
2. Esperá un instante: la lista de resultados aparece sola, con unos pocos productos (hasta 8).
3. Elegí un resultado con el mouse, o con las flechas y **Enter** desde el teclado. Se abre la pantalla de edición de ese producto. **Escape** cierra la lista.
4. Si no hay coincidencias, ves «No encontramos productos». Si falla la búsqueda, ves el aviso de error con **Reintentar** y lo que escribiste se mantiene.

Límites:

- Busca **solo productos**. Clientes y comprobantes no se buscan desde acá.
- Solo encontrás productos si tu rol puede ver la sección Productos; si no, la búsqueda no devuelve nada.
- Los productos son del catálogo de la organización, por eso la búsqueda **no depende de la empresa activa**.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **No pudimos cargar este dato** (con **Reintentar**) | Falló la carga del tablero. Hacé clic en **Reintentar**. |
| **No hay datos para mostrar** | No tenés Ventas ni Stock habilitados para la tienda o el depósito que elegiste. Probá con otra tienda. |
| **No tenés ventas habilitadas en esta tienda** | Tu rol no tiene Ventas en esa tienda. Pedile a quien administra tu cuenta que te la habilite, o elegí otra. |
| **No tenés Stock habilitado** | Tu rol no tiene Stock. Pedile a quien administra tu cuenta que te lo habilite. |
| **Sin datos en el período** | En ese período no hubo ventas ni movimientos de stock. |
| **Sin movimientos para estos filtros** | No hay productos que coincidan. Probá con otra búsqueda o usá **Limpiar filtros**. |
| **No pudimos cargar los movimientos por producto.** | Falló la carga del listado. Reintentá con **Reintentar**. |
| **La actividad no se filtra por depósito** | Es un aviso: con un depósito elegido, la actividad es de toda la organización. |
| **El valor se aleja más de 10 veces de la cotización vigente. Revisalo: puede ser un error de tipeo.** | Escribí el valor de nuevo. Mientras esté así, no se puede aplicar. |
| **Ingresá un valor válido, por ejemplo 1490 o 1490,50.** | El campo está vacío, es cero o es negativo. Corregilo. |
| **El dólar cambió mientras revisabas: revisá de nuevo.** | Otra persona cambió la cotización: volvé a mirar la vista previa y a confirmar. |
| **Cambiaste de empresa: el diálogo de carga se cerró sin guardar.** | Se cerró el cuadro de carga del dólar porque cambiaste la empresa activa. Volvé a abrirlo. |
| **No pudimos abrir la carga del dólar. Recargá la página e intentá de nuevo.** | El cuadro no se pudo abrir (por ejemplo, se cortó la conexión). Recargá la página. |
| **No pudimos calcular qué va a cambiar.** | Falló la vista previa del impacto. Usá **Reintentar**. |

## Todavía no se puede

- Ver tarjetas o alertas de Mercado Libre ni de precios en revisión.
- Filtrar el tablero por un período de 30 o 90 días, o por el mes anterior: los períodos son Hoy, 7 días, Este mes y un rango libre.
- Filtrar Reportes de ventas por tienda o por depósito desde el tablero: el enlace a Reportes lleva solo el período.
- Ver el costo o el margen de un producto en el listado de movimientos por producto.
- Personalizar qué bloques del tablero se ven o cómo se ordenan.
- Ver las ventas de Mercado Libre.

Ver también: [Stock](stock-movimientos.md) · [Consultas](consultas.md) · [Cotización del dólar](precios-dolar.md) · [Rentabilidad](rentabilidad.md) · [Tu organización y tus empresas](organizacion-y-empresas.md) · [Reportes de ventas](ventas-reportes.md).

<!-- TODO (dueño: documentación de producto): capturas de la pantalla de Inicio con el tablero — los tres filtros, «Ventas del período», «Stock hoy», el gráfico, «Resumen por tienda», «Salidas por depósito», «Actividad reciente», el listado «Movimientos por producto» y el cuadro «Cargar dólar del día» con su vista previa — en docs/producto/img/inicio-y-alertas/. No se pudieron generar porque la herramienta de capturas del manual (`pnpm docs:capturas` y `pnpm demo:dataset`) no existe en este repo y el código de la épica todavía no está en `main`; ver la página técnica. -->
