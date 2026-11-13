# Problem Definition: Consultas y ventas · clientes, pedidos y facturación

- **Slug**: clientes-pedidos-y-facturacion
- **Created**: 2026-11-13
- **Inputs used**: intake.md, research.md

## Problem Statement

Un cliente registrado no puede ver su historial ni sus datos en la tienda, y el seguimiento de un pedido desde la consulta hasta la entrega depende de personas. De esas dos necesidades, la primera ya tiene historia propia (F-CLI-20) y la segunda no está pedida por nadie en el tracker.

## Affected Users & Stakeholders

- **Cliente con cuenta web**: quiere ver compras y datos (cubierto por F-CLI-20).
- **Operador de Consultas/Ventas**: hoy une a mano consulta, cliente y comprobante.
- **Nicolás**: decide si se retoma la épica.

## Goals

- Que no queden dos o tres historias (F-CON-07, F-TDA-27, F-CLI-20) para lo mismo.
- Si el cliente lo pide, enlazar una consulta con el presupuesto que se arma a partir de ella (trazabilidad), sin pagos.

## Non-Goals

- Cobro en línea y facturación ARCA (specs propias, fuera de alcance).
- Pedidos y despacho (ya son de Ventas y despacho).
- Rehacer la cuenta web.

## Success Metrics

- Cantidad de historias del tracker para «cuenta, historial y favoritos»: 3 → 1 (baseline: 3).
- (Si se hace el enlace consulta→presupuesto) porcentaje de presupuestos con consulta de origen (baseline: 0, no hay vínculo).

## Cost of Inaction

Bajo: nada se rompe; solo permanece el desorden de historias duplicadas y una épica que parece pendiente sin serlo.

## Open Questions

- [NEEDS CLARIFICATION: ¿existe la necesidad de trazabilidad consulta → presupuesto → entrega?]
