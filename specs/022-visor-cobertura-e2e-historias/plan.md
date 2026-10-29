# Implementation Plan: Visor de cobertura E2E por historia

**Branch**: `feat/022-visor-cobertura-e2e-historias` | **Date**: 2026-10-20 | **Spec**: `specs/022-visor-cobertura-e2e-historias/spec.md`

## Summary

Trazabilidad historia → evidencia E2E en video: convención `[EPICA:TASK]` en títulos de tests, manifiesto JSON generado por script y subido con los videos al bucket privado `evidencias-e2e`, y ruta del panel que muestra checklist + reproductor. Se sigue el patrón probado de `evidencias-ejecuciones` (bucket privado + URL firmada desde el navegador, migración `20260920000000`).

## Technical Context

**Language/Version**: TypeScript 5.x (app), Node 24 (script), SQL Postgres (migración)

**Primary Dependencies**: `@playwright/test` 1.61.0 (reporte JSON + videos .webm), Refine + MUI (ruta), Supabase Storage (bucket privado + `createSignedUrl`)

**Storage**: bucket `evidencias-e2e` (privado); manifiesto `cobertura-e2e.json` versionado por corrida (`<run-id>/cobertura-e2e.json`); sin tablas nuevas en `public`/`dominio`

**Testing**: `playwright --list` (convención), Vitest para el script del manifiesto, E2E manual contra preview para la ruta

**Target Platform**: panel web (Refine), runners self-hosted `platform-local` para CI

**Performance Goals**: la ficha no descarga videos hasta pedirlos (carga diferida); manifiesto < 100 KB por corrida

**Constraints**: service-role nunca en el navegador (sube el CI, lee el navegador con URL firmada); videos `.webm` de Playwright sin recompresión

**Scale/Scope**: 3 archivos E2E (7 tests), 1 bucket, 1 ruta, 1 script, 1 job-step en `validate.yml`

## Constitution Check

- **I (aislamiento/RLS)**: bucket privado; lectura por URL firmada con sesión del usuario; subida solo CI con service-role. Sin secretos en Git (solo `.env.example` si hiciera falta).
- **II (spec primero)**: esta spec precede a la implementación; fases independientes por historia de usuario.
- **III (idempotencia/auditoría)**: la subida al bucket usa ruta por run-id (reintentos no duplican); el manifiesto registra fecha y modo de grabación.
- **VI (panel operable)**: ubicación en navegación + icono, audiencia (quien ve el panel), rutas canónicas, patrones carga/vacío/error, teclado + lector, carga diferida de videos. Detalle en fase 3.
- **VII (esquemas)**: sin tablas nuevas; solo `storage.buckets` + políticas (ver DER en spec.md).

## Phases

### Fase 1 — Convención en los E2E existentes (US1 base)

Retitular los 7 tests con `[EPICA:TASK]` según el mapeo verificado:

| Archivo | Tests | Etiqueta |
|---|---|---|
| `acceso-publico.e2e.ts` | 5 | `[MSF-119:T020]` |
| `permisos-por-empresa.e2e.ts` | 1 | `[MSF-121:T022]` |
| `stock-movimientos.e2e.ts` | 1 | `[MSF-136:T021]` |

Verificación: `playwright --list` muestra las etiquetas. Efecto colateral esperado: T022 (MSF-121) y T021 (MSF-136) hoy `[ ]` se cierran con `[x]` + evidencia E2E si la corrida está en verde (regla: ninguna tarea queda `[ ]`).

### Fase 2 — Manifiesto + bucket + subida CI (US1 completa)

- Script `scripts/cobertura-e2e.mjs`: parsea el reporte JSON de Playwright (títulos con `[EPICA:TASK]`), lee los `tasks.md` de las specs citadas, localiza videos en `test-results/` y emite `cobertura-e2e.json` (evidencias + huérfanos + modo de grabación).
- Migración: bucket `evidencias-e2e` privado + políticas (patrón `evidencias-ejecuciones`).
- `validate.yml`: tras el artefacto `playwright-report`, subir videos + manifiesto a `<run-id>/` con service-role.

### Fase 3 — Ruta del panel (US2, US3)

- Ruta `/cobertura-e2e` (nombre e icono en navegación a definir en la fase): lista de épicas → ficha de historia (checklist + reproductor) → vista agregada por épica.
- Lectura del manifiesto + `createSignedUrl` por video; estados carga/vacío/error; carga diferida.
- Docs: `docs/e2e-app.md` (convención + manifiesto) y esta spec.

## Risks

- Videos pesados en el bucket (cada corrida E2E_VIDEO=on suma MB): mitigación con ciclo de limpieza por antigüedad (a definir en fase 2, documentado, no implementado aquí si excede el alcance).
- Claves citadas con typo generan huérfanos: el manifiesto los expone en vez de ocultarlos (FR edge).
