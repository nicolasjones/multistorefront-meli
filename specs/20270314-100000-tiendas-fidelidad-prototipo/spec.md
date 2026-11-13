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
Franja del banner a todo el ancho con el color de la barra (440 px; título de 72 px en mayúsculas, bajada de 20 px, botón en el acento de la identidad y dos franjas inclinadas), «Categorías» con tarjetas de 186 px, «Destacados» con «Ver todo el catálogo →», y el bloque de consultas a todo el ancho. En celular, las categorías son píldoras y «Ver todo el catálogo» un botón con borde.

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
- **FR-009**: sin regresiones: Vitest de la tienda en verde, axe (Chromium real, con contraste) sin violaciones y `documentElement.scrollWidth == clientWidth` a 320, 390, 768, 900, 1024, 1100, 1200, 1280, 1366 y 1440 px en las dos tiendas; los campos y la casilla del panel conservan un foco visible (WCAG 2.4.7).
- **FR-010** (auditoría independiente de fidelidad, 52 diferencias de implementación): el botón del héroe usa el acento de la identidad con el texto de mayor contraste (`tema.tienda.botonDestacado`); si el acento se confunde con la franja (contraste < 1,5:1, `UMBRAL_BOTON`) toma el color del texto de la franja, así nunca queda invisible (se eligió 1,5:1 y no 3:1 para que el botón primario de Mundo JC sobre `#2A2A2A`, 1,81:1, no cambie); el «papel» del tema es blanco (encabezado, campos, menús y diálogos) y el fondo de la página el de la identidad; el título del héroe es el h1 de la portada (la marca solo lo es sin título de héroe).
- **FR-011**: panel de categorías con filas de 32 px y «Todos los productos» con su total; menú de orden de 116 px sin fondo teñido; sugerencias sin la línea «Disponible» a la vista (queda para lectores) y mensaje vacío en gris; pie sin subrayado salvo «Escribinos»; tarjeta con el área de imagen de 282 px.
- **FR-012**: celular: hoja «Filtros» con asa, categorías y orden como píldoras y botones de 16 px; menú lateral con las entradas de 47/43 px, sombra y recuadro de contacto; píldoras de la portada con «Todo» activa que filtran los destacados en su lugar; pie sin la columna de categorías; contacto con rótulos solo para lectores, sin «Retiro y envíos» y glifos de 20 px; ficha sin «Ver más productos» y disponibilidad de 15 px.
- **FR-013**: contacto enviado conserva el título «Escribinos» (tarjeta de 376 px) y «Enviar otra» a 16 px.
- **FR-014**: diálogo de WhatsApp como el prototipo (460 px, radio 14, círculo verde #25D366, línea de contacto, mensaje en recuadro de solo lectura, botones de 44 px) con el texto de «Abrir WhatsApp» en la tinta de la tienda (blanco sobre #25D366 es 2:1, no cumple AA).
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
| «Cancelar», «Abrir WhatsApp» (diálogo) | Ficha | FR-014 (medido: 460 px, radio 14, botones de 44 px de 16 px) |
| «Enviar consulta», «Enviar otra» y campos del formulario | Contacto | FR-008 |
| «Sin imagen» y placeholders de los campos | Tarjeta, ficha, contacto, filtros | Desvío accesible respecto del prototipo: el prototipo usa negro al 35 % / 45 % (≈ 2,4:1 sobre la superficie); la tienda usa el gris secundario del tema (≥ 4,5:1, AA) |
| Foco de teclado en campos y casilla | Contacto, filtros | Desvío accesible: el prototipo no dibuja el estado de foco; la tienda suma borde y contorno primarios de 2 px (WCAG 2.4.7) |
| Orden de tabulación del encabezado de celular | Todas (celular) | Menú → marca → buscador → «Ingresar». Desvío menor: «Ingresar» se ve antes que el buscador pero se tabula después (el mismo DOM sirve al escritorio, donde el orden coincide) |
| Héroe de San Javucho (franja clara, círculo ámbar, título de 60 px) | Portada | Decisión abierta (ver arriba); solo se corrigió la accesibilidad del botón (acento de la identidad con texto de contraste calculado) |
| «Explorar productos» / «Ver catálogo» del héroe | Portada | FR-010 (acento + texto de contraste; uppercase de MundoJC, ver decisión abierta de mayúsculas) |
| Fondo del encabezado, campos, menús y diálogos | Todas | FR-010 (papel blanco; antes crema en San Javucho) |
| Título del héroe como `h1` | Portada | FR-010 (un único h1 por página: la marca lo cede si hay título de héroe) |
| «Todos los productos» con total, filas de 32 px | Catálogo | FR-011 |
| Menú de «Ordenar por» (116 px, sin fondo teñido) y sugerencias | Catálogo, búsqueda | FR-011 |
| Hoja «Filtros» (asa, píldoras, botones de 16 px) | Catálogo (celular) | FR-012. Desvíos: «Precio máximo» se conserva (el prototipo móvil no lo trae pero el filtro existe) y la hoja suma un botón de cierre de 36 px (accesibilidad) |
| Menú lateral con contacto, entradas 47/43 px | Todas (celular) | FR-012. «Inicio» activo se marca solo con negrita (sin fondo) |
| Píldoras de la portada (Todo activa, filtran en el lugar) | Portada (celular) | FR-012. Si la categoría no tiene destacados, un enlace lleva a su listado |
| «Retiro y envíos», rótulos de campos, «Ver más productos», columna de categorías del pie | Celular | FR-012 (el prototipo móvil no los dibuja: no se muestran; los rótulos quedan para lectores) |
| Diálogo de WhatsApp (círculo, línea de contacto, recuadro del mensaje, botones) | Ficha | FR-014. Desvío accesible: texto de «Abrir WhatsApp» en tinta, no blanco |
| Contacto enviado: título «Escribinos», «Enviar otra» 16 px | Contacto | FR-013 |
| Píldoras de categoría de la portada (celular) | Portada | Una píldora con destacados filtra en el lugar y NO enlaza a su listado (como el prototipo); el acceso a cada categoría es el menú lateral, «Más categorías» y «Ver todo el catálogo». Con una categoría sin destacados se muestra un enlace a su listado. La elección se descarta al pasar a escritorio |
| Filas del panel de categorías en San Javucho | Catálogo | Diferencia cosmética conocida: miden 34 px (la tipografía de texto de la identidad tiene otro interlineado `normal`) en lugar de 32 px; en MundoJC miden 32 px |
| Grilla de celular entre 400 y 599 px | Celular | Las tarjetas crecen (2 columnas fluidas); a 390 px miden 173 px (4 px libres a la derecha, como el prototipo) |
| Campo «Correo o WhatsApp» en celular y tableta chica (< 900 px) | Contacto | El rótulo queda solo para lectores y el texto de apoyo visible es «Correo o WhatsApp» (prototipo móvil); en escritorio «Para responderte» |
| «Cargar más» al final del listado | Catálogo | Decisión declarada: regla del repo (carga infinita con alternativa por teclado); el prototipo no pagina |
| Áreas táctiles del encabezado y de «← Todos los productos» (36–44 px) | Celular y escritorio | Desvío accesible declarado (el texto mide lo mismo que el prototipo) |
| Barra de categorías con las que entran por ancho + «Más categorías» | Todas | Decisión declarada (MSF-825/MSF-846) |
| Pie de celular: marca, contacto y © en una columna | Celular | Diferencia conocida: se mantienen las líneas de «Información» y el bloque legal (otras funcionalidades) |
| Datos del banner/categorías/destacados | Portada | Contenido y datos de la demo: fuera de alcance (colores de texto del tenant, gris secundario derivado de la identidad) |

## Decisiones abiertas (requieren decisión de producto; no se inventó configuración)

- **Héroe de dos variantes (H-04, H-05, H-06).** El prototipo MundoJC tiene una franja oscura con título de 72 px en mayúsculas blancas y franjas inclinadas; el de San Javucho, una franja clara `#F1E9D8` con un círculo ámbar de 360 px y el título de 60 px sin mayúsculas en el color primario. Hoy solo existe la variante de MundoJC. Hay que decidir si la variante se deriva de la identidad (p. ej. por la luminancia de `colorBarra`) o si es un campo propio de la identidad. Lo que sí es implementación y se corrigió: el botón es visible y accesible con cualquier identidad y el texto de la franja se calcula según su luminancia.
- **Mayúsculas de la barra de categorías y del botón del héroe (C-14).** MundoJC las usa (con `letter-spacing` .04em) y San Javucho no las transforma; la identidad no trae ese dato. Hoy siguen el estilo de MundoJC. Misma decisión que el héroe.
- **Color de la franja inclinada (H-02).** El prototipo fija `#8C0004`; la app usa el primario oscuro de la identidad (`#7A0A12` en la demo).

## Decisiones

- El catálogo usa 3 columnas fluidas (el prototipo fija tarjetas de 304 px en un área de 900 px, que deja un hueco): se prefirió reflujo a copiar el hueco.
- Los colores del tenant (`colorTexto`, gris secundario derivado con contraste AA) son datos/derivaciones de la identidad, no medidas del layout.
- La imagen del héroe y el collage de productos no existen en el modelo de contenido: no se inventan.
- Reversión: revertir los commits (sin migraciones).
