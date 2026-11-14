# Tasks: Deuda técnica · Lote 2: higiene de código y documentación (MSF-515)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

Sin migraciones: no se necesita Supabase local. Vitest corrido con un solo worker.

## Fase 1 · MSF-777: nombres de test y «Etapa N»

- [x] T001 Quitar el código MSF de los títulos de `describe`/`it`/`test` en `apps/web/src` (FR-001). Evidencia: 126 títulos reescritos con un script y 2 a mano tras la revisión (`comprobante.faltantes.test.tsx` y `PrecioPropioEmpresas.test.tsx`, formas `it.each`/tabla que el script no veía); el guardián (T003) recorre todo `apps/web/src` y no encuentra ninguno; los tests de los archivos tocados pasan.
- [x] T002 Reformular los seis comentarios con «Etapa 2» (FR-002). Evidencia: `ventas.ts`, `preciosPropios.ts`, `rentabilidad.ts`, `BloqueQueVaACambiar.tsx`, `TablaHistorial.tsx`, `ComoSeCalcula.tsx`; `git grep 'Etapa [0-9]' apps/web/src` sin resultados.
- [x] T003 Test de higiene (FR-003, FR-006). Evidencia: `apps/web/src/higieneReferenciasInternas.test.ts` (analizador `titulosConTicket` con 14 formas detectadas, 6 no marcadas y la línea informada, más 3 casos sobre el árbol) en verde. Desvío: los comentarios con `MSF-<n>` quedan como seguimiento (ver D-1 de la spec).

## Fase 2 · MSF-753

- [x] T004 Anidar el `describe` de «log sin PII» bajo el bloque con `afterEach(vi.restoreAllMocks)` (FR-004). Evidencia: `apps/web/src/lib/mensajeErrorBase.test.ts`, 4 tests en verde.

## Fase 3 · MSF-745

- [x] T005 Quitar `sanitizarDato` (import) de `chat-ia-responder/index.ts` y `abrirInvocacion` y el tipo `InteraccionEnCurso` de `intentarRecuperarPaso.ts`. Evidencia: sin referencias restantes salvo comentarios; suite de `@platform/ia-navegacion` (17), `tsc --noUnusedLocals` y oxlint del paquete limpios, y `tsc -b` en verde.

## Fase 3b · MSF-950: sourceAt del manifest sin HEAD

- [x] T008 `sourceAt` con el último commit propio de la página y `sourceHash` con el alcance de `sourceAt` (FR-007). Evidencia: `scripts/docs-manifest.mjs`; `docs/manifest.json` regenerado (solo cambia la página editada) y `node scripts/docs-manifest.mjs` sin diff.
- [x] T009 Test (FR-007). Evidencia: `scripts/docs-manifest.test.mjs` (2 casos: `sourceAt` igual al último commit propio; dos HEAD distintos, con commit vacío y merge `--no-ff`, dan el mismo `sourceAt`, `sourceHash` y `commit`), cableado como `pnpm test:docs:manifest`. Ningún test existente fijaba el valor viejo.

## Fase 4 · Documentación y cierre

- [x] T006 Documentación. Evidencia: esta spec, su plan y la fila de `docs/roadmap-template.md`. Sin cambios de `docs/` funcionales: no cambia ningún comportamiento ni pantalla.
- [x] T007 Guards y validación final. Evidencia: ver el informe de cierre del lote. Desvío: no se corrió `supabase test db` ni E2E (sin migraciones ni flujos visibles); MSF-580/631/862 ya estaban resueltos, MSF-584 y MSF-539 quedan pendientes (ver spec).
