---
owner: producto
sources:
  - specs
---

# Ventas: impresión de factura, remito y presupuesto (MSF-213)

**Épica:** MSF-213 · **Historias:** F-VTA-19 (MSF-230, impresión de factura y remito), F-VTA-20 (MSF-245, presupuesto en PDF y correo) y F-VTA-21 (MSF-256, marca de impreso y reimpresión).
**Spec:** `specs/20261024-100000-ventas-impresion/` · **Cierre:** MSF-565 (E2E y revisión de seguridad).

Desde Ventas se imprimen o descargan en PDF la **factura interna**, el **remito** y el **presupuesto**
con los datos de la empresa, y el presupuesto se envía por correo al cliente.

## Qué resuelve y para quién

- Quien vende o despacha obtiene el documento desde el comprobante (botones «Imprimir» e «Imprimir remito»,
  diálogo «Imprimir comprobante») o desde la lista de Presupuestos, sin armar nada a mano.
- Los documentos son **internos** y llevan la leyenda «Documento no válido como factura».
- Razón social, CUIT, dirección y logo salen de la ficha de la empresa (pestaña General guarda razón social y CUIT).
- Cada impresión queda marcada («Factura impresa · dd/mm hh:mm») y se puede reimprimir sin límite.

## Reglas de negocio

| Documento | Cuándo se puede pedir | Contenido (provisorio) | Permiso mínimo |
|---|---|---|---|
| Factura interna | Comprobante `confirmada` | Precios sin IVA, subtotal, IVA, total, forma de pago y envío | `ventas` en lectura en la empresa |
| Remito | Comprobante `confirmada` | Producto, código, cantidad y depósito, **sin importes** | `ventas` en lectura |
| Presupuesto | `pendiente`, `aceptado` o `vencido`; no `convertido` | Número, fecha, «Válido hasta», cliente, líneas y totales | `ventas` en lectura |
| Envío del presupuesto por correo | Cliente con correo válido | PDF adjunto; asunto y cuerpo fijos | `ventas` en edición |

- Un presupuesto se edita, así que su PDF solo se reutiliza si se pidió después de la última modificación;
  la factura y el remito reutilizan el PDF vigente.
- Un cliente sin correo (incluido Consumidor final) o con correo mal formado no puede recibir el envío: se
  avisa y no se crea nada.
- Lo no cargado en la ficha (CUIT, logo, correo…) se omite del documento; sin logo igual se genera.
- La impresión y el envío siguen la **empresa activa**: al cambiarla se corta la acción en curso y se descarta
  su resultado (Principio VIII). Fuente: `docs/ventas-impresion.md` de la épica (commit `58452852`).

## Límites y fuera de alcance

- **El formato exacto** de factura, remito y presupuesto es provisorio hasta confirmarlo con el cliente con
  ejemplos del panel actual. TODO (dueño: producto).
- No hay remitente de correo por empresa (se usa el remitente global) ni plantilla de asunto/cuerpo editable.
- Documentos no fiscales: no reemplazan una factura electrónica.
- Reimpresión sin límite ni permiso adicional; no hay anulación de impresiones (el registro solo se agrega).
- Abierto: confirmar si las 16 h de la épica son adicionales a «Comprobante» (45 h) y la alternativa de
  salir primero con la impresión del navegador (opción b del riesgo de fecha). TODO (dueño: producto).
- La razón social y el CUIT se cargan en la ficha de empresa; la «condición frente al IVA» del cliente aún
  no tiene edición en la ficha del cliente (texto libre). Roadmap.

Detalle técnico: [Ventas impresión (técnico)](../tecnico/ventas-impresion.md).
