# Tasks: Visor por componente, épica e historia

## Fase 1 — Componente en manifiesto

- [x] T001 `**Componente**: Acceso` en `specs/20261012-140000-acceso-y-organizacion/spec.md` y `specs/20261016-140000-permisos-por-empresa/spec.md`; `**Componente**: Stock` en `specs/20261017-120000-stock-movimientos/spec.md` (ver commit 6cdc73f)
- [x] T002 `scripts/cobertura-e2e.mjs`: parsea `**Componente**` (cae a "Sin clasificar"), lo incluye en evidencias y `sin_cubrir` + test (ver commit 6cdc73f)
- [x] T003 Verificar con un manifiesto generado localmente que agrupa Acceso → {MSF-119, MSF-121} y Stock → {MSF-136}. Evidencia: `mapaEpicaSpec('specs')` devuelve MSF-119/Acceso, MSF-121/Acceso, MSF-136/Stock; `node --test scripts/cobertura-e2e.test.mjs` en verde (4/4)

## Fase 2 — Visor

- [x] T004 Lista: secciones por componente, cards de épica con progreso/conteos, buscador y filtro por estado (ver commit 6cdc73f)
- [x] T005 Ficha de historia: miniatura (`preload="metadata"`), checklist, reproductor bajo demanda (como hoy) (ver commit 6cdc73f)
- [x] T006 Fuente local de respaldo (`/cobertura-e2e.json` en `public/`) con insignia de origen + vacío con instrucciones (ver commit 6cdc73f)
- [x] T007 Test Vitest de agrupado/filtrado + `docs/e2e-app.md` (convención `componente:`). Evidencia: 6/6 en `src/pages/cobertura-e2e`, `docs/manifest.json` regenerado, `pnpm docs:check` y `pnpm matriz:check` OK

**Checkpoint**: SC-001–SC-003 cumplidos; merge del PR con merge commit (`--no-ff`).
