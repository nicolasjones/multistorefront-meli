---
owner: producto
sources: []
---

# Opiniones: moderar lo que dicen los clientes

> Detalle de ingeniería (tabla, RPC, migraciones y reversión): [guía de referencia](../tienda-opiniones.md).

## Para qué sirve

**Opiniones** es la pantalla donde el Administrador revisa las opiniones que los clientes con cuenta web dejan sobre los productos de su tienda. La moderación es **previa**: una opinión nueva queda **pendiente** y solo las que aceptás se mostrarán en la tienda.

> **Estado actual**: esta primera entrega trae solo la base y la moderación en el panel. Las opiniones **todavía no se ven en la tienda pública** ni los clientes pueden escribirlas desde ahí: esas partes llegan en entregas siguientes. Todo está detrás de la bandera `tienda_opiniones`, apagada por defecto.

## Quién puede hacerlo

Solo el **Administrador** de la organización. Los demás roles no ven la opción en el menú ni pueden abrir la dirección de la pantalla.

## Dónde lo encontrás

En el menú de la izquierda: **Canales → Opiniones**.

## Qué ves y qué podés hacer

- Un aviso: las opiniones nuevas quedan pendientes hasta que las aceptes o rechaces; solo las aceptadas se muestran en la tienda.
- El filtro de tienda («Todas las tiendas» o una empresa). Si elegís una empresa en la barra superior, la pantalla se filtra por esa tienda y recarga la lista y los contadores.
- Tres contadores: **Pendientes**, **Aceptadas** y **Rechazadas**, del mismo ámbito que el filtro de tienda.
- Los filtros **Pendientes** (por defecto), **Aceptadas**, **Rechazadas** y **Todas**.
- La lista, con la tienda (cuando mirás todas), el nombre completo del cliente, la fecha, el estado, «N sobre 5», el texto y «Sobre: producto». Carga por tandas con «Cargar más».
- **Aceptar**: la opinión pasa a «Aceptada». El botón no aparece en las opiniones que ya están aceptadas.
- **Rechazar**: abre un diálogo con un **motivo opcional** (hasta 200 caracteres). Sirve también para despublicar una opinión ya aceptada.

Si otra persona decidió la misma opinión (o el cliente la editó) mientras la mirabas, ves un aviso, la lista se recarga y tu decisión no pisa la anterior.

## Si las opiniones están desactivadas

Con la bandera apagada la pantalla avisa que las opiniones están desactivadas y **solo permite rechazar**. Aceptar queda deshabilitado hasta que el equipo técnico active la función.

## Actividad

Cada decisión queda en **Administración → Actividad** como «Opinión aceptada» u «Opinión rechazada», con el producto y la puntuación. El texto de la opinión y el motivo **no** se guardan en la Actividad.
