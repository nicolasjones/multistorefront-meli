---
owner: producto
sources: []
---

# Consultas de las tiendas online

## Para qué sirve

Cuando alguien te escribe desde la tienda online, el mensaje llega acá. La bandeja de Consultas junta todo en un solo lugar para que el equipo sepa qué consultas llegaron, quién se está ocupando y cuáles ya se resolvieron.

## Qué es una consulta

Hay dos formas de que llegue una:

- **Formulario**: la persona completó el formulario de contacto de la tienda con su nombre, un dato de contacto y un mensaje.
- **WhatsApp**: la persona tocó el botón de WhatsApp de un producto en la tienda. Queda registrado el producto que le interesaba, aunque no haya dejado mensaje.

Y una tercera, que **todavía no está habilitada** en tu ambiente (ver [Pedidos y presupuesto desde la tienda](tienda-compra-y-cuentas.md)):

- **Pedido**: la persona armó una lista con varios productos y cantidades en la tienda y la mandó **sin pagar**. Queda registrada con los ítems del pedido, no con un solo producto.

Las respuestas **se dan por fuera del sistema**, por correo o por WhatsApp. En Consultas solo registrás si ya fue atendida.

## Quién puede hacerlo

| Rol | Qué puede hacer |
|---|---|
| Quien tiene permiso de edición en Consultas | Ver todo, asignar responsable, cambiar el estado, anotar, responder y administrar las respuestas rápidas. |
| Quien tiene solo lectura | Ve la bandeja y el detalle, sin cambiar nada («Solo lectura: tu rol puede ver las consultas pero no cambiarlas.»). |

El Administrador define el permiso de cada rol en **Administración → Roles y permisos**. Si tu rol no incluye Consultas, no vas a ver la opción en el menú.

## Dónde lo encontrás

Menú lateral **Canales → Consultas**. Al lado del nombre aparece el número de consultas nuevas sin atender.

![Bandeja de Consultas con las solapas de tienda, el buscador, los botones de estado y la tabla de consultas con su contacto, producto y origen](img/consultas/01-bandeja.png)

*La bandeja de Consultas, con datos de ejemplo.*

## Cómo se ve la bandeja

Cada fila es una consulta, de la más nueva a la más vieja. La lista carga de a 25: cuando llegás al final se siguen cargando solas, o apretá **Cargar más** al pie. Ver [Cómo se muestran las listas](listados.md).

| Columna | Qué muestra |
|---|---|
| **Estado** | Nueva, En curso o Resuelta. |
| **Cuándo** | Día y hora en que llegó. |
| **Empresa** | La tienda a la que le escribieron. |
| **Contacto** | El nombre (hacé clic para abrir la consulta) y su correo o teléfono. |
| **Producto** | El producto de interés, o «Sin producto». En un pedido, «Pedido de N productos». |
| **Origen** | Formulario, WhatsApp o Pedido. |

## Filtrar y buscar

- **Tienda**: «Todas las tiendas» o una en particular. También se filtra con la empresa elegida en la barra superior.

![Filtro de tienda con San Javucho elegido](img/consultas/04-filtro-tienda.png)

*Elegí una tienda (1) para ver solo sus consultas.*

- **Buscar consultas**: escribí parte del nombre, del producto o del mensaje.
- **Todas / Nuevas / En curso / Resuelta**: filtra por estado. En «Nuevas» ves entre paréntesis cuántas hay.

![Filtro de estado con Nuevas marcado y la lista de consultas nuevas](img/consultas/02-filtro-nuevas.png)

*Con «Nuevas» (1) ves solo las que nadie tomó.*

![Bandeja filtrada por estado Resuelta](img/consultas/03-filtro-resueltas.png)

*Con «Resuelta» ves las que ya fueron atendidas.*

- **Desde** y **Hasta**: acotan por fecha.

Si no hay coincidencias ves «Sin resultados para el filtro». Si todavía no llegó ninguna, «Todavía no hay consultas».

## Atender una consulta

1. Hacé clic en el nombre de la persona para abrir la consulta. Se abre una ventana con la tienda, el origen, el estado, el contacto, el producto de interés y el mensaje.

![Consulta recibida por el formulario de contacto, con estado, responsable y nota interna](img/consultas/05-detalle-formulario.png)

*Una consulta del formulario: tiene mensaje y el botón para responder por WhatsApp, porque dejó un teléfono.*

![Consulta recibida por WhatsApp, con el producto de interés](img/consultas/06-detalle-whatsapp.png)

*Una consulta de WhatsApp: muestra el producto que le interesaba y no trae mensaje propio.*

2. En **Responsable** elegí quién se ocupa, o «Sin responsable».
3. En **Estado** elegí Nueva, En curso o Resuelta.
4. En **Nota interna** anotá lo que el equipo necesite saber. Solo la ve el equipo, nunca la persona que escribió.
5. Hacé clic en **Guardar**.

### Responder desde la consulta

Si el contacto es un correo o un teléfono, aparece el botón **Responder por correo** o **Responder por WhatsApp**. Se abre tu aplicación de correo o WhatsApp con un mensaje inicial. El sistema no envía nada por vos: mandás el mensaje desde esa aplicación.

Al responder, una consulta Nueva pasa a **En curso** y, si no tenía responsable, queda a tu nombre. Una consulta En curso o Resuelta conserva su estado.

### Usar una respuesta rápida

Si el equipo guardó textos frecuentes para esa tienda, en el detalle aparece **Respuesta rápida**. Elegí uno y después tocá **Responder por correo** o **Responder por WhatsApp**: el mensaje inicial se abre con ese texto y las variables ya completadas. Si no elegís ninguno, se usa el texto de siempre.

Las respuestas rápidas no envían nada: solo arman el mensaje que abrís en tu correo o WhatsApp. El sistema no sabe si el mensaje salió. Para crearlas o cambiarlas, mirá [Respuestas rápidas](contactos.md#respuestas-rapidas).

### Sumar la consulta a la libreta de contactos

En el detalle de la consulta podés guardar a la persona en la libreta de **Contactos**. Si todavía no está, aparece **Crear contacto**; si ya está vinculada, aparece **Contacto en la libreta** con un enlace a su ficha. El formulario trae el nombre y el contacto de la consulta, y al guardar la consulta queda vinculada. Ver [Contactos](contactos.md#crear-un-contacto).

### Atender un pedido de la tienda

Un pedido se atiende igual que cualquier otra consulta (mismos estados, mismo responsable, misma nota
interna). Lo que cambia es el detalle:

- En lugar del bloque «Producto de interés», aparece el bloque **Pedido**, con una tabla de **Producto · SKU ·
  Cantidad · Precio de referencia · Subtotal** y el **Total de referencia**. En el celular, cada línea es una
  tarjeta.
- Debajo dice: «Precios de referencia calculados al enviar, tal como los vio la persona en la tienda.
  Confirmalos al responder.»
- El mensaje que escribió la persona se llama **Nota de la persona** (si no escribió nada, dice «Sin nota»).
- Si la persona tenía cuenta en la tienda, aparece la fila **Cliente** con su número y su nombre.

El botón **Responder por correo/WhatsApp** abre tu aplicación con un mensaje inicial que ya lista los ítems
del pedido, para que no tengas que escribirlos de nuevo.

**Los datos del pedido no se borran solos.** Todavía no está definido un plazo de conservación, así que ni las
consultas, ni los ítems de un pedido se limpian automáticamente.

### Quitar los datos personales de un pedido

En el panel **no hay ninguna acción para borrar una consulta** y los pedidos tampoco se limpian solos. Para que
no queden datos personales de una persona:

1. Si la consulta está **vinculada a un contacto** de la libreta, abrí la ficha del contacto y hacé clic en
   **Anonimizar**: se reemplazan el nombre, el contacto y el mensaje, y el contacto queda en solo lectura. Los
   ítems del pedido se conservan (son productos, no datos de la persona). Ver
   [Anonimizar un contacto](contactos.md#anonimizar-un-contacto).
2. Si la consulta **no** está vinculada a ningún contacto, hoy no hay ninguna acción en el panel: hay que
   pedir el borrado al equipo técnico, que lo hace sobre la base de datos (al borrarla se van también sus
   ítems).

Lo mismo corre para los presupuestos que se crean desde la tienda: no se purgan solos y su nota se borra con
el comprobante.

## Avisos de consultas nuevas

Cada consulta nueva genera un aviso por correo para las personas que tienen acceso a Consultas y mantienen activado el aviso «Consulta nueva». Si llegan varias seguidas, se juntan en un solo correo. Cada persona activa o desactiva este aviso desde su cuenta; mirá [Avisos y listas configurables](avisos-y-listas.md).

## Estados

En la bandeja se usan tres estados:

| Estado | Cuándo usarlo |
|---|---|
| **Nueva** | Llegó y nadie la tomó. |
| **En curso** | Alguien se está ocupando. |
| **Resuelta** | Ya fue atendida. |

![Consulta resuelta con responsable y nota interna](img/consultas/07-consulta-resuelta.png)

*Una consulta resuelta: queda con su responsable y la nota interna del equipo.*

El Administrador también tiene una lista de estados de consulta en **Administración → Listas configurables**. Por ahora los cambios que hagas ahí no modifican estos tres estados de la bandeja.

## Si algo no sale

| Mensaje | Qué hacer |
|---|---|
| «La consulta cambió.» | Otra persona la modificó mientras la editabas. Hacé clic en **Recargar** y volvé a cargar tus cambios. |
| «No se guardó la consulta.» / «No pudimos guardar la consulta. Intentá de nuevo.» | Reintentá; si sigue, recargá la página. |
| «No se registró la respuesta.» | Se abrió tu aplicación, pero el cambio de estado no quedó guardado. Hacé clic en **Reintentar**. |
| «No encontramos esa consulta o no tenés acceso a ella.» | El enlace es viejo o es de otra tienda a la que no tenés acceso. |
| «No pudimos cargar las consultas.» | Hacé clic en **Reintentar**. |
| «Ya existe un contacto con ese correo o teléfono en esta empresa.» | La persona ya está en la libreta de esa tienda. Abrí el contacto existente o vinculá la consulta a él. Ver [Contactos](contactos.md). |
