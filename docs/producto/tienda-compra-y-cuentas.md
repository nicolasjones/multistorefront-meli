---
owner: producto
sources: []
---

# Pedidos y presupuesto desde la tienda

## Para qué sirve

Hoy, en las tiendas online **no se cobra nada**: el visitante mira el catálogo, consulta por WhatsApp o escribe
un mensaje, y esas consultas te llegan a [Consultas](consultas.md). Con esta funcionalidad, el visitante de la
tienda puede además:

- **armar una lista de pedido** con varios productos y cantidades y mandártela, **sin pagar**, como una
  consulta con los ítems;
- **pedir un presupuesto** desde esa misma lista: si tiene cuenta en la tienda, se crea un presupuesto a su
  nombre con el precio que le corresponde, y vos lo ves en **Ventas › Presupuestos**;
- **entrar a «Mi cuenta»** y ver sus compras y presupuestos de esa tienda, y guardar productos como
  favoritos.

La venta se sigue cerrando **fuera del sistema**: el pago, el envío y la factura se coordinan como hoy, por
correo o WhatsApp.

## Todavía no está disponible en tu ambiente

Esta función se entrega **apagada**: hoy no se activa sola en ningún ambiente. Recién cuando se habilite (por
tienda y por versión) el visitante va a ver los botones de **Mi lista**, **Mi cuenta** y **Pedir presupuesto**,
y vos vas a ver los pedidos y los presupuestos de la tienda en el panel. Mientras tanto:

- la tienda sigue funcionando exactamente como está, sin cambios;
- **no hay forma de cobrarle a un visitante desde la tienda**;
- la cuenta web del cliente sigue sirviendo **solo para ver los precios que le corresponden**
  (ver [La cuenta web de un cliente](cuenta-web-cliente.md)).

Cuando la función esté habilitada, esta guía te sirve para saber qué va a pasar y cómo atender lo que llega.

## Qué puede hacer el visitante

### Armar su lista de pedido

1. En la ficha de un producto, el visitante hace clic en **Agregar a la lista**. El botón está junto a
   **Consultar por WhatsApp**. Cada clic suma una unidad del mismo producto.
2. Debajo de los botones aparece **«Ya tenés N en tu lista · Ver lista»** (N son las unidades de ese producto), y en
   el encabezado de la tienda aparece **Mi lista (N)** con la cantidad de productos distintos.
3. Si el producto está **sin stock**, también se puede agregar: la línea dice **«Sin stock hoy: lo confirmamos
   al responder»**. Vos decidís la disponibilidad cuando le respondes.
4. La lista **queda en el navegador de esa persona**, no en el sistema: no se guarda en el servidor ni se
   comparte entre dispositivos, y solo guarda qué producto y qué cantidad (nunca precios). Si el navegador no
   deja guardarla, la lista dura mientras la página está abierta y la tienda lo avisa.

### Mandar el pedido

1. El visitante abre **Mi lista** y ve sus productos con la cantidad, el **precio de referencia** y el total.
2. Completa **Nombre** y **Correo o teléfono** (puede dejar una **Nota** de hasta 500 caracteres) y hace clic en
   **Enviar pedido**.
3. La tienda le responde **«Recibimos tu pedido. Te vamos a responder para confirmar disponibilidad y precio.
   No se cobró nada.»** y vacía la lista.
4. Si el visitante tiene **cuenta activa** en esa tienda, **no se le pide nombre ni contacto**: se usan los
   datos de su ficha y el pedido queda vinculado al cliente.

Los precios que se muestran son de **referencia**: se confirman cuando le respondés. El pedido **no reserva
stock** ni es una compra.

### Pedir un presupuesto

Solo si el visitante **tiene cuenta activa** en esa tienda:

1. En **Mi lista**, aparece el botón **Pedir presupuesto** (además de **Enviar pedido**).
2. Se abre la ventana **Tu presupuesto** con el precio que le corresponde a esa persona: su escala de precios
   por cantidad, su descuento y las promociones vigentes, con el IVA y el total. Lo que ve es lo que se crea.
3. Con **Confirmar presupuesto** se crea el presupuesto. La tienda le responde **«Pedimos tu presupuesto Nº
   N. Es un presupuesto, no una compra: no reserva stock ni se cobró nada. Te vamos a responder para
   coordinar.»**
4. El presupuesto queda **pendiente** en **Ventas › Presupuestos**, a nombre del cliente, y el cliente lo ve
   en **Mi cuenta**.

### Entrar a «Mi cuenta»

Con cuenta activa, el encabezado de la tienda muestra **Mi cuenta**. Ahí el cliente ve dos pestañas:

- **Compras y presupuestos**: todas sus compras y presupuestos **de esa tienda** (los de mostrador, por
  teléfono y los de la tienda online), con fecha, número, tipo, estado y total con IVA. Al tocar uno se abre el
  detalle con las líneas y los totales.
- **Favoritos**: los productos que guardó, con foto, disponibilidad y el precio que le corresponde. Desde ahí
  puede quitar un favorito o agregar el producto a su lista.

También puede guardar favoritos desde la ficha del producto, con el botón **Guardar en favoritos**.

Los datos que ve el cliente son los suyos: el estado que se muestra es un estado simple (**Pendiente**,
**Aceptado**, **Vencido**, **Anulado**, **Confirmada**, **Anulada** o **Nota de crédito**). No ve si algo está
cobrado o despachado, ni costos, márgenes, descuentos ni datos internos. Un comprobante de otro cliente se ve
igual que uno que no existe.

## Qué ves vos en el panel

### Los pedidos, en Consultas

- Cada pedido llega a la bandeja de **Consultas** con el origen **Pedido**. En la columna del producto figura
  **«Pedido de N productos»**.
- Al abrir la consulta, en lugar de un único producto de interés ves el bloque **Pedido**, con una tabla de
  **Producto · SKU · Cantidad · Precio de referencia · Subtotal** y el **Total de referencia**. La nota que
  escribió el visitante aparece como **Nota de la persona**.
- Si el visitante tenía cuenta, además aparece la fila **Cliente** con su número y su nombre.
- El botón **Responder por correo/WhatsApp** abre tu aplicación con un mensaje inicial que ya lista los ítems
  del pedido.
- La consulta se atiende como cualquier otra: le cambiás el estado, le asignás un responsable, le dejás una
  nota y, cuando la atendiste, la marcás como resuelta.

**Los datos del visitante no se borran solos.** Ni las consultas, ni los ítems del pedido, ni los presupuestos
que se crean desde la tienda: no hay una limpieza automática porque todavía no está definido un plazo de
conservación. Para quitar los datos personales de un pedido hay que anonimizar el contacto de la libreta (ver
[Consultas de las tiendas online](consultas.md#quitar-los-datos-personales-de-un-pedido)).

### Los presupuestos, en Ventas

- En **Ventas › Presupuestos** aparece el presupuesto pedido desde la tienda, con estado **Pendiente** y con
  la columna **Operador** que dice **«Tienda online (cliente)»** (en vez de «Usuario sin nombre»).
- En la ficha del comprobante, al lado del estado, aparece el rótulo **«Creado desde la tienda por el
  cliente»**, el Operador dice **«Tienda online (cliente)»** y aparece la **Nota del cliente** que escribió.
- Lo modificás, lo aceptás o lo copiás con los flujos de siempre. Un presupuesto **no se anula**: queda
  pendiente hasta que lo aceptes. Si querés cobrar, cargá una factura nueva con los mismos productos (podés
  usar **Copiar** para tener los datos a mano).
- En **Actividad** aparece el evento con **Quién: Tienda online** y el detalle «Presupuesto N pedido desde la
  tienda … por el cliente Nº … · …» (sin correo ni teléfono).

### La empresa activa

Los pedidos y los presupuestos se ven **en la empresa activa** (o en todas tus empresas, si elegís esa opción
en el selector de arriba). Si cambiás de empresa con un pedido abierto, la ventana se cierra y la lista se
vuelve a cargar.

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Ver y responder los pedidos de la tienda | Quienes tienen acceso a [Consultas](consultas.md) |
| Ver y atender los presupuestos de la tienda | Quienes tienen acceso a [Ventas › Presupuestos](ventas-comprobantes.md) |
| Crear la cuenta web para que un cliente pueda pedir presupuesto | Administrador, Operador, Mostrador y Administración (ver [La cuenta web de un cliente](cuenta-web-cliente.md)) |

## Lo que todavía no existe

- **No hay carrito que quede guardado** entre dispositivos: la lista es del navegador de cada visitante.
- **No hay pago en línea, ni medios de pago, ni cálculo de envíos, ni factura electrónica.** La venta se cierra
  fuera del sistema.
- **No se avisa al equipo por correo** cuando alguien pide un presupuesto: lo ves en Ventas y en Actividad.
- **No se puede anular un presupuesto** desde la pantalla.
- **No hay aviso al cliente** de que su pedido o presupuesto avanzó: la respuesta se la das vos, por correo o
  WhatsApp.
- **Los pedidos no reservan stock** ni descuentan existencias: la disponibilidad la confirmás al responder.

## Si algo no sale

Estos son los mensajes que pueden aparecer **en la tienda** (del lado de quien compra):

| Mensaje | Qué significa y qué hacer |
|---|---|
| **Recibimos tu pedido…** | Salió bien: el pedido llegó a Consultas. Atendelo desde la bandeja. |
| **Hiciste varios envíos seguidos. Probá de nuevo en N minutos.** | El visitante mandó demasiados pedidos en poco tiempo. Que espere y reintente. |
| **Tu navegador no nos deja guardar la lista…** | El navegador del visitante bloqueó el almacenamiento: la lista le dura mientras la página esté abierta. |
| **Ya tenés presupuestos abiertos. Esperá nuestra respuesta para pedir otro.** | El cliente llegó al tope de presupuestos pendientes: respondele y que pida otro. |
| **No pudimos calcular el precio de «X».** | El producto no tiene precio calculable en el momento (por ejemplo, falta la cotización del dólar). Quitalo de la lista o pedí el pedido sin presupuesto. |
| **Tu cuenta no está activa en esta tienda.** | La cuenta del cliente está suspendida o el cliente no está habilitado en esa tienda. Revisaso en su ficha. |

<!-- TODO (dueño: documentación de producto): capturas de la ficha con «Agregar a la lista» y «Guardar en favoritos», de la pantalla «Mi lista», de la ventana «Tu presupuesto», de la pantalla «Mi cuenta» y de la bandeja de Consultas con un pedido, en docs/producto/img/tienda-compra-y-cuentas/. No se pudieron generar porque la herramienta de capturas del manual (`pnpm docs:capturas` y `pnpm demo:dataset`) no existe en este repo y el frente de la tienda todavía no está en `main`; ver la página técnica. -->
