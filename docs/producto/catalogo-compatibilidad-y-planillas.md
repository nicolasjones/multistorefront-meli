---
owner: producto
sources: []
---

# Productos: filtrar por compatible, importar y exportar planillas

## Para qué sirve

Tres cosas que ahorran tiempo cuando el catálogo es grande:

- **Filtrar por compatible**: encontrar de una vez los productos que sirven para una consola o un modelo (por ejemplo, «PS5» o «Switch»).
- **Importar productos desde una planilla**: cargar productos nuevos o actualizar los que ya existen, de a cientos, con sus imágenes, en lugar de uno por uno.
- **Exportar productos a una planilla**: bajar el catálogo (o solo lo que tenés filtrado) a un archivo para abrirlo en Excel o guardarlo.

## Quién puede usarlo

| Qué querés hacer | Quién puede |
|---|---|
| Filtrar el listado por «Compatible con» | Quien puede ver el listado de productos |
| Importar productos desde una planilla | Solo el **Administrador** |
| Exportar productos | Solo el **Administrador** |
| Importar la columna **costo** | El Administrador que además puede **editar** Rentabilidad. Sin ese acceso, el costo se ignora y el sistema avisa fila por fila. |
| Exportar las columnas **Costo** y **Proveedor** | El Administrador que además puede **ver o editar** Rentabilidad. Sin ese acceso, esas dos columnas no se ofrecen. |

Los demás roles no ven los botones «Importar CSV» ni «Exportar». Si alguien con otro rol abre la dirección de la carga masiva, el sistema le avisa «No tenés permiso para importar productos.»

## Filtrar por «Compatible con»

Cada producto puede tener cargados los modelos o consolas con los que sirve (el campo **Compatible con** del alta y de la edición, separados por comas). En el listado de **Productos** esos valores se usan de dos maneras.

### Las etiquetas en cada fila

Debajo del nombre de cada producto aparecen sus valores de «Compatible con» como etiquetas. Si el producto no tiene ninguno cargado, no se muestra nada.

### El filtro

1. Abrí **Catálogo → Productos**.
2. En la barra de filtros buscá el selector **Compatible con**. Aparece solo si ya hay al menos un valor cargado en tu organización.
3. Elegí uno o más valores. El listado muestra los productos que tengan **alguno** de los valores elegidos.
4. Para quitar un valor, sacalo del selector. Para empezar de nuevo, usá **Limpiar filtros**, que también limpia este filtro.

Cosas a tener en cuenta:

- No distingue mayúsculas de minúsculas: «ps5», «PS5» y «Ps5» cuentan como lo mismo.
- Se combina con la búsqueda, la categoría, el estado, la disponibilidad y la tienda que tengas elegida.
- Si ningún producto cumple, ves el mensaje de listado vacío de siempre.
- Si dentro del selector escribís algo que no existe, dice «No hay valores que coincidan».
- Si no se pudieron cargar los valores, el selector avisa «No pudimos cargar los valores.»
- Los valores del selector son los de toda tu organización. Al cambiar de tienda (empresa) se vuelven a cargar y el listado vuelve a la primera página; si algún valor que habías elegido ya no existe, se descarta.

El campo **Compatible con** del alta y la edición sigue funcionando igual que siempre.

## Importar productos desde una planilla

### Antes de empezar

- La importación **crea** los productos cuyo SKU no existe y **actualiza** los que ya existen.
- Hay que tener habilitada la importación de productos para tu organización. Si no lo está, el sistema avisa «Tu organización todavía no tiene habilitada la importación de productos. Un Administrador tiene que crear la conexión «importar-productos» (servidor y credencial).» y no deja elegir archivos.
- Podés cargar hasta **2.000 filas** por archivo. Si tenés más, dividilas en varios archivos.

### Paso a paso

1. En **Catálogo → Productos**, hacé clic en **Importar CSV**. Se abre **Carga masiva de productos**. Esta pantalla no tiene ítem propio en el menú: siempre se llega desde ese botón.
2. Hacé clic en **Descargar plantilla CSV**. Se baja el archivo `plantilla-productos.csv`, que trae solo la fila de títulos con todas las columnas. Completalo en Excel o en una hoja de cálculo y guardalo como CSV.
3. En el recuadro **1 · Archivos**, hacé clic en **Elegir CSV** y elegí tu planilla. Se muestra el nombre del archivo y un resumen. Si te equivocaste, usá **Cambiar archivo**.
4. Si querés cargar imágenes, hacé clic en **Elegir imágenes** y elegí un archivo ZIP con todas las fotos, o las fotos sueltas. Es opcional.
5. Se abre la **vista previa**: **2 · Vista previa y validación**. Revisala (ver más abajo).
6. Si está todo bien, hacé clic en **Importar N productos** (N es la cantidad de filas que se van a importar). Si preferís no seguir, **Cancelar** descarta la vista previa y no se guarda nada.
7. La pantalla pasa a **Importación** y te muestra cómo avanza. **Conviene dejarla abierta hasta que termine**: la importación sigue sola aunque la cierres, pero la pantalla no guarda el seguimiento y, si salís, no podés volver a ver el estado ni descargar el reporte de errores. Los productos que se hayan guardado figuran igual en **Catálogo → Productos** y en **Actividad**.

### Las columnas de la planilla

La pantalla tiene un panel **Columnas de la plantilla** con el mismo detalle. Los títulos de las columnas tienen que ser exactamente estos (da lo mismo mayúsculas o minúsculas):

| Columna | ¿Obligatoria? | Qué poner | Ejemplo |
|---|---|---|---|
| `sku` | Sí | El código único del producto. Hasta 80 caracteres. | `9266a` |
| `nombre` | Sí | El nombre del producto. Hasta 200 caracteres. | `Vidrio templado Switch OLED` |
| `categoria` | Sí | La categoría, que ya tiene que existir. Para una subcategoría, el camino completo separado por `>`. | `Accesorios > Nintendo > Vidrios` |
| `costo` | No | Lo que te cuesta. Solo se guarda si tenés acceso completo a Rentabilidad. | `1200` |
| `precio_x1` | **Sí, en productos nuevos** | El precio de venta de una unidad. Tiene que ser mayor a cero. | `2500` |
| `precio_x5`, `precio_x10`, `precio_x50` | No | Los precios por cantidad (desde 5, 10 y 50 unidades). | `2300`, `2100`, `1900` |
| `proveedor` | No | El nombre del proveedor, tal como figura cargado. | `Proveedor Ejemplo SA` |
| `codigo_barras` | No | El código de barras, de 13 dígitos. | `7790000000012` |
| `tiendas` | No | Los códigos de las tiendas donde se publica, separados por `|`. | `SJ|MJC` |
| `imagenes` | No | Los nombres de los archivos de imagen, separados por `|`. La primera es la principal. | `9266a-1.jpg|9266a-2.jpg` |

Algunos detalles del archivo:

- Tiene que estar en **UTF-8** (el formato habitual al guardar como CSV). Se aceptan columnas separadas por coma o por punto y coma, con o sin marca de orden de bytes.
- Los importes se leen como se escriben en Excel en castellano: `1200`, `1200,50` y `1.200,50` valen. Podés dejar el signo `$`; se ignora.
- Si falta alguna de las columnas obligatorias, no se abre la vista previa y el sistema avisa «Faltan columnas obligatorias: …. Descargá la plantilla para ver el formato.»
- Si el archivo tiene más de 2.000 filas, avisa «El archivo tiene más de 2.000 filas. Dividilo en archivos más chicos.»
- Si el archivo no se puede leer, avisa «No pudimos leer el archivo.»

### Las imágenes

- Pueden ser **JPG, PNG o WebP**, de hasta **2 MB** cada una.
- Podés subir hasta **500 imágenes** por importación. Si las subís en un ZIP, el ZIP puede pesar hasta **50 MB**.
- Si dos imágenes se llaman igual, se usa la primera y el sistema avisa. Un ZIP que no se puede abrir se informa; uno vacío no da error.
- Cada imagen tiene que llamarse igual que en la columna `imagenes` de la planilla.
- Cada producto guarda hasta **4 imágenes**: si la fila cita más, se usan las primeras 4.
- Las imágenes que no sirven (no son de un tipo permitido, pesan de más o están vacías) se rechazan y el sistema te las lista debajo de los recuadros, por ejemplo «“foto.gif” no es JPG, PNG ni WebP» o «“foto.jpg” pesa más de 2 MB.». El resto sigue.

### La vista previa

Antes de guardar nada, el sistema revisa cada fila y te la muestra en una tabla con las columnas **Fila**, **SKU**, **Nombre**, **Categoría**, **Precio x1**, **Imágenes**, **Acción** y **Validación**. Arriba ves tres contadores: **correctas**, **con aviso** y **con error**.

- **Acción** indica qué va a pasar: **Nuevo** si el SKU todavía no existe en tu catálogo, o **Actualiza** si ya existe. Para comparar el SKU no importan las mayúsculas.
- **Validación** dice **OK** o, si hay algo para avisar, el motivo.

Al pie de la tabla el sistema recuerda: «Las filas con error no se importan. Los avisos se importan igual.»

**Errores** (la fila no se importa):

| Mensaje | Qué hacer |
|---|---|
| Falta el SKU / Falta el nombre / Falta la categoría | Completar el dato |
| El SKU supera los 80 caracteres / El nombre supera los 200 caracteres | Acortarlo |
| La categoría «…» no existe | Crearla antes en Catálogo, o corregir el nombre |
| SKU repetido en la planilla (ya está en la fila N) | Dejar una sola fila por producto |
| «…» debe ser un número no negativo con hasta 2 decimales | Corregir el importe |
| «precio_x1» debe ser mayor a cero | Poner un precio válido |
| Falta el precio x1 de un producto nuevo | Completar `precio_x1` |
| El código de barras debe tener 13 dígitos | Corregirlo |
| Código de barras repetido en la planilla (fila N) | Dejar un código por producto |
| El código de barras ya lo usa otro producto | Revisar a qué producto pertenece |

**Avisos** (la fila se importa igual, pero sin ese dato):

| Mensaje | Qué pasa |
|---|---|
| Se ignora el costo: tu rol no tiene acceso a Rentabilidad | No se guarda el costo |
| Se ignora el proveedor «…»: no existe | El producto se guarda sin ese proveedor |
| Tienda desconocida: … | No se publica en esa tienda |
| Imagen «…» no se subió | El producto se guarda sin esa imagen |
| Imagen «…» inválida (JPG, PNG o WebP) | El producto se guarda sin esa imagen |
| Más de 4 imágenes: se usan las primeras 4 | Se guardan solo 4 |

Si ninguna fila se puede importar, el botón **Importar** queda deshabilitado.

### Qué pasa con los productos que ya existen

Cuando el SKU ya existe, la fila **actualiza** el producto:

- El **nombre** y la **categoría** siempre se reemplazan por los de la planilla.
- Una **celda vacía no pisa** el dato actual: si dejás `precio_x1`, `proveedor` o `codigo_barras` en blanco, el producto conserva el valor que tenía. Lo mismo vale para los precios por cantidad y para el costo.
- En **tiendas**, si ponés valores, el producto queda publicado **solo** en esas tiendas. Si la dejás vacía, no se toca dónde está publicado. En un producto nuevo, una celda vacía significa que no se publica en ninguna tienda.
- Las **imágenes** de la fila se agregan al producto.
- El **costo** solo se guarda si, cuando pediste la importación, tenías acceso completo a Rentabilidad.

Cada producto creado o actualizado queda registrado en **Actividad**, con tu nombre, como «desde una importación CSV».

### Seguir la importación

Después de hacer clic en **Importar**, la pantalla muestra el estado:

| Estado | Qué quiere decir |
|---|---|
| **En cola** | Esperando su turno. Si hay otra importación de tu organización en curso, esta empieza cuando termine la anterior. Dice «La importación quedó en cola; empieza cuando termine la anterior.» |
| **Aplicando** | Se están guardando las filas. Dice «Aplicando las filas…» |
| **Terminada** | Listo. Dice, por ejemplo, «Importación terminada. 118 productos procesados, 2 omitidos por error. Ya figuran en Catálogo · Productos.» |
| **Fallida** | Hubo un problema técnico antes de terminar. Dice «La importación falló.» (o el motivo, por ejemplo «La importación tardó más de lo permitido. Reintentala.») y que podés reintentarla desde la pantalla de ejecuciones. |

Cuando hay filas omitidas aparece **Descargar reporte de errores**. Baja el archivo `errores-importacion-productos.csv`, con tres columnas: **fila** (el número de línea en tu planilla), **sku** y **motivo**. Con ese archivo corregís solo lo que falló y lo volvés a importar.

Cuando la importación termina, **Importar otro archivo** vuelve al inicio de la carga.

Reintentar una importación no duplica los productos ni las imágenes. Si la importación termina pero algunas fotos no se pudieron adjuntar, la pantalla avisa «N productos quedaron sin imágenes»; si una fila falló varias veces por un error temporal, figura como omitida y podés volver a importarla. El seguimiento queda en la dirección de la página (`?importacion=…`): si salís y volvés, ves el estado.

## Exportar productos

1. En **Catálogo → Productos**, hacé clic en **Exportar**. Se abre el diálogo **Exportar productos**.
2. En **Qué exportar** elegí:
   - **Lo filtrado (N)**: los productos que estás viendo según la búsqueda, el estado, la categoría, la disponibilidad y la tienda elegida. El diálogo lo aclara: «Respeta la búsqueda, los filtros y la categoría elegida.»
   - **Todos (N)**: todo el catálogo, sin filtros. El diálogo lo aclara: «Todo el catálogo, sin filtros.»
3. En **Formato** queda seleccionado **CSV**. La opción **Excel (.xlsx)** se ve pero está deshabilitada: todavía no se puede exportar en ese formato (el CSV se abre sin problema en Excel).
4. En **Columnas** marcá las que quieras. Por defecto vienen tildadas **SKU**, **Nombre**, **Categoría**, **Precio**, **Costo**, **Stock**, **Visible en** y **Estado**; podés sumar **Código de barras** y **Proveedor**. **Costo** y **Proveedor** solo aparecen si tenés acceso a Rentabilidad.
5. Hacé clic en **Exportar**. Se baja el archivo `productos-AAAA-MM-DD.csv` (con la fecha de hoy) y aparece el aviso «Exportación CSV lista: N productos, M columnas».

Qué tener en cuenta:

- «Lo filtrado» **todavía no tiene en cuenta el filtro «Compatible con»**: si filtraste por compatible y querés bajar solo esos productos, el archivo sale con todos los que cumplen los demás filtros. Una forma de resolverlo hoy es filtrar la planilla ya descargada.
- Si no hay productos para exportar, el diálogo dice «No hay productos para exportar.» y el botón queda deshabilitado.
- Mientras se arma el archivo ves el progreso, y podés usar **Cancelar exportación**. Si algo falla, el diálogo avisa «No pudimos exportar los productos.» y te deja **Reintentar**. Si no se pudo contar el catálogo, avisa «No pudimos contar el catálogo.»
- Si cambiás de tienda (empresa) con el diálogo abierto, se cierra y aparece el aviso «Cambiaste de empresa: se cerró la exportación. Volvé a abrirla para exportar con la empresa nueva.»
- El archivo se abre bien en Excel en castellano: columnas separadas por punto y coma y acentos correctos.
- Cualquier texto que empiece con `=`, `+`, `-` o `@` sale con un apóstrofo adelante. Es una protección para que Excel no lo tome como una fórmula.
- Cada exportación queda registrada en **Actividad** (quién la hizo, cuántos productos y qué columnas), sin los precios ni los costos.

## Todavía no se puede

- Exportar en formato Excel (`.xlsx`): la opción está deshabilitada.
- Exportar solo los productos filtrados por «Compatible con».
- Importar con otro formato que no sea CSV.
- Volver a ver el seguimiento de una importación después de salir de la pantalla de carga.
- Que el rol Consulta (ni ningún otro rol que no sea Administrador) importe o exporte.
- Cambiar la forma de cargar «Compatible con»: se sigue escribiendo como texto separado por comas en el alta y la edición de cada producto.

## Ver también

- [Catálogo: listado y categorías](catalogo-listado-y-categorias.md)
- [Catálogo: costo y disponibilidad](catalogo-costo-y-disponibilidad.md)
- [Construcción interna de esta función (técnico)](../tecnico/catalogo-compatibilidad-y-planillas.md)

!!! note "Capturas pendientes"
    Esta página todavía no trae capturas de pantalla de la carga masiva, del diálogo de exportar ni del filtro «Compatible con». Se agregan con el comando de capturas del repositorio cuando se pueda levantar la aplicación con datos de ejemplo.
