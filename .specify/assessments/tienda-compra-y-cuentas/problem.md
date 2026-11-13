# Problem Definition: Tienda · compra online y cuentas de clientes

- **Slug**: tienda-compra-y-cuentas
- **Created**: 2026-11-13
- **Inputs used**: intake.md, research.md

## Problem Statement

Un cliente de la tienda que ya decidió qué quiere hoy tiene que salir de la tienda (WhatsApp, correo o local) y repetir producto por producto lo que ya vio; el comercio recibe una consulta suelta de un solo producto, sin cantidades, que después alguien transcribe a mano a un presupuesto. Además, quien ya tiene cuenta web no puede ver sus compras ni guardar productos. **Cuánto de esto es un problema real para el cliente del negocio no está confirmado** (sin evidencia de demanda).

## Affected Users & Stakeholders

- **Cliente final minorista** (visitante de la tienda): hoy consulta y coordina fuera del sistema.
- **Cliente mayorista con cuenta web** (ya existe, con precios por escala): hoy no ve historial ni guarda favoritos; pide por WhatsApp.
- **Operador de Consultas / Ventas** de San Javucho y Mundo JC: recibe consultas de un producto y arma el presupuesto a mano.
- **Administración** (cobros, conciliación): registra cobros manualmente; un cobro en línea cambiaría su trabajo y su responsabilidad.
- **Nicolás / cliente del negocio** (decide alcance y presupuesto); **soporte** (heredaría reclamos de pagos, devoluciones y envíos).

## Goals

Objetivos reales y verificables si se encara algo (no ya decididos; dependen de las respuestas de negocio):

1. Que un cliente con cuenta web vea sus compras y guarde favoritos, sin duplicar la cuenta que ya existe (F-CLI-20 acotada).
2. Que un cliente pueda armar una lista de varios productos con cantidades y enviarla como pedido o presupuesto, sin cobrar, y que el operador la reciba estructurada en el panel (opción intermedia).
3. Solo si el negocio lo confirma: cobrar y despachar en línea.

## Non-Goals

- Cobro en línea, envíos con cotización automática y facturación fiscal electrónica (ARCA) **en cualquier opción distinta de la completa**.
- Auto-registro público con aprobación (ya descartado en cuenta web, supuesto D2).
- Mercado Libre y otros canales (Etapa 2).
- Rehacer la cuenta web, el login o los precios por escala (existen).
- Exponer cantidades exactas de stock en la tienda (decisión ya tomada).

## Success Metrics

- Proporción de consultas de tienda que llegan con más de un producto o con cantidad (baseline: 0, hoy es un solo producto sin cantidad).
- Tiempo del operador desde que llega la consulta hasta que existe el presupuesto (baseline: desconocido).
- Clientes con cuenta que usan «Mi cuenta» al mes (baseline: desconocido; la cuenta web recién se entregó).
- Para la opción completa: ventas cobradas en línea y tasa de conciliación sin intervención (baseline: 0).

## Cost of Inaction

Se sigue trabajando como hoy: consulta → WhatsApp/correo/local → presupuesto manual. Costo real no medido. El riesgo de no hacer nada con las cuentas es menor: la cuenta web ya da acceso y precios por escala. El riesgo de hacer la opción completa sin demanda es alto (alcance XL con riesgo legal, fiscal y de soporte).

## Open Questions

- [NEEDS CLARIFICATION: ¿los clientes piden comprar sin pasar por una persona, o el cierre humano es parte del valor (precio mayorista negociado, envío por transporte)?]
- [NEEDS CLARIFICATION: ¿cuántas consultas de la tienda hay y cuántas terminan en venta? (datos disponibles en `dominio.consultas`)]
- [NEEDS CLARIFICATION: ¿qué faltaría de «cuentas y favoritos» que la cuenta web actual no dé?]
