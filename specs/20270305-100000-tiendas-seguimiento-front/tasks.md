# Tasks: Tiendas públicas · Seguimiento del front (MSF-846 B)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

- [x] T001 Menú de categorías en una línea sin cortes: `cuantasEntran` + medición con `ResizeObserver` (FR-001); la copia de medida va en un contenedor recortado (`position:absolute; inset:0; overflow:hidden; visibility:hidden`, `aria-hidden`) para no agregar scroll horizontal a la página. Evidencia: `lib/tiendaCategorias.test.ts`, `pages/tienda-publica/layout/MenuCategorias.test.tsx` y medición en Chromium (playwright-core) sobre HTML aislado con el mismo CSS y fuente ancha: SIN el contenedor la copia de medida desborda y el desborde crece con el viewport; CON el contenedor desaparece (`documentElement.scrollWidth` = `clientWidth`, anchos de los hijos idénticos). Cifras de `scrollWidth` sin contenedor con viewport 900/1024/1280/1440: 1576/1576/1600/1680 en la medición del desarrollador (fuente ancha genérica) y 1387/1387/1427/1507 en la del revisor (otra fuente); no coinciden exactamente porque dependen de la fuente, así que no hay una cifra única. Pendiente: medir Bricolage Grotesque real en dev tras el despliegue.
- [x] T002 `CargaInfinita`: el foco no cae al body entre «Reintentar» y «Cargar más» (FR-002a). Evidencia: `components/pagina/CargaInfinita.test.tsx`.
- [x] T003 Aviso de espera anunciado una sola vez (FR-002b). Evidencia: `CargaInfinita.test.tsx`.
- [x] T004 Estilo visible de `aria-disabled` en «Cargar más» (FR-002c). Evidencia: `CargaInfinita.test.tsx`.
- [x] T005 A→B→A sin lista vieja (FR-003). Evidencia: `pages/tienda-publica/ListadoProductos.test.tsx` («A→B→A rápido»; falla sin el cambio, verificado).
- [x] T006 Pantallas del panel que usan `CargaInfinita` sin regresiones (SC-001). Evidencia: ver «Evidencia de validación» más abajo (Vitest de CargaInfinita, ListadoProductos, layout, tiendaCategorias y páginas del panel que lo importan).
- [x] T007 E2E de tienda releídos contra el DOM actual: `navigation` «Categorías» exacta (la del pie también contiene la palabra), headings de la home acotados a `<main>` (el pie repite «Categorías»), bloque de consultas y no desborde de la barra. Desvío: no se pudieron correr (requieren el stack local); solo `tsc`/lint. El botón del banner «Ver catálogo» depende de contenido sembrado y no tiene E2E.
- [x] T008 Documentación: `docs/tiendas-online.md`. Evidencia: `verificar-documentacion-cambios`.
- [x] T009 Spec con `## Matriz pantalla↔criterios`. Evidencia: `pnpm matriz:check`.
- [x] T010 Validación: `tsc -b`, `oxlint src`, `vite build` y guards de `scripts/`. Evidencia: ver «Evidencia de validación» más abajo.

## Evidencia de validación

Desde `apps/web` salvo indicación; Vitest con `--maxWorkers=1 --no-file-parallelism`.

- `npx tsc -b`: sin errores.
- `npx oxlint src`: 0 errores (solo advertencias previas `react(set-state-in-effect)` ajenas a este cambio).
- `npx vite build`: OK (solo el aviso habitual de chunks > 500 kB).
- Desde la raíz: `DOCUMENTATION_CHECK_BASE=origin/dokploy node scripts/verificar-documentacion-cambios.mjs` OK (15 archivos); `node scripts/verificar-matriz-pantalla.mjs` OK; `node scripts/verificar-inventario-prototipo.mjs` OK (120 pantallas); `node scripts/verificar-estilos-sueltos.mjs` OK.
- Vitest de lo tocado (`CargaInfinita`, `ListadoProductos`, `layout/*`, `lib/tiendaCategorias`): 11 archivos, 160 tests verdes.
- Vitest de las 33 pantallas y componentes del panel que importan `CargaInfinita` (clientes, stock, ventas, proveedores, historial, productos, actividad, consultas, contactos, notificaciones, correo masivo): 33 archivos, 727 tests verdes.
- Medición en Chromium (playwright-core) sobre HTML aislado: ver T001.
- No corridos: los E2E de `apps/web/e2e/` (requieren el stack local) ni la medición en dev.
