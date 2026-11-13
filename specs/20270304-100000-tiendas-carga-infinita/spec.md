# Feature Specification: Tiendas públicas · Carga infinita en los listados

**Épica**: MSF-845 · **Spec**: `tiendas-carga-infinita` · **Prioridad**: P2
**Alcance de entrega**: `refine` (sin `supabase`, `kestra`, `superset` ni `workers`: no hay migraciones ni cambios de base).
**Fuente**: pedido de Nicolás («en todas las tiendas quiero lazy loading infinito») y la regla del repo «Listados: carga infinita con lazy loading, sin paginación» (`CLAUDE.md`). Esta spec **traduce**; no agrega alcance de negocio.

## Objetivo

En el catálogo público (`/catalogo`, `/categoria/:categoriaId` y los resultados de búsqueda `/catalogo?q=`) la persona ve los productos por tandas que se suman a medida que llega al final de la lista, en lugar de páginas numeradas.

## Modelo y supuestos

- El único listado público paginado era el de productos (`secciones-catalogo/ListadoProductos.tsx`; se revisó con `grep Paginacion|Pagination` toda la tienda pública). Los demás listados públicos (menú de categorías, relacionados, inicio) son acotados y no paginan.
- La RPC `publico.catalogo_pagina_por_dominio` y `publico.busqueda_pagina_por_dominio` ya paginan por servidor (24 por página): se llama con `pagina` creciente. **No hay migraciones.**
- Se reutiliza el pie compartido del panel `components/pagina/CargaInfinita` (IntersectionObserver, «Cargar más», carga, error con reintento, fin de lista).
- **Esquemas (Principio VII)**: no se crea ni altera ninguna tabla ni función.
- **Enlaces viejos `?pagina=N` (decisión)**: se ignoran y se arranca de la primera tanda. No se reconstruye la página N (implicaría traer N tandas de golpe y no hay equivalente en una lista infinita); no se redirige ni rompe. La canónica y el `noindex` no cambian (nunca llevaron `pagina`).

## User Scenarios & Testing

### User Story 1 - Ver el catálogo por tandas que se suman al llegar al final (P1)

**Aceptación**
1. Al abrir el listado se ve la primera tanda (24) y el contador total «N productos».
2. Al acercarse al final se pide y suma la tanda siguiente a lo ya mostrado, sin repetir productos y sin cambiar la URL.
3. «Cargar más» (botón) hace lo mismo con teclado y es la única vía si el navegador no tiene `IntersectionObserver`.
4. Mientras carga se anuncia «Cargando más resultados»; si falla una tanda se conserva lo cargado y se muestra «No pudimos cargar más resultados.» con «Reintentar»; al terminar se muestra «No hay más resultados.».
5. Buscar, filtrar (categoría, stock, precio), ordenar o limpiar filtros reinicia desde la primera tanda y descarta lo acumulado; filtros, orden y `q` siguen en la URL.
6. Un `?pagina=N` en la URL no rompe: se ignora.

## Requirements

- **FR-001**: el listado carga por tandas desde el servidor y las suma (criterios 1 y 2).
- **FR-002**: «Cargar más» accesible por teclado y alternativa sin `IntersectionObserver` (criterio 3).
- **FR-003**: estados de carga, error con reintentar y fin de lista con el componente compartido (criterio 4).
- **FR-004**: reinicio al cambiar búsqueda, filtros u orden, con el estado en la URL (criterio 5).
- **FR-005**: compatibilidad de `?pagina=N` (criterio 6) y SEO sin cambios.
- **FR-006**: sin `Pagination`/`TablePagination` en la tienda pública; documentación y E2E al día.
- **SC-001**: Vitest (incluye axe a 320/768/1440 px y en carga/error/fin) verde sobre lo tocado.

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/MJC_Catalogo`, `MJC_Categoria`, `SJ_Catalogo`, `SJ_Categoria` (`*.inventory.json`). **Ninguno dibuja paginación ni carga infinita** (su inventario no lista botones de página ni «Cargar más»). Los únicos elementos visibles nuevos son los que exige la regla del repo («Cargar más», «Cargando más resultados», error con «Reintentar» y «No hay más resultados.»), todos del componente compartido del panel; no se inventa nada más y se declara en el PR.

| Ítem del prototipo / elemento | Pantalla | Dueño |
|---|---|---|
| Buscar productos (campo), «Ver todos los resultados →» | Catálogo MJC/SJ | **Fuera de alcance**: buscador de MSF-191, no se toca; el reinicio al buscar es FR-004 |
| Categorías del panel lateral | Catálogo/Categoría | FR-004 (elegir categoría reinicia la lista) |
| «Solo con stock», «Sin límite» (precio máximo), «Limpiar filtros» | Catálogo/Categoría | FR-004 |
| «· ▾» (Ordenar por) | Catálogo/Categoría | FR-004 |
| Tarjetas de producto («Sin imagen», «Sin stock») y contador de productos | Catálogo/Categoría | FR-001 (contador total visible) |
| Paginación (control del kit, **no dibujada en el prototipo**) | Catálogo/Categoría | FR-001, FR-006: reemplazada por carga infinita |
| «Cargar más» / carga / error / fin de lista (no dibujados) | Catálogo/Categoría | FR-002, FR-003 (componente compartido) |
| Navegación (Inicio, Contacto, «Escribinos», «SAN JAVUCHO», categorías del menú) | Todas | **Fuera de alcance**: no cambian |

## Decisiones y puntos dudosos

- `?pagina=N` se ignora (ver Modelo). Alternativa descartada: cargar hasta la página N.
- Un `?pagina=` viejo permanece en la URL hasta el siguiente cambio de filtro (no se reescribe la URL para no provocar una navegación extra).
- Los E2E se actualizaron pero no se corrieron (requieren el stack local).
