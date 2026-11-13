# Tasks: Tiendas públicas · Seguimiento del front (MSF-846 B)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

- [x] T001 Menú de categorías en una línea sin cortes: `cuantasEntran` + medición con `ResizeObserver` (FR-001). Evidencia: `lib/tiendaCategorias.test.ts` y `pages/tienda-publica/layout/MenuCategorias.test.tsx`. Desvío: la medición real con Bricolage Grotesque a 1440 px no se pudo comprobar en navegador (sin stack local); se cubre con ancho simulado y con la aserción de no desborde agregada a `e2e/tienda-categorias.e2e.ts`.
- [x] T002 `CargaInfinita`: el foco no cae al body entre «Reintentar» y «Cargar más» (FR-002a). Evidencia: `components/pagina/CargaInfinita.test.tsx`.
- [x] T003 Aviso de espera anunciado una sola vez (FR-002b). Evidencia: `CargaInfinita.test.tsx`.
- [x] T004 Estilo visible de `aria-disabled` en «Cargar más» (FR-002c). Evidencia: `CargaInfinita.test.tsx`.
- [x] T005 A→B→A sin lista vieja (FR-003). Evidencia: `pages/tienda-publica/ListadoProductos.test.tsx` («A→B→A rápido»; falla sin el cambio, verificado).
- [x] T006 Pantallas del panel que usan `CargaInfinita` sin regresiones (SC-001). Evidencia: Vitest de los componentes y páginas que lo importan (ver informe).
- [x] T007 E2E de tienda releídos contra el DOM actual: `navigation` «Categorías» exacta (la del pie también contiene la palabra), headings de la home acotados a `<main>` (el pie repite «Categorías»), bloque de consultas y no desborde de la barra. Desvío: no se pudieron correr (requieren el stack local); solo `tsc`/lint. El botón del banner «Ver catálogo» depende de contenido sembrado y no tiene E2E.
- [x] T008 Documentación: `docs/tiendas-online.md`. Evidencia: `verificar-documentacion-cambios`.
- [x] T009 Spec con `## Matriz pantalla↔criterios`. Evidencia: `pnpm matriz:check`.
- [x] T010 Validación: `tsc -b`, `oxlint src`, `vite build` y guards de `scripts/`. Evidencia: informe del commit.
