# Tareas · Selección determinista de pruebas

**Spec**: `specs/20261018-220000-seleccion-determinista-pruebas/spec.md`
**Plan**: `specs/20261018-220000-seleccion-determinista-pruebas/plan.md`
**Rama**: `infra/tests-afectados` → PR contra `dokploy`
**Estado**: todas las tareas cerradas con evidencia.

## Fase 1 · Matriz y script

- [x] **T001** `scripts/tests-afectados.mjs`: `SUITES`, `seleccionarSuites`,
  `plan` y CLI determinista (`--base`, `--archivos`, `--ejecutar`, `--json`).
  **Evidencia:** `scripts/tests-afectados.test.mjs`.
- [x] **T002** `scripts/tests-afectados.test.mjs`: 10 casos (web, componentes,
  migraciones, pgTAP, edge, tooling, infra, prototipo, specs, docs, determinismo).
  **Evidencia:** `node --test scripts/tests-afectados.test.mjs`.

**Checkpoint 1**: misma lista de archivos ⇒ mismo plan. ✅

## Fase 2 · Integración y documentación

- [x] **T003** `package.json`: `test:afectados`.
  **Evidencia:** `pnpm test:afectados --archivos …`.
- [x] **T004** `docs/pruebas.md`: matriz archivo→suites, comandos y límites.
  **Evidencia:** `pnpm docs:check`.
- [x] **T005** Gates y PR contra `dokploy` (rebasado sobre `origin/dokploy` por
  trabajo concurrente de otra ventana).
  **Evidencia:** PR (a abrir).

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `node --test scripts/tests-afectados.test.mjs` | OK (10) |
| `pnpm test:afectados --archivos …` | plan determinista |
| `pnpm docs:check` | OK |
