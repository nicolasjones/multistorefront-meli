---
owner: producto
sources: []
---

# Venta de mostrador

## Para qué sirve

En el mostrador escaneás los productos con el lector de código de barras y cobrás en el momento, sin
cargar la venta a mano. Cada producto escaneado se agrega solo a una factura; cuando terminás, apretás
**Cobrar** y queda todo confirmado y cobrado de una vez.

Por defecto la venta es a **Consumidor final**: no hace falta buscar ni elegir un cliente.

## Quién puede hacerlo

| Acción | Quién |
|---|---|
| Usar la pantalla de venta de mostrador | Administrador, Operador, Mostrador y Administración (roles con **Ventas en edición**). |
| **Cobrar** la venta | Mostrador, Administración y Administrador. |
| Ver la pantalla sin poder cobrar | Los roles que solo tienen **Ventas en lectura** ven «Acceso restringido». |

Si tu rol puede cargar ventas pero no registrar cobros, podés escanear y preparar la venta, pero el
botón **Cobrar** queda deshabilitado y se lee «Tu rol no puede registrar cobros en esta tienda.».

## Dónde lo encontrás

En el menú de la izquierda: **Ventas → Venta de mostrador** (es la primera pantalla del grupo).

Antes de empezar, elegí en la barra superior **una tienda concreta**. La venta es de una sola tienda:
si dejás «Todas mis empresas», la pantalla te pide que elijas una.

## Vender con el lector

1. Entrá en **Ventas → Venta de mostrador**.
2. Pasá el lector por el código de barras del producto (o escribí el código a mano y apretá `Enter`).
   El campo se limpia solo después de cada lectura, así que podés seguir escaneando sin hacer clic.

   *Si tenés el lector plugueado, no tenés que hacer nada más: el lector escribe el código y manda
   `Enter` por vos.*

3. El producto aparece en la tabla, con **Cantidad 1** y su precio.

   *Si el mismo producto ya estaba en la venta, la cantidad sube y **no** se duplica la fila.*

4. Seguí escaneando hasta que termines.

## Si algo no se escanea

| Lo que pasa | Qué dice la pantalla | Qué hacer |
|---|---|---|
| El código no existe o no es de tu organización | «Producto no encontrado» | Revisá que el código esté bien y que el producto tenga **código de barras** cargado en el catálogo. |
| El código no tiene 13 dígitos | «El código de barras debe tener 13 dígitos (EAN-13).» | Revisá el código: los lectores de retail leen 13 dígitos. |
| No se pudo agregar el producto | «No pudimos agregar el producto. Probá de nuevo.» | Volvé a escanear. |
| Tu organización no tiene un cliente «Consumidor final» | «No hay un cliente «Consumidor final» en tu organización. Pedile a un administrador que lo cree.» | Pedile a un administrador que lo cree. |
| No se pudieron cargar las formas de pago | «No pudimos cargar las formas de pago de esta tienda. Probá de nuevo.» | Recargá la pantalla. |

## Totales

Abajo de la tabla se leen tres renglones, como en cualquier factura:

- **Subtotal sin IVA**: la suma de las líneas, sin impuestos.
- **IVA**: el impuesto de las líneas.
- **Total**: lo que hay que cobrar.

El precio de cada línea se muestra **sin IVA**.

## Cobrar

1. Elegí la **Forma de pago** (las que tiene la tienda). Si esa forma de pago pide una **cuenta de
   cobro** (por ejemplo, una transferencia o un depósito bancario), aparece también el campo
   **Cuenta de cobro** y tenés que elegir una.
2. Hacé clic en **Cobrar**.
3. Se ve el aviso «Venta cobrada · <número de factura> · <importe>» y la tabla se vacía para la venta
   siguiente.

!!! tip "Si el cobro falla"
    Si la factura se confirmó pero el cobro no se pudo registrar, la pantalla lo avisa: «La venta se
    confirmó pero no pudimos registrar el cobro. Probá de nuevo: no se duplica la venta.» Podés
    apretar **Cobrar** otra vez: **no** se vuelve a confirmar la factura y **no** se pueden agregar más
    productos a esa venta.

## Cambiar de tienda con una venta abierta

Si cambiás de tienda en la barra superior mientras tenés una venta a medio cargar, la venta en curso se
**descarta** y se te avisa: «Cambiaste de tienda: se descartó la venta en curso (…). Empezá una nueva
escaneando un producto.»

La factura que se había armado queda en **Ventas → Comprobantes** como borrador: no se cobró ni se
guardó bajo la otra tienda.

## Si la venta no se cobró

- La factura queda en **Ventas → Comprobantes** como **borrador**. Desde ahí la podés completar,
  imprimir o cancelar.
- Para más detalle de las facturas, mirá [Presupuestos y facturas](ventas-comprobantes.md).
- Para registrar o conciliar cobros de ventas ya cargadas, mirá
  [Cobros y conciliación](ventas-cobros-y-conciliacion.md).

## Capturas

Las capturas de esta pantalla están pendientes de generar; el seguimiento está en la guía técnica de la
épica. Hasta que estén, seguí los pasos de esta página.
