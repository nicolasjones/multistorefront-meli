# Bug Assessment: CI `application` rojo por la fila «Empresa activa» de la spec 023

- **Slug**: msf-863
- **Created**: 2026-11-13
- **Source**: pasted text (tracker MSF-863) + log real del CI (run 43482415728, job `application` id 132083319817)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim)

> PR: https://github.com/nicolasjones/multistorefront-meli/pull/929 (`integracion/main-en-dokploy` → `dokploy`).
>
> Run `43482415728`, job `application` (id `132083319817`), paso `pnpm matriz:check`:
>
> ```
> $ node scripts/verificar-matriz-pantalla.mjs
> Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo).
>  - specs/023-visor-componentes/spec.md
> [ELIFECYCLE] Command failed with exit code 1.
> ```
>
> Causa: PR #929 trae de `main` la regla «Empresa activa en pantallas y pop-ups» (Principio VIII de la constitución) y su chequeo en `matriz:check`. La spec `023-visor-componentes`, preexistente en `dokploy` desde antes de esa regla, no declara ese criterio en su `## Matriz pantalla↔criterios`. Es la única spec que falla (`prototipo:check` ya pasa: 120 pantallas al día).
>
> Por qué SÍ bloquea el merge: `gh api repos/nicolasjones/multistorefront-meli/rules/branches/dokploy` → único check requerido: `validacion`. `.github/workflows/validate.yml:496-498`: el job `validacion` tiene `needs: [changes, application, web, infrastructure, database]` con `if: always()` y falla si alguno de ellos falló. `application` rojo ⇒ `validacion` rojo ⇒ merge bloqueado.
>
> El job `quality` (oxlint) de este mismo PR también está en rojo, pero **no** está en ese `needs` y por lo tanto no bloquea nada — es el comportamiento ya decidido en MSF-683/PR #737 (`quality` falla con hallazgos pero no bloquea el merge). No requiere acción.
>
> INSTRUCCIÓN: completar en `specs/023-visor-componentes/spec.md`, sección `## Matriz pantalla↔criterios`, la fila «Empresa activa»: mapearla a un criterio de aceptación existente si la pantalla del visor de componentes se ve afectada por el cambio de empresa activa, o declarar «Empresa activa: no aplica» con el motivo. Un único commit mecánico sobre esa spec; no tocar migraciones, workflows ni el resto del merge de #929.

## Symptom

El job `application` del CI falla en el paso `pnpm matriz:check`: la spec `specs/023-visor-componentes/spec.md` (nueva respecto de `dokploy`) tiene su sección `## Matriz pantalla↔criterios` pero no menciona la empresa activa, y el gate exige que la declare (Principio VIII de la constitución). Como `validacion` depende de `application` con `if: always()`, el PR #929 no se puede mergear a `dokploy`.

## Reproduction

1. Tener la rama del PR #929 (`integracion/main-en-dokploy`) con la base `origin/dokploy`:
   `git diff --name-only --diff-filter=A origin/dokploy...HEAD` lista `specs/023-visor-componentes/spec.md` (spec nueva → entra en la revisión del gate).
2. `node scripts/verificar-matriz-pantalla.mjs` (o `MATRIZ_CHECK_BASE=origin/dokploy pnpm matriz:check` en local).
3. El gate encuentra la matriz (`SECCION_MATRIZ`) y la spec menciona UI (`design/pantallas`), pero el cuerpo de la matriz no dice nada de «empresa» → `motivoSpecSinEmpresa` la devuelve como faltante.
4. Sale `Fallo de spec: la matriz debe incluir «Empresa activa»…` y exit 1.

Verificado en local sobre `origin/integracion/main-en-dokploy` (commit 69a2dcaf) antes del arreglo: exit 1 con el mismo mensaje que el CI.

## Suspected Code Paths

- `scripts/verificar-matriz-pantalla.mjs:39` (`motivoSpecSinEmpresa`) — el gate que exige la mención de empresa activa en el cuerpo de la matriz (no se toca: es la regla nueva de `main`).
- `specs/023-visor-componentes/spec.md:68` (sección `## Matriz pantalla↔criterios`) — la spec nueva que no declara la fila «Empresa activa».
- `.github/workflows/validate.yml:496-498` — el agregador `validacion` que depende de `application` (no se toca).

## Root Cause Hypothesis

Confianza: alta. PR #929 trae de `main` el gate `matriz:check` con la regla del Principio VIII (la matriz debe declarar la empresa activa). La spec `023-visor-componentes` es preexistente (vive en `main`, no en `dokploy`) y su matriz mapea lo visible del visor pero nunca declaró la empresa activa, porque la regla todavía no existía cuando se escribió. Al ser una spec *nueva* respecto de `dokploy` (el gate sólo revisa specs agregadas en el diff), el PR la expone al chequeo.

## Proposed Remediation

**Preferred**: completar la matriz de `specs/023-visor-componentes/spec.md` con la fila «Empresa activa». El visor de componentes (`/cobertura-e2e`) es una pantalla interna de desarrollo: su única fuente de datos es el manifiesto de cobertura E2E (`cobertura-e2e.json`, del bucket o el respaldo local de `public/`); no lee ni escribe datos de ninguna empresa y no muestra selector, columna ni texto de empresa. Por lo tanto corresponde **«Empresa activa: no aplica» con su motivo** (la forma que la constitución y `AGENTS.md` habilitan cuando la pantalla no es de empresa), y no un criterio de aceptación nuevo.

**Alternatives**:
- Mapear la fila a un criterio de aceptación existente (p. ej. FR-005, la fuente de datos): descrebe el alcance pero no dice qué pasa con la empresa activa; el gate sólo pediría la mención, pero la spec quedaría ambigua.
- Agregar `specs/023-visor-componentes` a `scripts/matriz-pantalla-exentas.txt`: es la lista de specs anteriores a la vigilancia y el archivo dice explícitamente «no agregar líneas acá sin motivo»; la spec es nueva en `dokploy`, así que no corresponde exceptuarla.

**Files likely to change**:
- `specs/023-visor-componentes/spec.md` (una fila en `## Matriz pantalla↔criterios`).

**Tests to add or update**:
- El gate ya tiene su propia prueba en `scripts/verificar-matriz-pantalla.test.mjs` («acepta «no aplica» con motivo» y «acepta la fila de empresa activa»): cubre la regla, no hace falta un test nuevo.
- La verificación de esta historia es el gate en sí: `pnpm matriz:check` contra la base real (`origin/dokploy`) falla antes del arreglo y pasa después.

## Risks & Considerations

- Riesgo bajo: es un cambio de documentación (una fila de una tabla), sin código, sin migraciones, sin cambios de API.
- Ojo con la base del gate: en local `pnpm matriz:check` usa `HEAD~1` por defecto y no encuentra specs nuevas (0 revisadas); hay que correrlo con `MATRIZ_CHECK_BASE=origin/dokploy` (o con `GITHUB_BASE_REF=dokploy`) para reproducir el CI de verdad.
- La fila debe quedar DENTRO de la sección `## Matriz pantalla↔criterios` (el gate corta el cuerpo en el próximo `## `), y la tabla tiene dos columnas: «Elemento visible» y «Criterio».

## Open Questions

- Ninguno: el verificador es determinista y la decisión «no aplica» está sustentada en el código (el visor no consulta datos de empresa).
