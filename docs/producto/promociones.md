---
owner: producto
sources: []
---

# Promociones de precio por empresa

## Para qué sirve

Una promoción es un **precio especial para un producto, en una tienda y por un período de tiempo**. La programás una vez con su fecha de inicio y de fin, y el sistema se encarga solo: cuando llega la fecha de inicio la tienda muestra el precio promocional con el precio anterior tachado, y cuando llega la de fin vuelve al precio de siempre, sin que tengas que hacer nada.

Cada promoción es de **una sola tienda**: la tienda de San Javucho no ve las promociones de Mundo JC ni al revés.

El precio promocional es un **número fijo en pesos**, cargado **sin IVA**. No se mueve con el dólar ni con una actualización masiva de precios.

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Programar, editar y anular promociones | Administrador y Operador |
| Ver la lista de promociones | Todos los demás roles, en solo lectura |
| Entrar a la pantalla | Todos los roles la ven |

Sin permiso de edición, la lista se ve pero no aparecen el botón **Nueva promoción** ni los botones **Editar** y **Anular**.

El Administrador puede ajustar esto en [Usuarios y roles](usuarios-y-roles.md).

## Dónde lo encontrás

En el menú de la izquierda: **Catálogo → Promociones**.

## La lista de promociones

Cada fila muestra:

| Columna | Qué es |
|---|---|
| **Producto** | El nombre del producto y su SKU. |
| **Empresa** | Solo aparece cuando arriba tenés «Todas mis empresas» elegida. |
| **Precio normal** | El precio de siempre de ese producto en esa tienda, tal como lo ve el cliente. |
| **Precio promocional** | El precio especial que cargaste. |
| **Desde** / **Hasta** | El período en el que rige. |
| **Estado** | Programada, Vigente, Vencida o Anulada (ver abajo). |

Con permiso de edición, las promociones **Programada** y **Vigente** tienen los botones **Editar** y **Anular** en la fila.

## Programar una promoción

1. Elegí **la empresa** en la barra superior. Con «Todas mis empresas» el botón **Nueva promoción** queda deshabilitado y la pantalla te pide que elijas una: una promoción siempre es de una sola tienda.
2. Hacé clic en **Nueva promoción**.
3. En **Empresa** se ve la tienda elegida (no se puede cambiar desde el formulario).
4. Buscá el **Producto**. Solo se ofrecen los productos activos.
5. Escribí el **Precio promocional (sin IVA)**: tiene que ser mayor a 0.
6. Elegí **Desde** (cuándo empieza a regir) y **Hasta** (cuándo termina).
7. Hacé clic en **Guardar**.

La fecha de fin **no se incluye**: la promoción rige desde la fecha de inicio hasta ese momento, sin incluirlo. Dos promociones del mismo producto en la misma tienda **no pueden superponerse** en el tiempo; sí se puede encadenar: una promoción termina y la siguiente empieza justo en ese momento.

Si el sistema rechaza el guardado, el formulario queda abierto y te muestra el motivo.

## Los estados de una promoción

| Estado | Qué significa |
|---|---|
| **Programada** | Todavía no empezó: la fecha de inicio está en el futuro. |
| **Vigente** | Está en curso: la tienda ya muestra el precio promocional. |
| **Vencida** | Ya terminó: la fecha de fin pasó. La tienda volvió al precio normal. |
| **Anulada** | La cortaste vos antes de tiempo. |

El estado **no se guarda**: se calcula con la fecha del día. Por eso una promoción **vence sola**, sin que nadie la cierre ni haya que correr nada.

## Editar y anular

- **Editar**: abrí el formulario de una promoción Programada o Vigente y cambiá el precio o las fechas. **El producto y la empresa no se pueden cambiar**: si te equivocaste de producto o de tienda, anulá esa promoción y creá otra.
- **Anular**: corta la promoción de inmediato y **no se puede revertir** (no hay forma de «reactivarla»). Para volver a ofrecer ese precio, creá una promoción nueva.

Una promoción **vencida** no se puede editar ni anular: ya terminó sola.

## Lo que ve el cliente en la tienda

Mientras la promoción está **Vigente**, la tienda muestra:

- el **precio promocional** como el precio del producto;
- el **precio anterior**, tachado, al lado.

El tachado aparece **solo cuando el precio anterior es mayor** que el promocional: si la promoción no baja el precio, el cliente ve un solo precio, sin cambios.

Si la tienda muestra los precios **con IVA**, el precio promocional y el tachado también se ven con IVA: la tienda le suma el IVA igual que a cualquier otro precio.

El cliente ve la promoción **solo en la tienda online**. El carrito, las facturas, la venta de mostrador y Mercado Libre **no cobran** el precio promocional: siguen con el precio de siempre.

## Cambiar de empresa mientras estás en la pantalla

Si cambiás la empresa de la barra superior, la pantalla se recarga entera con las promociones de la nueva empresa y **no queda nada de la anterior**. Si tenías el formulario de una promoción abierto, se cierra y te aparece un aviso: «Cambiaste de empresa: cerramos el formulario para no mezclar datos de la anterior.».

## Casos comunes

- **Quiero una promoción solo este fin de semana.** Cargá **Desde** el viernes a la mañana y **Hasta** el lunes a la madrugada: el lunes a la madrugada ya no rige.
- **Me equivoqué en el precio.** Mientras esté Programada o Vigente, usá **Editar** y corregilo.
- **Me equivoqué de producto.** Anulá la promoción y creá otra con el producto correcto.
- **Quiero dos promociones del mismo producto en la misma tienda.** Se pueden hacer si **no se superponen** en el tiempo: una termina y la otra arranca en ese momento.
- **La promoción no aparece en la tienda.** Fijate que esté **Vigente** (no Programada) y que la fecha de inicio ya haya pasado.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **Elegí una empresa en la barra superior** | Estás en «Todas mis empresas». Elegí una tienda concreta arriba para poder crear una promoción. |
| **Tu rol no puede editar promociones.** | Pedile al Administrador que lo haga o que te dé permiso de edición en Productos. |
| **Ya hay otra promoción de este producto en esta empresa que se solapa con esas fechas. Cambiá las fechas o anulá la otra.** | Ya hay una promoción de ese producto en esa tienda para esas fechas. |
| **Otra persona modificó esta promoción. Recargá la lista y probá de nuevo.** | Alguien la cambió mientras la estabas editando. Recargá la lista. |
| **La promoción ya venció: la fecha de fin tiene que ser futura.** | No se puede crear ni guardar una promoción que ya terminó. |
| **La promoción ya venció y no se puede editar** | Pasó la fecha de fin. Creá una nueva. |
| **No se puede cambiar la empresa ni el producto de una promoción: anulala y creá otra** | Anulá la promoción y hacé una nueva. |
| **La empresa, el producto o la promoción ya no existe.** | Alguien la eliminó o cambió de empresa. Recargá la lista. |
| **El precio es demasiado grande.** | Revisá el importe. |
| **Ingresá un precio mayor a 0** | El precio está vacío, es cero o es negativo. |

<!-- TODO (dueño: documentación de producto): capturas de la pantalla «Promociones» (la lista con sus estados, el formulario de alta y el cuadro de anulación) y de una ficha de la tienda con el precio anterior tachado, en docs/producto/img/promociones/. No se pudieron generar porque la herramienta de capturas del manual (`pnpm docs:capturas` y `pnpm demo:dataset`) no existe en este repo y el código de la épica todavía no está en `main`; ver la página técnica. -->

Ver también: [Tiendas online](tiendas-online.md), [Precios, escalas e IVA](precios-e-iva.md), [Actualizar precios en bloque](precios-masivos.md) y [Usuarios y roles](usuarios-y-roles.md).
