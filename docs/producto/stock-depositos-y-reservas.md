---
owner: producto
sources:
  - specs
---

# Stock · depósitos y reservas (MSF-292)

**Qué resuelve:** que el administrador defina los depósitos de la organización, que cada producto muestre cuánto
hay en cada uno sobre un **stock total único**, que el equipo elija en qué depósito entra, sale o se traslada cada
unidad y que los productos «A pedido» **reserven** al vender y **descuenten recién** cuando el cliente retira o
recibe, sin pasar nunca el disponible.

Reúne las tres historias de la épica MSF-292:

| Historia | Qué agrega |
|----------|------------|
| F-STK-14 · Depósitos y existencias por depósito (MSF-316) | Alta de depósitos y stock desglosado por depósito sobre un total único |
| F-STK-15 · Traslado entre depósitos (MSF-353) | Mover unidades de un depósito a otro sin cambiar el stock total |
| F-STK-16 · Reserva y descuento de productos a pedido (MSF-337) | Reservar al vender y descontar al entregar, para productos «A pedido» |

**Estado:** implementado en la rama de la épica (`epic/MSF-292-stock-stock-depositos-y-reservas`); pendiente de merge
a `main` a la fecha de esta página. Spec: `specs/20261022-180000-stock-depositos-y-reservas/`.

## Para quién

| Persona | Qué hace |
|---------|----------|
| **Administrador/a** | Define los depósitos: los crea, los edita, elige cuál es el de por defecto y los activa o desactiva |
| **Depósito u Operador/a con edición en Stock** | Registra entradas, salidas y ajustes eligiendo el depósito; traslada mercadería entre depósitos |
| **Consulta o cualquier rol sin edición en Stock** | Ve los depósitos, el stock por depósito, el reservado y el disponible, y el historial de movimientos |

## El disponible, la regla de la casa

**Disponible = cantidad − reservado**, por depósito y en total. Ninguna salida, ajuste, traslado ni reserva puede
dejar el disponible de un depósito por debajo de 0: el stock sigue siendo único por organización y compartido entre
empresas y canales, pero **la barrera contra negativos ahora se calcula sobre el disponible de cada depósito**, no
sobre la cantidad total.

Ejemplo: un producto con 10 unidades y 3 reservadas tiene 7 disponibles. Una salida de 8 se rechaza aunque el total
de la organización sea 10 y haya unidades en otro depósito.

## Depósitos (F-STK-14)

En **Stock → Depósitos de mercadería** (`/stock/depositos`) se ve la tabla de depósitos de la organización (la
edita el Administrador; con `lectura` se ve completa pero sin botones):

| Columna | Qué muestra |
|---------|-------------|
| **Depósito** | Nombre del depósito (único por organización, sin distinguir mayúsculas) |
| **Dirección** | Dirección opcional (hasta 200 caracteres) |
| **Venden desde acá** | Las empresas desde las que se puede vender en ese depósito (una etiqueta por empresa) |
| **Productos con stock** | Cuántos productos tienen unidades en ese depósito |
| **Unidades** | Total de unidades en el depósito |
| **Por defecto** | Marca del depósito por defecto y acción **«Usar por defecto»** |
| **Activo** | Interruptor para activar o desactivar el depósito |

- **Alta y edición.** El botón **«Nuevo depósito de mercadería»** abre un formulario con **Nombre**, **Dirección**
  (opcional) y **«Pueden vender desde acá»** (las empresas de la organización). Editar un depósito usa el mismo
  formulario. La empresa activa de la barra superior viene marcada al crear el depósito.
- **Un depósito por defecto.** Siempre hay **exactamente uno** por organización, y es el destino de los movimientos
  que no eligen depósito. El depósito por defecto **no se puede desactivar**. Cuando se cambia, el aviso dice
  «&lt;Nombre&gt; es ahora el depósito por defecto».
- **Desactivar.** Un depósito con unidades no se puede desactivar: el sistema responde «Tiene stock: trasladá la
  mercadería antes de desactivarlo». Al pie de la tabla está la nota «Un depósito con stock no se puede desactivar:
  trasladá antes la mercadería a otro depósito. El depósito por defecto tampoco.» Un depósito inactivo no aparece en
  los selectores y no admite entradas.
- **Los depósitos no se borran**, se desactivan.

### Stock por depósito en Stock actual

En **Stock → Stock actual** (`/stock`) la tabla suma las columnas **Stock**, **Reservado** y **Disponible**, y suma el
control **«Depósito de mercadería»**: con **«Todos los depósitos»** (el valor por defecto) las cifras son los totales
únicos de la organización; al elegir un depósito, las cifras pasan a ser las de ese depósito.

El control cambia las cifras, **no el estado**: el estado (Sin stock / Stock bajo / Disponible) y las alertas se
calculan sobre el **disponible total**, porque el stock es único por organización y compartido entre empresas.

En **Movimientos** (`/stock/movimientos`) el detalle agrega la columna **Depósito** y el resumen por producto muestra
**Queda**, **Reserv.** y **Disp.**.

## Traslado entre depósitos (F-STK-15)

En **Stock actual**, la acción **«Trasladar»** (solo con edición en Stock) abre el diálogo **«Trasladar stock entre
depósitos»** con **Producto**, **Depósito de origen**, **Depósito de destino**, **Cantidad**, **Fecha** y **Nota
(opcional)**. El selector de origen muestra el disponible: «Disponible en &lt;depósito&gt;: N · Stock N · Reservado N».

- Un traslado **no cambia el stock total**: deja una **salida en el origen** y una **entrada en el destino**, en la
  misma operación, con el motivo «Traslado entre depósitos». En Movimientos se distinguen como «Traslado · Salida» y
  «Traslado · Entrada» y cada uno muestra su depósito.
- La operación se rechaza, sin dejar rastro, si el origen y el destino son el mismo, si la cantidad no es un entero
  mayor que cero, si algún depósito está inactivo, si la fecha es futura o si la cantidad supera el **disponible del
  origen**. En ese último caso el aviso es «No hay stock suficiente».
- Al terminar, el aviso «Traslado registrado» muestra cuánto queda en cada depósito y su disponible.
- Se necesitan **al menos dos depósitos activos** para trasladar.

## Reserva y descuento de productos a pedido (F-STK-16)

Esta historia **no agrega pantallas**: define el contrato que usa el formulario de venta de otra épica.

- **Reservar:** al vender un producto «A pedido» se reserva la cantidad en el depósito elegido. El **stock total no
  baja** (sigue en 10 si había 10) pero el **reservado sube** (3) y el **disponible baja** (7).
- **Descontar:** cuando el cliente retira o recibe, la reserva se descuenta: la **cantidad baja** (7), el **reservado
  vuelve a 0** y queda una salida en el historial del libro, en el depósito de la reserva, con el motivo «Entrega de
  producto a pedido».
- **Liberar:** si la venta no se concreta, la reserva se libera: el reservado vuelve a 0 y la cantidad no cambia.
- Una reserva ya descontada o liberada **no se vuelve a descontar ni a liberar**: el sistema lo rechaza.
- Solo se puede reservar stock de productos **«A pedido»**; de un producto normal la operación se rechaza.
- Reservar más que el disponible se rechaza con «No hay stock suficiente», y dos reservas simultáneas sobre el mismo
  disponible nunca lo pasan por debajo de cero.

## Permisos

| Acción | Quién puede |
|--------|-------------|
| Ver Depósitos y el stock por depósito | `lectura` o `edicion` en Stock |
| Crear y editar depósitos, «Usar por defecto», activar/desactivar | **Solo Administrador** de la organización |
| Registrar movimientos (con depósito), trasladar | `edicion` en Stock |
| Reservar, liberar y descontar reservas | `edicion` en Stock |

La base es la autoridad: sin `edicion` las RPC de escritura rechazan la operación aunque se llamen directamente, y
sin Administrador las RPC de depósitos responden «Solo el Administrador puede definir depósitos».

## Empresa activa

**Aplica en la pantalla de Depósitos.** La tabla se filtra por la empresa de la barra superior según «Venden desde
acá»: con una empresa elegida se listan solo los depósitos desde los que esa empresa puede vender y, con **«Todas
mis empresas»**, todos. Al cambiar de empresa la tabla se recarga, no queda ninguna fila de la empresa anterior y el
formulario abierto se cierra con el aviso «Cambiaste de empresa: cerramos el formulario del depósito para no mezclar
datos. Volvé a abrirlo si querés seguir».

**No aplica en Stock actual ni en Movimientos:** el stock es único por organización y compartido entre empresas, así
que esas pantallas no se filtran por la empresa activa.

## Límites y fuera de alcance

- El **stock sigue siendo uno por producto** y compartido entre empresas y canales: los depósitos lo reparten, no lo
  duplican. `dominio.existencias.cantidad` es la suma de los depósitos.
- **No hay stock por empresa**: la relación con las empresas es «Venden desde acá», que solo alimenta el filtro de la
  pantalla.
- **La reserva manual a un cliente** (F-STK-12, P3) queda fuera de alcance: la reserva de esta épica es la de los
  productos «A pedido».
- **No hay pantalla de reservas**: el contrato existe para el formulario de venta, que es de otra épica.
- Las pestañas **«Faltantes»** y **«Actualizar por Excel»** son de MSF-368: fuera de alcance.
- El **ingreso de mercadería no elige depósito**: entra al depósito por defecto. Lo que cambia con esta épica es que
  la anulación de un ingreso devuelve la mercadería al depósito donde entró (y no al por defecto de ese momento).
- Un traslado **no emite aviso a los canales externos**: el stock total no cambia.
- La **reserva no es un depósito**: no se puede reservar mercadería de un producto que no sea «A pedido».

## Decisiones pendientes de confirmación

La épica cerró estas decisiones de la spec para poder implementarlas; quedan por confirmar con el dueño indicado:

| Decisión | Qué se implementó | Quién confirma |
|----------|-------------------|---------------|
| D-2 · Épica 5 (F-STK-12 reserva manual a un cliente, F-STK-13 múltiples depósitos) | Solo F-STK-14/15/16; la reserva manual a un cliente queda fuera | Nicolás / producto |
| D-4 · «Columnas por depósito» | Un **control de depósito** (Todos los depósitos + cada uno), no columnas fijas por depósito: con N depósitos no escalan | Nicolás / producto |
| D-5 · Traslado y evento | Un traslado **no emite** `stock.actualizado` (el stock total no cambia) | Nicolás / producto |
| D-6 · Evento y reservas | `stock.actualizado` suma depósito, reservado y disponible; reservar y liberar lo emiten con diferencia 0 | Nicolás / producto |
| D-7 · Motivo del descuento | Motivo de sistema «Entrega de producto a pedido» (solo salidas) | Nicolás / producto |
| D-8 · Idempotencia | La referencia la define quien llama (p. ej. la línea de venta) | Ventas |

## Para seguir

- **[Guía técnica de depósitos y reservas](../tecnico/stock-depositos-y-reservas.md)** — tablas, RPC, vistas,
  eventos, pruebas y reversión.
- **[Stock: movimientos, historial y mínimo](../stock.md)** — el resto de la sección Stock.
- **[Ingreso de mercadería por proveedor](ingreso-de-mercaderia.md)** — el ingreso sigue entrando al depósito por
  defecto; lo que cambia con esta épica es que la anulación devuelve la mercadería al depósito donde entró.
- Spec de la épica: `specs/20261022-180000-stock-depositos-y-reservas/`.
