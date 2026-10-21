# Tasks: Visor por componente, épica e historia

## Fase 1 — Componente en manifiesto

- [ ] T001 `**Componente**: Acceso` en `specs/20261012-140000-acceso-y-organizacion/spec.md` y `specs/20261016-140000-permisos-por-empresa/spec.md`; `**Componente**: Stock` en `specs/20261017-120000-stock-movimientos/spec.md`
- [ ] T002 `scripts/cobertura-e2e.mjs`: parsea `**Componente**` (cae a "Sin clasificar"), lo incluye en evidencias y `sin_cubrir` + test
- [ ] T003 Verificar con un manifiesto generado localmente que agrupa Acceso → {MSF-119, MSF-121} y Stock → {MSF-136}

## Fase 2 — Visor

- [ ] T004 Lista: secciones por componente, cards de épica con progreso/conteos, buscador y filtro por estado
- [ ] T005 Ficha de historia: miniatura (`preload="metadata"`), checklist, reproductor bajo demanda (como hoy)
- [ ] T006 Fuente local de respaldo (`/cobertura-e2e.json` en `public/`) con insignia de origen + vacío con instrucciones
- [ ] T007 Test Vitest de agrupado/filtrado + `docs/e2e-app.md` (convención `componente:`)

**Checkpoint**: SC-001–SC-003 cumplidos; merge del PR con merge commit (`--no-ff`).
