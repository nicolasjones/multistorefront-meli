---
owner: producto
sources:
  - specs
---

# Tienda online: dominio, identidad y vidriera (MSF-147)

Spec: `specs/20261022-084830-tienda-dominio-e-identidad/spec.md` (épica **MSF-147**, historias
F-TDA-01 a F-TDA-04). Merge de la épica `f52758d` (PR #260), pendiente de merge a `main`.
Detalle técnico: [Tienda online: dominio, identidad y catálogo visible](../tecnico/tienda-dominio-e-identidad.md).

Esta página cubre la **puesta en marcha y la configuración** de la tienda de cada empresa: su dominio, su
identidad visual, sus textos comerciales y qué categorías y productos se muestran y se destacan. El
catálogo navegable y la ficha son de [MSF-167](tiendas-online.md); las consultas, de
[MSF-122](consultas.md); la cuenta web, de [MSF-237](cuenta-web-cliente.md).

## Qué resuelve

Cada empresa tiene **una tienda en su propio dominio**. El visitante entra sin cuenta ni sesión y ve la
identidad, los textos y la vidriera de esa empresa; nunca los datos de otra. El administrador define esa
vidriera desde el panel, dentro de **Empresas**, y los cambios se aplican al guardar. El catálogo
navegable y la ficha se completan en [MSF-167](tiendas-online.md).

Si el dominio no está configurado o la tienda está desactivada, el visitante ve la misma página
**«Volvemos pronto»**: no se revela si el dominio existe.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Visitante de la tienda** | Entra al dominio de una empresa, sin cuenta, y ve su identidad, sus textos y la vidriera que la empresa dejó visible (el catálogo navegable se completa en MSF-167). |
| **Administrador con edición en Empresas** | Configura la tienda de la empresa activa: identidad visual, textos comerciales y catálogo visible. No hay pantalla de tienda fuera de Empresas. |
| **Equipo técnico** | Configura los dominios. La tienda se activa o pausa con el interruptor de Empresas (F-EMP-04), no con una pantalla de tienda. En el lanzamiento no hay pantalla de dominio ni verificación DNS. |
| **Operador** | En la matriz del lanzamiento no ve Empresas, así que **no gestiona la tienda** (decisión D3, ver pendientes). |

## Qué puede hacer el administrador

### Identidad visual

- Subir un **logo** (PNG o SVG) y **banners** principal y móvil, con «Reemplazar» y «Quitar». Las medidas
  son una sugerencia visible: banner principal 1440×440 y móvil 390×300.
- Elegir **cuatro colores** (Primario, Primario oscuro, Acento y Fondo) en formato `#RRGGBB`.
- Ver el **contraste del texto blanco sobre el primario**. Si no alcanza AA (4,5:1) se muestra una
  advertencia, pero **no bloquea** guardar.
- Elegir las tipografías de **Títulos** y **Texto** de una lista cerrada del sistema de diseño.
- Ver una **vista previa en vivo** de la home con los valores sin guardar. La tienda pública no cambia
  hasta «Guardar».

### Contenido y textos comerciales

- Editar **Título**, **Subtítulo**, **Texto del botón** y **«El botón lleva a»** del banner principal.
- Editar el **mensaje de bienvenida** de la barra superior, el **texto del pie**, el **aviso de la ficha**
  y el **texto del botón de contacto**.
- Todos los textos son **texto plano**: nunca se interpreta HTML. Un campo vacío **oculta su elemento**
  en la tienda; no se muestran marcadores vacíos.
- «El botón lleva a» es una lista cerrada; hoy solo tiene **Catálogo completo**.

### Catálogo visible y destacados

- Ocultar **categorías**: las ocultas no aparecen en el menú ni en los filtros de esa tienda.
- Mostrar u ocultar **productos** y marcarlos como **destacados** con la estrella.
- Buscar productos por nombre y ver el resumen **«N visibles, M destacados»**.
- Ver el aviso por fila cuando un producto no se muestra («No se muestra: producto inactivo» o
  categoría oculta). El motivo lo calcula el servidor.
- Destacar un producto que no se muestra pide **confirmación** antes de marcarlo; confirmar no lo hace
  visible.
- **Precio y stock son de lectura**: se muestran, no se editan en esta pantalla.

## Reglas de negocio que respeta

- **Una tienda, una empresa, un dominio.** El dominio es único en la plataforma y se guarda normalizado
  (minúsculas, sin puerto ni punto final).
- **Aislamiento.** Cada dominio devuelve solo los datos de su empresa. El usuario autenticado solo ve y
  edita las tiendas de su organización. `anon` no lee tablas: solo ejecuta funciones de lectura pública
  acotadas.
- **Sin borrador.** Guardar aplica de inmediato; «Descartar» solo vuelve al último valor guardado. No hay
  «Publicar cambios», versiones ni restauración en esta épica.
- **Visibilidad efectiva.** Un producto se muestra solo si está activo, su interruptor de tienda está
  visible y su categoría —y la categoría padre— son visibles. Sin fila de configuración, el producto o la
  categoría se toman como visibles y no destacados.
- **Solo lo público.** La tienda pública nunca expone costos, existencias exactas, proveedor, códigos internos ni
  el identificador de la organización.
- **Texto seguro.** Los textos se muestran escapados; un SVG con scripts o eventos se rechaza al subirlo.
- **Empresa activa.** La gestión opera sobre la empresa activa de la barra superior. Al cambiarla se
  recargan todas las consultas, se descarta lo no guardado con aviso y no queda ningún dato ni diálogo de
  la empresa anterior.

## Límites y fuera de alcance

Queda **fuera de esta épica** y no debe leerse como hecho:

- **Pantalla de dominio, verificación DNS, borrador y versiones:** F-TDA-05/06/07, MSF-133 (Etapa 2). En
  esta entrega el dominio lo configura el equipo técnico y no hay pantalla de publicación. La pantalla
  `StorePublicacion` del prototipo no se implementa acá.
- **Pestañas General, Precios y moneda, Mercado Libre:** la General es de Empresas (F-EMP-04); las otras
  son de otras épicas. `StoreGeneral` se cita solo como contexto.
- **Catálogo público navegable, ficha y búsqueda:** son de [MSF-167](tiendas-online.md). Acá se entrega la
  base de dominio, identidad, textos y visibilidad.
- **Información de contacto visible y formulario:** el bloque del prototipo y el contacto son de otras
  épicas de Tiendas online (MSF-122 / MSF-212).
- **«Volvemos pronto» completo:** acá se entrega la versión mínima de F-TDA-01; la historia completa es
  F-TDA-19.
- **Gestión por el Operador:** en el lanzamiento la tienda la gestiona el Administrador, porque el
  Operador no ve Empresas (D3).
- **Precio y destacados distintos por tienda:** los destacados ya son por tienda; el precio se lee del
  producto/empresa y no se edita por tienda (D2, pendiente de confirmar con el cliente).

## Límites técnicos visibles

Los valores por defecto son decisiones de la épica (D5), ajustables en una sola constante/migración:

| Elemento | Límite |
|---|---|
| Logo | PNG o SVG, hasta **1 MB** |
| Banner principal / móvil | PNG, JPG o WebP, hasta **3 MB** |
| Títulos y textos de botón | Hasta **120 caracteres** |
| Subtítulo, bienvenida, pie y aviso de ficha | Hasta **300 caracteres** |

El filtro de scripts del SVG corre en el navegador antes de subir. El bucket restringe tipo y tamaño y
la base valida la carpeta de la ruta; el contenido del SVG no se vuelve a inspeccionar en el servidor
(ver pendientes técnicos).

## Estado y pendientes

**Implementado en la épica** (merge `f52758d`, PR #260); al momento de esta página, pendiente de merge a
`main`. Las cuatro historias están cerradas y verificadas con pgTAP, Vitest/axe y E2E.

| Pendiente | Dueño |
|---|---|
| Confirmar si los dominios de las dos tiendas ya existen, quién controla su DNS y cargar los reales (D1). | Nicolás / cliente + equipo técnico |
| Confirmar si un mismo producto puede tener precio y destacados distintos por tienda (D2). | Nicolás / cliente |
| Decidir si el Operador debe elegir qué productos se muestran; hoy lo hace el Administrador (D3). | Producto |
| Ampliar la lista cerrada «El botón lleva a» más allá de «Catálogo completo» (D4). | Producto / MSF-167 |
| Revisar los límites de la tabla anterior cuando el cliente los defina (D5). | Producto |
| Coordinar `categorias_tienda` con `categorias_empresa` de Catálogo (D6). | Catálogo (MSF-160) |
| Cerrar el recorte de horas del roadmap (D7); no cambia el alcance funcional. | Planificación |

## Diferencias con el prototipo

- El prototipo dibuja **borrador y publicación** («Hay cambios sin publicar», «Guardar y publicar»,
  «Publicar cambios», «Descartar cambios», versiones). La épica fija que **no hay borrador**: se usa un
  único **«Guardar»** que aplica de inmediato, y «Descartar» restaura el formulario sin diálogo.
- La **vista previa** refleja los valores del formulario sin guardar; no publica una versión aparte.
- **`StorePublicacion`** (dominio, DNS y versiones) y **`StoreGeneral`** (datos generales de la empresa)
  no forman parte de esta entrega.
- El bloque de **información de contacto visible** del prototipo no se implementa acá.
