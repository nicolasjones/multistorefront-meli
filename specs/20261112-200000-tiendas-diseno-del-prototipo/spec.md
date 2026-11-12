# Feature Specification: Tiendas online · Diseño del prototipo

**Feature Branch**: `epic/MSF-841-tiendas-diseno-del-prototipo`

**Componente**: Tiendas online

**Jira Epic**: MSF-841 — Tiendas públicas: diseño del prototipo (spec `tiendas-diseno-del-prototipo`)

**Created**: 2026-11-12

**Status**: Implementada en la rama (tramo A: datos; tramo B: front). Pendiente de revisión, PR y verificación en dev.

**Delivery scope**: `refine` (`apps/web`: front público de la tienda y vista previa del panel) y `supabase` (migraciones aditivas del tramo A: tipografías, color de barra, eslogan y foto de categoría en `publico.categorias_por_dominio`). Sin `kestra`, `superset` ni `workers`.

**Input**: las tiendas públicas no se parecían al prototipo (`design/pantallas/MJC_*`, `SJ_*`) y «los colores no se aplicaban». Objetivo: que el front público reproduzca el diseño del prototipo con la identidad de **cada** empresa (multitienda: nada fijo por tienda).

## Alcance

- **Tramo A (datos, ya en la rama)**: tipografías `Bricolage Grotesque` y `DM Sans`; quinto color `color_barra` («Barra superior y pie») en la identidad; campo `eslogan` (80 caracteres) en el contenido; `imagen` en las categorías de `publico.categorias_por_dominio`. Detalle en `docs/tiendas-online.md`.
- **Tramo B (front)**: la identidad se aplica a toda la tienda (no solo a la portada), logo, barra superior, encabezado y barra de categorías, pie oscuro, tarjetas de categoría con foto, bloque «Consultas por WhatsApp / Escribinos» y tipografías.

## Causa raíz de «los colores no se aplican»

`ProveedorTemaTienda` (tema MUI desde la identidad) solo se usaba en la vista previa del panel; en la tienda pública `TemaTienda` era una sección de la portada que solo seteaba variables CSS. En `/catalogo`, `/categoria`, `/producto` y `/contacto` no se aplicaba identidad alguna y en la portada los botones y enlaces seguían con el azul de MUI.

## Requisitos funcionales

- **FR-001** La identidad (colores, tipografías, logo, color de barra) se lee una vez por host en el layout y se aplica a **todas** las rutas de la tienda: tema MUI, variables `--tienda-*` (incluida `--tienda-color-barra`) y contexto. Sin identidad legible, tema base.
- **FR-002** El encabezado muestra el logo de la tienda a la izquierda (enlazado a la portada, con el nombre como texto alternativo); sin logo, el nombre en texto. El logo no se repite en la portada.
- **FR-003** Barra superior de 36 px (28 px en celular), fondo `colorBarra`, texto blanco de 13 px: izquierda el eslogan (o, sin eslogan, la bienvenida); derecha WhatsApp y correo de la tienda (solo desde `md`). Un dato ausente no se muestra; sin nada que mostrar, no hay barra. La bienvenida no se duplica: la franja de la portada solo queda si hay eslogan y una bienvenida distinta.
- **FR-004** El encabezado trae marca, buscador (campo de 44 px con botón de lupa) y «Inicio» / «Contacto»; debajo, la barra de categorías en mayúsculas, 15 px, 600, subrayado de 3 px en la activa. Máximo 6 categorías principales + «Más categorías» (MSF-825).
- **FR-005** Pie oscuro (fondo `colorBarra`, texto blanco): logo en blanco, eslogan, texto del pie configurado, columnas Categorías, Información y Contacto (WhatsApp, correo, «Escribinos»), bloque legal y «© {año} {empresa}. Todos los derechos reservados.» con el nombre de la tienda.
- **FR-006** Las tarjetas de categoría de la portada muestran la foto de la categoría; sin foto, el recuadro neutro. Nombre y «N productos» como antes.
- **FR-007** Bloque «Consultas por WhatsApp / Escribinos» al final de la portada; sin WhatsApp, solo «Escribinos».
- **FR-008** Los títulos usan la tipografía de títulos de la identidad y el cuerpo la de texto (tema MUI), con la hoja de Google Fonts pedida con `display=swap` y `preconnect`.
- **FR-009** Rendimiento: identidad, contenido y contacto se leen una sola vez por host; la vista previa del panel no lee `publico.*` ni toca variables globales.
- **FR-010** Accesibilidad: sin violaciones de axe a 320, 768 y 1440 px en el layout; contraste AA del texto blanco sobre la barra lo informa la pestaña Identidad (tramo A).

## Matriz pantalla↔criterios

Pantallas: `MJC_Home`, `MJC_Contacto`, `MJC_Catalogo`, `MJC_Producto`, `SJ_Home` y sus versiones móviles `MJC_M_*` / `SJ_M_*` (`design/pantallas/*.inventory.json`). Las tres pantallas de contenido (Catálogo, Producto, Contacto) ya estaban implementadas por sus épicas (MSF-167, MSF-212); acá solo cambia el marco común (barra, encabezado, pie) y la identidad.

| Ítem del inventario | Pantallas | Criterio / decisión |
|---|---|---|
| Campo «Buscar productos» | todas | FR-004 (estilo alineado: 44 px, borde 1,5 px, lupa); sugerencias de MSF-825/F-TDA-15 sin cambios. |
| «Ver todos los resultados →» (sugerencias) | Home, Contacto, Catálogo, Producto, SJ_Home | Ya existe (F-TDA-15); fuera de alcance de este cambio. |
| «Inicio», «Contacto» (fila de la marca) | todas | FR-004. En celular los lleva `MenuMovil` (sin cambios). |
| Categorías de la barra (Cargadores, Protectores, Joysticks, Cases y estuches, Vidrios templados, Skins y calcos) | todas | FR-004: las principales de la tienda, nunca fijas; «Más categorías» si hay más. |
| «SAN JAVUCHO» (marca en texto) | SJ_Home, SJ_M_Home | FR-002: sin logo, el nombre de la tienda en texto. |
| «Ver catálogo» / «Explorar productos» (héroe) | Home, SJ_Home, móviles | Fuera de alcance: lo configura `BannerHome`/contenido (F-TDA-02/03); el héroe oscuro del prototipo no es del layout. |
| Tarjetas de categoría «Nombre N productos» | Home, SJ_Home, móviles | FR-006 (foto + nombre + conteo). |
| «Ver todo el catálogo →» | Home, SJ_Home, móviles | Ya existe (F-TDA-10); sin cambios. |
| Tarjeta de producto «Sin imagen / Sin stock» | Home, Catálogo, Producto, SJ, móviles | Fuera de alcance: tarjetas de producto de MSF-167; no se tocan en este tramo. |
| «Escribinos» (bloque Consultas y pie) | Home, Contacto, Catálogo, Producto, SJ_Home | FR-007 (bloque de la portada) y FR-005 (columna Contacto del pie). |
| «Consultas por WhatsApp» (bloque) | Home, SJ_Home | FR-007. |
| Franja superior (eslogan, WhatsApp, correo) | todas | FR-003. |
| Pie oscuro (logo, eslogan, Categorías, Contacto, ©) | todas | FR-005. |
| «Enviar consulta», «Enviar otra» | Contacto, MJC_M_Contacto | Fuera de alcance: formulario de MSF-212 (F-TDA-16). |
| «Solo con stock», «Limpiar filtros», «Limpiar», «· ▾», «Sin límite», «Filtrar», «Ver · productos» | Catálogo, MJC_M_Catalogo | Fuera de alcance: catálogo con filtros de MSF-167 (F-TDA-12); solo cambia el marco y los colores (FR-001). |
| «Todos los productos», «← Todos los productos», «Consultar por WhatsApp», «Ver más productos», «Cancelar», «Abrir WhatsApp» | Producto, MJC_M_Producto | Fuera de alcance: ficha de MSF-167/MSF-212; solo cambia el marco y los colores (FR-001). |

## Diferencias conocidas con el prototipo

- El menú de celular no tiene el logo ni el buscador como ícono (se conserva el buscador a todo el ancho de MSF-825).
- El héroe oscuro de la portada no es del layout: depende de los banners configurados.
- La vista previa del panel no muestra la barra, el encabezado ni el pie (siguen siendo solo de la tienda pública).
