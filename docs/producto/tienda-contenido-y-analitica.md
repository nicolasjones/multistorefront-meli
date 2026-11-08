---
owner: producto
sources: []
---

# Páginas propias, medición de visitas y botón Compartir

## Para qué sirve

Cada tienda puede tener sus **propias páginas de texto** (por ejemplo «Cómo comprar» o «Garantía»), medir cuántas personas la visitan con **Google Analytics** y **Meta Pixel**, y dejar que el visitante **comparta un producto** con un enlace.

## Quién puede hacerlo

Las pestañas **Páginas** y **Analítica** las edita quien puede editar **Empresas** (el Administrador). Con permiso de solo lectura se ven los datos pero no se guardan cambios. El botón **Compartir** y las páginas las usa cualquier visitante, sin cuenta.

## Páginas de contenido

1. Entrá a **Canales → Empresas**, hacé clic en **Tienda** en la fila de la empresa y abrí la pestaña **Páginas**.
2. Hacé clic en **Nueva página** y completá **Título** (hasta 80 caracteres) y **Contenido** (hasta 10 000 caracteres).
3. El interruptor **Visible en la tienda** viene apagado: la página queda guardada pero nadie la ve. Prendelo cuando esté lista.
4. Hacé clic en **Guardar**.

Cada página aparece en la lista con la marca **Visible** u **Oculta**, y con los botones **Editar** y **Eliminar** (este último pide confirmación).

**Cómo la ve el visitante**

- Cada página visible tiene su dirección propia, con la forma `/pagina/` y el título escrito en minúsculas, sin tildes y con guiones (por ejemplo, «Cómo comprar» queda en `/pagina/como-comprar`). Esa dirección se genera al crear la página y **no cambia** aunque después edites el título.
- Al pie de la tienda aparece la columna **Información** con un enlace por cada página visible. Si no hay ninguna visible, la columna no aparece.
- El contenido es **texto simple**: una línea en blanco separa párrafos y los saltos de línea se respetan. No hay negritas, enlaces ni imágenes, y si pegás código HTML se muestra tal cual, como texto.
- Una página oculta, eliminada o inexistente muestra «No encontramos esta página». Cada tienda ve solo sus páginas.

Los cambios se aplican **al guardar**: no pasan por el borrador ni por las versiones de la tienda (ver [Dominio, publicación y versiones](tienda-dominio-y-publicacion.md)).

## Medición de visitas

En la pestaña **Analítica** cargás los identificadores de tu tienda; ambos son opcionales:

| Campo | Qué poner |
|---|---|
| **ID de Google Analytics 4** | Empieza con `G-` (por ejemplo `G-XXXXXXXXXX`). |
| **ID de Meta Pixel** | Solo números, de 8 a 20 dígitos. |

Dejá un campo vacío para no usar esa herramienta. **Guardar** y **Descartar** se activan cuando hay cambios; si te vas con cambios sin guardar, el sistema te avisa. Si un ID tiene un formato incorrecto, el aviso aparece debajo del campo y no se guarda nada.

**Cuándo se mide**

- Solo en la **tienda publicada**. En la vista previa y en una tienda pausada no se mide.
- Solo si el visitante **aceptó las cookies** en el aviso de la tienda (ver [Estados, relacionados, Google y legales](tienda-seo-legal-y-estados.md)). Si las rechaza o no decide, no se carga nada.
- Cada página que mira el visitante cuenta como una visita.
- También se registran dos acciones: cuando el visitante abre WhatsApp desde una ficha y cuando envía el formulario de contacto. Solo se informa que ocurrió; **no** se envía su nombre, su mensaje ni sus datos.

Cada empresa mide con sus propios identificadores: los datos de una tienda no se mezclan con los de otra.

## Compartir un producto

En la ficha de cada producto hay un botón **Compartir**:

- En celulares y navegadores que lo permiten, abre el selector de compartir del sistema con el nombre del producto y el enlace. Si lo cerrás sin elegir, no pasa nada.
- Si el navegador no tiene selector, **copia el enlace** y muestra «Enlace copiado».
- Si tampoco se puede copiar, muestra el enlace seleccionado en un campo («Copiá este enlace») para copiarlo a mano.

El enlace es la dirección de la ficha en la tienda que se está viendo, sin datos personales ni parámetros de seguimiento.

## Lo que todavía no se puede

- Dar formato al texto de las páginas (negritas, enlaces, imágenes).
- Usar otras herramientas de medición además de Google Analytics 4 y Meta Pixel.
- Preparar las páginas en un borrador y publicarlas junto con el resto de la tienda.
- Mandar el enlace directo por WhatsApp desde el botón: solo se copia o se abre el selector del sistema.
- Ordenar a mano las páginas del pie: salen por orden alfabético del título.

## Si algo no sale

| Mensaje | Qué significa y qué hacer |
|---|---|
| **El título es obligatorio** / **no puede superar los 80 caracteres** | Completá o acortá el título. |
| **El contenido no puede superar los 10000 caracteres** | Dividí el texto en dos páginas. |
| **El ID de Google Analytics 4 tiene un formato inválido** | Copiá el ID de medición que empieza con `G-` desde tu cuenta de Google Analytics. |
| **El ID de Meta Pixel tiene un formato inválido** | Debe tener solo números, de 8 a 20 dígitos. |
| **Tu rol no puede editar…** | Pedile al Administrador que lo haga o que te dé permiso de edición en Empresas. |
| **No pudimos eliminar la página. Intentá de nuevo.** | Probá otra vez; si sigue, avisá al soporte. |

<!-- TODO (dueño: documentación de producto): capturas de las pestañas Páginas y Analítica, de la columna Información y del botón Compartir en docs/producto/img/tienda-contenido-y-analitica/. No se pudieron generar con `pnpm docs:capturas` porque el código de la épica todavía no está en `main`; ver la página técnica. -->
