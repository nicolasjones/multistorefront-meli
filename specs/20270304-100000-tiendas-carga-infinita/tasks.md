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
