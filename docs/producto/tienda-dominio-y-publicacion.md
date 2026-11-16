---
owner: producto
sources: []
---

# Dominio, publicación y versiones de la tienda

## Para qué sirve

Desde esta pestaña conectás la **dirección web** de la tienda, comprobás que los registros de dominio estén
bien cargados, preparás los cambios de la tienda **sin que se vean** y los publicás cuando quieras. También
podés **volver a una versión anterior** de la tienda si publicaste algo que no te gustaba.

Antes, la dirección web de cada tienda la cargaba el equipo de soporte y todo cambio se aplicaba en el
momento. Ahora lo hacés vos.

## Quién puede hacerlo

Solo el **Administrador**. Los demás roles no ven la pantalla de Empresas.

## Dónde lo encontrás

1. Menú **Canales → Empresas**.
2. En la fila de la empresa, hacé clic en **Tienda**.
3. Elegí la pestaña **Dominio y publicación**.

Arriba de las pestañas ves el nombre de la empresa, su dirección web (o «Sin dominio configurado») y si está
**Publicada** o **Pausada**. Cada empresa se configura por separado: para pasar a la otra tienda, usá
**Cambiar a… ↔** o **Cambiar de empresa** en la parte superior.

La pestaña tiene cuatro bloques, de arriba abajo: **Dominio**, **Publicación**, **Versiones** y **Vista previa**.

## Conectar la dirección web de la tienda

### Cargar el dominio

1. En el bloque **Dominio** completá **Dominio principal** con la dirección de la tienda (por ejemplo,
   `tienda-ejemplo.com.ar`).
2. El campo **Redirigir también** es opcional: si lo completás, quien entre por esa segunda dirección
   llega automáticamente a la principal.
3. Hacé clic en **Guardar dominio**.
   - Vas a ver «Dominio guardado.» y, debajo, la tabla con los **registros** que tenés que cargar.
   - Si la empresa todavía no tenía tienda, el sistema la crea sola.

Si el dominio no tiene un formato válido, o si otra tienda ya lo está usando, el error aparece **en el campo**
y no se guarda nada.

### La tabla de registros

La tabla tiene cuatro columnas: **Tipo**, **Nombre**, **Valor** y **Estado**. Cada fila es un registro que
tenés que crear en el sitio donde compraste tu dominio:

| Tipo | Qué es | Para qué sirve |
|---|---|---|
| **A** | La dirección IP de nuestra plataforma | Apunta el dominio a nosotros |
| **TXT** | Un texto de control | Nos dice que el dominio es tuyo |
| **CNAME** | El nombre de destino | Solo aparece si configuraste **Redirigir también** |

Copiá los valores **tal como están**. Cada fila tiene su estado: **Correcto**, **Incorrecto** (cuando el
registro existe pero con otro valor, abajo te muestra qué encontramos) o **Pendiente** (todavía no se
comprobó).

### Verificar

1. Una vez cargados los registros en tu proveedor de dominio, volvé al panel y hacé clic en **Verificar ahora**.
   - El botón queda apagado mientras el dominio tenga cambios sin guardar: primero guardalo con **Guardar
     dominio**.
2. Mientras verifica, la pantalla muestra «Verificando registros DNS…».
3. Al terminar:
   - Si todo está bien: «DNS verificado correctamente», cada registro en **Correcto** y los avisos
     **Dominio verificado** y **Certificado SSL activo**.
   - Si algo falta: ese registro queda en **Incorrecto** o **Pendiente**, el aviso dice **Dominio sin
     verificar** y abajo te muestra el motivo. El certificado no se comprueba hasta que los registros
     estén correctos.
4. Debajo de los avisos también está la última verificación («Última verificación hace 6 h»). Si nunca
   verificaste, dice «Nunca verificado».

Solo se puede verificar una vez cada 10 segundos por tienda: si hacés clic dos veces seguidas, el sistema te
avisa que esperes unos segundos.

### Cambiar la dirección de una tienda que ya funciona

Si cargás una dirección **nueva**, la tienda **no se apaga**:

- La dirección nueva queda «Pendiente de verificación» y arriba te avisa que, por ahora, la tienda sigue
  respondiendo en la anterior.
- Cuando la nueva quede verificada **y** tenga el certificado activo, pasa a ser la principal y la anterior
  deja de usarse.

## Preparar cambios y publicarlos

### Guardar deja los cambios «sin publicar»

En las pestañas **Identidad visual**, **Contenido** y **Catálogo visible**, el botón **Guardar** ya **no**
aplica los cambios en la tienda: los deja **sin publicar**. Vas a ver el aviso «Cambios guardados en el
borrador. Publicalos desde Dominio y publicación.».

Mientras haya cambios sin publicar, la tienda pública sigue mostrando lo que estaba publicado.

### Ver qué hay para publicar

En la pestaña **Dominio y publicación**, bloque **Publicación**:

- Arriba dice «Estado: publicada» (con la etiqueta **En línea**) o «Estado: fuera de línea» (con la etiqueta
  **Fuera de línea**). Si la empresa está desactivada, abajo te avisa que podés preparar y publicar cambios,
  pero los visitantes siguen viendo «Volvemos pronto».
- Abajo dice en qué versión está la tienda: «Versión 14 · publicada el 03/02/2027 10:15 por Nombre Apellido». Si
  todavía no se publicó nada, dice «Todavía no hay versiones publicadas.».
- Si hay cambios pendientes, aparece un aviso como «3 cambios sin publicar: colores, texto del banner y 2
  productos visibles.» con un botón **Ver cambios**.
- **Ver cambios** despliega el detalle por área (identidad visual, contenido, catálogo visible) con **qué**
  campos tocaste, sin mostrar los valores.
- En la tarjeta de abajo dice «Hay cambios sin publicar.» con los botones **Descartar** y **Guardar y publicar**.
  Si no hay nada para publicar, dice «No hay cambios sin publicar.» y los dos botones quedan apagados.

### Publicar

1. Hacé clic en **Guardar y publicar**.
2. Aparece el cuadro **Publicar cambios**: «Los cambios se ven de inmediato en `<tu dominio>`. Podés volver a
   la versión anterior desde Dominio y publicación.»
3. Hacé clic en **Publicar**.
   - La tienda muestra los cambios al instante, se crea la versión siguiente y vas a ver «Store publicada».

### Descartar

1. Hacé clic en **Descartar**.
2. Aparece el cuadro **Descartar cambios**: «Se pierden los cambios sin publicar de esta store.»
3. Hacé clic en **Descartar**.
   - Los cambios sin publicar se borran, las pestañas vuelven a lo publicado y vas a ver «Cambios descartados».

### Qué NO espera a la publicación

El **precio**, el **stock** y el **estado activo** de los productos no pasan por este proceso: si los cambiás
en su pantalla, la tienda y la vista previa los muestran al instante.

## Ver la vista previa antes de publicar

El bloque **Vista previa** muestra cómo queda la tienda con los cambios sin publicar: el logo, el banner y
algunos productos de ejemplo. Debajo dice «Se actualiza con los cambios sin publicar.». El botón **Abrir
vista previa** abre la página de inicio de la tienda con los cambios aplicados, para revisarla con calma.

Es una pantalla interna: solo la ves con tu sesión iniciada y los buscadores no la indexan.

## Versiones y volver a una versión anterior

Cada publicación queda guardada como una **versión**.

1. En el bloque **Versiones** está la tabla con **Versión**, **Fecha**, **Por** y **Cambios**, de la más
   nueva a la más vieja.
2. Todas las versiones tienen el botón **Restaurar**, menos la que está vigente.
3. Al hacer clic en **Restaurar** aparece el cuadro **Restaurar versión**: «La versión elegida se carga como
   borrador. No se publica hasta que la confirmes.» Si ya tenías cambios sin publicar, abajo avisa que «Los
   cambios sin publicar que hay ahora se reemplazan».
4. Hacé clic en **Restaurar**:
   - Vas a ver «Versión restaurada como borrador» y el aviso de cambios sin publicar vuelve a aparecer.
   - **Nada se publica todavía**: la versión restaurada es un borrador más.
5. Cuando quieras, hacé clic en **Guardar y publicar** como antes.

El historial no se reescribe: publicar un borrador restaurado crea una **versión nueva**.

## Si cambiás de empresa con un cuadro abierto

Si cambiás de empresa mientras tenés un cuadro abierto (Publicar, Descartar o Restaurar), el cuadro se cierra
con un aviso y **no se aplica nada** de la empresa anterior. Los cambios sin guardar también se descartan con
un aviso.

## Casos comunes

- **Cargué los registros y el dominio sigue sin verificar.** Revisá que los valores de la tabla estén
  copiados tal cual, sobre todo el **TXT** (se compone de dos partes separadas por un `=`). La verificación
  la hace el proveedor de dominio: puede tardar unos minutos en verse.
- **El certificado queda en «Certificado pendiente».** El certificado lo emite el proveedor donde está
  alojada la aplicación; se activa solo cuando el dominio ya está verificado.
- **Guardé un color y la tienda sigue igual.** Es lo esperado: **Guardar** deja el cambio sin publicar.
  Publicá desde **Dominio y publicación** para que se vea.
- **Guardé y no me aparece el aviso de cambios.** Si el valor que guardaste era igual al que ya estaba
  publicado, no hay nada que publicar.
- **Restauré una versión y la tienda no cambió.** Restaurar carga el contenido como borrador: todavía tenés
  que publicarlo.
- **Falta un producto o una categoría en la versión que restauré.** Se omiten los que ya no existen en el
  catálogo; el resto se carga.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **No pudimos guardar el dominio. Intentá de nuevo.** | Falló el guardado. Probá de nuevo. |
| **No pudimos verificar el dominio. Intentá de nuevo.** | Falló la comprobación. Probá de nuevo. |
| **No se pudo verificar ahora, probá de nuevo.** | El proveedor de dominio no respondió. Probá en un rato. |
| **Esperá unos segundos antes de verificar de nuevo.** | Verificaste hace menos de 10 segundos. |
| **No tenés permiso para verificar el dominio de esta tienda.** | Te falta el permiso de edición sobre Empresas. |
| **Se cerró el diálogo porque cambió la empresa activa. No se aplicó nada.** / **…No se restauró nada.** | Cambiaste de empresa con el cuadro abierto; nada se publicó ni se restauró. Volvé a la empresa y repetí la acción. |
| **No pudimos publicar los cambios. Revisá tu conexión e intentá de nuevo: no se publicó nada.** | Falló la publicación; la tienda quedó como estaba. |
| **No pudimos descartar los cambios. Intentá de nuevo.** | Falló el descarte; los cambios sin publicar siguen como estaban. |
| **No pudimos restaurar la versión. Intentá de nuevo: el borrador quedó como estaba.** | Falló la restauración; el borrador no cambió. |
| **El DNS todavía no coincide: revisá los registros marcados e intentá de nuevo.** | Hay registros **Incorrectos** o **Pendientes**. Corregilos y verificá de nuevo. |
