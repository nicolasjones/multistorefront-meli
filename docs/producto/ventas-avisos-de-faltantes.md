---
owner: producto
sources: []
---

# Avisar a los clientes cuando vuelve a haber stock

## Para qué sirve

Cuando a un cliente le faltó un producto en un pedido y más tarde vuelve a haber stock, el sistema te dice
**qué pedidos ya se pueden cubrir** y te deja **avisarle al cliente por correo** con un clic: elegís los
faltantes, escribís el texto que quieras mandar y el cliente recibe un correo con el detalle de lo que volvió a
haber.

## Quién puede hacerlo

| Persona | Qué hace |
|---|---|
| **Administrador, Operador, Mostrador y Administración** | Ven la pantalla de Faltantes, pueden marcar pedidos y enviar los avisos |
| **Depósito y Consulta** | Ven la pantalla de Faltantes, pero no pueden enviar avisos: las casillas y el botón no les aparecen |

Los permisos iniciales los puede cambiar el Administrador.

## Dónde lo encontrás

- **Ventas → Faltantes**: los pedidos que quedaron sin stock.
- **Stock → Ingreso de mercadería**: cuando registrás un ingreso, el sistema marca los pedidos que ese ingreso
  cubre (ver [Registrar un ingreso de mercadería](ingreso-de-mercaderia.md)).

## Ver qué pedidos ya se pueden avisar

En la pantalla de Faltantes hay una columna **Aviso** con uno de estos estados:

| Estado | Qué significa |
|---|---|
| **Sin avisar** | Todavía no le avisaste a ese cliente |
| **Para avisar** | La mercadería de ese producto volvió a entrar y el pedido se puede cubrir. **El sistema no manda ningún correo**: es una sugerencia para que vos decidas |
| **En cola** | Mandaste el aviso y el correo todavía no salió. Sale en menos de un minuto |
| **Avisado · dd/mm/aaaa** | El correo salió, en esa fecha |
| **Aviso fallido** | El correo no se pudo enviar. Debajo se ve el motivo y el botón **Reintentar** |

El filtro **Todos · Para avisar**, arriba de la lista, muestra solo los pedidos marcados **Para avisar**, del más
antiguo al más nuevo (los que más están esperando).

La marca **Para avisar** aparece cuando registrás un ingreso de mercadería del producto de esos pedidos: el
sistema toma los pedidos más antiguos hasta que se agota la cantidad que ingresó.

Tres cosas que conviene saber:

- La marca **no** es una reserva: no descuenta stock y no bloquea el pedido.
- Si después **anulás** el ingreso, la marca sigue puesta (podés seguir avisando).
- Lo único que entra por esta vía es el **ingreso de mercadería**. Una carga en lote, una toma de inventario, un
  traslado o una devolución de mercadería **no** marcan pedidos.

## Avisar a los clientes

1. Entrá a **Ventas → Faltantes**.
2. Si querés ver solo una tienda, elegila en el filtro **Tienda** (o en la empresa activa de la barra superior).
3. Marcá las casillas de los pedidos que querés avisar. La casilla del encabezado marca todos los que están a la
   vista.
4. Abajo ves cuántos elegiste: «N seleccionados de M faltantes».
5. Hacé clic en **Avisar a los seleccionados (N)**.
6. Se abre la ventana **Avisar a los clientes**, que te dice a cuántos clientes se les va a escribir.
7. Editá el **Texto del aviso** (hasta 1.000 caracteres). Por defecto viene «Volvió a haber stock de los productos
   que tenías pedidos:».
8. Si entre lo que marcaste hay pedidos **ya avisados**, aparece la casilla **Volver a avisar a los N ya avisados**.
   Si no la tildás, esos pedidos no se vuelven a avisar.
9. Hacé clic en **Enviar avisos**. Aparece «Avisos en cola.» y los pedidos quedan **En cola**; cuando el correo sale pasan a **Avisado** con la fecha.

### Qué pasa después

- Se manda **un correo por cliente**: si a un cliente le faltan dos productos, recibe un solo correo con los dos.
- El correo va en texto plano, con el texto que escribiste y el detalle de los productos y el comprobante.
- Los pedidos quedan **En cola** y, cuando sale el correo, **Avisado** con la fecha de envío.
- Si el correo no se puede enviar, el pedido muestra **Aviso fallido** con el motivo (por ejemplo, «el correo del cliente no es una dirección válida») y podés tocar **Reintentar**: se abre el mismo aviso con ese pedido elegido. Si el motivo dice que el servidor de correo no respondió a tiempo, el correo pudo haber salido: revisalo antes de reintentar.
- Un aviso fallido por falta de respuesta no se reenvía solo; los demás se reintentan solos unas pocas veces antes de marcarse como fallidos.
- Si a un cliente **no tiene correo**, el pedido **no** se marca y el aviso te lo dice: «El cliente no tiene correo.»
- Si el pedido se resuelve antes de que salga el correo (por ejemplo, si retomás el armado), no se manda nada y el
  pedido vuelve a **Sin avisar** y se explica que el pedido se cerró antes de enviar el aviso.

## Límites

- **El sistema no manda ningún correo por su cuenta.** El aviso lo enviás vos.
- **Avisar no cierra el pedido.** El faltante se sigue viendo hasta que retomes el armado de la factura.
- **No se avisa dos veces el mismo pedido** sin que lo confirmes con la casilla de reaviso, y **nunca antes de 24 horas** de haberlo avisado, aunque tildes la casilla.
- **Tope diario**: tu organización puede mandar hasta **1.000 avisos por día** (cuenta las últimas 24 horas). Los que pasan el tope quedan para la ventana siguiente y el aviso emergente te lo dice.
- **El filtro cambia lo que ves y lo que elegís**: al pasar de **Todos** a **Para avisar** (o al revés) se descarta la selección, así «Avisar (N)» cuenta solo lo que está a la vista.
- **Si llegó mercadería y el aviso falló**, el pedido sigue en **Para avisar** (con **Aviso fallido**): la mercadería llegó, falta avisar.
- **Se avisa de a 200 pedidos por vez**: si marcaste más, el sistema te avisa cuántos desmarcar.
- Solo se avisan los pedidos **abiertos** de las tiendas a las que tenés acceso.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| «No pudimos enviar los avisos. Probá de nuevo.» | No se mandaron avisos. Reintentá |
| «No se enviaron avisos.» | De los pedidos que elegiste, ninguno se pudo avisar: mirá el detalle que viene abajo |
| «Tu rol no puede avisar faltantes.» | Tu rol no tiene permiso de aviso. Pedile a un Administrador o a alguien que lo tenga |
| «El cliente no tiene correo: …» / «N clientes no tienen correo: …» | A esos clientes no se les puede avisar por correo. Cargales el correo ([ver cómo](clientes.md)) o avisales por otro medio. Los pedidos quedan **Sin avisar** |
| «1 faltante ya estaba avisado.» / «N faltantes ya estaban avisados.» | Esos pedidos ya tienen aviso: tildá **Volver a avisar** si querés mandarlo de nuevo |
| «1 faltante tiene un envío en curso.» / «N faltantes tienen un envío en curso.» | A esos clientes ya se les está mandando el aviso: esperá a que salga |
| «1 faltante es de una tienda donde tu rol no puede avisar.» / «N faltantes son de tiendas donde tu rol no puede avisar.» | Los marcaste de una tienda donde no tenés permiso |
| «1 faltante ya no está abierto.» / «N faltantes ya no están abiertos.» | Esos pedidos se resolvieron mientras los elegías. Revisá la lista |
| «N faltantes se avisaron hace menos de 24 horas y no se vuelven a avisar.» | Esperá a que pasen las 24 horas |
| «Se alcanzó el tope diario de avisos de tu organización…» | Volvé a avisar más tarde: pasan a la siguiente ventana de 24 horas |
| «Elegí entre 1 y 200 faltantes para avisar.» | Marcá al menos un pedido y no más de 200 por vez |
| «El texto del aviso no puede tener más de 1.000 caracteres.» | Acortá el texto |
| «Cambiaste de empresa: se cerró el aviso a los clientes.» | Cambiaste la tienda con la ventana abierta. Volvé a marcar los pedidos |

## Ver también

- [Armar, controlar y entregar pedidos, y registrar faltantes](ventas-despacho-y-faltantes.md) — de dónde salen
  los pedidos sin stock.
- [Registrar un ingreso de mercadería](ingreso-de-mercaderia.md) — el ingreso que marca los pedidos para avisar.
- [Cargar stock desde una planilla, exportar y recibir avisos](stock-carga-exportacion-y-avisos.md) — los avisos de
  los pedidos «a pedido» de Stock.
- [Clientes](clientes.md) — cargarle el correo a un cliente para poder avisarle.
