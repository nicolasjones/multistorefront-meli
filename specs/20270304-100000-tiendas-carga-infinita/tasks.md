# Tasks: Tiendas públicas · Carga infinita (MSF-845)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

- [x] T001 Sacar `pagina` de `FiltrosCatalogo` y del parser/serializador; `leerPaginaCatalogo`/`leerPaginaBusqueda` reciben la tanda aparte; `?pagina=N` ignorado (FR-005). Evidencia: `apps/web/src/lib/tiendaListado.test.ts`.
- [x] T002 Hook `useCatalogoPublico` con acumulado, `cargarMas`, `hayMas`, `cargandoMas`, `errorMas`, reinicio por clave y deduplicado (FR-001, FR-004). Evidencia: `ListadoProductos.test.tsx` (describe «carga infinita»).
- [x] T003 `ListadoProductos` usa `CargaInfinita` y se elimina la redirección de página fuera de rango y `catalogo/Paginacion.tsx` (FR-001, FR-002, FR-003, FR-006). Evidencia: tests de «carga infinita» y «ya no dibuja paginación numerada».
- [x] T004 Tests Vitest con mock de `IntersectionObserver`: carga/error/fin, reinicio al cambiar filtro u orden, «Cargar más» por teclado, búsqueda y categoría, sin IO, axe (SC-001). Evidencia: `ListadoProductos.test.tsx`.
- [x] T005 E2E `apps/web/e2e/tienda-catalogo.e2e.ts` migrado de enlaces de paginación a carga por «Cargar más». Desvío: no se pudo correr (requiere stack local); solo `tsc`/lint.
- [x] T006 Documentación: `docs/tiendas-online.md` (sección «Carga infinita en los listados (MSF-845)» y ajustes de F-TDA-12). Evidencia: `verificar-documentacion-cambios`.
- [x] T007 Spec con `## Matriz pantalla↔criterios` y decisión sobre `?pagina=N` (FR-005). Evidencia: `pnpm matriz:check`.
- [x] T008 Validación: `tsc -b`, `oxlint src`, `vite build` y guards de `scripts/`. Evidencia: resultados en el informe del commit.
- [x] T009 Revisión independiente: E2E robustos (scroll real al final y conteo con `expect.poll`, aceptando auto-carga o botón; `?pagina=2` sin depender de la carrera). Desvío: no se pudieron correr (requieren stack local). Evidencia: `apps/web/e2e/tienda-catalogo.e2e.ts` (`tsc`/lint).
- [x] T010 `CargaInfinita` accesible: botón montado con `aria-busy`/`aria-disabled`, foco al texto de fin, región viva `aria-live` con texto («Cargando más resultados», «N productos más cargados», «No hay más resultados»). Evidencia: `components/pagina/CargaInfinita.test.tsx` y los tests de sus demás usos (Vitest).
- [x] T011 `useCatalogoPublico`: límite de búsquedas en la tanda siguiente antes de firmar imágenes, con aviso específico y «Reintentar» deshabilitado hasta pasada la espera; contador de generación (cierra A→B→A); refs actualizadas en efectos; clave memoizada y `filtros` memoizados en `ListadoProductos`. Evidencia: `ListadoProductos.test.tsx` (describe «respuestas tardías y reinicios»).
- [x] T012 Reinicio de scroll al cambiar filtro/orden/búsqueda y limitaciones anotadas en la spec (sin conservar tandas al volver de la ficha; sin virtualización, seguimiento si un catálogo supera ~500). Evidencia: test «vuelve al inicio del listado» y `spec.md` (Decisiones).
- [x] T013 Tests nuevos: respuestas tardías por filtro/q/host, A→B→A, tanda 2 con `esperaSegundos`, `leerPaginaBusqueda(..., n)` envía `pagina: n`, reinicio de scroll. Evidencia: `ListadoProductos.test.tsx` y `apps/web/src/lib/tiendaBusqueda.pagina.test.ts`.
- [x] T014 Docs (`docs/tiendas-online.md`): quitados los restos de paginación y agregado lo nuevo. Evidencia: `verificar-documentacion-cambios`.
