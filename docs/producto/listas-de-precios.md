---
owner: producto
sources:
  - apps/web/src/pages/productos/listas-de-precios.tsx
---

# Listas de precios por cliente

> Detalle de ingeniería (migraciones, RPC, bandera y pruebas): [guía de referencia](../listas-de-precios.md).

## Para qué sirve

Una **lista de precios** te deja venderle a un cliente con un porcentaje fijo sobre el precio central: por ejemplo «Revendedores −20 %». No hay precios sueltos por producto dentro de una lista: es un único porcentaje, de −90 % a +100 %, que se aplica sobre el precio central en pesos. Sirve para tus revendedores, tus clientes frecuentes o cualquier acuerdo que ya tengas con una persona o un negocio.

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Crear, editar, archivar y restaurar listas | Administrador |
| Asignar una lista a un cliente o quitársela | Administrador |
| Ver las listas y la lista de cada cliente | Quien puede ver Clientes o Ventas |

## Tiene que estar activada en tu entorno

**Las listas vienen apagadas de fábrica en cada entorno** y las enciende el equipo técnico cuando Nicolás lo decide. Mientras estén apagadas, la pantalla solo te deja archivar y restaurar, «Guardar» y «Asignar» avisan que las listas están desactivadas en este entorno, y **todos los precios son los de siempre**.

## Cómo se usa

1. Entrá a **Productos → Listas de precios** y tocá «Nueva lista». Poné un nombre, el porcentaje (por ejemplo −20) y mirá el ejemplo que te muestra el diálogo.
2. Abrí la ficha del cliente y elegí la lista en el campo **Lista de precios**. El Consumidor final no admite lista.
3. Vendele como siempre en el mostrador o en un comprobante: la línea sale al precio de la lista y muestra la marca «Lista: Revendedores −20 %».
4. Si el cliente tiene cuenta en tu tienda online, ve **su precio** con la lista en la ficha del producto y arma sus presupuestos a ese precio. El catálogo y los visitantes ven el precio público.

## Qué precio gana

De más específico a más general, gana el primero que aplica:

1. El **precio manual** que pongas en la línea.
2. La **escala por cantidad** (x5, x10, x50) del producto, si el cliente mayorista compra esa cantidad.
3. El **precio propio** del producto en la tienda.
4. La **lista del cliente**: el precio central más o menos el porcentaje, redondeado como el resto de la tienda y **sin IVA** (el IVA se suma después). **Reemplaza** el ajuste que tenga la tienda, no se suma.
5. La regla de la tienda, como hasta ahora.

El **descuento personal** del cliente no se suma a la lista. Una **promoción** vigente solo gana si deja el precio más bajo que el de la lista; nunca se acumulan.

## Qué pasa con lo ya vendido

La línea guarda la lista y el porcentaje que se usaron. Si después cambiás el porcentaje de la lista o le cambiás la lista al cliente, **lo ya vendido no se mueve**, y la **nota de crédito** devuelve al precio que se cobró. Un borrador sí se recalcula cuando guardás sus líneas.

Si cambia la lista entre que guardaste un borrador y lo confirmás, el sistema avisa «El precio de la lista cambió: revisá el total y confirmá de nuevo». Revisá el total y confirmá otra vez.

## Cosas que conviene saber

- **Al encender las listas**, los borradores que ya estaban guardados para un cliente con lista pueden pedir un nuevo guardado antes de confirmar. Es normal y se resuelve volviendo a guardar las líneas.
- Una lista no se borra: se archiva, y **no se puede archivar mientras tenga clientes asignados**.
- Si el porcentaje deja una línea en $0 (por ejemplo −90 % en un producto muy barato), el sistema no la guarda: ponele un precio manual.
- La lista de pedido de la tienda («Enviar consulta») sigue mostrando el precio público: es una consulta al local, no un cobro.
- Mercado Libre queda fuera: las listas no generan precios en las publicaciones.
