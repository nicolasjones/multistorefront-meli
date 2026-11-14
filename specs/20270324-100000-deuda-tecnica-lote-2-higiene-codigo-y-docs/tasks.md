# Tasks: Deuda técnica · Lote 2: higiene de código y documentación (MSF-515)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

Sin migraciones: no se necesita Supabase local. Vitest corrido con un solo worker.

## Fase 1 · MSF-777: nombres de test y «Etapa N»

- [x] T001 Quitar el código MSF de los títulos de `describe`/`it`/`test` en `apps/web/src` (FR-001). Evidencia: 126 títulos reescritos en ~79 archivos; `git grep -nE "(describe|it|test)(\.\w+)?\(['\"\`][^'\"\`]*MSF-" apps/web/src` sin resultados; los tests de los archivos tocados pasan.
- [x] T002 Reformular los seis comentarios con «Etapa 2» (FR-002). Evidencia: `ventas.ts`, `preciosPropios.ts`, `rentabilidad.ts`, `BloqueQueVaACambiar.tsx`, `TablaHistorial.tsx`, `ComoSeCalcula.tsx`; `git grep 'Etapa [0-9]' apps/web/src` sin resultados.
- [x] T003 Test de higiene (FR-003). Evidencia: `apps/web/src/higieneReferenciasInternas.test.ts` (3 casos) en verde. Desvío: los comentarios con `MSF-<n>` quedan como seguimiento (ver D-1 de la spec).

## Fase 2 · MSF-753

- [x] T004 Anidar el `describe` de «log sin PII» bajo el bloque con `afterEach(vi.restoreAllMocks)` (FR-004). Evidencia: `apps/web/src/lib/mensajeErrorBase.test.ts`, 4 tests en verde.

## Fase 3 · MSF-745

- [x] T005 Quitar `sanitizarDato` (import) de `chat-ia-responder/index.ts` y `abrirInvocacion` de `intentarRecuperarPaso.ts`. Evidencia: sin referencias restantes salvo comentarios; suite de `@platform/ia-navegacion` y `tsc -b` en verde (ver T007).

## Fase 4 · Documentación y cierre

- [x] T006 Documentación. Evidencia: esta spec, su plan y la fila de `docs/roadmap-template.md`. Sin cambios de `docs/` funcionales: no cambia ningún comportamiento ni pantalla.
- [x] T007 Guards y validación final. Evidencia: ver el informe de cierre del lote. Desvío: no se corrió `supabase test db` ni E2E (sin migraciones ni flujos visibles); MSF-580/631/584/862 no se incluyen por estar resueltos o necesitar Supabase local (ver spec).
