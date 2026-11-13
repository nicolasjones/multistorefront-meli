# Feature Specification: Tiendas públicas · Fidelidad con el prototipo (MSF-847)

**Épica**: MSF-847 (seguimiento de MSF-841/MSF-846) · **Spec**: `tiendas-fidelidad-prototipo` · **Prioridad**: P2
**Alcance de entrega**: `refine` (sin `supabase`, `kestra`, `superset` ni `workers`: no hay migraciones, tablas ni cambios de base).
**Fuente**: comparación con Playwright del prototipo (`design/pantallas/MJC_*`, `SJ_*`, escritorio 1440 y celular 390) contra la tienda en dev, midiendo con `getComputedStyle`. Esta spec **traduce**: no agrega alcance de negocio ni cambia datos; el prototipo manda la UI (`CLAUDE.md`).

## Objetivo

1. La tarjeta de producto (catálogo, categoría, destacados de la portada y relacionados de la ficha) tiene las medidas del prototipo.
2. El resto de las pantallas públicas (portada, catálogo, categoría, ficha y contacto, en las dos tiendas) coincide con el prototipo en tipografía, tamaños, colores, espaciados y estructura, salvo las diferencias declaradas en la matriz.

## User Scenarios & Testing

### User Story 1 - Tarjeta de producto como el prototipo (P1)
1. Borde de 1 px (`rgba(0,0,0,.08)`), radio 8, fondo blanco y recorte; área de imagen cuadrada con el fondo de superficie y la imagen COMPLETA (`contain`, hasta 86 %); «Sin imagen» en gris; «Sin stock» como insignia arriba a la izquierda (10 px) y la imagen atenuada (45 %).
2. Cuerpo de 14 px: nombre de 16 px/500 en 2 líneas como máximo (alto fijo 42 px), precio de 22 px/700 en la tipografía de títulos y el color primario, y disponibilidad de 13 px/500 con punto de 8 px («Disponible» #2E7D32, «Sin stock» #6B6B6B).
3. «Últimas unidades» NO se implementa (la plataforma no expone cantidades, FR-023).
4. Grillas: 4 columnas de ~282 px con 24 px de separación en la portada y los relacionados; 3 columnas en el catálogo y las categorías; 2 columnas con 12 px de separación en celular. Sin romper el reflow ni axe a 320/768/1440.

### User Story 2 - Contenedor, encabezado y pie (P1)
1. Contenido de 1200 px (antes 1168), márgenes de 14 px en celular; texto en el color de la tienda y fondo de la tienda en toda la página; títulos en negrita sin el espaciado entre letras de MUI; botones sin mayúsculas forzadas.
2. Barra de categorías en la tipografía de texto (Barlow, no la de títulos); buscador de 15 px con sugerencias del prototipo (miniatura de 36 px, nombre, precio en primario); pie con filas de 28 px.
3. Celular: menú a la izquierda y marca centrada (60 px), buscador en su propia fila, menú lateral de 300 px con «Inicio», «Categorías», las categorías y «Contacto», pie con 20 px de margen.

### User Story 3 - Portada (P1)
Franja del banner a todo el ancho con el color de la barra (440 px; título de 72 px en mayúsculas, bajada de 20 px, botón primario y dos franjas inclinadas), «Categorías» con tarjetas de 186 px, «Destacados» con «Ver todo el catálogo →», y el bloque de consultas a todo el ancho. En celular, las categorías son píldoras y «Ver todo el catálogo» un botón con borde.

### User Story 4 - Catálogo y categoría (P1)
Migas «Inicio / Página» (14 px), título de 44 px/700 (30 px en celular), panel de 260 px (títulos de 18 px en la tipografía de títulos, filas de 15 px con la elegida en negrita y primario, casilla «Solo con stock», campo «Precio máximo» de 40 px, «Limpiar filtros» de texto), contador y «Ordenar por» con su menú como el prototipo, estado vacío punteado «No hay productos con esos filtros». En celular, «Filtrar» y el orden vigente en dos botones iguales.

### User Story 5 - Ficha y contacto (P1)
Ficha: galería de 600 px (miniaturas de 84 px con borde primario en la elegida), título y precio de 44 px, disponibilidad de 16 px con punto de 10 px, datos de 15 px, botones de 16 px/700 con radio 8 y relacionados. Contacto: columna de 460 px con círculos de 44 px y glifos, tarjeta del formulario con rótulos arriba, campos de 44 px y botón de 48 px.

## Requirements

- **FR-001**: `TarjetaProducto` + `PrecioTachado` + `EtiquetaDisponibilidad` con las medidas de la US1; `data-testid`, `h3`, textos accesibles y enlace completo se conservan.
- **FR-002**: `GrillaProductos` (4/3/2 columnas) en portada, relacionados, catálogo y categoría.
- **FR-003**: tema de la tienda (`tema/temaTienda.ts`): títulos en negrita, interlineado y espaciado `normal`, botones del prototipo.
- **FR-004**: contenedor de 1232 px (1200 de contenido) y márgenes de celular (`layout/medidas.ts`); color de texto y fondo de la tienda en el layout.
- **FR-005**: encabezado, barra de categorías, buscador, menú de celular y pie con las medidas de la US2.
- **FR-006**: portada (banner, categorías, destacados, consultas) con la US3.
- **FR-007**: catálogo y categoría (migas, título, panel, orden, vacío, filtros de celular) con la US4.
- **FR-008**: ficha y contacto con la US5.
- **FR-009**: sin regresiones: Vitest de la tienda en verde, axe sin violaciones a 320/768/1440 y sin scroll horizontal.
- **SC-001**: medidas del prototipo verificadas con Playwright sobre una build local (los números están en `docs/tiendas-online.md`, «Fidelidad con el prototipo»).

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/MJC_Home`, `MJC_Catalogo`, `MJC_Categoria`, `MJC_Producto`, `MJC_Contacto`, `MJC_M_Home`, `MJC_M_Catalogo`, `MJC_M_Producto`, `MJC_M_Contacto` y sus equivalentes `SJ_*` (`*.inventory.json`; las dos tiendas comparten el layout y solo cambia la identidad). No se agrega ni quita ningún elemento visible, salvo lo que se declara.

| Ítem del inventario / elemento visible | Pantalla | Criterio |
|---|---|---|
| Campo «Buscar productos» y «Ver todos los resultados →» | Todas | FR-005 (campo de 15 px, panel de sugerencias de 10 px de radio, miniatura de 36 px) |
| «Inicio», «Contacto» (encabezado) | Todas | FR-005 (15 px/600). Diferencia conocida: el enlace de la página actual lleva subrayado primario (orientación, ya existente) |
| Cargadores, Protectores, Joysticks, Cases y estuches, Vidrios templados, Skins y calcos (barra de categorías) | Todas | FR-005 (Barlow 15 px/600 en mayúsculas; las categorías son las de la tienda) |
| «Escribinos» y columnas del pie | Todas | FR-005 (filas de 28 px). Diferencia conocida: el texto del pie no se atenúa con opacidad (contraste AA); el pie suma «Información» y el bloque legal (otras funcionalidades) |
| Botón «Ingresar» / «Salir» | Todas | Fuera de alcance: viene de otra funcionalidad (F-CLI-06); el prototipo lo omite |
| Barra superior (eslogan, WhatsApp, correo) | Todas | Sin cambio: ya medida en MSF-841 (36 px / 28 px en celular) |
| «Ver catálogo» (héroe) | Portada | FR-006 (franja de 440 px, título de 72 px, botón de 16 px/700). Fuera de alcance: las tarjetas de producto del héroe (el banner no trae productos) |
| «Cargadores 2 productos»… (tarjetas de categoría) | Portada | FR-006 (186 px, 16 px de separación, píldoras en celular). Diferencia conocida: las categorías sin productos no se muestran (MSF-825) |
| «Ver todo el catálogo →» / «Ver todo el catálogo» | Portada | FR-006 |
| «Sin imagen», «Sin stock», nombre, precio, disponibilidad | Portada, catálogo, categoría, ficha | FR-001, FR-002 |
| «Consultas por WhatsApp» / «Escribinos» (bloque) | Portada | FR-006 (franja a todo el ancho de 120 px). Diferencia conocida: el prototipo móvil no lo trae; se conserva (es el camino a `/contacto`) |
| Migas «Inicio / …» | Catálogo, categoría, ficha, contacto | FR-007, FR-008. Diferencia conocida: el prototipo móvil no las trae; se conservan (orientación y SEO) |
| «Solo con stock», campo «Sin límite», «Limpiar filtros» | Catálogo, categoría | FR-007 |
| «Ordenar por», «· ▾» (orden) | Catálogo, categoría | FR-007 |
| «Filtrar·», «Limpiar», «Ver · productos» | Catálogo (celular) | FR-007. Diferencia conocida: el título va arriba de los botones y las píldoras de categoría del prototipo móvil quedan dentro del panel «Filtros» |
| Estado vacío «No hay productos con esos filtros» | Catálogo, categoría | FR-007 |
| «← Todos los productos» | Ficha (celular) | FR-008 |
| Galería (imagen y miniaturas) | Ficha | FR-008. Diferencia conocida: en celular el prototipo usa puntos y una imagen a todo el ancho; la tienda mantiene miniaturas |
| «Consultar por WhatsApp», «Ver más productos» | Ficha | FR-008. «Compartir» (F-TDA-25) no está en el prototipo: va después de esos dos botones |
| «Cancelar», «Abrir WhatsApp» (diálogo) | Ficha | Fuera de alcance: el diálogo no se midió en este tramo (seguimiento) |
| «Enviar consulta», «Enviar otra» y campos del formulario | Contacto | FR-008 |
| Datos del banner/categorías/destacados | Portada | Contenido y datos de la demo: fuera de alcance (colores de texto del tenant, gris secundario derivado de la identidad) |

## Decisiones

- El catálogo usa 3 columnas fluidas (el prototipo fija tarjetas de 304 px en un área de 900 px, que deja un hueco): se prefirió reflujo a copiar el hueco.
- Los colores del tenant (`colorTexto`, gris secundario derivado con contraste AA) son datos/derivaciones de la identidad, no medidas del layout.
- La imagen del héroe y el collage de productos no existen en el modelo de contenido: no se inventan.
- Reversión: revertir los commits (sin migraciones).
