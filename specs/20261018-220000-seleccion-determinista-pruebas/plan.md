# Plan de implementación · Selección determinista de pruebas

**Spec**: `specs/20261018-220000-seleccion-determinista-pruebas/spec.md`
**Alcance**: workers (tooling)
**Rama**: `infra/tests-afectados` → PR contra `dokploy`

## Contexto técnico

- El job `changes` del CI ya clasifica el diff (`code/db/web/infra/e2e`), pero no
  hay una regla local explícita para elegir pruebas.
- Los scripts del repo usan `node --test` (`scripts/*.test.mjs`) y exponen
  funciones puras testeables (patrón de `supabase-ci.mjs`).

## Principios aplicados

- **III (auditable)**: el plan es reproducible (misma entrada ⇒ misma salida) y
  se puede imprimir como JSON.
- **VI (panel operable)**: un comando (`pnpm test:afectados`) muestra y ejecuta.

## Fases

### Fase 1 · Matriz y script

1. `scripts/tests-afectados.mjs`: `SUITES`, `seleccionarSuites`, `plan` y CLI
   (`--base`, `--archivos`, `--ejecutar`, `--json`).
2. `scripts/tests-afectados.test.mjs` (10 casos).

### Fase 2 · Integración y documentación

3. `package.json`: `test:afectados`.
4. `docs/pruebas.md`: matriz, comandos y límites.
5. Verificación y PR.

## Verificación

- `node --test scripts/tests-afectados.test.mjs`
- `pnpm test:afectados --archivos apps/web/src/pages/clientes/list.tsx`
- `pnpm docs:check`

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La matriz se desactualiza | El test fija el contrato; `docs/pruebas.md` la documenta |
| Se interpreta como “saltear el CI” | El doc aclara que el gate del PR corre todo |
| Cambios concurrentes de otra ventana | Rama disjunta + rebase sobre `origin/dokploy` antes del PR |
