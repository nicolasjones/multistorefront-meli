# Bug Assessment: el E2E nocturno no se puede disparar (gate MSF-852)

- **Slug**: msf-852
- **Created**: 2026-11-14
- **Source**: MSF-852 (tracker) — gate «¿los E2E de Playwright entran al CI con una base real?»
- **Verdict**: valid (decisión de negocio ya tomada; queda un defecto de entrega del job)
- **Severity**: medium

## Report (verbatim o resumido)

> ## Gate para Nicolás
>
> **Qué pasa hoy:** la suite `apps/web/e2e` (99 tests) NO corre de verdad en el CI: el job `application` los omite
> porque no hay base de datos (94 omitidos, solo corren unos 5). Por eso se pudrieron y tardamos en enterarnos.
> Se corrigieron en #905/#907 y hoy corren contra un Supabase local con la receta de `docs/e2e-app.md`. Un guardián
> barato (`pnpm e2e:escritura:check`) ya corre en el CI.
>
> **Decisión:** ¿se agrega un job con Supabase real (levantar el stack, migrar, sembrar, build, Playwright) para que
> no se vuelvan a pudrir?
>
> **Recomendación:** job nocturno sobre `dokploy` (no bloquea los PR) más correr los specs afectados en los PR que
> toquen e2e.

Decisión del 2026-11-13 (comentario 85620, por delegación de Nicolás): job **nocturno** sobre `dokploy` + disparo
manual, **sin bloquear PRs**.

## Symptom

La decisión está implementada en `.github/workflows/e2e-nocturno.yml` (PR #925, mergeado en `dokploy`), pero el job
**nunca se ejecuta**: GitHub dispara `schedule` y resuelve `workflow_dispatch` y la API de Actions sólo en la rama por
defecto (`main`), y el workflow vive únicamente en `dokploy`. Un E2E nocturno que no corre vuelve a esconder la
podredumbre que abrió el gate.

## Reproduction

1. `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` → sin salida (el archivo no está en la rama por
   defecto).
2. `gh run list --workflow=e2e-nocturno.yml` → `HTTP 404: Not Found`.
3. `gh api -X POST repos/<repo>/actions/workflows/e2e-nocturno.yml/dispatches -f ref=dokploy -f 'inputs[spec]=acceso-publico'`
   → `HTTP 404`, incluso con el archivo en `dokploy`: el workflow no es direccionable fuera de la rama por defecto.
4. El workflow y sus docs sí existen en `dokploy` (PR #925), y su contrato está completo; el único eslabón que falta
   es el aterrizaje en `main`.

## Suspected Code Paths

- `.github/workflows/e2e-nocturno.yml` — job nocturno (cron 05:00 UTC, `workflow_dispatch`, checkout de `dokploy`,
  stack Supabase con API, `--workers=1`, sin bloqueo de PRs).
- `docs/e2e-app.md` — sección `## E2E nocturno`; decía que el gate «queda resuelto» sin aclarar que el cron depende
  de `main`.
- `docs/manifest.json` — índice de documentación.
- `PR #928` (`ci/e2e-nocturno-en-main`) — carve-out abierto y verde que lleva el workflow a `main`.
- `MSF-858` — gate de integración `dokploy`→`main`, alternativa al carve-out.

## Root Cause Hypothesis

Defecto de entrega, no de código: se implementó el job en la rama de desarrollo (`dokploy`) sin llevarlo a la rama
por defecto. Como `schedule` y `workflow_dispatch` se resuelven contra `main`, la funcionalidad existe pero no se puede
invocar. Confianza: alta (402/404 reproducidos contra la API de Actions).

## Proposed Remediation

**Preferred**:
1. Llevar `.github/workflows/e2e-nocturno.yml` y su sección de `docs/e2e-app.md` a `main` (PR #928 ya lo hace; no
   duplicarlo en esta rama). Mientras no esté en `main`, el cron y el disparo manual no existen.
2. En esta rama: agregar una guarda determinista (`pnpm e2e:nocturno:check` + `pnpm test:e2e:nocturno`) que falle si
   el workflow o su contrato desaparecen, y corregir la documentación para que diga la verdad sobre `main`.

**Alternatives**:
- Esperar la integración completa `dokploy`→`main` (MSF-858), que arrastra el workflow con el resto de la divergencia.
  Es correcta pero deja el cron apagado hasta que ese gate avance.
- Duplicar el workflow en esta rama: no sirve (la rama no es `main`) y repite el trabajo de #928.

**Files likely to change**: `.github/workflows/e2e-nocturno.yml` (comentarios), `.github/workflows/validate.yml`
(guarda), `scripts/verificar-e2e-nocturno*.mjs`, `package.json`, `docs/e2e-app.md`, `.specify/bugs/msf-852/`.

**Tests to add or update**: `scripts/verificar-e2e-nocturno.test.mjs` (mutaciones del contrato) y el CLI de la guarda
en `application`.

## Risks & Considerations

- El cron seguirá apagado hasta mergear #928 o MSF-858; la guarda no puede verificar la rama por defecto en cada PR
  sin poner rojo todo el mundo hasta ese merge, así que verifica el contrato en la rama del PR.
- No tocar migraciones: esta historia no cambia el esquema.
