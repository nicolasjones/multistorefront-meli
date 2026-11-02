---
owner: producto
sources: []
---

# Contactos: la libreta de personas

## Para qué sirve

La libreta de **Contactos** guarda a las personas que te consultan o te compran, separadas por tienda. Así sabés a quién le hablás, qué consultó y qué compró, sin cargar dos veces a la misma persona y con el consentimiento para guardar sus datos.

Es distinta de la sección **Contactos → Clientes**: un contacto de la libreta no crea ni modifica un cliente. Sirve para el seguimiento de consultas y compras de la tienda, no para la facturación.

## Quién puede hacerlo

La libreta usa el mismo permiso que **Consultas**.

| Permiso en Consultas | Qué puede hacer |
|---|---|
| **Edición** | Ver la libreta, crear y editar contactos, vincular consultas y comprobantes, y anonimizar. |
| **Solo lectura** | Ver la libreta y las fichas, sin botones para cambiar nada. |
| **Sin acceso** | No ve la opción en el menú ni puede abrir la dirección de la pantalla. |

Si un botón aparece deshabilitado, pasá el mouse por encima: dice «Necesitás permiso de edición».

## Dónde lo encontrás

En el menú de la izquierda: **Canales → Contactos**. Queda debajo de **Consultas**.

La libreta muestra los contactos de la **empresa activa** de la barra superior. Si elegís **Todas mis empresas**, ves los contactos de todas las tiendas a las que tenés acceso y, debajo de cada nombre, la tienda a la que pertenece.

## La libreta

La tabla tiene estas columnas:

| Columna | Qué muestra |
|---|---|
| **Nombre** | El nombre de la persona. Hacé clic para abrir su ficha. Si estás en «Todas mis empresas», debajo aparece la tienda. |
| **Correo** | Su correo, si lo tiene. |
| **Teléfono** | Su teléfono, si lo tiene. |
| **Estado** | **Activo** o **Anonimizado**. |

Arriba podés **Buscar contactos** por nombre, correo o teléfono: escribí parte del dato y la lista se actualiza sola. El listado muestra de a 25 contactos por página e indica cuántos hay en total.

- Si un filtro no encuentra nada, ves «Sin resultados para el filtro».
- Si todavía no cargaste ninguno, ves «Todavía no hay contactos».

## Crear un contacto

Podés crearlo desde la libreta o desde una consulta.

### Desde la libreta

1. Elegí una tienda en la barra superior. Si estás en **Todas mis empresas**, el botón **Nuevo contacto** queda deshabilitado con el aviso «Elegí una tienda para crear un contacto».
2. Hacé clic en **Nuevo contacto**.
3. Completá:
   - **Nombre**: obligatorio.
   - **Correo**: opcional si cargás un teléfono.
   - **Teléfono**: opcional si cargás un correo. Tiene que tener entre 7 y 15 dígitos.
   - **Confirmo el consentimiento de la persona**: obligatorio para guardar.
4. Hacé clic en **Guardar contacto**. Se abre la ficha del contacto nuevo.

Al menos uno de los dos datos de contacto (correo o teléfono) es obligatorio. El sistema guarda la fecha, quién registró el consentimiento y una copia del texto que la persona aceptó.

### Desde una consulta

1. Abrí una consulta en **Canales → Consultas**.
2. En el detalle, hacé clic en **Crear contacto**.
3. El formulario ya trae el nombre y el dato de contacto de la consulta: si el dato tiene un correo, va a **Correo**; si es un teléfono, va a **Teléfono**. Revisalo y completá lo que falte.
4. Confirmá el consentimiento y hacé clic en **Guardar contacto**. La consulta queda vinculada al contacto nuevo.

Si la consulta ya tiene un contacto vinculado, en lugar del botón ves **Contacto en la libreta** con un enlace a su ficha.

### Si la persona ya existe

No se pueden cargar dos contactos activos con el mismo correo o el mismo teléfono en una misma tienda. Si intentás guardar un dato repetido:

- El sistema no crea el contacto.
- Aparece un aviso: «Ya existe un contacto con ese correo o teléfono en [tienda]», con un enlace para verlo.
- Si venías desde una consulta, tenés el botón **Vincular la consulta al existente**.

El correo se compara sin importar mayúsculas ni espacios, y el teléfono se compara solo por sus números.

## La ficha del contacto

En la ficha ves el estado (**Activo** o **Anonimizado**), la fecha del consentimiento y los datos personales. Si podés editar, los campos **Nombre**, **Correo** y **Teléfono** están habilitados y tenés los botones **Guardar** y **Anonimizar**.

- Si cambiás un dato y otra persona ya había guardado ese contacto, ves «Otra persona modificó este contacto mientras lo editabas. Recargalo para ver sus cambios.» con el botón **Recargar**.
- Si el dato nuevo repite el correo o teléfono de otro contacto de la tienda, el cambio no se guarda y el aviso te lo explica.

### El historial

La sección **Historial** reúne, de lo más nuevo a lo más viejo:

- Las **consultas** vinculadas a ese contacto, con su fecha, tienda, estado y un resumen del mensaje.
- Las **compras** (comprobantes) vinculadas, con su fecha, tienda, estado y total.

Para sumar una compra al historial:

1. Hacé clic en **Vincular comprobante**.
2. Escribí el **Número o cliente** del comprobante y hacé clic en **Buscar**.
3. En la lista de resultados, hacé clic en **Vincular** en el comprobante correcto. Solo se ofrecen comprobantes de la misma tienda que el contacto.

Una compra vinculada se puede quitar con **Desvincular**. Las consultas no se desvinculan desde la ficha.

Si todavía no hay nada vinculado, ves «Sin historial todavía».

## Anonimizar un contacto

**Anonimizar** borra los datos personales y no se puede deshacer.

1. Abrí la ficha del contacto y hacé clic en **Anonimizar**.
2. Leé el aviso y confirmá en **Anonimizar**.
3. El contacto queda como **Anonimizado**, en solo lectura.

Qué cambia:

- El nombre, el correo y el teléfono del contacto se reemplazan por un texto neutro.
- En las consultas vinculadas se reemplazan el nombre, el contacto y el mensaje, y se borra la nota interna.
- Se libera el correo o teléfono para que puedas cargar a otra persona con ese dato.

Qué se conserva:

- Las consultas y las compras siguen existiendo, con su estado, fechas, producto, tienda y totales.
- La fecha, el texto y quién registró el consentimiento se conservan como prueba.
- La bandeja de Consultas y los comprobantes de Ventas se siguen abriendo.

Los datos originales solo se pueden recuperar desde una copia de seguridad. Por eso el sistema no ofrece «desanonimizar».

## Respuestas rápidas

Las **respuestas rápidas** son textos que el equipo guarda para contestar más rápido. Se administran desde **Canales → Consultas**, con el botón **Respuestas rápidas** que está arriba a la derecha. Cada tienda tiene sus propios textos.

1. Elegí una tienda en la barra superior. Si estás en **Todas mis empresas**, el sistema te pide que elijas una para ver sus respuestas.
2. Hacé clic en **Respuestas rápidas**.
3. Hacé clic en **Nueva respuesta**, completá **Título** y **Texto**, y guardá. El título admite hasta 80 caracteres y el texto, hasta 1000.
4. Para cambiar una respuesta, hacé clic en **Editar**. Para quitarla, hacé clic en **Eliminar** y confirmá.

Podés usar estas variables dentro del texto; al responder se reemplazan solas:

| Variable | Se reemplaza por |
|---|---|
| `{nombre}` | El nombre de la persona que consultó. |
| `{tienda}` | El nombre de la tienda de la consulta. |
| `{producto}` | El producto de interés de la consulta, si tiene uno. |

Si una variable no tiene valor, se reemplaza por vacío y no quedan llaves ni espacios de más. Una variable que no existe se deja tal cual.

### Responder con una respuesta rápida

1. Abrí una consulta y, en **Respuesta rápida**, elegí uno de los textos de esa tienda.
2. Hacé clic en **Responder por correo** o **Responder por WhatsApp**.

El texto inicial que se abre en tu correo o en WhatsApp es el de la respuesta elegida, con las variables reemplazadas por los datos de la consulta. Si no elegís ninguna, se usa el texto de siempre. **El sistema no envía nada**: el mensaje lo mandás desde tu correo o WhatsApp.

El estado y el responsable de la consulta cambian igual que siempre al responder.

## Empresa activa

La libreta y las respuestas rápidas respetan la tienda elegida en la barra superior.

- Si cambiás de tienda en la libreta, se recarga la lista, la búsqueda vuelve a la primera página y se cierra el formulario que estuviera abierto, con un aviso.
- Si cambiás de tienda mientras ves la ficha de un contacto, volvés a la libreta con un aviso.
- Si cambiás de tienda con el diálogo **Respuestas rápidas** abierto, se cierra con un aviso.
- Nunca se muestran ni se guardan datos de la tienda anterior.

## Preguntas frecuentes

**¿Esto reemplaza a Clientes?** No. Clientes es la ficha comercial para vender y facturar. La libreta de Contactos guarda a quien consultó o compró por la tienda y su historial de conversaciones y compras.

**¿Puedo borrar un contacto?** No se borra: se anonimiza. Así las consultas y las ventas no quedan rotas.

**¿Puedo tener dos contactos con el mismo correo?** No dentro de la misma tienda, mientras estén activos. Si uno se anonimiza, ese correo queda libre.

**¿El contacto se crea solo cuando alguien compra?** No por ahora. Podés crearlo desde una consulta o a mano desde la libreta, y vincular las compras desde la ficha.

**¿Los datos se borran solos después de un tiempo?** Todavía no. La anonimización se hace a mano cuando corresponde.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **Elegí una tienda para crear un contacto** | Estás en «Todas mis empresas». Elegí una tienda en la barra superior. |
| **Escribí el nombre.** | El nombre es obligatorio. |
| **Indicá al menos un correo o un teléfono.** | Cargá uno de los dos datos. |
| **El correo no es válido.** | Revisá el correo. |
| **El teléfono debe tener entre 7 y 15 dígitos.** | Revisá el número. |
| **Confirmá el consentimiento para guardar el contacto.** | Marcá la casilla del consentimiento. |
| **Ya existe un contacto con ese correo o teléfono en esta empresa.** | Buscalo con la búsqueda y abrí su ficha, o vinculá la consulta al existente. |
| **Otra persona modificó este contacto mientras lo editabas.** | Hacé clic en **Recargar** y volvé a intentar. |
| **No pudimos cargar los contactos.** | Hacé clic en **Reintentar**. |
| **No encontramos ese contacto.** | El enlace es viejo, el contacto no existe o no tenés acceso a su tienda. |
| **No tenés permiso para cambiar este contacto.** | Pedile al Administrador que revise tu permiso en Consultas. |
