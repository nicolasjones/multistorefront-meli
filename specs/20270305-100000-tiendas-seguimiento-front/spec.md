# Feature Specification: Tiendas públicas · Seguimiento del front (MSF-846, parte B)

**Épica**: MSF-846 (seguimiento de MSF-841/MSF-845) · **Spec**: `tiendas-seguimiento-front` · **Prioridad**: P2
**Alcance de entrega**: `refine` (sin `supabase`, `kestra`, `superset` ni `workers`: no hay migraciones ni cambios de base).
**Fuente**: observaciones de la revisión de MSF-841 y MSF-845. Esta spec **traduce**; no agrega alcance de negocio.

## Objetivo

1. El menú de categorías del encabezado nunca desborda ni corta la última entrada, con cualquier tipografía de la tienda.
2. La carga infinita (compartida con el panel) conserva el foco, anuncia cada aviso una sola vez, se ve deshabilitada mientras carga y no muestra un instante la lista vieja al alternar A→B→A.
3. Los E2E de la tienda coinciden con el DOM actual.

## User Scenarios & Testing

### User Story 1 - Menú de categorías en una línea sin cortes (P1)
1. Con San Javucho a 1440 px (Bricolage Grotesque, más ancha) la barra muestra solo las categorías que entran y «Más categorías» al final; `scrollWidth <= clientWidth`.
2. Mismo estilo del prototipo (mayúsculas, subrayado de la activa); al cambiar el ancho o cargar la fuente se vuelve a medir.

### User Story 2 - Carga infinita accesible y sin parpadeos (P1)
1. Con el foco en «Reintentar» o en «Cargar más», el foco pasa al control que lo reemplaza (o al aviso si «Reintentar» espera), nunca al body.
2. El aviso de espera por límite de búsquedas se anuncia una sola vez (`role=alert`; la región viva calla).
3. «Cargar más» se ve apagado mientras carga (`aria-disabled`).
4. Al volver a una consulta anterior (A→B→A) no se renderiza la lista acumulada vieja.

### User Story 3 - E2E al día (P2)
Los locators coinciden con el DOM actual (navegaciones «Principal»/«Categorías» y la del pie, bloque de consultas, carga infinita, menú móvil con Contacto).

## Requirements

- **FR-001**: la barra mide el ancho de cada entrada y muestra las que entran (`cuantasEntran`), reservando «Más categorías» (US1).
- **FR-002**: `CargaInfinita` devuelve el foco, no duplica anuncios y estiliza `aria-disabled` (US2.1–2.3).
- **FR-003**: `useCatalogoPublico` descarta lo acumulado en el mismo render en que cambia la clave (US2.4).
- **FR-004**: E2E de la tienda actualizados (US3).
- **SC-001**: Vitest verde sobre lo tocado y sobre las pantallas del panel que usan `CargaInfinita`.

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/MJC_Home` y `SJ_Home` (`*.inventory.json`). No se agrega ningún elemento visible nuevo: la barra conserva sus entradas y estilo (mayúsculas, 15 px, 600, subrayado de 3 px en la activa); solo cambia cuántas se dibujan según el ancho.

| Ítem del prototipo / elemento | Pantalla | Dueño |
|---|---|---|
| Barra de categorías (entradas en mayúsculas, subrayado de la activa) y «Más categorías» | Home MJC/SJ | FR-001 |
| «Inicio», «Contacto», buscador, marca | Home MJC/SJ | **Fuera de alcance**: no cambian |
| «Cargar más», carga, error con «Reintentar», fin de lista (no dibujados en el prototipo) | Catálogo/Categoría | FR-002, FR-003 (componente compartido) |

## Decisiones y puntos dudosos

- La medida se toma de una copia invisible de la barra (texto en pseudo-elemento, sin texto en el DOM accesible) para no depender de lo ya recortado; sin `ResizeObserver` se muestran todas.
- Las categorías no mostradas no se pierden: se alcanzan desde «Más categorías» (`/catalogo`).
- El aviso de espera se anuncia por el `role=alert` de `EstadoError`; la región viva queda vacía en error.
