---
owner: producto
sources:
  - specs/20270328-100000-newsletter-de-la-tienda
  - design/pantallas
  - apps/web/src/pages/clientes/newsletter
---

# Tiendas online · Newsletter de la tienda (MSF-468)

**Spec:** `specs/20270328-100000-newsletter-de-la-tienda/`. Detalle técnico y pasos de despliegue: [Newsletter (técnico)](../newsletter.md).

> **Estado:** la capacidad está construida pero **apagada por defecto**. No se muestra en ninguna tienda ni se envía nada hasta que el equipo técnico
> encienda la bandera `newsletter` y se publiquen los flows de Kestra. Mientras tanto, el correo masivo a clientes funciona igual que siempre.

## Qué resuelve

Cada tienda online puede juntar **suscriptores propios** desde un formulario en el pie de la tienda, y el dueño de la empresa **compone y envía** newsletters
a quienes confirmaron su suscripción. No es el correo masivo a clientes: es **otra lista con otro consentimiento**.

- **Para quien visita la tienda**: escribe su correo, marca la casilla de consentimiento y recibe un correo para **confirmar** (el enlace vale 48 horas). Si no
  confirma, no recibe nada. Cada newsletter trae un enlace de **baja de un clic**.
- **Para el Administrador** (Contactos → Newsletter): ve cuántos suscriptores activos, pendientes y bajas hay, activa el formulario en el pie de cada tienda,
  arma campañas, las previsualiza, se manda una prueba, las envía y puede cancelar lo que todavía no salió.

## Cómo usarlo (Administrador)

1. Entrá a **Contactos → Newsletter**. Si ves un aviso de que no está habilitado en este entorno, pedile al equipo técnico que lo encienda.
2. Activá **«Mostrar suscripción en el pie de la tienda»** en las tiendas que quieran recibir suscriptores.
3. Mirá la lista de **Suscriptores** (Confirmados, Pendientes o Bajas) y buscá por correo. «Dar de baja» deja de enviarle; «Borrar datos» elimina su suscripción
   (para un pedido de supresión) y no se puede deshacer.
4. Tocá **«Nueva campaña»**: elegí la **tienda remitente**, escribí un **nombre interno** (solo lo ves vos), el **asunto** y el **mensaje** (texto plano; se muestra tal cual, sin formato),
   y activá si querés **Productos destacados** y **Promociones vigentes** (hasta 6 de cada una, con el precio actual de la tienda).
5. Tocá **«Vista previa»** para ver el correo tal como llega, **«Enviar prueba»** para mandártelo (hasta 5 por hora) y **«Guardar borrador»** si querés seguir después.
6. Tocá **«Enviar a N»** y confirmá. El envío sale por lotes dentro del cupo diario de la organización (que comparte con el correo masivo a clientes); no se puede editar
   después. En la lista de **Campañas** ves el estado (Borrador, Enviando, Enviada, Cancelada) y los totales; podés **cancelar** un envío en curso.

## Qué tener en cuenta

- Solo reciben los suscriptores **confirmados** de esa tienda. Quien se dio de baja no recibe más, aunque tuviera envíos pendientes.
- Los correos no llevan imágenes ni cuentan aperturas (no hay rastreo).
- Un newsletter grande puede **demorar** los correos a clientes de la misma organización, porque comparten el cupo diario.
- Quien no es Administrador, pero tiene acceso a Clientes, ve la pantalla en solo lectura.
- Cada acción queda en **Actividad** (sin correos ni textos).

## Qué hace quien visita la tienda

- **Suscribirse** desde el pie de la tienda: escribe su correo y marca la casilla «Acepto recibir novedades de la tienda por correo» (el texto lleva el nombre
  de la tienda). Si la tienda tiene política de privacidad, al lado de la casilla hay un enlace.
- **Confirmar** con el enlace del correo que recibe. Vale 48 horas; si se venció, la página lo avisa y hay que pedir uno nuevo desde el pie de la tienda.
- **Darse de baja** con un clic, desde el enlace que viene al pie de cada correo. La página pide confirmar con un botón: abrir el enlace no da de baja a nadie.
- **Volver a suscribirse** cuando quiera (vuelve a pasar por la confirmación).

## Quién puede hacerlo

| Tarea | Quién |
|---|---|
| Encender el newsletter de una tienda, componer y mandar campañas, dar de baja o borrar datos de un suscriptor | Administrador |
| Ver los números, la lista de suscriptores y la de campañas, en solo lectura | Quienes tienen lectura en [Clientes](clientes.md) |

## Reglas que conviene saber

- **Doble confirmación:** la suscripción no vale hasta que el visitante abre el enlace del correo. Solo los suscriptores confirmados reciben los envíos; los
  «Pendientes» no.
- **Los clientes que ya tenés no se suscriben solos:** el newsletter es otra lista, con otro consentimiento. Si alguien se suscribe desde la tienda, es un
  suscriptor más: no se toca su ficha de cliente y darse de baja de una lista no toca la otra.
- **La baja conserva el correo** en una lista de supresión, para no volver a mandarle por error. «Borrar datos» borra todo y no se puede deshacer; en los
  envíos ya hechos ese correo queda escrito como «[eliminado]».
- **El contenido se congela al mandar:** los productos y los precios que salen en el correo son los del momento del envío. La vista previa dice «Precios al
  día» con la fecha de ese momento.
- **El envío sale por el mismo canal y con el mismo cupo diario que el correo a clientes:** con el cupo por defecto de 500 por día, un envío de 1.248
  suscriptores tarda tres días.
- **El remitente es la tienda:** el nombre visible es el de la tienda, pero la dirección de envío es la misma para todas; no hay un dominio de correo propio
  por tienda.

## Empresa activa

La pantalla respeta la **empresa activa**:

- Si elegís una tienda en la barra superior, ves solo sus suscriptores, sus campañas y sus números, y esa tienda queda preseleccionada como «Tienda remitente».
- Si elegís **Todas mis empresas**, ves todas las tiendas a las que tenés acceso, con la columna «Tienda».
- Al cambiar la empresa activa se recargan los números y las dos listas, las listas vuelven al principio y se descartan los filtros y las selecciones de la
  tienda anterior.
- Si tenés abierto el diálogo de una campaña, se cierra con un aviso («Cambiaste de empresa: se cerró la campaña sin guardar») y no se guarda ni se manda
  nada con la empresa anterior. Un borrador ya guardado no se pierde.

Ver [Empresa activa](../empresa-activa.md).

## Lo que no incluye

- **No hay métricas de apertura ni de clics**: el correo no lleva rastreadores. Por eso la columna «Aperturas» que aparece en el diseño no se construyó.
- **No se pueden elegir destinatarios** por compra, por etiqueta o por grupo: van todos los suscriptores confirmados de la tienda.
- **No se programan envíos** y no hay automatizaciones (bienvenida, carrito abandonado) ni recordatorios.
- **No hay plantillas ni editor con colores**, ni se sube una imagen al cuerpo del correo.
- **No se pueden elegir productos a mano**: los destacados y las promociones salen de lo que ya marcaste en [Productos](catalogo-productos.md) y [Promociones](promociones.md).
- **No se importan suscriptores** desde una planilla ni desde la lista de clientes, y no se dan de alta a mano.
- **No hay dominio de correo propio por tienda** ni «responder a» de cada tienda.

## Pendientes conocidos

Publicar los flows de Kestra y probar con el correo real, decidir si el correo lleva imágenes, el encabezado de baja automática de los clientes de correo y separar el cupo.
Están anotados en [Newsletter (técnico)](../newsletter.md).

## Para seguir

- [Las tiendas online de tu negocio](tiendas-online.md)
- [Clientes](clientes.md)
- [Correo masivo a clientes](correo-masivo-a-clientes.md)
