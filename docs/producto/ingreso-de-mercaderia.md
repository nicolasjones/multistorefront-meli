---
owner: producto
sources:
  - specs
---

# Ingreso de mercadería por proveedor (MSF-219)

**Épica:** MSF-219 · **Historias:** F-PRV-04 (MSF-383), F-PRV-05 (MSF-393) y F-PRV-06 (MSF-404).
**Spec:** `specs/20261021-183246-ingreso-de-mercaderia-por-proveedor/`.

El depósito registra la mercadería que llega de un proveedor y el stock sube en el acto. Queda un
historial con fecha, producto, cantidad, empresa, proveedor y operador, y un ingreso mal cargado se
**anula con motivo**, sin editar ni borrar el pasado.

## Qué resuelve

- Antes, la llegada de mercadería no tenía un registro propio: el movimiento de stock no guardaba
  proveedor, comprobante ni costo, y la compra quedaba sin trazabilidad.
- Ahora cada compra se registra una vez, con su proveedor, fecha, comprobante opcional y costo unitario
  en USD, y por cada producto se crea una entrada de stock con el motivo «Compra a proveedor».
- El historial responde qué llegó, de quién, para qué tienda y quién lo registró. Anular un ingreso
  devuelve el stock y conserva la operación (y su motivo) en el historial.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a, Operador y Depósito** (con `stock` en edición) | Registrar ingresos y anularlos |
| **Consulta, Mostrador y Administración** (con `stock` en lectura) | Ver el historial; no ven el formulario ni el botón «Anular» |
| **Quien no tiene acceso a Stock** | No ve la pestaña ni recibe filas del historial |
| **Con `rentabilidad` en edición (hoy, Administrador)** | Además, marcar «Actualizar el costo del producto con este ingreso» |

La base vuelve a validar el permiso: ocultar el formulario es comodidad, no la autorización.

## Cómo se usa

La pantalla vive en **Stock → Ingreso de mercadería** (`/stock/ingresos`), como tercera pestaña junto a
**Stock actual** y **Movimientos**.

### Registrar un ingreso

1. Completá **Compra a nombre de** (la empresa de la compra), **Proveedor**, **Fecha** y, si querés,
   **Remito o factura de compra** (hasta 100 caracteres).
2. Agregá uno o más productos con **Cantidad** y **Costo unit. USD**; podés sumar o restar unidades y
   quitar líneas. Un mismo producto no se puede repetir en el ingreso.
3. Si tenés permiso, marcá **Actualizar el costo del producto con este ingreso**. El costo del producto
   se actualiza; el precio de lista no cambia.
4. **Registrar ingreso** confirma todo de una vez: si una línea falla, no se guarda ninguna. El aviso es
   «Ingreso registrado · N unidades» y el ingreso aparece abajo, en el historial.

«Limpiar» vacía el formulario sin tocar lo ya registrado. El botón queda deshabilitado mientras guarda y
el envío lleva una clave de idempotencia: un doble clic o un reintento no crea dos ingresos ni mueve el
stock dos veces.

### Historial

La tabla muestra una fila por producto con **Fecha**, **Producto** (nombre y SKU), **Cantidad**,
**Destino**, **Tienda**, **Proveedor**, **Operador** y **Estado** («Registrado» o «Anulado» con su
motivo). Se ordena del más reciente al más antiguo y pagina de 25 líneas en 25.

Los filtros se combinan: **Desde**, **Hasta**, **Proveedor**, **Tienda**, **Producto** y **Operador**.
«Limpiar filtros» vuelve a la lista completa. Sin resultados se ve el estado vacío del panel.

### Anular

El botón **Anular** aparece una sola vez por ingreso, solo para quien edita Stock y solo si sigue
«Registrado». Pide un **motivo de 3 a 500 caracteres**, avisa que la operación no se puede deshacer y,
al confirmar, el stock baja en las cantidades de todas las líneas. El ingreso queda «Anulado» en el
historial con su motivo; la fecha de anulación queda guardada en el registro.

Si parte de esa mercadería ya se vendió y no alcanza el stock, **no se anula nada**: se muestra «No hay
stock suficiente para anular» y el ingreso sigue como estaba.

## Reglas de negocio

- **Un ingreso no se edita ni se borra**: se anula con motivo.
- La **empresa** («Compra a nombre de») identifica a nombre de quién se compró y se muestra como
  «Tienda»; **no separa el stock por empresa**.
- El **proveedor** y los **productos** deben estar activos y ser de la organización. Un producto no
  tiene que estar asignado a ese proveedor: si coincide, la pantalla lo indica, pero no lo exige.
- **Fecha**: hoy o anterior; no se acepta una fecha futura.
- **Cantidad**: entero entre 1 y 1.000.000. **Costo**: en USD, mayor o igual a 0, con hasta dos
  decimales. Un ingreso admite hasta **100 productos**.
- El **comprobante** es opcional y puede repetirse: no hay unicidad por número.
- **Operador y fecha de carga** los pone el servidor; no se eligen desde el formulario.
- Cada ingreso y cada anulación dejan un evento en **Actividad** (`ingreso.registrado` /
  `ingreso.anulado`), sin importes ni costos.

## Empresa activa

La barra superior no crea un stock por tienda: el stock es **único por organización** y todas las
empresas lo comparten.

- **Compra a nombre de** arranca con la empresa activa de la barra superior; se puede elegir otra
  empresa a la que la persona tenga acceso.
- Si la empresa activa cambia con el formulario ya abierto, la compra ya elegida no cambia sola.
- El historial muestra todas las tiendas de la organización; la columna **Tienda** y el filtro del mismo
  nombre permiten acotar. El historial **no** se filtra automáticamente por la empresa activa.

## Diferencias con el prototipo

- El prototipo separa **Local** y **Depósito** y ofrece un selector de depósito; esta entrega usa el
  **stock único** de la organización. «Destino» se muestra fijo como **«Depósito principal»** y no hay
  selector. Los depósitos llegan con MSF-292.
- El prototipo muestra el costo unitario y la casilla para actualizarlo; se implementaron (decisión D1 de
  la spec). El documento original de la épica decía que el ingreso no registraba costo.
- El historial completo con filtros y el diálogo de anulación **no estaban dibujados**; se construyeron
  con los patrones del sistema de diseño.
- El prototipo muestra «Compra a nombre de» y se conservó como metadata de la compra. No separa stock.
- La pestaña **Archivo anterior al sistema**, «Depósitos de mercadería», «Faltantes» y «Actualizar por
  Excel» no son de esta épica.

## Fuera de alcance y roadmap

| Tema | Estado |
|---|---|
| Depósitos, selector de depósito y stock por depósito | MSF-292 (Stock · depósitos y reservas) |
| Archivo consultable del historial de ingresos del sistema anterior | MSF-330 (F-MIG-03) |
| Ingreso en lote de Stock (F-STK-10) | Decisión abierta en Stock; esta épica no lo implementa |
| Lotes, vencimientos, órdenes de compra, pagos y cuentas corrientes | Fuera de alcance |
| Costo en ARS, multimoneda y actualización masiva de precios | Fuera de alcance |
| Editar o borrar un ingreso | No existe: se anula con motivo |
| Migración inicial de datos | MSF-142 |

La vista de detalle dedicada no está en la pantalla: el historial muestra una fila por producto con su
estado y motivo. La RPC de detalle existe para cuando se agregue esa vista.

## Para profundizar

- [Ingreso de mercadería: modelo, RPC y flujos](../tecnico/ingreso-de-mercaderia.md)
- [Stock: movimientos, historial, mínimo y sin negativos](../stock.md)
- [Permisos por rol](../permisos-por-rol.md)

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
