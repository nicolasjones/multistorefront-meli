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

## Pendientes conocidos

Publicar los flows de Kestra y probar con el correo real, decidir si el correo lleva imágenes, el encabezado de baja automática de los clientes de correo y separar el cupo.
Están anotados en [Newsletter (técnico)](../newsletter.md).
