---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Tienda pública: corrección de la demo frente al prototipo (MSF-825)

Épica **MSF-825** («Tiendas públicas · Corrección de la demo vs prototipo (multitienda)») con los bugs
hijos **MSF-826** … **MSF-832**. Registro del bug:
`.specify/bugs/tienda-demo-categorias-y-catalogo-timeout/{assessment,fix,test}.md`.

Rama `epic/MSF-825-tiendas-demo-vs-prototipo`, **PR #870**, merge `ebd2b1f8` sobre la rama `dokploy`.
Commits de la épica: `38d572c4` (categorías y catálogo sin *timeout*), `e82a9eca` (categorías principales,
nombres limpios y bloques de contacto), `17050c69` (imports y mocks de las pruebas),
`5a1a5bd8` (prefijo acotado y precio solo para la página), `23ac7607` (prefijo que no toca «&USB Hub»),
`408f03ee` (holgura de tiempo en las pruebas), `a961b581`, `109807a5` y `70f6c893` (permisos de la helper),
`6421b9cd` (renumeración de migraciones) y `050c43ed`.

Depende de [MSF-167 (catálogo y ficha)](tienda-catalogo-y-ficha.md),
[MSF-191 (inicio, búsqueda y móvil)](tienda-inicio-busqueda-movil.md) y
[MSF-212 (WhatsApp y contacto)](tienda-whatsapp-y-contacto.md). Resumen de producto y límites:
[Tiendas online](../producto/tiendas-online.md).

La épica **no agrega pantallas**: corrige el comportamiento de las pantallas públicas que ya existían
(Home, Catálogo, Categoría, Producto, Contacto y sus versiones móviles) para que se vean y funcionen
como las del prototipo, y para que el resultado valga en **cualquier** tienda configurada, sin tocar
código por tienda.

## Alcance de entrega

- **`supabase`:** tres migraciones **aditivas**. Ninguna crea ni altera tablas: solo redefinen funciones
  (`publico` y `private`) y ajustan privilegios.
- **`refine`:** front público en `apps/web/src/pages/tienda-publica/` y dos módulos nuevos en
  `apps/web/src/lib/`. Sin pantallas nuevas en el panel.
- **Sin** `workers`, `kestra`, `superset` ni Compose nuevo.

| Bug | Migración | Contenido | Reversión (en una migración posterior) |
|---|---|---|---|
| MSF-826, MSF-827, MSF-830, MSF-832 | `supabase/migrations/20270228300400_tienda_publica_rendimiento_y_categorias.sql` | Redefine `publico.categorias_por_dominio(text)` y `publico.catalogo_pagina_por_dominio(text, uuid, boolean, numeric, text, integer)`: **mismas firmas y mismos campos** | Reaplicar las definiciones de `20261023150000_tienda_categorias_publicas.sql` y `20270221100004_tienda_precio_anterior.sql` |
| MSF-828 | `supabase/migrations/20270228300500_productos_nombre_sin_prefijo_de_importacion.sql` | `private.quitar_prefijo_importacion(text)`; redefine el disparador `private.normalizar_producto()`; limpia lo ya cargado con un `UPDATE` | El dato anterior (el prefijo) no se conserva; para el disparador, reaplicar `private.normalizar_producto()` de `20261017120100_catalogo_productos_y_costos.sql` |
| MSF-828 | `supabase/migrations/20270228300600_prefijo_importacion_permiso_de_ejecucion.sql` | `grant execute on function private.quitar_prefijo_importacion(text) to authenticated` | `revoke execute on function private.quitar_prefijo_importacion(text) from authenticated` |

Las tres versiones (`20270228300400`, `…300500`, `…300600`) quedaron **por encima** de la máxima de
`origin/dokploy` en el momento del merge (`20270228300300`): `scripts/verificar-migraciones.mjs` falla con
«versión REUSADA» si una migración nueva queda por debajo de la base.

## Modelo de datos (DER)

**Sin cambios de esquema.** La épica no crea ni altera tablas: `publico` sigue siendo un esquema **solo de
funciones** y `dominio.productos` no cambia de columnas (solo cambia qué valor guarda el disparador que
ya existía).

| Tabla | Estado | Cambio |
|---|---|---|
| `dominio.productos` | existente | Sin cambio de columnas. Cambia el **valor** que escribe el disparador `productos_normalizar`: el nombre y la descripción pierden el prefijo de importación. |
| `dominio.categorias` | existente | Se lee (árbol y orden). No cambia. |
| `dominio.categorias_tienda` | existente | Aporta la visibilidad de la categoría y de su padre. No cambia. |
| `dominio.productos_tienda` | existente | Aporta `visible` y `destacado` de la tienda. No cambia. |
| `dominio.producto_empresa` | existente | Determina qué productos vende la empresa. No cambia. |
| `dominio.empresas` / `dominio.tiendas` | existentes | Resuelven la empresa y la tienda del `host`. No cambian. |

No hay ERD nuevo: el modelo del catálogo y de la tienda sigue en
[Datos y DER](datos.md#tienda-publica-msf-147-msf-167) y su [ERD interactivo](../diagrams/msf-160-erd.html).

## Causa raíz

El relevamiento del 11 nov 2026 comparó la demo de Mundo JC con los prototipos `MJC_Home`,
`MJC_Catalogo`, `MJC_Categoria`, `MJC_Producto` y `MJC_Contacto`. La demo «no cargaba»: la home, el menú
y `/catalogo` respondían con «No pudimos cargar las categorías / los productos» y, cuando cargaban,
mostraban ~190 categorías (muchas vacías o repetidas) y nombres con el prefijo «&ua».

Medido en dev con el volumen real de la demo (**2.204 productos publicados por tienda**), con el rol
`anon` y el tope de 3 s de `statement_timeout` (mediciones del encabezado de
`20270228300400_tienda_publica_rendimiento_y_categorias.sql`):

| Consulta | Antes | Causa | Después |
|---|---|---|---|
| `publico.categorias_por_dominio` | 2,5 s con la caché tibia y más de 3 s en frío → **HTTP 500** «canceling statement due to statement timeout» | El CTE `conteo` se reescribía en línea dentro de una subconsulta correlacionada y se evaluaba **una vez por categoría** (~170 llamadas a `private.catalogo_tienda_efectivo`) | **30 ms** (conteo materializado, una sola pasada) |
| `publico.catalogo_pagina_por_dominio` | **44 s** (≈ 20 ms por producto) | `private.precio_vigente_empresa` se evaluaba para **todos** los productos antes de paginar | **~0,3 s** con orden «relevancia» sin tope de precio; **~1 s** con orden por precio o con tope |

Las correcciones de comportamiento se hicieron **en el origen y no por tienda**:

1. **Menú con ~190 entradas sin estilo** (MSF-826): el menú de escritorio, el menú móvil y el pie
   listaban **todas** las categorías que la base devolvía, en varias líneas y con los enlaces subrayados
   del navegador. Ahora el menú es **una sola línea** con las categorías principales y «Más categorías».
2. **Categorías vacías y duplicadas** (MSF-827): la base devolvía categorías con `productos = 0` y el
   front no filtraba ni unificaba nombres. Ahora la base **no devuelve** las categorías sin productos
   visibles y el front **no repite nombres**.
3. **Nombres con prefijo «&ua»** (MSF-828): venían de una exportación de un sistema anterior (en dev
   afectaba a **2.174 de los productos**). Se corrige **al escribir el producto** (disparador) y **al
   mostrarlo** (front).
4. **Catálogo sin listado, contador ni «Ordenar por»** (MSF-830): era la consecuencia del *timeout* de
   `catalogo_pagina_por_dominio`. Con la función rápida, la página carga y además el panel de categorías
   pasó de una lista plana a un **árbol** (las raíces y, debajo de la elegida, sus subcategorías).
5. **Contacto sin los bloques del prototipo** (MSF-831): la página mostraba solo WhatsApp y Correo.
   Ahora agrega «Respondemos dentro de las 24 h» y el bloque «Retiro y envíos».
6. **Ficha de producto incompleta** (MSF-829): la ficha ya tenía galería, «Sin imagen», «Sin stock»,
   relacionados y el botón de WhatsApp (de MSF-212); lo que fallaba era el **nombre repetido** (el
   prefijo) y que la descripción repetía el nombre. Corregido en la misma historia.
7. **Mundo JC y San Javucho con las mismas categorías y conteos** (MSF-832): **no era una fuga**. La
   base ya filtraba por tienda; en dev **ambas empresas publican los mismos 2.204 productos** (con
   precios propios), por eso los conteos coinciden. El aislamiento se prueba en pgTAP: la tienda de otra
   organización solo ve sus categorías.

## Contratos públicos

Las dos funciones reescritas conservan **firma, campos, tipo de retorno, `security definer`,
`set search_path = ''`, lista blanca y el `null` idéntico** para host desconocido, host inválido y
empresa desactivada. Lo que cambia es **cuánto tardan** y **qué devuelven**.

### `publico.categorias_por_dominio(host)`

```ts
publico.categorias_por_dominio(host: string): {
  categorias: Array<{ id: string; nombre: string; padre_id: string | null; productos: number }>
} | null
```

- El conteo se **materializa** en una sola pasada (`conteo as materialized`) sobre
  `private.catalogo_tienda_efectivo(empresa)`.
- **Solo devuelve categorías con productos visibles**: las que se quedan sin productos desaparecen del
  menú, de la home, del pie y de los filtros.
- **`productos` ahora suma las subcategorías**: la raíz «Consolas» cuenta los productos de sus hijas.
  Antes contaba solo los de la categoría directa, y el número de la tarjeta no coincidía con el listado
  al entrar.
- El subárbol se calcula dentro de la organización de la tienda (`dominio.categorias.organizacion_id`),
  con tope de 10 niveles.
- El orden no cambia: raíces primero y después `posicion` e `id`.

### `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)`

Misma forma que en MSF-167 (`total`, `pagina`, `tamano` = 24, `categorias`, `productos`). Cambios:

- **El precio se calcula solo cuando hace falta.** Con orden `relevancia` y sin tope de precio, se calcula
  para los **24 productos de la página**; con orden por precio o con `precio_max` se calcula para el
  conjunto filtrado. El cálculo usa **las mismas funciones y la misma regla** que
  `private.precio_vigente_empresa`, pero **directo** (sin la función envoltorio), con `offset 0` para que
  el planificador no repita las llamadas.
- **Filtrar por una categoría incluye su subárbol** (CTE recursivo `sub`, limitado a la organización de
  la tienda): el total del listado coincide con el número que muestra la tarjeta de la categoría.
- `categorias` sigue trayendo el resultado de `publico.categorias_por_dominio(host)`: el catálogo hereda
  la regla de «solo categorías con productos» y el conteo con subcategorías.

## Front público

### Módulos nuevos

| Archivo | Qué aporta |
|---|---|
| `apps/web/src/lib/tiendaCategorias.ts` | `CATEGORIAS_PRINCIPALES = 6`, `categoriasPrincipales(categorias, maximo)`, `hayMasCategorias(categorias, principales)` y `filasPanelCategorias(categorias, seleccionada)`. Funciones puras: no dependen de Supabase (se pueden probar sin base). |
| `apps/web/src/lib/tiendaTextos.ts` | `decodificarEntidades(texto)`, `quitarPrefijoImportacion(texto)`, `limpiarTextoPublico(texto)` y `limpiarDescripcionPublica(texto)`: la red de seguridad al mostrar. |

`categoriasPrincipales` toma las **raíces** (categorías sin padre) de la tienda, las ordena de mayor a
menor cantidad de productos (desempate por nombre), **elimina nombres repetidos** (comparación sin
mayúsculas ni espacios) y corta en seis. Si la tienda no tiene raíces visibles (todas colgadas de una
oculta), usa las que haya; si no tiene categorías, devuelve `[]`.

`filasPanelCategorias` arma las filas del panel **Categorías** del catálogo: las **raíces** en el orden
recibido y, debajo de la elegida (o de la que la contiene), sus subcategorías con **sangría por nivel**,
en orden de árbol. Sin selección el panel muestra solo las raíces (no las seis principales: el panel
muestra **todas** las categorías de primer nivel de la tienda). Una categoría elegida cuyo padre no vino
(oculto) se muestra como raíz.

`quitarPrefijoImportacion` quita «`&` + una o más de `u`, `U`, `a`, `k` o `+`» seguido de un espacio o
pegado a una mayúscula, un dígito o «(» («&ua ADAPTADOR…», «&uaCONSOLA», «&u+ MOCHILA», «&+ COOLER»). **No
toca** un nombre real que empiece con «&» y minúsculas («&ultra Cable»), uno con «&» pegado a una
palabra («&Kids»), uno con «&U» en mayúsculas («&USB Hub») ni una entidad HTML («&amp; Compañía»); un
nombre que sea **solo** el prefijo no se vacía. `limpiarTextoPublico` además decodifica las entidades
HTML comunes y compacta espacios; `limpiarDescripcionPublica` conserva los saltos de línea.

### Dónde se aplica

| Pieza | Cambio |
|---|---|
| `layout/MenuCategorias.tsx` | Menú de escritorio en **una línea** (`flexWrap: nowrap` + `overflowX: auto`), con las categorías principales y el enlace **«Más categorías»** hacia `/catalogo` cuando hay más. |
| `layout/MenuMovil.tsx` | Menú móvil: mismas categorías principales y **«Más categorías»**. |
| `layout/PieCategorias.tsx` | El pie muestra las **mismas** categorías principales que el menú. |
| `secciones/CategoriasInicio.tsx` | La home muestra las tarjetas de las categorías principales con su conteo real y el enlace **«Ver todas las categorías →»**. Nunca hay tarjetas con «0 productos». |
| `catalogo/PanelFiltros.tsx` | Panel **Categorías**: las raíces de la tienda y, debajo de la elegida, sus subcategorías en árbol (`filasPanelCategorias`) con sangría por nivel. |
| `contacto/DatosContacto.tsx` | Bloque **«Retiro y envíos»** («Coordinamos por WhatsApp» o «Coordinamos por correo», más «No hay compra online en esta versión: consultás y coordinamos.») y el aviso **«Respondemos dentro de las 24 h»** bajo el correo. Sin datos de contacto no se muestra ningún bloque. |
| `lib/tiendaFicha.ts` | La descripción **igual al nombre** se omite (el nombre aparecía tres veces) y el nombre y la categoría se limpian con `limpiarTextoPublico`. |
| `lib/tiendaListado.ts`, `lib/tiendaInicio.ts`, `lib/tiendaBusqueda.ts`, `lib/tiendaRelacionados.ts` | Nombre de producto y de categoría con `limpiarTextoPublico`. |

La limpieza del front es **red de seguridad**: la base ya limpia al escribir. Sirve para que una tienda
con datos cargados antes de la migración no muestre el prefijo mientras se reescriben.

### El prefijo se corrige en el origen

`private.normalizar_producto()` (disparador `productos_normalizar` de `dominio.productos`) es el **único
punto por el que pasa toda escritura de productos** —importación, alta y edición—, y ahora quita el
prefijo del **nombre y de la descripción**. La migración `20270228300500` además ejecuta un `UPDATE` que
reescribe cada fila afectada (el disparador hace el resto y queda registrado en la actividad del
producto, como cualquier edición). Es **idempotente**.

`private.quitar_prefijo_importacion` es una función **pura de texto**: no lee datos ni cambia permisos.
El disparador **no** es `security definer` (corre como el rol que inserta) y `public.crear_producto` es
`security invoker`, así que el rol `authenticated` necesita `execute` sobre la helper: sin el `grant` de
`20270228300600`, el alta y la edición de productos fallaban con «permission denied for function
quitar_prefijo_importacion». El importador no lo necesita (su RPC es `security definer`).

## Multitienda

Ninguna corrección depende de una tienda en concreto:

- Las categorías principales salen de la **visibilidad configurada** de cada tienda
  (`dominio.categorias_tienda.visible`): una tienda nueva sin configuración usa las de mayor cantidad.
- El nombre, la identidad, el WhatsApp, el correo y los horarios salen de
  `publico.contacto_por_dominio` y `publico.identidad_por_dominio` (MSF-147/MSF-212).
- Los precios y la disponibilidad se calculan por empresa (MSF-114/MSF-231).
- El mismo producto puede estar en varias tiendas con precio propio; la visibilidad efectiva es la de
  MSF-147 (`private.catalogo_tienda_efectivo`).

El criterio transversal de la épica («cada bug se verifica en al menos dos tiendas con identidad
distinta») se apoyó en las dos tiendas de la demo (Mundo JC y San Javucho).

## Cómo probarlo (técnico)

Guía de prueba **técnica** de la épica. Cada control tiene su rótulo `[MSF-825:T0yy]`, que es el que
deberían llevar los E2E cuando se escriban (el número es el del bug hijo: MSF-826 → `T026`, …,
MSF-832 → `T032`).

### Prerrequisitos

- **Rol/permiso:** ninguno para el visitante (la tienda es pública, sin sesión). Para el panel:
  Administrador, con la empresa asignada.
- **Datos:** un entorno con la base migrada (las tres migraciones de la épica aplicadas) y **dos tiendas
  configuradas** con categorías y productos visibles. Sirve el seed de la demo (Mundo JC y San Javucho)
  o el stack local con `pnpm dev:supabase` y el seed del repositorio.
- **URL:** el dominio de cada tienda (`https://demo-mundojc…` y `https://demo-sanjavucho…` en DEV). En
  local, el host de la tienda con `Host` apuntando a ella; el panel decide por `VITE_PANEL_HOSTS`.
- **Sin video:** la épica no produce video de evidencia.

### Pasos

1. **Menú de escritorio en una línea** — Abrí la home de la tienda en 1440 px. **Tenés que ver** una sola
   línea con «Inicio», hasta seis categorías, «Más categorías» y «Contacto»; si los nombres no entran, la
   línea se desplaza con el mouse. Rótulo: `[MSF-825:T026]`.
2. **Sin categorías vacías ni repetidas** — Recorré el menú, las tarjetas de la home y el pie. **Tenés que
   ver** que ninguna categoría dice «0 productos» y que no hay dos con el mismo nombre. Rótulo:
   `[MSF-825:T027]`.
3. **Nombres limpios** — Cargá un producto con un nombre de exportación (por ejemplo «&ua ADAPTADOR HDMI A
   DVI 24+1 (3010)») o tomá uno que ya lo traiga, y mirá la home, el catálogo y la ficha. **Tenés que ver**
   «ADAPTADOR HDMI A DVI 24+1 (3010)», sin «&ua» ni entidades. En la demo, la migración ya limpió los
   nombres cargados: para ver el caso hay que cargar el producto con el prefijo. Rótulo:
   `[MSF-825:T028]`.
4. **Ficha completa** — Abrí la ficha de ese producto. **Tenés que ver** galería (o «Sin imagen»), precio,
   disponibilidad, SKU, categoría, «Consultar por WhatsApp», «Compartir», «Ver más productos» y
   relacionados; la descripción no puede repetir el nombre. Rótulo: `[MSF-825:T029]`.
5. **Catálogo con listado, contador y orden** — Entrá a `/catalogo`. **Tenés que ver** el panel de
   categorías con el número de cada una, el total de resultados, el selector «Ordenar por» y las tarjetas
   de producto; el número de una categoría debe coincidir con lo que se ve al entrar a ella. Rótulo:
   `[MSF-825:T030]`.
6. **Panel de categorías en árbol** — Elegí una categoría raíz y después una subcategoría. **Tenés que
   ver** las hijas debajo de la elegida, con sangría, y que se mantenga el orden de árbol. Rótulo:
   `[MSF-825:T030]`.
7. **Contacto con los bloques del prototipo** — Abrí `/contacto`. **Tenés que ver** el bloque «Retiro y
   envíos» («Coordinamos por WhatsApp» o «por correo») con la aclaración de que no hay compra online, y el
   aviso «Respondemos dentro de las 24 h» bajo el correo. Rótulo: `[MSF-825:T031]`.
8. **Dos tiendas distintas** — Repetí los pasos 1 a 7 en la **segunda** tienda. **Tenés que ver** otra
   identidad, otros textos y sus propias categorías; si las dos tiendas publican el mismo catálogo, los
   conteos coinciden y eso es el dato, no una fuga. Rótulo: `[MSF-825:T032]`.
9. **Celular** — Repetí 1, 5 y 7 a 390 px. **Tenés que ver** el menú desplegado con las categorías
   principales y «Más categorías», y el catálogo con filtros y contador. Rótulo:
   `[MSF-825:T026]`.
10. **Tienda nueva** — Creá una empresa nueva, configurá identidad, un WhatsApp y categorías con
    productos. **Tenés que ver** la tienda con su propia identidad, sus categorías principales y el
    bloque «Retiro y envíos» con «Coordinamos por WhatsApp», sin tocar código. Rótulo:
    `[MSF-825:T032]`.

### Resultado esperado

- **Given** una tienda con más de seis categorías visibles, **When** se abre la home o el catálogo, **Then**
  el menú muestra una sola línea con hasta seis categorías y un enlace «Más categorías» que lleva al
  catálogo con el resto.
- **Given** una categoría sin productos visibles, **When** se carga la home, **Then** no aparece en el
  menú, ni en las tarjetas ni en el pie, ni con «0 productos».
- **Given** un producto cuyo nombre trae el prefijo de una exportación anterior, **When** se lo guarda o
  se lo muestra en la tienda, **Then** el nombre aparece limpio y la descripción no repite el nombre.
- **Given** el catálogo de una tienda con 2.000+ productos, **When** se entra a `/catalogo`, **Then** la
  página carga con el listado, el contador y «Ordenar por» (sin «No pudimos cargar…») y el número de una
  categoría coincide con su listado.
- **Given** una tienda con WhatsApp cargado, **When** se abre `/contacto`, **Then** aparecen el bloque
  «Retiro y envíos» con «Coordinamos por WhatsApp» y el aviso «Respondemos dentro de las 24 h»; sin
  WhatsApp, el bloque dice «Coordinamos por correo».
- **Given** dos tiendas con catálogo distinto, **When** se abre cada una, **Then** muestran categorías y
  conteos distintos, y ninguna consulta devuelve datos de la otra.

### Cómo automatizarlo

**Pendiente de automatizar: hoy no existe ningún E2E con estos rótulos.** La épica **no agregó** E2E
(los `apps/web/e2e/tienda-*.e2e.ts` que ya hay no cubren las reglas nuevas). Lo que debería escribirse:

| Rótulo | Prueba sugerida | Dónde |
|---|---|---|
| `[MSF-825:T026]` | El menú de escritorio va en una línea con las categorías principales y «Más categorías»; en el móvil, lo mismo en el menú desplegable | `apps/web/e2e/tienda-categorias.e2e.ts` (nuevo caso) |
| `[MSF-825:T027]` | Ninguna categoría visible viene con «0 productos» ni con un nombre repetido | `apps/web/e2e/tienda-categorias.e2e.ts` (nuevo caso) |
| `[MSF-825:T028]` | El nombre de un producto con prefijo de importación se muestra limpio en la home, el catálogo y la ficha | `apps/web/e2e/tienda-catalogo.e2e.ts` (nuevo caso) |
| `[MSF-825:T029]` | La ficha muestra galería, precio, disponibilidad, SKU, WhatsApp y relacionados, y no repite el nombre en la descripción | `apps/web/e2e/tienda-ficha.e2e.ts` (nuevo caso) |
| `[MSF-825:T030]` | El catálogo carga con contador y «Ordenar por», y el número de la categoría coincide con su listado | `apps/web/e2e/tienda-catalogo.e2e.ts` (nuevo caso) |
| `[MSF-825:T031]` | `/contacto` muestra «Retiro y envíos» y «Respondemos dentro de las 24 h»; sin datos, no muestra bloques | `apps/web/e2e/tienda-contacto.e2e.ts` (nuevo caso) |
| `[MSF-825:T032]` | Dos tiendas con catálogos distintos muestran categorías y conteos distintos; una tienda nueva sin configuración muestra las suyas | `apps/web/e2e/tienda-dos-dominios.e2e.ts` (nuevo caso) |

Mientras tanto, la cobertura existente es:

- **pgTAP** `supabase/tests/database/productos_nombre_importacion.test.sql` (14 aserciones): el prefijo se
  quita en el alta y en la edición, no se tocan «&ultra Cable», «&Kids», «&USB Hub» ni «&amp; Compañía»,
  un nombre que es solo el prefijo no se vacía, el rol de la app puede ejecutar la helper y el alta desde
  la app quita el prefijo sin fallar por permiso.
- **pgTAP** `supabase/tests/database/tienda_categorias_publicas.test.sql` (17 aserciones): el conteo suma
  las subcategorías, una categoría sin productos no se lista y el listado de una categoría incluye sus
  subcategorías (el total coincide con la tarjeta).
- **Vitest** `apps/web/src/lib/tiendaCategorias.test.ts` (categorías principales, nombres repetidos,
  desempate, árbol del panel) y `apps/web/src/lib/tiendaTextos.test.ts` (prefijo, entidades, espacios);
  `apps/web/src/pages/tienda-publica/contacto/contacto.test.tsx` (bloques de contacto según los datos de
  la tienda).

```bash
pnpm dev:supabase
pnpm --filter @platform/web test:e2e tienda-categorias
pnpm --filter @platform/web test:e2e tienda-catalogo
pnpm --filter @platform/web test:e2e tienda-ficha
pnpm --filter @platform/web test:e2e tienda-contacto
```

## Seguridad y aislamiento

- No hay cambios en los privilegios de las funciones públicas: siguen siendo `security definer` con
  `search_path = ''`, lista blanca de campos, filtro por `host` y `empresa.activa`, y el mismo `null`
  para host desconocido o empresa desactivada.
- La migración `20270228300600` **suma** un privilegio: `execute` sobre una helper **pura de texto**
  para `authenticated`. No lee datos ni cambia permisos. El `revoke` previo (en `…300500`) es de
  `public` y `anon`, y revocar de `PUBLIC` alcanza también a `authenticated` por herencia: por eso el
  `grant` explícito es necesario y no redundante.
- El subárbol de categorías (conteo y filtro) se limita a `organizacion_id` de la tienda: una categoría
  de otra organización no se cuenta ni se filtra.
- Los textos limpios se siguen mostrando como nodos de React: no hay `dangerouslySetInnerHTML` en el
  front público.

## Operación

- **Migraciones:** aplicar en orden `20270228300400`, `20270228300500`, `20270228300600`. La primera
  tarda (reescribe las funciones y, con el volumen real de la demo, recalcula el conteo de categorías);
  la segunda reescribe los productos afectados.
- **Sin caché** de las respuestas públicas: cada carga hace una llamada por RPC.
- **Despliegue:** la corrección está mergeada en `dokploy` (PR #870, merge `ebd2b1f8`). La demo pública
  seguía sirviendo el bundle anterior al merge (verificado el 12 nov 2026 sobre el chunk
  `MenuMovil` desplegado): ver «Límites y deuda».
- **Rollback:** revertir el PR completo (`git revert -m 1 ebd2b1f8`) devuelve el front; para la base,
  reaplicar las definiciones anteriores (ver la tabla de migraciones). **Ojo:** revertir la migración del
  prefijo no devuelve los nombres con «&ua» (el dato se limpió, no se guardó copia).

## Decisiones y supuestos

| Decisión | Supuesto adoptado | Si cambia |
|---|---|---|
| **D1** · cuántas categorías principales | **6** (las del prototipo) | La constante `CATEGORIAS_PRINCIPALES` en `lib/tiendaCategorias.ts` |
| **D2** · cuáles son las principales | Las **raíces** visibles con más productos, sin nombres repetidos | `categoriasPrincipales()` en `lib/tiendaCategorias.ts` |
| **D3** · el conteo de una categoría | Suma sus **subcategorías** | La función `publico.categorias_por_dominio` (`20270228300400`) |
| **D4** · filtro por categoría | Incluye el **subárbol** | `publico.catalogo_pagina_por_dominio` (`20270228300400`) |
| **D5** · el precio en el catálogo | Se calcula para la **página** salvo que el orden o el tope lo necesiten | La CTE `pagina` de `20270228300400` |
| **D6** · prefijo de importación | Se quita **en el origen** (disparador) y además **al mostrar** (front) | `private.normalizar_producto()` y `lib/tiendaTextos.ts` |
| **D7** · «Respondemos dentro de las 24 h» | Texto **fijo de la plataforma** (como el prototipo), no configurable por tienda | `contacto/DatosContacto.tsx` |
| **D8** · «Retiro y envíos» | El medio de coordinación depende de si la tienda cargó WhatsApp | `contacto/DatosContacto.tsx` |
| **D9** · ¿compra online? | Sigue **fuera de alcance**: la página aclara que no hay compra online | — |

## Contradicciones con el prototipo

1. **La barra de categorías se desplaza**: con nombres largos el menú de una sola línea no entra en
   1440 px y se desplaza con el mouse. El prototipo muestra menos categorías por barra.
2. **«Más categorías» / «Ver todas las categorías →»**: son accesos a `/catalogo` que el prototipo no
   dibuja; hacen falta porque el catálogo tiene muchas más categorías que las seis principales.
3. **El panel de categorías del catálogo** es un árbol con sangría; el prototipo lo muestra plano.
4. **«No hay compra online en esta versión»** se muestra como texto del bloque «Retiro y envíos»: es una
   aclaración de estado, no un estado de compra (MSF-176 sigue fuera de alcance).
5. **La versión móvil** (`MJC_M_*`, `SJ_M_*`) y la tienda San Javucho **no se relevaron** en la primera
   pasada de la épica: el relevamiento de la segunda pasada quedó pendiente.

## Límites y deuda

- **La demo pública seguía sirviendo el bundle anterior al merge** (verificado el 12 nov 2026 sobre el
  chunk `MenuMovil` desplegado: seguía listando todas las categorías, sin «Más categorías»). La base ya
  tenía las migraciones aplicadas; faltaba el front. **Dueño: Operación / despliegue** — redesplegar
  `dokploy` y volver a tomar las capturas del manual.
- **Las capturas del manual** de las pantallas públicas se tomaron de una build de la rama
  `epic/MSF-825-tiendas-demo-vs-prototipo` (merge `ebd2b1f8`) servida contra la base de la demo, **no de
  la demo pública**, que todavía sirve el bundle anterior (verificado el 12 nov 2026). Cuando la demo se
  redespliegue, hay que **volver a tomarlas**. **Dueño: Tiendas online / Documentación.**
- **El relevamiento de la versión móvil y de la tienda San Javucho** quedó sin hacer (la épica lo declara
  «no verificado»). **Dueño: Tiendas online.**
- **Los E2E con los rótulos de esta épica no existen**: la cobertura es pgTAP + Vitest. Ver «Cómo
  automatizarlo». **Dueño: Tiendas online / QA.**
- **«Respondemos dentro de las 24 h» es un texto fijo**: una tienda con otro plazo no lo puede cambiar.
  **Dueño: decisión de producto (Nicolás).**
- **No hay un volumen máximo verificado del catálogo:** con 2.204 productos por tienda `/catalogo` carga en
  ~0,3 s, pero no se midió un catálogo mayor. **Dueño: Tiendas online.**
- **La limpieza del prefijo no es reversible**: el nombre anterior no se conserva (era basura de
  importación). Si una tienda tenía un nombre legítimo que empezaba con «&ua », se le quitó el prefijo.
- **Fuera de alcance:** compra online y carrito (MSF-176/237), «Últimas unidades · quedan N», slugs de
  categoría y la adaptación móvil de las pantallas (MSF-191).
