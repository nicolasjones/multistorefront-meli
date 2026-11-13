---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Tienda pública: diseño del prototipo (MSF-841)

Épica **MSF-841** — Tiendas públicas · Diseño del prototipo (identidad aplicada, barra superior, pie, logo y
categorías con foto). Spec, plan y tareas en `specs/20261112-200000-tiendas-diseno-del-prototipo/`.
Rama `epic/MSF-841-tiendas-diseno-del-prototipo` (commits `acc9e49b`, `94ed436e`, `e4808b62`, `e6ec8bbe`,
`638875a9`, `55ebfffa`, `0f7ebc72`, `48b79f60`, con los ajustes de revisión `0f533538`, `77916f9e`, `5bb70762`
y `5f565cb8`; migraciones renumeradas en `01c1901e`). Depende de
[MSF-825 (demo frente al prototipo)](tienda-demo-vs-prototipo.md), [MSF-167 (catálogo y ficha)](tienda-catalogo-y-ficha.md),
[MSF-191 (inicio, búsqueda y móvil)](tienda-inicio-busqueda-movil.md) y
[MSF-212 (WhatsApp y contacto)](tienda-whatsapp-y-contacto.md).

> **Estado:** implementada en la rama de la épica, pendiente de verificación visual en dev y de merge.
> T017 (verificación contra el prototipo con Playwright) y T018 (foto de categoría en la vista previa del panel)
> siguen abiertas; el detalle está en [Pendientes](#pendientes).

Resumen para quien administra la tienda: [Las tiendas online de tu negocio](../producto/tiendas-online.md) e
[Identidad, textos y dirección de la tienda](../producto/tienda-dominio-e-identidad.md).

## Alcance de entrega

- **`supabase`:** cuatro migraciones **aditivas** del tramo A (tipografías, color de barra, eslogan y foto de
  categoría). No crean tablas; agregan columnas, amplían una lista cerrada y redefinen funciones.
- **`refine`:** front público de la tienda (`apps/web/src/pages/tienda-publica/`) y la vista previa del panel.
- **Sin** `workers`, `kestra`, `superset` ni Compose nuevo.

| Tarea | Migración | Qué cambia | Reversión (en el encabezado de la migración) |
|---|---|---|---|
| T001 | `supabase/migrations/20270303100000_tienda_tipografias_prototipo.sql` | Agrega `Bricolage Grotesque` y `DM Sans` a los `check` de `dominio.tienda_identidad` y a `private.validar_tienda_identidad` | Volver a los checks y al validador con la lista de siete familias |
| T002 | `supabase/migrations/20270303200000_tienda_color_barra.sql` | `dominio.tienda_identidad.color_barra` (`#RRGGBB`, default `#222222`), `private.identidad_vivo`, `private.detalle_cambios_tienda`, `publico.identidad_por_dominio` y `public.guardar_tienda_identidad` | Recrear las funciones sin `color_barra` y recién entonces `drop column` |
| T003 | `supabase/migrations/20270303300000_tienda_eslogan.sql` | `dominio.tienda_contenido.eslogan` (hasta 80 caracteres, recortado), `private.contenido_vivo`, `private.detalle_cambios_tienda`, `publico.contenido_por_dominio` y `public.guardar_tienda_contenido` | Recrear las funciones sin `eslogan` y recién entonces `drop column` |
| T004 | `supabase/migrations/20270303400000_tienda_categorias_imagen.sql` | `publico.categorias_por_dominio` devuelve `imagen` por categoría (ruta del bucket `productos-imagenes`) | Volver a la definición de `20270228300400_tienda_publica_rendimiento_y_categorias.sql` |

Las cuatro versiones quedaron por encima de la máxima de `origin/dokploy` al integrar (`20270302100000`); el
reordenamiento está en el commit `01c1901e`.

## Causa raíz de «los colores no se aplican»

`ProveedorTemaTienda` (tema MUI a partir de la identidad) solo se usaba en la vista previa del panel. En la
tienda pública, `TemaTienda` era una sección de la portada que únicamente seteaba variables CSS: `/catalogo`,
`/categoria`, `/producto` y `/contacto` no aplicaban identidad y, en la portada, botones y enlaces seguían con
el azul de MUI. MSF-841 sube la lectura de la identidad al layout y la reparte por tema, variables CSS y
contexto.

## Tramo A: datos

El detalle de columnas, RPC y contratos está en
[Tienda online: dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md) y el DER en
[Datos y DER](datos.md#modelo-de-la-tienda-msf-147). En resumen:

- **Tipografías:** la lista cerrada pasa de siete a nueve familias en los `check` de la tabla y en el validador
  compartido; `TIPOGRAFIAS` en `apps/web/src/lib/tiendaIdentidad.ts` ya arma la URL de Google Fonts desde la
  identidad, así que el front no necesitó otra lista.
- **Color de barra:** quinto color de la identidad (`color_barra`). Viaja en el borrador, en las versiones (un
  borrador anterior sin la clave vale `#222222`), en `publico.identidad_por_dominio` y en la pestaña, con su
  chequeo de contraste AA. Un cambio de barra cuenta como «colores» en el resumen de cambios sin publicar.
- **Eslogan:** texto comercial nuevo (`eslogan`, 80 caracteres, vacío = no se muestra) con recorte por trigger
  y validación con `hint = 'eslogan'`. `public.guardar_tienda_contenido` agrega `p_eslogan` al final.
- **Foto de categoría:** no hay campo de configuración. `publico.categorias_por_dominio` devuelve `imagen` con
  la ruta de la imagen principal (menor `posicion`) de un producto efectivamente visible de la categoría o de
  sus subcategorías; el primero por nombre y, en empate, por id. Se calcula en una sola pasada (CTE
  materializados `efectivos` → `img_producto` → `imagen`) para no repetir el timeout de MSF-825 bajo `anon`.
- **Firmas:** `public.guardar_tienda_identidad` agrega `p_color_barra text default null` y
  `public.guardar_tienda_contenido` agrega `p_eslogan text default null`, ambas al final; se eliminan las firmas
  viejas. Siguen sin ser ejecutables por `authenticated` (solo las llama `public.publicar_tienda`).

## Tramo B: front público

| Pieza | Archivo | Qué hace |
|---|---|---|
| Identidad por host | `apps/web/src/pages/tienda-publica/layout/IdentidadTiendaContexto.tsx` | `ProveedorIdentidadTienda` lee `resolverIdentidadPublica` una vez por host y la aplica al tema MUI (`ProveedorTemaTienda`), a las variables `--tienda-*` (incluida `--tienda-color-barra`) y al contexto `useIdentidadTienda()`. Sin identidad legible, tema base. |
| Tema | `apps/web/src/tema/temaTienda.ts` | `theme.tienda` expone `barra`, `textoBarra`, `superficie` y `fuenteTitulos`; títulos y cuerpo usan las tipografías de la identidad. |
| Barra superior | `apps/web/src/pages/tienda-publica/layout/BarraSuperior.tsx` | 36 px (28 px en celular), fondo `colorBarra`, texto blanco de 13 px (12 px en celular). Izquierda: `eslogan` o `bienvenida`; derecha desde `md`: WhatsApp (`wa.me`) y correo (`mailto:` codificado). Sin datos no se dibuja; mientras llega el contacto reserva su altura. |
| Encabezado y categorías | `layout/LayoutTienda.tsx`, `layout/MenuCategorias.tsx` | Logo a la izquierda (sin logo, el nombre), buscador flexible hasta 560 px con lupa, «Inicio» / «Contacto» en `nav` «Principal» y barra de categorías en mayúsculas, 15 px, 600, subrayado de 3 px en la activa. Conserva el tope de 6 principales + «Más categorías» de MSF-825. |
| Pie oscuro | `layout/PieCategorias.tsx`, `layout/PieInformacion.tsx`, `layout/PieLegal.tsx` | Fondo `colorBarra`, logo en blanco (`brightness(0) invert(1)`) o nombre, eslogan, `contenido.pie`, columnas Categorías, Información, Contacto (WhatsApp, correo, «Escribinos»), bloque legal y «© año empresa». |
| Categorías con foto | `secciones/CategoriasInicio.tsx` | Firma las rutas con `urlsImagenesProducto` en una sola llamada por bloque y muestra la foto en un recuadro de 120 px; sin foto o si no se pudo firmar, recuadro neutro. |
| Bloque de consultas | `secciones/ConsultasInicio.tsx` | Al final de la portada: WhatsApp de la tienda y «Escribinos» (a `/contacto`, con el correo si lo hay); sin WhatsApp queda solo «Escribinos». No se dibuja en la vista previa del panel. |

- **Una sola lectura por host:** el layout comparte identidad, contenido (`ProveedorContenidoTienda`), contacto
  (`ContextoContactoTienda`) y categorías (`ContextoCategoriasTienda`). `useContenidoPublico`,
  `useContactoTienda` y `useCategoriasTienda` usan el compartido si existe; sin layout (vista previa, tests)
  leen por su cuenta.
- **Sin bloquear el pintado:** la tienda arranca con el tema base y pasa a la identidad al llegar. Es un
  destello conocido y aceptado; para no sumar saltos, la barra reserva su altura mientras llega el contacto. La
  hoja de Google Fonts se pide con `display=swap` y `preconnect` a `fonts.googleapis.com` /
  `fonts.gstatic.com`.
- **Vista previa del panel:** recibe la identidad inyectada (`ProveedorFuenteTienda`) y no toca variables
  globales. No muestra la barra, el encabezado ni el pie (son solo de la tienda pública) y no calcula la foto de
  categoría (`vista_previa_tienda` no devuelve `imagen`): muestra el recuadro neutro.

## Accesibilidad

`layout/tiendaDiseno.test.tsx`, `rutas/inicio/CategoriasInicio.test.tsx` y
`rutas/inicio/ConsultasInicio.test.tsx` corren axe con el modo celular forzado por `matchMedia` a 320 y 768 px
y el de escritorio a 1440 px (jsdom no calcula anchos; el modo es lo que cambia). El texto del pie no se atenúa
con opacidad y el texto secundario del tema se calcula para llegar a 4,5:1 sobre el fondo y sobre la superficie
de las tarjetas. El contraste del texto blanco sobre `colorBarra` lo informa la pestaña Identidad.

## Diferencias conocidas con el prototipo

- Las categorías vacías se omiten (la base no las devuelve, MSF-825/MSF-827); el prototipo muestra «Skins y
  calcos, 0 productos».
- En celular el encabezado pone la marca a la izquierda y el menú a la derecha; el prototipo pone el menú a la
  izquierda, el logo al centro y la lupa a la derecha.
- El menú de celular no tiene el logo ni el buscador como ícono (se conserva el buscador a todo el ancho de
  MSF-825).
- El héroe oscuro de la portada no es del layout: depende de los banners configurados (`BannerHome`).
- La tarjeta de producto, el catálogo, la categoría, la ficha y las versiones móviles no se rediseñaron en este
  tramo: solo cambia el marco común (barra, encabezado, pie) y la identidad.
- El campo de «categorías principales» por tienda sigue siendo una decisión abierta de MSF-825.

## Guía de prueba técnica

### Prerrequisitos

- Entorno **DEV** (o local con `pnpm dev:supabase` y `pnpm dev:refine:host`) con las dos tiendas demo
  (`mundojc.localhost` y `sanjavucho.localhost`, seed local).
- Un usuario con **edición en Empresas** para la gestión; el front público se prueba **sin sesión**.
- Las migraciones `20270303100000`–`20270303400000` aplicadas y la versión 2 de la identidad publicada.

### Pasos

1. **Tipografías en la base.** En SQL, comprobar que la lista cerrada acepta las dos familias nuevas y rechaza
   una ajena. Rótulo `[MSF-841:T001]`.
2. **Color de barra.** Guardar una identidad con `color_barra` y publicar; abrir la tienda y ver la franja
   superior y el pie con ese color. Rótulo `[MSF-841:T002]`.
3. **Eslogan.** Cargar un eslogan de hasta 80 caracteres y publicar; verlo en la barra superior y en el pie.
   Probar 81 caracteres: la base responde `22023` con `hint = 'eslogan'`. Rótulo `[MSF-841:T003]`.
4. **Foto de categoría.** Consultar `publico.categorias_por_dominio` y comprobar que cada categoría trae
   `imagen` (o `null`); en la portada, la tarjeta muestra la foto o el recuadro neutro. Rótulo `[MSF-841:T004]`.
5. **Identidad en todas las rutas.** Con la tienda publicada, entrar a `/`, `/catalogo`, `/categoria/<id>`,
   `/producto/<id>` y `/contacto`: botones, enlaces, títulos y franjas usan los colores y tipografías de la
   tienda, no el azul de MUI. Rótulo `[MSF-841:T005]`.
6. **Logo.** Ver el logo en el encabezado (enlazado a la portada) y en el pie (en blanco); sin logo, el nombre
   en texto. Rótulo `[MSF-841:T006]`.
7. **Barra superior.** Ver eslogan (o bienvenida), WhatsApp y correo a la derecha en escritorio; en celular,
   solo el eslogan. Quitar el WhatsApp y el correo: la barra desaparece si no queda texto. Rótulo
   `[MSF-841:T007]`.
8. **Encabezado y categorías.** «Inicio» / «Contacto» en la fila de la marca; categorías en mayúsculas con
   subrayado en la activa; hasta 6 + «Más categorías». Rótulo `[MSF-841:T008]`.
9. **Pie oscuro.** Logo, eslogan, texto del pie, Categorías, Información, Contacto, bloque legal y «© año
   empresa». El texto del pie no se duplica en la portada. Rótulo `[MSF-841:T009]`.
10. **Tarjetas con foto.** Cada tarjeta de categoría de la portada muestra la foto de un producto de la
    categoría y conserva nombre y conteo. Rótulo `[MSF-841:T010]`.
11. **Bloque de consultas.** Al final de la portada, WhatsApp y «Escribinos»; sin WhatsApp, solo «Escribinos».
    Rótulo `[MSF-841:T011]`.
12. **Tipografías en el front.** Los títulos usan la tipografía de títulos y el cuerpo la de texto; la hoja de
    Google Fonts se pide con `display=swap`. Rótulo `[MSF-841:T012]`.
13. **Lecturas únicas.** Con la pestaña Red del navegador, comprobar una sola lectura de identidad, contenido,
    contacto y categorías por host. Rótulo `[MSF-841:T013]`.
14. **Accesibilidad.** Correr axe en 320, 768 y 1440 px con el modo forzado por `matchMedia`; sin violaciones.
    Rótulo `[MSF-841:T014]`.

### Resultado esperado

- Dado un administrador con edición en Empresas, cuando publica una identidad con logo, cinco colores,
  tipografías y eslogan, entonces la tienda pública muestra esa identidad en todas sus rutas, con barra
  superior, encabezado con logo, pie oscuro y tarjetas de categoría con foto.
- Dado un visitante sin sesión, cuando entra a cualquier ruta de la tienda, entonces ve los colores,
  tipografías y textos de **esa** tienda y no valores fijos de otra.
- Dado un dato ausente (sin logo, sin eslogan, sin WhatsApp o sin foto de categoría), cuando se carga la
  tienda, entonces el elemento no se muestra y el resto sigue funcionando.

### Cómo automatizarlo

| Rótulo | Cobertura actual | Automatización pendiente |
|---|---|---|
| `[MSF-841:T001]` | pgTAP de identidad (`supabase/tests/database/tienda_identidad.test.sql`) | Caso con las dos tipografías nuevas y una ajena |
| `[MSF-841:T002]` | Vitest de identidad y contrato (`apps/web/src/lib/tiendaIdentidad.test.ts`) | pgTAP de `color_barra` en borrador, versión y `publico.identidad_por_dominio` |
| `[MSF-841:T003]` | Vitest de contenido (`apps/web/src/lib/tiendaContenido.test.ts`) | pgTAP del tope de 80 y del `hint = 'eslogan'` |
| `[MSF-841:T004]` | Vitest de `CategoriasInicio` (`rutas/inicio/CategoriasInicio.test.tsx`) | pgTAP de `imagen` en `publico.categorias_por_dominio` |
| `[MSF-841:T005]`–`[MSF-841:T014]` | Vitest + axe de `layout/tiendaDiseno.test.tsx`, `CategoriasInicio.test.tsx` y `ConsultasInicio.test.tsx` | E2E con los dos dominios del seed (`apps/web/e2e/tienda-dos-dominios.e2e.ts`) |
| `[MSF-841:T017]` | — | Verificación visual contra `design/pantallas/MJC_*` y `SJ_*` con Playwright, pendiente en dev |

```bash
pnpm dev:supabase
pnpm --filter @platform/web test
pnpm --filter @platform/web test:e2e tienda-dos-dominios
```

## Capturas

TODO (dueño: Documentador / equipo de diseño): regenerar las capturas de la tienda con la barra superior, el
encabezado con logo, el pie oscuro y las tarjetas con foto. En este repositorio no existe el script
`pnpm docs:capturas`; cuando esté disponible, guardar las imágenes en `docs/producto/img/tiendas-online/` y
`docs/producto/img/tienda-dominio-e-identidad/`.

## Pendientes

| Pendiente | Dueño | Estado |
|---|---|---|
| T017 — verificación visual contra el prototipo con Playwright en dev | Nicolás / equipo de desarrollo | Abierta; no se corrió por falta de memoria libre en el servidor |
| T018 — foto de categoría en la vista previa del panel | Producto / desarrollo | Abierta; `vista_previa_tienda` no devuelve `imagen`, la vista previa muestra el recuadro neutro |
| Recapturas del manual de usuario | Documentador / equipo de diseño | Pendiente de `pnpm docs:capturas` |
