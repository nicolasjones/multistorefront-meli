# Tasks: Visor de cobertura E2E por historia

## Fase 1 — Convención en los E2E existentes

- [x] T001 Retitular los 5 tests de `apps/web/e2e/acceso-publico.e2e.ts` con `[MSF-119:T020]` (ver commit `test(e2e)` en esta rama)
- [x] T002 Retitular el test de `apps/web/e2e/permisos-por-empresa.e2e.ts` con `[MSF-121:T022]` (ver commit `test(e2e)` en esta rama)
- [x] T003 Retitular el test de `apps/web/e2e/stock-movimientos.e2e.ts` con `[MSF-136:T021]` (ver commit `test(e2e)` en esta rama)
- [x] T004 Verificación estática: solo cambiaron los 7 literales de título (`git diff`); `--list` y `lint` corren en el CI del PR (sin Node en este nodo)
- [ ] T005 Si las corridas están en verde, cerrar T022 (`specs/20261016-140000-permisos-por-empresa`) y T021 (`specs/20261017-120000-stock-movimientos`) con `[x]` + evidencia E2E (regla: ninguna tarea queda `[ ]`)

**Checkpoint fase 1**: SC-001 cumplido; commit `test(e2e): ...` en castellano.

## Fase 2 — Manifiesto + bucket + subida CI

- [x] T006 Script `scripts/cobertura-e2e.mjs` (parsea reporte JSON + `tasks.md` + videos → `cobertura-e2e.json`) con test node:test (ver commit `feat(spec-022)`; corre en el CI)
- [x] T007 Migración con bucket `evidencias-e2e` privado + políticas (patrón `evidencias-ejecuciones`) + pgTAP `evidencias_e2e.test.sql`
- [x] T008 Step en `validate.yml`: reporte JSON en la corrida + manifiesto adjunto al artefacto + subida al bucket si hay secreto (omisión elegante si no)
- [x] T009 Verificación: `test:cobertura:e2e` entra en la cadena `pnpm test`; lint/build/test/db los corre el CI del PR

**Checkpoint fase 2**: SC-002 cumplido.

## Fase 3 — Ruta del panel

- [x] T010 Ruta `/cobertura-e2e` con lista de épicas y ficha de historia (checklist + reproductor diferido)
- [x] T011 Vista agregada por épica (conteos + playlist, sin compilar video)
- [x] T012 Navegación (recurso `cobertura-e2e`, etiqueta «Cobertura E2E», carga diferida), audiencia (admin con organización activa), patrones carga/vacío/error, teclado + lector (principio VI)
- [x] T013 Docs en `docs/e2e-app.md` (convención + manifiesto + visor)

**Checkpoint fase 3**: SC-003 y SC-004 cumplidos; merge del PR con merge commit (`--no-ff`).
