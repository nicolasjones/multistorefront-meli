---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · comprobantes (MSF-159)

Esta página explica **qué resuelve** la épica MSF-159 (spec `ventas-comprobantes`) para quien opera el
negocio. El detalle de datos, RPC y operación está en [Ventas · comprobantes (técnico)](../tecnico/ventas-comprobantes.md).

## Qué resuelve

Cargar una **factura interna** o un **presupuesto interno** para un cliente existente o para
**Consumidor final**, con el precio que corresponde según el **tipo de cliente** y la **escala por
cantidad**, indicando **desde qué depósito sale la mercadería**. Al confirmar la factura, el stock baja del
depósito elegido en cada línea.

El comprobante es **interno: no es fiscal** (no emite CAE ni tiene validez impositiva).

## Para quién

- **Operador / Mostrador:** carga facturas y presupuestos, elige cliente, depósito y cantidades, y
  confirma la factura.
- **Administración:** usa los presupuestos como cotización comercial y sigue el estado de cada uno.
- **Administrador:** define el acceso a Ventas por empresa y la acción de editar precio.

Sin la sección **Ventas** la pantalla muestra «Acceso restringido». Con **lectura** se consulta, pero no se
crea ni se edita; con **edición** en la empresa del comprobante se puede operar.

## Cómo se carga

1. **Nuevo comprobante** (o **Nuevo presupuesto**) abre la cabecera con la **Tienda** preseleccionada con
   la empresa activa, el **Canal de venta**, el **Cliente** (buscador o Consumidor final), la **Fecha** y
   el **Operador**.
2. **Agregar producto** suma líneas con **Producto, Stock, Depósito de mercadería, Cantidad, Precio sin IVA
   y Subtotal**. El pie muestra **Subtotal sin IVA, IVA y Total**.
3. Cada línea puede elegir **depósito de salida** (Local, Principal u otro). El **disponible** es el stock
   del depósito menos lo reservado; si la cantidad lo supera, se muestra un aviso de faltante que **no
   impide guardar el borrador**.
4. **Guardar cambios** conserva la cabecera y las líneas. La Tienda queda bloqueada una vez guardado: un
   comprobante pertenece a una sola tienda.

### Precios y escalas

- El **precio de lista es sin IVA**; el IVA sale de la categoría del producto o de su override.
- La **escala** (x1, x5, x10, x50) se elige por la **cantidad de la línea** y el **tipo de cliente**:
  minorista siempre x1; mayorista x1 (1–4), x5 (5–9), x10 (10–49) y x50 (50 o más).
- El precio lo calcula la base con `private.precio_para`; la pantalla no lo inventa.
- **Editar el precio** requiere la acción `editar_precio` de Ventas. Sin ese permiso el precio es de solo
  lectura.

### Qué pasa al confirmar la factura

- Solo una **factura en borrador con al menos una línea** se confirma. Un **presupuesto nunca** se
  confirma ni mueve stock.
- Cada línea de stock genera una **salida del depósito de esa línea**. Los productos **«A pedido»** dejan
  una **reserva** y no descuentan hasta que el comprobante se marque **Entregado** (eso llega con el
  despacho, MSF-135).
- La confirmación es **todo o nada**: si falta stock en algún depósito, no se descuenta nada y se informa
  el producto y el depósito. Reintentar sobre una factura ya confirmada no duplica movimientos.
- El botón **Confirmar factura** pide confirmación, muestra los faltantes visibles y deja el comprobante
  en solo lectura.

### Presupuestos

La pantalla **Ventas › Presupuestos** lista número, tienda, fecha, cliente, operador, vencimiento, estado,
total y acciones, con búsqueda por cliente o número y filtros por estado.

- **Aceptar** pasa de `pendiente` a `aceptado`; no reserva ni descuenta stock.
- **Copiar** crea un presupuesto nuevo `pendiente` con número nuevo; el original no cambia.
- **Modificar** abre el comprobante en edición solo mientras está `pendiente`.
- **Vencido** se calcula solo: un presupuesto `pendiente` con «Válido hasta» anterior a hoy (fecha de
  Argentina). No hay job ni se guarda como estado.

## Empresa activa

La Tienda del comprobante se **preselecciona con la empresa activa** de la barra superior. En un
comprobante nuevo se puede cambiar antes de guardar; una vez emitido, la empresa no cambia. Si se cambia
la empresa activa con un comprobante abierto, la pantalla se cierra con aviso: **nunca se muestran ni se
guardan datos de una tienda bajo otra**. El listado de presupuestos se acota a la empresa activa y se
reencuadra al cambiarla (página 1, búsqueda limpia, consultas recargadas).

## Límites y decisiones abiertas

- **Numeración:** correlativo por organización, empresa y tipo, con formato provisorio de 8 dígitos. La
  numeración definitiva sigue pendiente de decisión del cliente; el número entero se guarda aparte para
  poder cambiar el formato sin migrar datos.
- **Escala por línea o por total:** se implementó **por cantidad de la línea**, pendiente de confirmar con
  el cliente.
- **Forma de pago y envío:** se guarda **solo la elección**; los catálogos son de MSF-139. Mientras no
  existan en la base, la pantalla no los ofrece.
- **Mercado Libre** no es un canal válido todavía (queda para la Etapa 2).
- **Condición frente al IVA del cliente:** se muestra «—» porque la ficha del cliente todavía no la
  registra.
- **Cliente:** los clientes son de toda la organización; no se restringen a las tiendas habilitadas del
  cliente.

## Fuera de alcance de esta épica

Listado, estados, anulación y nota de crédito (MSF-177), despacho y entrega de reservas (MSF-135),
impresión y envío por correo (MSF-213), cobros y conciliación, transportes, «Facturar» un presupuesto,
exportar y observaciones. El prototipo muestra esas acciones; no se implementaron en MSF-159.

El listado con filtros y exportación, los estados del comprobante y de cobro, el historial, la anulación y la
nota de crédito llegaron después, en
[Ventas · listado, estados y anulación (MSF-177)](ventas-listado-estados-y-anulacion.md).

## Estado

Implementado en la rama de la épica (historias MSF-273, MSF-295, MSF-317 y MSF-331), **pendiente de merge a
`main`**. La fuente funcional es `specs/20261023-100000-ventas-comprobantes/spec.md`; las pruebas están en
`supabase/tests/database/ventas_*.test.sql` y en `apps/web/src/pages/ventas/*.test.tsx`.

## Para seguir

- **[Ventas · comprobantes (técnico)](../tecnico/ventas-comprobantes.md)** — tablas, numeración, RPC,
  permisos y reversión.
- **[Clientes](../clientes.md)** — Consumidor final y tipo de cliente.
- **[Stock](../stock.md)** — depósitos, movimientos y reservas.
