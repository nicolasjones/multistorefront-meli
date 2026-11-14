# Bug Verification: E2E nocturno de MSF-852

- **Slug**: msf-852
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial — la guarda y la documentación quedaron verificadas; el síntoma original (el cron no dispara)
  sigue presente hasta que el workflow esté en `main`.

## Summary

La guarda nueva pasa sus 14 tests y la documentación ya no afirma que el gate esté resuelto sin el aterrizaje en
`main`. El defecto de disparo se reproduce tal cual: en `origin/main` no está `.github/workflows/e2e-nocturno.yml` y
la API de Actions devuelve 404 para el workflow y para su dispatch. No se puede correr el job real desde esta rama,
así que la verificación funcional del nocturno queda para después del merge de PR #928 (o MSF-858).

Esta segunda vuelta atiende la revisión de QA del PR #967: la guarda ahora cubre la condición `if:` del job (kill
switch), la guarda anti-omisiones del paso «Resumen» y `pull_request_target`, y la documentación del CI ya no
atribuye a `application` guardas que corren en `e2e-tienda`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` | fail (esperado) | Sin salida: el archivo no está en la rama por defecto; el cron sigue apagado. |
| Reproducción (post-fix) | `gh run list --workflow=e2e-nocturno.yml` | fail (esperado) | `HTTP 404: Not Found`. |
| Reproducción (post-fix) | `gh api -X POST repos/.../actions/workflows/e2e-nocturno.yml/dispatches -f ref=dokploy` | fail (esperado) | `HTTP 404`: tampoco se puede disparar a mano desde `dokploy`. |
| Guarda nueva | `pnpm e2e:nocturno:check` | pass | Contrato completo en la rama. |
| Tests de la guarda | `pnpm test:e2e:nocturno` | pass | 14/14; cada invariante tiene su mutación. |
| Test que detecta la regla (FEAT-236) | se quitó la marca «kill switch del job» de la guarda y se re-corrió el test | pass (detecta) | `ℹ fail 2`: los dos tests nuevos del kill switch fallan sin la marca. |
| Test que detecta la regla (FEAT-236) | se quitó la marca «guarda contra omisiones masivas» y se re-corrió el test | pass (detecta) | `ℹ fail 1`: el test de la guarda anti-omisiones falla sin la marca. |
| Documentación | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | OK, 9 archivos comparados y 0 migraciones nuevas. |
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
✔ falla si el kill switch del job se invierte (el job no correría nunca)
✔ falla si el job pierde la condición del kill switch
✔ falla si los permisos dejan de ser de solo lectura
✔ falla si el cron deja de probar dokploy
✔ falla si la suite deja de correr en serie
✔ falla si el job deja de levantar la base real o migrarla
✔ falla si desaparece la guarda contra omisiones masivas del resumen
✔ falla si la documentación deja de describir el nocturno
✔ falla si falta el workflow o la documentación
ℹ tests 14  ℹ pass 14  ℹ fail 0
```

```text
$ git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml
(sin salida)

$ gh run list --workflow=e2e-nocturno.yml
HTTP 404: Not Found
```

```text
# sin la marca «kill switch del job» (prueba de que el test vigila la regla):
ℹ tests 14  ℹ pass 12  ℹ fail 2
✖ falla si el kill switch del job se invierte (el job no correría nunca)
✖ falla si el job pierde la condición del kill switch

# sin la marca «guarda contra omisiones masivas»:
ℹ tests 14  ℹ pass 13  ℹ fail 1
✖ falla si desaparece la guarda contra omisiones masivas del resumen
```

## Residual Risks

- El cron no corre hasta mergear PR #928 o MSF-858; la guarda no puede detectar ese estado sin poner rojo el CI de
  todos los PRs de `dokploy`.
- La suite completa no se ejecutó en esta verificación (necesita el stack del runner); se valida en el primer run
  manual después del merge a `main`.
- Sin Edge Runtime el nocturno omite `tienda-seo` y el caso «recuperar» de `cuenta-web-cliente`, igual que antes.
- La guarda del contrato lee el YAML con marcas literales: si el workflow se reescribe con otro formato (otro
  entrecomillado, la condición partida en varias líneas), la guarda falla aunque el job siga siendo correcto. Es
  deliberado: el fallo se ve en el PR, no en silencio.

## Recommendation

Hold hasta mergear PR #928 (o completar MSF-858); después, disparar a mano `acceso-publico` y recién entonces cerrar
MSF-852. La guarda y la documentación de esta rama no cambian el comportamiento del CI.
