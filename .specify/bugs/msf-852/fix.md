# Bug Fix: E2E nocturno de MSF-852 — guarda del contrato y aterrizaje en `main`

- **Slug**: msf-852
- **Fixed**: 2026-11-14
- **Revised**: 2026-11-15 (devolución de QA y de seguridad del PR #967)
- **Assessment**: ./assessment.md
- **Status**: fixed — el job está en `dokploy` (PR #925) y el workflow ya aterrizó en `main` (PR #928, merge
  `57ad76da`), que es lo que habilita el cron y el disparo manual. Esta rama entrega la guarda del contrato y la
  corrección de la documentación; no duplica el aterrizaje en `main`.

## Summary

El gate MSF-852 decidió un E2E nocturno sobre `dokploy` sin bloquear PRs. El job existe y está completo en `dokploy`
(PR #925), y el workflow ya está en la rama por defecto: el PR #928 lo mergeó en `main` (`57ad76da`, 2026-11-14
17:26 -0300), así que tanto `schedule` como `workflow_dispatch`/la API de Actions lo resuelven. Antes de ese merge el
archivo vivía sólo en `dokploy`, el cron no arrancaba y un disparo manual respondía 404; esa era la causa del síntoma.
Esta rama entrega una guarda barata que impide que el contrato del nocturno desaparezca en silencio y la documentación
que explica el despliegue y su reparto en el CI.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/verificar-e2e-nocturno.mjs` | added | Guarda determinista: cron 05:00 UTC, `workflow_dispatch`, permisos de solo lectura, checkout de `dokploy`, Playwright en serie, stack Supabase + migraciones, kill switch del job, guarda contra omisiones masivas del resumen, sin `continue-on-error`, sin `pull_request`/`pull_request_target` (en cualquier forma YAML), y docs con la sección y la ruta. |
| `scripts/verificar-e2e-nocturno.test.mjs` | added | 17 tests; cada invariante se muta y se exige que la guarda falle. |
| `package.json` | modified | `e2e:nocturno:check` y `test:e2e:nocturno`. |
| `.github/workflows/validate.yml` | modified | El job `application` corre la guarda y su test en cada PR (sin base). |
| `.github/workflows/e2e-nocturno.yml` | modified | Comentarios al día: TTL de 75 min (no 50), y que `schedule`/`workflow_dispatch`/API requieren el archivo en `main`. Sin cambios de comportamiento. |
| `docs/e2e-app.md` | modified | La sección «E2E nocturno» dice que el cron depende de `main`, cómo se dispara una vez ahí, y suma la guarda a la tabla del CI; se quitaron las referencias a #923 «todavía no mergeado». |
| `.specify/bugs/msf-852/` | added | assessment, fix y test de este bug. |

### Revisión de QA (PR #967) — segunda vuelta

La revisión pidió que la guarda cubriera también las condiciones que pueden dejar el nocturno apagado o en verde falso:

| Hallazgo | Corrección |
|----------|------------|
| La guarda no cubría la condición `if:` del job (`vars.CI_PAUSED != 'true' && vars.CI_E2E_NOCTURNO != 'false'`): invertirla o ponerla en `false` dejaba el nocturno sin correr nunca, sin que ningún test lo detectara. | Marca nueva «kill switch del job» + dos tests de mutación (invertir el `!=` y borrar la condición). |
| La guarda no cubría la guarda anti-omisiones del paso «Resumen» (`omitidos.length * 2 > filas.length`): borrarla dejaba el run verde con toda la suite omitida. | Marca nueva «guarda contra omisiones masivas» + test de mutación (borrar la condición). |
| La guarda no miraba `pull_request_target`. | La condición que rechaza PRs ahora cubre `pull_request` y `pull_request_target` + test de mutación. |
| `docs/e2e-app.md` atribuía `pnpm e2e:omitidos:check` al job `application` (sólo corre en `e2e-tienda`) y decía que `acceso-publico` corría en «cada PR» (sólo si el diff toca la web). | Tabla del CI corregida: `application` lista lo que realmente corre, `acceso-publico`/`recorrido-publico` van en su propia fila (PR que toca la web) y `e2e:omitidos:check` figura en `e2e-tienda`. |
| `docs/deployment.md` decía que el lock del job `database` se recicla a los 50 min; el valor real es 75 (`validate.yml`). | Corregido a 75 min. |

### Revisión de QA (PR #967) — tercera vuelta

| Hallazgo | Corrección |
|----------|------------|
| El rechazo de disparos de PR exigía `^\s{2}pull_request` (indentación exacta de 2 espacios): con `on:` + `    pull_request:` (4 espacios), en lista o en flujo (`on: [pull_request]`) la guarda daba verde. | `disparaEnPR()` reconoce el evento en bloque con cualquier indentación, en lista, en flujo y como escalar; los comentarios de línea completa no cuentan. Tests de mutación para cada forma. |
| La guarda anti-omisiones se anula con `continue-on-error` en el job: el `process.exitCode = 1` del resumen deja de fallar el run (como `e2e-tienda` con `E2E_TIENDA_BLOQUEA`). | La guarda rechaza cualquier `continue-on-error` distinto de `false` en el workflow + tests de mutación (job con `true` y con expresión). |
| La tabla del CI en `docs/e2e-app.md` decía que los specs públicos y `e2e-tienda` corren en «cada PR que toca la web», omitiendo `changes.e2e == 'true'` y que es `false` en PRs con base `epic/*`. | Filas corregidas: PR a `dokploy`/`main` que no apunta a `epic/*`, con el requisito `changes.web` + `changes.e2e` explícito. |
| La evidencia de `fix.md`/`test.md` afirmaba que `origin/main` no tenía el workflow y que la API daba 404, pero el PR #928 ya lo había mergeado (`57ad76da`). | Evidencia actualizada: `git ls-tree origin/main` devuelve `blob 46f9136a`; la rama por defecto ya tiene el workflow y el cron puede disparar. |

## Diff Highlights

La guarda verifica el contrato, no la prosa del workflow: `cron: '0 5 * * *'`, `workflow_dispatch`, `contents: read`,
`ref: ... 'dokploy'`, `playwright test ... --workers=1`, `supabase start`, `supabase migration up`, la condición `if:`
del job con sus dos variables de kill switch, la guarda `omitidos.length * 2 > filas.length` del resumen, la ausencia
de `continue-on-error` y de `pull_request`/`pull_request_target` (en cualquier forma YAML), y la sección + ruta en
`docs/e2e-app.md`. Cada una de esas marcas tiene su test de mutación.

## Tests Added or Updated

- `scripts/verificar-e2e-nocturno.test.mjs` — el repo cumple; falla con cron cambiado, sin disparo manual, con
  `pull_request`/`pull_request_target` en bloque (2 y 4 espacios, en lista), en flujo (`on: [pull_request]`,
  `on: {pull_request: …}`) y escalar, con `continue-on-error` en el job (`true` o una expresión), con el kill switch
  invertido, sin la condición del kill switch, con permisos de escritura, sin `dokploy`, sin `--workers=1`, sin
  stack/migraciones, sin la guarda anti-omisiones, sin sección o ruta en docs, y si faltan los archivos.

## Local Verification

- `pnpm e2e:nocturno:check` → `E2E nocturno: contrato completo (...)`.
- `pnpm test:e2e:nocturno` → 17/17 en verde.
- `pnpm lint` → exit 0 (sólo warnings preexistentes de `apps/web/src`, fuera de este cambio).
- `pnpm build` → exit 0 (`tsc -b && vite build`).
- `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` → OK (sin migraciones nuevas).
- `pnpm calidad` → todo ok salvo `gitleaks`, que necesita el daemon de Docker (no disponible en este entorno); el
  diff no agrega secretos.
- Estado del defecto original: `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` → `blob 46f9136a`
  (PR #928 mergeado en `57ad76da`); el workflow ya está en la rama por defecto, así que el cron y el disparo manual
  existen. `gh run list --workflow=e2e-nocturno.yml` todavía no devuelve corridas (el cron corre a las 05:00 UTC).

## Deviations from Assessment

- No se duplicó PR #928 ni se creó un segundo workflow en `main`: el aterrizaje en `main` ya está mergeado (`57ad76da`).
- La guarda no consulta la rama por defecto: la rama base de este PR es `dokploy` y la guarda protege el contrato del
  workflow en la rama, no el estado de `main`.

## Follow-ups

- Primer disparo manual con un spec corto (`-f spec=acceso-publico`) antes de confiar en el cron de las 05:00 UTC.
- Si el run nocturno falla, leer el resumen del run (tabla Pasaron/Fallaron/Inestables/Omitidos) y los artefactos
  `e2e-nocturno`.
