# Feature Specification: Selección determinista de pruebas

**Feature Branch**: `infra/tests-afectados`

**Created**: 2026-10-18

**Status**: Implementada (PR contra `dokploy`).

**Delivery scope**: workers (tooling de CI: `scripts/`). No toca `refine`,
`supabase`, `kestra` ni `superset`.

**Input** (pedido del usuario): «no quiero lenguaje natural, quiero determinístico
según lo que tiene que hacer» (qué pruebas correr para un cambio).

## Por qué

Hoy el subconjunto de pruebas se decidía conversando (“corré Clientes”, “corré
pgTAP”), lo que es ambiguo y no reproducible. El CI ya clasifica el diff
(`changes`) pero no hay una regla local explícita que diga, para un cambio, qué
suites corresponden. Se necesita una **matriz archivo→suites** y un comando que
la aplique, para que el plan sea el mismo siempre y verificable.

## Historias y criterios de aceptación

### US1 · El plan sale del diff, no de una persona

- **US1-CA1** Dada una lista de archivos, `seleccionarSuites(archivos)` devuelve
  siempre el mismo conjunto, en el mismo orden (determinista).
- **US1-CA2** `pnpm test:afectados` calcula el diff contra la base
  (`origin/dokploy` por defecto, o `--base`), muestra el plan y, con
  `--ejecutar`, lo corre en orden cortando al primer fallo.
- **US1-CA3** `--json` devuelve el plan para CI/scripts; `--archivos` permite
  probar la matriz sin git.

### US2 · La matriz cubre las áreas del repo

- **US2-CA1** Web: `apps/web/**` → Vitest; páginas → + E2E público + estilos;
  componentes → + E2E.
- **US2-CA2** Supabase: migraciones → pgTAP + aditivas; tests → pgTAP; edge
  functions → sus tests.
- **US2-CA3** Tooling/infra: `scripts/**`/`.github/**` → tests de scripts;
  `infra/**` → `infra:config` + tests de scripts.
- **US2-CA4** Prototipo/specs/docs: `design/pantallas/**` → inventario;
  `specs/**` → matriz; siempre `lint` + `docs:check`.

## Requisitos funcionales

- **FR-001** `scripts/tests-afectados.mjs` expone `SUITES`, `seleccionarSuites` y
  `plan`; la CLI soporta `--base`, `--archivos`, `--ejecutar` y `--json`.
- **FR-002** Orden estable de suites (barato → pesado) y sin duplicados.
- **FR-003** `pnpm test:afectados` en `package.json`.
- **FR-004** `docs/pruebas.md` documenta la matriz y sus límites.
- **FR-005** `scripts/tests-afectados.test.mjs` fija el contrato (10 casos).

## Fuera de alcance

- No reemplaza el gate del PR: el CI sigue corriendo todo.
- No selecciona archivos individuales de Vitest (corre la suite web completa).
- Los E2E con sesión siguen siendo manuales (requieren Supabase local).

## Pruebas

- `node --test scripts/tests-afectados.test.mjs` (matriz, determinismo, orden).
- `pnpm test:afectados --archivos …` (dry-run) y `pnpm docs:check`.

## Reversión

Sin migraciones ni datos. Se revierte con `git revert` (script, tests y doc).
