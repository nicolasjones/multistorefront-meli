---
owner: producto
sources: []
---

# Importaciones y exportaciones: seguir las cargas y descargas masivas

## Para qué sirve

Cuando alguien carga o descarga muchos datos de una vez (productos, stock, publicaciones de una tienda o el historial de ventas), el trabajo puede tardar y algunas filas pueden fallar. **Importaciones** reúne todos esos trabajos en un solo lugar para que puedas ver:

- cuáles están esperando, cuáles están en curso y cuáles ya terminaron;
- cuánto avanzó cada uno y cuánto tardó;
- cuántas filas fallaron y por qué;
- y, si todavía no terminó, cancelarlo.

Esta pantalla **no inicia** las cargas ni las descargas de las demás áreas del sistema: solo muestra y sigue las que
ellas hacen. La única descarga que se pide desde acá es la **exportación total de los datos**, al final de esta página.

## Quién puede verla

| Rol | Acceso |
|---|---|
| **Administrador** | Ve la pantalla y puede cancelar procesos de su organización. |
| Cualquier otro rol | No ve el ítem en el menú ni puede abrir la pantalla. |

## Dónde la encontrás

Menú **Administración → Importaciones**.

## Qué muestra la tabla

Cada fila es una carga o descarga, de la más reciente a la más antigua.

| Columna | Qué significa |
|---|---|
| **Fecha** | Cuándo se pidió el trabajo. |
| **Origen** | El nombre del trabajo, con el área de donde viene (por ejemplo, Catálogo, Stock, Mercado Libre o Exportación total) y si es una importación o una exportación. |
| **Estado** | En qué punto está (ver abajo). |
| **Avance** | Cuántas filas se procesaron sobre el total. Mientras está abierto muestra una barra de progreso. |
| **Resultado** | Cuántas filas salieron bien y cuántas no, por ejemplo «480 correctas y 20 con error». Muestra «—» si todavía no se procesó ninguna. |
| **Duración** | Cuánto tardó, o «en curso» / «sin empezar» si todavía no terminó. |

### Los estados

| Estado | Qué quiere decir |
|---|---|
| **Pendiente** | Se pidió pero todavía no empezó. |
| **En curso** | Se está procesando. |
| **Cancelando** | Pediste cancelarlo y se va a detener al terminar el lote que está procesando. |
| **Completado** | Terminó sin errores. |
| **Con errores** | Terminó, pero algunas filas no se pudieron procesar. El detalle dice cuáles y por qué. |
| **Fallido** | No pudo terminar. Las filas que ya se habían procesado se conservan. |
| **Cancelado** | Se detuvo a pedido tuyo. Lo que ya se había procesado se conserva. |

Mientras haya trabajos **Pendiente** o **En curso**, la tabla se actualiza sola cada pocos segundos. Cuando todos terminaron, deja de consultar.

Si todavía no hay trabajos, ves el mensaje **«Todavía no hay importaciones ni exportaciones»**. Aparecerá una fila cuando algún área del sistema registre una carga o una descarga.

## Ver el detalle y los errores

1. En la fila del trabajo, hacé clic en **Ver detalle**.
2. Se abre el cuadro **«Detalle de la importación»** con un resumen: nombre, origen, estado, avance, resultado, fecha de creación y duración.
3. Más abajo está la tabla de errores, con **Fila**, **Columna**, **Referencia** y **Motivo**. Se carga de a 20: al llegar al final aparecen los siguientes (o usá **Cargar más**) y el contador «Mostrando N de M errores» siempre está a la vista. El detalle guarda hasta 1000 errores por trabajo: si hubo más, el cuadro avisa «Mostrando los primeros 1000 errores de N» y el resultado sigue contando todos.
4. **Descargar errores (CSV)** baja el registro completo de errores del trabajo (fila, columna, referencia y motivo) para corregirlos y volver a cargar; si el detalle quedó truncado, el archivo termina con una fila que lo avisa.
5. Si el trabajo no tuvo errores, el cuadro dice **«Este proceso no registró errores»**.
6. Para cerrarlo, usá **Cerrar** o la tecla **Escape**.

## Cancelar un trabajo

El botón **Cancelar** aparece solo mientras el trabajo está **Pendiente** o **En curso**.

1. Hacé clic en **Cancelar** en la fila del trabajo.
2. El cuadro **«¿Cancelar este proceso?»** te muestra el nombre del trabajo y te avisa que lo ya procesado se conserva.
3. Confirmá con **Sí, cancelar el proceso** o volvé con **No, volver**.

Qué pasa según el estado:

- Si estaba **Pendiente**, pasa a **Cancelado** de inmediato y no llega a ejecutarse.
- Si estaba **En curso**, queda **Cancelando** hasta que se detiene al terminar el lote actual y pasa a **Cancelado**.
- Si estaba **En curso** pero ya no hay nadie procesándolo (por ejemplo, el trabajo se trabó y se agotaron los reintentos), pasa a **Cancelado** de inmediato.
- Si ya había terminado, aparece el aviso **«El proceso ya terminó, no se puede cancelar.»**

## Exportar todos los datos

### Para qué sirve

Te permite descargar **una copia de todos los datos de tu organización** en un solo archivo, para tener un respaldo
propio o para analizarlo afuera. El archivo viene comprimido (un `.zip`) y adentro tiene **una planilla por cada tipo de
dato**: productos, categorías, clientes, ventas, cobros, stock, proveedores, consultas, service técnico, tiendas
online y los datos de la organización, de **todas** las tiendas.

### Quién puede pedirla

Solo el **Administrador de tu propia organización**. Si sos una persona de soporte de otra organización, no podés
pedirla ni descargarla: la pantalla te avisa que la exportación es del administrador de esa organización.

### Cómo pedirla

1. En la pantalla **Importaciones**, arriba de la tabla, está el bloque **Exportar todos los datos**.
2. Hacé clic en **Exportar todos los datos**. Se abre el cuadro **«¿Exportar todos los datos de la organización?»**,
   que explica qué se descarga y qué no.
3. Confirmá con **Sí, exportar** (o volvé con **Cancelar**).
4. La exportación se prepara en segundo plano: podés seguir trabajando. El bloque dice **«Estamos preparando tu
   exportación»** y muestra una barra de avance con cuántos grupos de datos ya están listos. El trabajo también
   aparece en la tabla de abajo, como cualquier otra carga o descarga.

Si ya hay una exportación en curso y la pedís de nuevo, **no se crea otra**: te muestra la que está en curso.

### Descargarla

Cuando termina, el bloque dice **«Tu exportación está lista»** y aparece el botón **Descargar**. El archivo se llama
`exportacion-total-<fecha>.zip`.

- **Solo queda el último archivo**: cuando termina una exportación nueva, la anterior se borra. Si esperás un rato
  para guardarlo y otra persona pide una exportación, el enlace deja de servir.
- El enlace de descarga es temporal: si ya no funciona, pedí la exportación de nuevo.
- Si algún grupo de datos no se pudo leer completo, la exportación termina igual y el detalle está en el detalle del
  proceso (tabla de abajo).

### Qué incluye y qué no

| Entra en el archivo | No entra en el archivo |
|---|---|
| Productos, categorías, costos, escalas de precio y precios por empresa | Contraseñas, claves y datos de acceso |
| Clientes, cuentas de cliente, contactos y proveedores | Los archivos de las imágenes y los adjuntos (entran los datos que los referencia, no los archivos) |
| Ventas: comprobantes y sus líneas, cobros, historial de comprobantes, devoluciones y contrarreembolsos | El historial de actividad (quién hizo qué y cuándo) |
| Stock: existencias, movimientos, depósitos, lotes, reservas e ingresos de mercadería | Las conversaciones del asistente |
| Consultas de las tiendas, sus estados y las respuestas rápidas | Las invitaciones de personas |
| Service técnico: reparaciones, ítems, repuestos y modelos de equipo | Los avisos que todavía no se enviaron por correo |
| Tiendas online: tienda, textos, identidad, páginas, dominios y analítica | Los procesos internos del sistema y el registro de las tareas que se ejecutan |
| Campañas de correo y sus destinatarios | |
| Formas de pago y envío, motivos de stock, estados de consulta y de reparación | |
| Los datos de la organización: empresas, personas, roles y permisos | |

### Si algo falla

- **«Tu organización todavía no tiene habilitado el servidor de exportaciones.»**: avisale a quien administra la
  plataforma; la organización necesita esa habilitación para poder exportar.
- **«No pudimos pedir la exportación. Probá de nuevo.»**: se cortó la comunicación; volvé a intentarlo.
- **«La última exportación no pudo completarse.»**: el trabajo falló y no hay archivo para bajar. Pedila de nuevo; si
  vuelve a pasar, avisale a quien administra la plataforma.

### La empresa activa

La exportación es **de toda la organización**, no de una empresa. El bloque se ve y funciona igual con cualquier
empresa activa (también con **Todas mis empresas**) y el archivo incluye los datos de todas las tiendas.

## La empresa activa

La pantalla sigue la **empresa activa** de la barra superior.

- Con una empresa elegida, ves solo los trabajos de esa empresa.
- Con **Todas mis empresas**, ves los de todas, incluidos los que no pertenecen a una empresa en particular.
- Al cambiar de empresa, la tabla se recarga desde el principio. Si tenías un cuadro abierto, se cierra con un aviso para que no queden datos de la empresa anterior en pantalla.
- La **exportación total** es la excepción: es de toda la organización, así que su fila se ve siempre, elijas la
  empresa que elijas.

## Lo que todavía no hace esta pantalla

- **No inicia** las cargas ni las descargas de las demás áreas: cada área las dispara desde su propia pantalla. La
  exportación total sí se pide desde acá.
- **No reintenta** las filas con error: el registro de errores se puede descargar en CSV, pero reintentar es cosa de cada área.
- **No exporta por empresa ni programa exportaciones automáticas**: la exportación total es siempre de toda la organización.
- **No muestra** los errores internos del panel ni las alertas del equipo de soporte: eso se revisa por fuera de esta pantalla.

Hasta que las demás áreas empiecen a registrar sus cargas y descargas, la pantalla puede estar vacía.
