# Tasks: Tiendas · Hallazgos QA (MSF-846 C)

**Spec**: [`spec.md`](./spec.md)

- [x] T001 Encabezado `h2` oculto en `ListadoProductos` (FR-001). Evidencia: `pages/tienda-publica/ListadoProductosEncabezados.test.tsx` (axe `heading-order` en celular y escritorio; catálogo, categoría y búsqueda).
- [x] T002 Barra superior dentro del `<header>` (FR-002). Evidencia: `layout/tiendaDiseno.test.tsx` (banner contiene la barra en celular y escritorio). Desvío: la regla axe `region` completa no se evalúa en jsdom (la helper la desactiva); se verifica el landmark directamente.
- [x] T003 `useEmpresa` sin id no consulta (FR-003). Evidencia: `hooks/useEmpresa.test.tsx` y Vitest de `pages/empresas`.
- [x] T004 Migración `20270306100000` y pgTAP `tienda_vista_previa_categorias_paridad.test.sql` (FR-004). Evidencia: 8 de 8 aserciones corridas a mano en dev dentro de `begin…rollback` (más las 7 de `tienda_vista_previa_categorias_imagen`).
- [x] T005 Documentación `docs/tiendas-online.md`. Evidencia: `verificar-documentacion-cambios`.
- [x] T006 Validación final: `tsc -b`, `oxlint src`, `vite build`, guards. Evidencia en el informe del desarrollador.
