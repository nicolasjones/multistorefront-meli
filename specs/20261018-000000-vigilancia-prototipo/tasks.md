# Tasks: Vigilancia del prototipo

- [x] T001 Verificador de inventario `scripts/verificar-inventario-prototipo.mjs` + `verificar-inventario-prototipo.test.mjs`. — evidencia: reusa `inventariar()`; testes en `pnpm test:prototipo:inventario`.
- [x] T002 Alias `prototipo:inventario` (genera) y `prototipo:check` (verifica) en `package.json`. — evidencia: `package.json`.
- [x] T003 Generar y commitear los `.inventory.json` faltantes de `design/pantallas/**`. — evidencia: `design/pantallas/**/*.inventory.json` (120).
- [x] T004 Gate de matriz `scripts/verificar-matriz-pantalla.mjs` + `verificar-matriz-pantalla.test.mjs`. — evidencia: specs nuevas con UI sin matriz fallan.
- [x] T005 Wiring en `.github/workflows/validate.yml`: `prototipo:check`, `test:prototipo:inventario`, `matriz:check`, `test:matriz:pantalla`; `design/` fuera del clasificador `code`/`web`. — evidencia: job `application`.
- [x] T006 Regla del prototipo en `AGENTS.md` y `CLAUDE.md`. — evidencia: viñeta "El prototipo manda la UI".
- [x] T007 Regla en skills `frontend-design`, `mui-refine`, `refine-frontend` (copias `.agents` y `.claude`). — evidencia: sección "En esta plataforma: el prototipo manda la UI".
- [x] T008 `docs/prototipos.md` con los gates y la herramienta de captura. — evidencia: sección "Qué lo hace mecánico".
- [x] T009 Herramienta de captura `apps/web/scripts/capturar-pantallas.mjs` + alias `pantallas:capturar`. — evidencia: `apps/web/package.json`.
- [x] T010 Verificación: `pnpm prototipo:check`, `test:prototipo:inventario`, `matriz:check`, `test:matriz:pantalla`, `docs:check`, `estilos:check`, `lint`. — evidencia: CI verde del PR.

## Checkpoint

Tooling cerrado. Deuda trazada: el diff de píxeles automático queda fuera de
alcance (ver `spec.md` → Fuera de alcance), con la captura manual como reemplazo.
