---
owner: producto
sources: []
---

# Newsletter de la tienda

## Para qué sirve

Cada tienda online puede tener su propia lista de personas que quieren recibir novedades por correo. El
visitante se suscribe desde el pie de la tienda y confirma con un enlace; el dueño de la empresa escribe
el mensaje, elige qué productos o promociones mostrar, lo previsualiza y lo manda.

Es una lista **por tienda**: los suscriptores de una tienda no reciben los envíos de otra, y es una lista
distinta de la del correo a clientes: nadie pasa de una a otra sin dar su consentimiento.

## Todavía no se puede usar

La función **está construida pero apagada**: en ningún ambiente se muestra el formulario en el pie de la
tienda ni sale ningún envío, hasta que el equipo técnico la enciende y publica los envíos automáticos.

Si entrás a la pantalla y te dice que no está habilitada en este entorno, pedile al equipo técnico que la
active; cuando esté encendida, esta guía va a explicar los pasos.

Mientras tanto, la tienda sigue funcionando como siempre: el visitante mira el catálogo, consulta por
WhatsApp o escribe un mensaje, y esas consultas llegan a [Consultas](consultas.md). El
[correo masivo a clientes](correo-masivo-a-clientes.md) sigue igual.

## Qué va a poder hacer el visitante

- **Suscribirse** desde el pie de la tienda: escribe su correo y marca la casilla «Acepto recibir
  novedades de la tienda por correo» (el texto lleva el nombre de la tienda). Si la tienda tiene política
  de privacidad, al lado de la casilla hay un enlace.
- **Confirmar** la suscripción con el enlace del correo que recibe. El enlace vale 48 horas; si se venció,
  la página lo avisa y hay que pedir uno nuevo desde el pie de la tienda.
- **Darse de baja** con un clic, desde el enlace que viene al pie de cada correo. La página pide confirmar
  con un botón: abrir el enlace no da de baja a nadie.
- **Volver a suscribirse** cuando quiera (vuelve a pasar por la confirmación).

## Qué va a poder hacer el equipo

El panel tiene una pantalla **Newsletter**, en el grupo **Contactos**. Desde ahí:

- Ver tres números arriba: **Suscriptores activos**, **Pendientes de confirmar** y **Bajas**.
- **Encender o apagar el newsletter de cada tienda** con el interruptor «Mostrar suscripción en el pie de la
  tienda». Apagado, el pie de la tienda no muestra el formulario y no sale ningún envío.
- Ver los **suscriptores**: correo, tienda, origen, fecha de alta y estado. Se pueden filtrar por
  **Confirmados**, **Pendientes** o **Bajas**, y buscar por correo.
- **Dar de baja** a un suscriptor (deja de recibir, incluso lo que estuviera pendiente) o **borrar sus
  datos** (elimina la suscripción y no se puede deshacer).
- Ver las **campañas**: campaña, tienda, asunto, fecha, destinatarios, cuántos enviados/fallidos/omitidos/bajas
  y en qué estado está (**Borrador**, **Enviando**, **Enviada**, **Cancelada**). Un borrador se puede
  editar o descartar; un envío en curso se puede cancelar; uno ya enviado no se edita.

### Componer y mandar una campaña

Con **«Nueva campaña»** se abre un diálogo con:

- **Nombre interno**: para reconocerla en la lista (el visitante no lo ve).
- **Asunto del correo**: una línea, de hasta 200 caracteres.
- **Tienda remitente**: la tienda cuya identidad y cuyos suscriptores se usan.
- **Destinatarios**: los suscriptores activos de esa tienda, en solo lectura (no se puede elegir un grupo).
- **Mensaje**: texto plano, de hasta 10 000 caracteres. Se muestra tal cual, sin formato.
- Dos interruptores: **Productos destacados** (hasta 6, los que marcaste como destacados en esa tienda) y
  **Promociones vigentes** (hasta 6, las que están vigentes en esa tienda).

Antes de salir se puede **ver la vista previa** (el correo tal como lo va a recibir el visitante, con un
enlace de baja de ejemplo y la fecha de los precios), **mandarse una prueba** al propio correo (con
prefijo «[Prueba]», hasta 5 por hora) y **guardar el borrador** para seguir con él más tarde.

Para salir: **«Enviar a N»** pide confirmación y manda el correo a los N suscriptores confirmados de esa
tienda. Si el envío todavía está en curso se puede **cancelar**: lo que ya salió se queda, lo que no salió
queda como «omitido».

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Encender el newsletter de una tienda, componer y mandar campañas, dar de baja o borrar datos de un suscriptor | Administrador |
| Ver los números, la lista de suscriptores y la de campañas, en solo lectura | Quienes tienen lectura en [Clientes](clientes.md) |

## Reglas que conviene saber

- **Doble confirmación:** la suscripción no vale hasta que el visitante abre el enlace del correo. Solo
  los suscriptores confirmados reciben los envíos; los que están «Pendientes» no.
- **Los clientes que ya tenés no se suscriben solos:** el newsletter es otra lista, con otro
  consentimiento. Si alguien se suscribe desde la tienda, es un suscriptor más: no se toca su ficha de
  cliente y darse de baja de una lista no toca la otra.
- **La baja conserva el correo** en una lista de supresión, para no volver a mandarle por error. «Borrar
  datos» borra todo y no se puede deshacer; en los envíos ya hechos ese correo queda escrito como
  «[eliminado]».
- **El contenido se congela al mandar:** la foto de los productos y los precios que salen en el correo
  son los del momento del envío. La vista previa dice «Precios al día» con la fecha de ese momento.
- **Los correos no llevan imágenes ni cuentan aperturas**: no hay fotos de producto ni rastreadores, así que
  tampoco se ven las aperturas.
- **El envío sale por el mismo canal y con el mismo cupo diario que el correo a clientes:** un envío
  grande (por ejemplo, 1.248 suscriptores con un cupo de 500 por día) tarda tres días y se sirve en el
  mismo orden que el correo a clientes.
- **El remitente es la tienda:** el nombre visible es el de la tienda, pero la dirección de envío es la
  misma para todas; no hay un dominio de correo propio por tienda.
- Cada acción queda registrada en [Actividad](../actividad.md), sin correos ni textos.

## Empresa activa

La pantalla respeta la **empresa activa**:

- Si elegís una tienda en la barra superior, vas a ver solo sus suscriptores, sus campañas y sus
  números, y esa tienda queda preseleccionada como «Tienda remitente».
- Si elegís **Todas mis empresas**, vas a ver todas las tiendas a las que tenés acceso, con la columna
  «Tienda».
- Al cambiar la empresa activa se recargan los números y las dos listas, las listas vuelven al principio y
  se descartan los filtros y las selecciones de la tienda anterior.
- Si tenés abierto el diálogo de una campaña, se cierra con un aviso («Cambiaste de empresa: se cerró la
  campaña sin guardar») y no se guarda ni se manda nada con la empresa anterior. Un borrador ya guardado no
  se pierde.

Ver [Empresa activa](../empresa-activa.md).

## Lo que no incluye

- **No hay métricas de apertura ni de clics**: el correo no lleva rastreadores. Por eso la columna
  «Aperturas» que aparece en el diseño no se construyó.
- **No se pueden elegir destinatarios** por compra, por etiqueta o por grupo: van todos los suscriptores
  confirmados de la tienda.
- **No se programan envíos** y no hay automatizaciones (bienvenida, carrito abandonado) ni recordatorios.
- **No hay plantillas, ni editor con colores**, ni se sube una imagen al cuerpo del correo.
- **No se pueden elegir productos a mano**: los destacados y las promociones salen de lo que ya marcaste
  en [Productos](catalogo-productos.md) y [Promociones](promociones.md).
- **No se importan suscriptores** desde una planilla ni desde la lista de clientes, y no se dan de alta a
  mano.
- **No hay dominio de correo propio por tienda** ni «responder a» de cada tienda.

## Para seguir

- [Las tiendas online de tu negocio](tiendas-online.md)
- [Clientes](clientes.md)
- [Correo masivo a clientes](correo-masivo-a-clientes.md)
- [Empresa activa](../empresa-activa.md)
