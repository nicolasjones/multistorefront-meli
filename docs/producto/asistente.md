---
owner: producto
sources: []
---

# Asistente con IA sobre tu catálogo

El **asistente** es el chat flotante del panel. Con esta funcionalidad activa, además de lo que ya hacía, **responde preguntas sobre el catálogo, el stock, los precios y las ventas de tu organización**. Es de **solo lectura**: consulta, no cambia nada.

## Qué le podés preguntar

| Tema | Qué puede responder |
|---|---|
| **Catálogo** | Productos con su nombre, código (SKU), categoría y si están activos |
| **Stock** | Cantidad, reservado y disponible de cada producto en cada depósito |
| **Precios** | Precio de lista y precios por escala (x5, x10 y x50); si una escala no tiene precio, lo indica |
| **Ventas** | Facturas confirmadas, con su número, fecha, empresa, totales y estado |

Por ejemplo: «¿cuánto stock queda del control negro?», «¿cuál es el precio por 10 unidades de este producto?» o «¿qué facturas se confirmaron esta semana?».

## Quién lo activa

La funcionalidad **se activa por organización** y la habilita la plataforma (un superadmin), desde Funcionalidades. Si no está activa, el asistente no responde sobre estos temas. Si te interesa, pedísela a quien administra la plataforma.

## Qué ve cada persona

El asistente consulta con **tu sesión**, así que ve **solo lo que tu rol ya puede ver** en el panel:

- Catálogo y precios requieren acceso a **Productos**.
- Stock requiere acceso a **Stock**.
- Ventas requiere acceso a **Ventas**.

Si tu rol no tiene acceso a una sección, el asistente no te devuelve datos de ella. Nunca mezcla datos de otras organizaciones.

## Límites

- **Hasta 50 filas por consulta.** Si hay más, el asistente te muestra las primeras 50 y te pide que afines la búsqueda (por ejemplo, por nombre o por categoría).
- Rigen los límites de uso de la IA de tu organización. Si no hay presupuesto de IA configurado, no se activa para esa organización.

## Qué **no** hace

- **No cambia nada**: no crea, modifica ni borra productos, stock, precios ni ventas.
- **No muestra costos, márgenes ni datos de contacto de tus clientes.**
- No calcula el precio final por empresa ni el IVA: da los precios de lista y de escala.
- En ventas solo muestra facturas **confirmadas**.

Cada pregunta y su respuesta quedan registradas como el resto de las interacciones con la IA, sin datos sensibles.
