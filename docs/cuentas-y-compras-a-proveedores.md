# Cuentas y compras a proveedores (épica MSF-450)

Ideas de la épica «Clientes y proveedores · Cuentas y compras a proveedores»
(spec `specs/20261029-100000-cuentas-y-compras-a-proveedores/`). La épica las dejó **sin requisitos de
comportamiento**: cada historia redacta los suyos en su propia spec cuando pasa a un hito. Este
documento es el registro de cada historia a medida que se entrega; lo completa la tarea de cierre de la
épica con las ideas que siguen pendientes.

| Historia | Prioridad | Talla | Estado | Dependencia |
|---|---|---|---|---|
| F-PRV-09 · Órdenes de compra a proveedores | P3 | L | Backlog → **entregada** por MSF-454 | Listado de reposición de Stock |
| F-CLI-19 · Cuenta corriente y saldo del cliente | P3 | L | Backlog · sin requisitos hasta que pase a un hito | Cobros y estado Deuda de Ventas |
| F-CLI-20 · Historial y favoritos en la cuenta web | P3 | L | Backlog · sin requisitos hasta que pase a un hito | Cuenta web del cliente |
| F-CLI-21 · Listas de precios por cliente | P3 | L | Backlog · sin requisitos hasta que pase a un hito | F-PRE-14 (Precios) |

## F-PRV-09 · Órdenes de compra a proveedores

- **Dependencia**: el listado de reposición de Stock (`docs/stock.md`, «Ver solo alertas») y el proveedor
  del producto (`dominio.productos.proveedor_id`, F-PRV-03).
- **Spec y guía**: `specs/20261109-103000-ordenes-de-compra-a-proveedores/` y
  [`docs/ordenes-compra.md`](./ordenes-compra.md).
- **Qué entrega**: la orden de compra nace del listado de reposición (los productos en alerta del
  proveedor), se sigue hasta que la mercadería llega (`recibida`) o se cancela (`anulada`, con motivo), y
  el listado respeta la empresa activa de la barra superior.
- **Fuera de alcance (declarado en la spec de la historia)**: número correlativo, condiciones de compra,
  «Compra para», envío por correo al proveedor, costo de la orden y el vínculo con el ingreso de
  mercadería (el stock sigue entrando por «Ingreso de mercadería», F-PRV-04).

## Historias pendientes

`F-CLI-19` (cuenta corriente del cliente), `F-CLI-20` (historial y favoritos en la cuenta web) y
`F-CLI-21` (listas de precios por cliente) siguen en P3 · Backlog, sin requisitos hasta que pasen a un
hito: cada una los redacta en su propia spec.

