# Tasks: Tiendas · Hallazgos QA (MSF-846 C)

**Spec**: [`spec.md`](./spec.md)

- [x] T001 Encabezado `h2` oculto en `ListadoProductos` (FR-001). Evidencia: `pages/tienda-publica/ListadoProductosEncabezados.test.tsx` (axe `heading-order` en celular y escritorio; catálogo, categoría y búsqueda).
- [x] T002 Barra superior dentro del `<header>` (FR-002). Evidencia: `layout/tiendaDiseno.test.tsx` (banner contiene la barra en celular y escritorio). Nota: la regla axe `region` sí corre en jsdom con un axe propio y falla sin el arreglo (comprobado por el revisor); el helper compartido `test/axe.ts` la desactiva, por eso el test verifica el landmark directamente. Se reconfirma en dev con Playwright tras el despliegue.
- [x] T003 `useEmpresa` sin id no consulta (FR-003). Evidencia: `hooks/useEmpresa.test.tsx` y Vitest de `pages/empresas`.
- [x] T004 Migración `20270306100000` y pgTAP `tienda_vista_previa_categorias_paridad.test.sql` (FR-004). Evidencia: 8 de 8 aserciones corridas a mano en dev dentro de `begin…rollback` (más las 7 de `tienda_vista_previa_categorias_imagen`).
- [x] T005 Documentación `docs/tiendas-online.md`. Evidencia: `DOCUMENTATION_CHECK_BASE=origin/dokploy node scripts/verificar-documentacion-cambios.mjs` en OK (sección nueva «Hallazgos de la pasada de pruebas» en `docs/tiendas-online.md`).
- [x] T006 Validación final: `tsc -b`, `oxlint src`, `vite build`, guards. Evidencia: `tsc -b` sin errores, `vite build` OK, `oxlint src` sin errores, guards `verificar-migraciones`/`verificar-documentacion-cambios`/matriz/inventario/estilos sueltos en OK, y Vitest de 37 archivos (463 tests) en verde; la revisión independiente repitió 152 tests y los pgTAP en dev (`tienda_borrador` 64/64, imagen 7/7, paridad 8/8) dentro de `begin…rollback`.
