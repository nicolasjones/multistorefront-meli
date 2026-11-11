---
owner: producto
sources: []
---

# Mensajería propia: registrar los envíos en moto y su rendición

## Para qué sirve

Cuando las entregas las hace la propia empresa con una moto, el pedido sale con un mensajero que además lleva
la plata de los pagos en efectivo. Esta pantalla registra cada salida (quién lleva el pedido, cuánto cuesta el
envío y cuánto abona el cliente al recibir) y después permite cerrar la cuenta de ese mensajero cuando te rinde
el efectivo.

Sirve para dos cosas:

- **Dejar asentado cada envío en moto:** el mensajero, la guía, el costo del envío y lo que el cliente paga en
  efectivo al recibir.
- **Saber cuánto falta por rendir y cerrarlo:** la tarjeta de arriba muestra el efectivo que está «en la calle» y
  podés rendir las entregas de a una o de a varias.

## Quién puede hacerlo

| Acción | Quién |
|---|---|
| **Registrar un envío**, editarlo o marcarlo como enviado | Operador y Administrador. |
| **Rendir** una entrega o un lote de entregas | Solo Administrador. |
| **Ver** la lista de envíos y la tarjeta | Todos los que tienen acceso a Ventas. Con el rol Consulta solo se mira. |

Si tu rol no puede escribir, no ves el botón **Registrar envío**, ni **Editar** en las filas, ni podés usar las
llaves para rendir. La pantalla avisa si intentás algo que tu rol no puede hacer.

## Dónde lo encontrás

- **Ventas → Transportes** (la pantalla se titula *Transportes y contrarreembolsos*), en la pestaña **Motos**.
- Arriba está el filtro **Tienda**: por defecto se ven todas las tiendas; si en la barra superior elegiste una
  empresa activa, se filtra por esa tienda.

## La tarjeta «Motos sin rendir»

Arriba de todo está la tarjeta **Motos sin rendir**: el monto del efectivo que te deben los mensajeros (la suma de
lo que abona al recibir de las entregas que todavía no se rindieron) y cuántas entregas son. Se recalcula cada vez
que registrás, editás o rendís un envío. Las entregas que no cobraron nada en efectivo no suman.

## Registrar un envío

1. Entrá a **Ventas → Transportes** y abrí la pestaña **Motos**.
2. Hacé clic en **Registrar envío**.
3. En **Comprobante** elegí la factura. El buscador ofrece solo las facturas que van por mensajería propia y que
   todavía no tienen envío registrado; buscá por número o por cliente. Si no hay ninguna, dice «No hay facturas con
   envío en moto sin registrar».
4. Escribí el **Mensajero** (obligatorio). Los espacios de más se acomodan solos y el nombre se agrupa sin
   distinguir mayúsculas.
5. La **Guía** es opcional.
6. En **Costo de envío** poné lo que te cuesta ese envío (0 si no hay costo) y en **Abona al recibir** lo que el
   cliente te paga en efectivo cuando recibe el pedido (0 si no paga nada). Los dos importes van de 0 en adelante,
   con hasta dos decimales.
7. Si el pedido ya salió, activá **Enviado**.
8. Hacé clic en **Registrar envío**. Aparece el aviso **«Envío registrado»** y la tabla se recarga con la fila
   nueva.

## Editar un envío

1. Hacé clic en **Editar** en la fila.
2. Se abre la misma ventana con los datos cargados: podés cambiar el mensajero, la guía, el costo, lo que abona al
   recibir y si está enviado.
3. Hacé clic en **Guardar cambios**. Aparece el aviso **«Envío actualizado»**.

Un envío que ya está rendido no se puede modificar: el botón **Editar** queda deshabilitado y el aviso es «El
envío ya está rendido: es de solo lectura y no se puede modificar».

## Marcar el envío como enviado

Se hace al registrarlo (el interruptor **Enviado**) o después, entrando a **Editar**. Solo se pueden rendir las
entregas que ya están marcadas como enviadas; por eso conviene marcar el envío en el momento en que el pedido sale.

## Rendir una entrega

1. Buscá la fila en la tabla.
2. Activá la llave de la columna **Rendido**.
3. Aparece el aviso **«Entrega rendida»** con cuántas entregas se rindieron y el total. La llave queda encendida.

Una entrega rendida **no se puede volver atrás**: no hay forma de revertir la rendición. Si te equivocaste,
corregí los datos antes de rendir.

## Rendir varias entregas juntas

1. Marcá la casilla de cada entrega que ya esté enviada y todavía no rendida. Con la casilla del encabezado
   («Seleccionar todos») marcás todas las de la pantalla.
2. Hacé clic en **Rendir seleccionados** (el botón dice cuántas elegiste).
3. Se abre la ventana **Rendir entregas** con los totales:

   | Dato | Qué es |
   |---|---|
   | **Mensajero** | A quién se le rinde. |
   | **Entregas** | Cuántas entregas entran en la rendición. |
   | **Efectivo cobrado** | La suma de lo que abona al recibir. |
   | **Costo de envíos** | La suma de los costos de envío. |
   | **Total a rendir** | El efectivo cobrado: lo que te tiene que entregar el mensajero. |
   | **Neto** | Efectivo cobrado menos costo de envíos. Es un dato informativo. |

4. Hacé clic en **Confirmar rendición**. Aparece el aviso **«Entrega rendida»** con la cantidad y el total, y las
   filas quedan con la llave encendida.

Dos cosas para tener en cuenta:

- **El total a rendir es el efectivo cobrado.** El costo de los envíos y el neto se muestran aparte, pero no se le
  resta nada al total.
- **Una rendición es de un solo mensajero.** Si la selección mezcla mensajeros, la ventana avisa «La selección
  mezcla mensajeros…» y el botón de confirmar queda bloqueado. Rendí de a un mensajero por vez.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| «Elegí la factura del envío.» | No elegiste un comprobante. Buscá la factura en el selector. |
| «Escribí el nombre del mensajero.» | El mensajero es obligatorio: no puede quedar vacío ni ser solo espacios. |
| «El costo de envío debe ser un importe de 0 en adelante, con hasta dos decimales.» | Corregí el importe (por ejemplo, 3500 o 3500,50). |
| «Lo que abona al recibir debe ser un importe de 0 en adelante, con hasta dos decimales.» | Corregí el importe. |
| «Ese comprobante ya tiene un envío en moto registrado.» | Una factura admite un solo envío en moto. Editalo en lugar de registrar otro. |
| «La forma de envío de la factura no es «moto».» | Esa factura no va por mensajería propia: no admite un envío en moto. |
| «Solo las facturas admiten un envío en moto.» | Un presupuesto no admite un envío en moto: hay que registrarlo sobre una factura. |
| «El envío ya está rendido: es de solo lectura y no se puede modificar.» | Una entrega rendida no se edita más. |
| «Otra persona modificó este envío mientras lo editabas. Recargá para ver el estado actual.» | Alguien cambió la misma fila: recargá la lista y volvé a editar. |
| «Solo el Administrador puede rendir entregas.» | Rindir es del Administrador. |
| «La selección mezcla mensajeros: rendí un mensajero por vez, no se rindió ninguno.» | Dejá solo las entregas de un mismo mensajero. |
| «Solo se rinden los envíos ya enviados: hay N sin marcar como enviado, no se rindió ninguno.» | Marcá como enviados las entregas que faltaban. |
| «Esas entregas ya estaban rendidas.» | Ya se habían rendido antes: no pasó nada. |
| «Cambió la empresa activa: cerramos el diálogo y descartamos la selección para no mezclar datos de dos tiendas.» | Cambiaste la tienda con la ventana abierta: volvé a abrirla. |

<!-- TODO (dueño: documentación de producto): capturas de la pestaña «Motos» (la tarjeta «Motos sin rendir», la tabla con la columna Rendido, la ventana «Registrar envío en moto» y la ventana «Rendir entregas») en docs/producto/img/ventas-motos/. No se pudieron generar con `pnpm docs:capturas` porque esa herramienta no existe en este repo y el código de la épica todavía no está en `main`; ver la página técnica. La captura `img/ventas-transportes/01-transportes.png` es anterior a la pestaña Motos y hay que regenerarla. -->
