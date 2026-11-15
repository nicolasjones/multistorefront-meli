# Bug Verification: E2E nocturno de MSF-852

- **Slug**: msf-852
- **Tested**: 2026-11-14
- **Revised**: 2026-11-15 (devolución de QA y de seguridad del PR #967)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: fixed — la guarda del contrato y la documentación quedaron verificadas, y el síntoma original (el cron
  no dispara porque el workflow no estaba en la rama por defecto) ya no aplica: el PR #928 lo mergeó en `main`
  (`57ad76da`) y GitHub lo lista como workflow activo.

## Summary

La guarda pasa sus 17 tests y la documentación ya no afirma que el gate esté resuelto sin el aterrizaje en `main`.
El defecto de disparo que originó el reporte ya no se reproduce: `.github/workflows/e2e-nocturno.yml` está en
`origin/main` (blob `46f9136a`, merge del PR #928 en `57ad76da`) y `gh workflow list` lo da como activo. No se puede
correr el job real desde esta rama (el stack del runner no está acá), así que la verificación funcional del nocturno
queda para el primer run manual o para el cron de las 05:00 UTC.

Esta segunda vuelta atendía la revisión de QA del PR #967: la guarda cubría la condición `if:` del job (kill switch),
la guarda anti-omisiones del paso «Resumen» y `pull_request_target`, y la documentación del CI ya no atribuía a
`application` guardas que corren en `e2e-tienda`.

Esta tercera vuelta atiende la devolución de QA y de seguridad del PR #967: la guarda reconoce `pull_request` /
`pull_request_target` en cualquier forma YAML válida (bloque con cualquier indentación, lista, flujo o escalar), y
rechaza `continue-on-error` (que dejaría el run verde con la suite omitida). La documentación del CI declara el
requisito `changes.web` + `changes.e2e` y que `changes.e2e` es `false` en todo PR con base `epic/*`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Estado del defecto original | `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` | pass | `100644 blob 46f9136a…`: el workflow YA está en la rama por defecto (PR #928, merge `57ad76da`, 2026-11-14 20:26 UTC). El cron y el disparo manual existen. |
| Estado del defecto original | `gh workflow list` | pass | `E2E nocturno  active  418613217`. |
| Corridas del nocturno | `gh run list --workflow=e2e-nocturno.yml` | pass (sin corridas todavía) | Todavía no hay runs: el cron dispara a las 05:00 UTC. |
| Guarda nueva | `pnpm e2e:nocturno:check` | pass | Contrato completo en la rama. |
| Tests de la guarda | `pnpm test:e2e:nocturno` | pass | 17/17; cada invariante tiene su mutación. |
| Test que detecta la regla (FEAT-236) | se quitó la marca «kill switch del job» de la guarda y se re-corrió el test | pass (detecta) | `ℹ fail 2`: los dos tests del kill switch fallan sin la marca. |
| Test que detecta la regla (FEAT-236) | se quitó la marca «guarda anti-omisiones» y se re-corrió el test | pass (detecta) | `ℹ fail 1`: el test de la guarda anti-omisiones falla sin la marca. |
| Test que detecta la regla (FEAT-236) | se volvió a la regex de 2 espacios (`^\s{2}pull_request`) y se re-corrió el test | pass (detecta) | `ℹ fail 1`: «falla con pull_request en cualquier forma YAML válida» falla con la guarda antigua. |
| Test que detecta la regla (FEAT-236) | se anuló la marca `continue-on-error` y se re-corrió el test | pass (detecta) | `ℹ fail 1`: «falla si el job puede quedar verde con continue-on-error» falla sin la marca. |
| Documentación | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | OK, 10 archivos comparados y 0 migraciones nuevas. |
| Lint | `pnpm lint` | pass | exit 0; sólo warnings preexistentes de `apps/web/src` (fuera de este cambio). |
| Build / type-check | `pnpm build` | pass | exit 0 (`tsc -b && vite build`). |
| Calidad | `pnpm calidad` | pass (con salvedad) | oxlint, knip, jscpd, dependency-cruiser y syncpack ok; `gitleaks` no corrió porque necesita el daemon de Docker (no disponible acá) y este diff no agrega secretos. |
| Regresión | `pnpm test:e2e:omitidos` y `pnpm test:docs:check` | pass | 4/4 y 4/4; no se tocaron. |

## Output Excerpts

```text
$ pnpm test:e2e:nocturno
✔ el repo cumple el contrato del E2E nocturno
✔ falla si desaparece el cron diario (mutación: cambia la hora)
✔ falla si desaparece el disparo manual
✔ falla si el job pasa a bloquear PRs
✔ falla si el job puede dispararse con pull_request_target
✔ falla con pull_request en cualquier forma YAML válida
✔ no se confunde con un comentario que menciona pull_request
✔ falla si el job puede quedar verde con continue-on-error
✔ falla si el kill switch del job se invierte (el job no correría nunca)
✔ falla si el job pierde la condición del kill switch
✔ falla si los permisos dejan de ser de solo lectura
✔ falla si el cron deja de probar dokploy
✔ falla si la suite deja de correr en serie
✔ falla si el job deja de levantar la base real o migrarla
✔ falla si desaparece la guarda contra omisiones masivas del resumen
✔ falla si la documentación deja de describir el nocturno
✔ falla si falta el workflow o la documentación
ℹ tests 17  ℹ pass 17  ℹ fail 0
```

```text
$ git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml
100644 blob 46f9136a054a939d25cde208f002c063bcbb3b68	.github/workflows/e2e-nocturno.yml

$ gh workflow list | grep -i nocturno
E2E nocturno	active	418613217
```

```text
# con la guarda nueva reemplazada por la regex antigua de 2 espacios (prueba de que el test vigila la regla):
ℹ tests 17  ℹ pass 16  ℹ fail 1
✖ falla con pull_request en cualquier forma YAML válida

# sin la marca «continue-on-error»:
ℹ tests 17  ℹ pass 16  ℹ fail 1
✖ falla si el job puede quedar verde con continue-on-error
```

## Residual Risks

- La suite completa no se ejecutó en esta verificación (necesita el stack del runner); se valida en el primer run
  manual o en el cron de las 05:00 UTC.
- Sin Edge Runtime el nocturno omite `tienda-seo` y el caso «recuperar» de `cuenta-web-cliente`, igual que antes.
- La guarda del contrato lee el YAML con marcas literales: si el workflow se reescribe con otro formato (otro
  entrecomillado, la condición partida en varias líneas), la guarda falla aunque el job siga siendo correcto. Es
  deliberado: el fallo se ve en el PR, no en silencio.
- La guarda reconoce `pull_request`/`pull_request_target` y `continue-on-error` leyendo el texto del workflow, no un
  AST de YAML: si alguien usa una forma exótica de YAML (un ancla o un alias), la guarda puede no verla. Cubre las
  formas que GitHub Actions acepta en la práctica (bloque, lista, flujo y escalar).

## Recommendation

Disparar a mano `acceso-publico` (`gh workflow run e2e-nocturno.yml -f spec=acceso-publico`) y, si el run sale verde
con el resumen «## E2E nocturno», dejar correr el cron de las 05:00 UTC. La guarda y la documentación de esta rama no
cambian el comportamiento del CI: lo evitan que se pudra en silencio.
