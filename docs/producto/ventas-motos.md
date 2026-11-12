---
owner: producto
sources: []
---

# Envíos en moto: registrar y rendir

## Para qué sirve

Cuando entregás con **mensajería propia (motos)**, cada envío se registra con quién lo lleva (el **mensajero**), la **guía** si la hay, el **costo de envío** y lo que el cliente **abona al recibir**. Después, cuando el mensajero te devuelve la plata, **rendís** esas entregas, una por una o en lote. Al rendir, el dinero queda cobrado en la factura.

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Ver los envíos | Quien tiene Ventas en lectura o edición **en la tienda del envío** |
| Registrar, editar y marcar «Enviado» | Operador y Administrador con edición de Ventas en la tienda (Mostrador no registra) |
| **Rendir** | Solo el Administrador |

## Dónde lo encontrás

**Ventas → Transportes**, pestaña **Motos**. Contrarreembolsos sigue siendo la pestaña que se abre por defecto. Arriba ves la tarjeta **Motos sin rendir** (suma de lo que abonan los envíos todavía sin rendir y cuántas entregas son).

## Qué facturas se pueden enviar en moto

- Solo **facturas emitidas** (confirmadas o en cualquier otro estado que no sea borrador ni anulada) cuya forma de envío es de tipo moto y de la misma tienda. Un presupuesto, un **borrador** o una factura **anulada** no se ofrecen; si probás registrar sobre un borrador, el sistema pide confirmarlo antes.
- Cada factura tiene **un solo envío**: no se puede registrar dos veces.

## Registrar un envío

1. Hacé clic en **Registrar envío** y elegí la factura (se busca por número o por cliente).
2. Escribí el **Mensajero**, la guía (opcional), el **Costo de envío** y **Abona al recibir**.
3. Marcá **Enviado** cuando salga y guardá. Mientras no se rinda, podés **Editar** el envío.

## Rendir

Activá la llave **Rendido** de una fila o tildá varias y usá **Rendir seleccionados** (el lote tiene que ser de **un solo mensajero**). Un diálogo muestra los totales. El **total de la rendición es lo que abonaron los clientes**; el costo se muestra aparte y el neto es informativo.

**Rendir cobra la factura.** Por cada entrega rendida se registra un cobro en la factura por el menor valor entre lo que abonó el cliente y lo que la factura todavía debe (saldo neto: total menos cobros menos notas de crédito). Ese cobro figura como cobro de contrarreembolso, y la factura pasa a **Cobrada** si queda sin saldo. Si el abono es 0, o la factura ya no debe nada, el envío se rinde sin cobro. La rendición es **todo o nada** y **no se puede revertir** desde la pantalla.

Si la factura no tiene forma de pago, se usa la forma «Contrarreembolso» activa de la tienda; si no hay ninguna, la rendición no se hace.

## Casos especiales

- **Factura anulada después de registrar el envío:** el envío queda **bloqueado** («Factura anulada» y el motivo): no se puede editar ni rendir, y no suma en «Motos sin rendir». Los ya rendidos no cambian.
- **Factura en borrador con abono:** aparece «Confirmá la factura antes de rendir» y no se puede rendir hasta confirmarla.
- **Nota de crédito posterior:** baja el **abono pendiente** de los envíos sin rendir hasta el saldo neto de la factura. Los ya rendidos no se tocan, y si la nota se anulara el abono no vuelve a subir.
- Al cambiar de tienda en la barra superior, la pantalla se recarga y cualquier diálogo abierto se cierra con aviso.

Ver también: [Cobros y conciliación](ventas-cobros-y-conciliacion.md) y [Catálogos de ventas](ventas-catalogos.md). Detalle técnico: [Ventas en moto (técnico)](../tecnico/ventas-motos.md).

<!-- TODO (dueño: documentación de producto): capturas de la pestaña Motos, del diálogo de registro y del de rendición. No se generaron: la herramienta de capturas del manual no existe en este repo. -->
