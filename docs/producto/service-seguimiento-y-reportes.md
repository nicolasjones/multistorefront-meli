---
owner: producto
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Service técnico: fotos, garantía, seguimiento del cliente y reportes

Esta página explica cuatro cosas nuevas del Service técnico: **adjuntar fotos del equipo**, **reingresar un equipo
por garantía**, **darle al cliente un enlace para que vea el estado de su reparación** y **ver reportes y exportar el
listado**. Todo se usa desde **Servicio técnico → Reparaciones**.

> **Capturas pendientes.** Las pantallas de esta entrega todavía no tienen capturas en este manual. Se agregan cuando
> se generen con el juego de datos de demostración.

## Fotos y adjuntos del equipo

Sirven para dejar constancia del estado en que llegó y en que se entregó el equipo. Abrí una reparación y buscá la
sección **«Fotos y adjuntos»**, debajo de «Mano de obra y repuestos».

1. Tocá **«Agregar fotos»** y elegí una o varias imágenes. En el celular podés elegirlas de la galería o sacarlas con la cámara.
2. Cada foto aparece como una miniatura. Si el archivo no sirve, ves un mensaje por cada uno y no se guarda nada.
3. Tocá una miniatura para verla ampliada, con su nombre, la fecha y quién la subió.
4. Para sacar una foto cargada por error, abrila y elegí **«Quitar»**; te pide confirmar.

Qué tenés que saber:

- Se aceptan **JPG, PNG y WebP**, de hasta **5 MB** cada una, y hasta **20 fotos por reparación**. No se pueden adjuntar PDF ni otros formatos.
- Para agregar o quitar fotos necesitás permiso de **edición** en Servicio técnico. Con permiso de solo lectura las ves, pero no las cambiás.
- Una reparación **anulada** solo se puede consultar. Una reparación **entregada** sí admite fotos (por ejemplo, la de la entrega).
- Las fotos **no** salen en la orden de ingreso, en el remito ni en la página que ve el cliente.
- Una reparación sin fotos muestra un aviso invitando a agregarlas. Si falla la carga, aparece **«Reintentar»**.

## Reingreso por garantía

Cuando un equipo vuelve por garantía, no hace falta cargarlo de nuevo.

1. Abrí una reparación **entregada** y tocá **«Reingresar por garantía»** (solo se ofrece con permiso de edición y si la reparación no está anulada).
2. Revisá el resumen del equipo (no se puede cambiar), escribí la **«Falla del reingreso»** (obligatoria) y, si querés, el **técnico** y la **entrega prevista**.
3. Tocá **«Reingresar»**. Se crea una reparación nueva con el siguiente número de la tienda y te lleva a su detalle.

La reparación nueva copia la tienda, el cliente, el contacto, el modelo, el N.º de serie y los accesorios de la original, y arranca en el primer estado activo con la fecha de hoy. **No copia ítems, importes ni fotos.** En su detalle ves **«Reingreso por garantía de R-xxxx»** con un enlace a la original; en la original ves la lista de sus reingresos con el estado de cada uno.

- Una misma reparación puede tener varios reingresos, y también se puede reingresar desde un reingreso ya entregado.
- Todavía **no** se controla el plazo de garantía ni se marca el reingreso «sin cargo»: cómo se cobra queda a criterio del taller.
- Si cambiás de empresa en la barra superior con el diálogo abierto, el diálogo se cierra con un aviso.

## Enlace para que el cliente consulte el estado

El cliente puede ver el estado de su equipo sin crear una cuenta.

1. En el detalle de la reparación tocá **«Enlace de seguimiento»** (solo con permiso de edición).
2. Tocá **«Copiar enlace»**; aparece la confirmación «Enlace copiado». Pedirlo de nuevo muestra el mismo enlace.
3. Pasale el enlace al cliente. **El sistema no se lo envía solo**: lo copiás y lo mandás vos, por el medio que uses.

Lo que ve el cliente al abrirlo (no necesita iniciar sesión): el código de la reparación, la tienda, el equipo y modelo, el estado actual con su explicación, la entrega prevista y la línea de tiempo de estados con sus fechas. Se lee bien en celular, tablet y computadora.

**No** ve su nombre ni su contacto, el N.º de serie, la falla, los accesorios, el técnico, las notas, los ítems, los importes ni las fotos.

- Si el enlace está mal escrito o no existe, el cliente ve «No encontramos esa reparación».
- Si se consulta demasiadas veces seguidas, ve «Demasiadas consultas, probá en unos minutos».
- El estado siempre es el actual: si cambia, el cliente lo ve al volver a abrir el enlace.
- El enlace **no vence ni se puede anular**: quien lo tenga ve el estado de esa reparación. No lo publiques en lugares abiertos.

## Exportar el listado

En **Servicio técnico → Reparaciones**, el botón **«Exportar»** (visible solo con el permiso de exportar) descarga un archivo CSV, que se abre en Excel, con las mismas **nueve columnas** que ves en la tabla y **todas las filas del filtro** que tengas aplicado (período, N.º de serie, técnico y empresa), no solo la página.

- El archivo se llama `reparaciones-AAAA-MM-DD.csv`.
- No incluye costos internos ni ganancia: el «Total» es el importe al cliente.
- Si el filtro no tiene resultados, ves «No hay filas para exportar». Si falla, no se descarga nada y podés tocar **«Reintentar»**.
- El archivo tiene como máximo 100.000 filas; si hay más, se avisa para que afines los filtros.
- Mientras se prepara, el botón dice «Exportando…».

## Reportes de Service

La pestaña **«Reportes»** de Servicio técnico muestra el tablero **«Service técnico»** con cuatro indicadores de tu organización:

- Reparaciones por estado.
- Reparaciones por técnico.
- Reparaciones ingresadas por mes y tienda.
- Importe al cliente por mes y tienda (mano de obra y repuestos).

Las reparaciones anuladas no cuentan, y el tablero no muestra costos internos ni ganancia. Se puede filtrar por tienda y por período de ingreso. Si no tenés acceso a Servicio técnico, ves «Acceso restringido».

> **Ojo:** el tablero muestra las cifras de **todas** las tiendas de la organización, aunque tu rol solo vea algunas. No cambia con la empresa activa.

## Todavía no se puede

- Adjuntar PDF u otros formatos que no sean imagen.
- Anular o renovar un enlace de seguimiento, o hacer que venza.
- Enviar el enlace al cliente desde el sistema.
- Controlar el plazo de garantía o cobrar un reingreso «sin cargo» automáticamente.
- Exportar a un archivo `.xlsx` (se exporta CSV).
