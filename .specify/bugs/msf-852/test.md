# Bug Verification: E2E nocturno de MSF-852

- **Slug**: msf-852
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial — la guarda y la documentación quedaron verificadas; el síntoma original (el cron no dispara)
  sigue presente hasta que el workflow esté en `main`.

## Summary

La guarda nueva pasa sus 10 tests y la documentación ya no afirma que el gate esté resuelto sin el aterrizaje en
`main`. El defecto de disparo se reproduce tal cual: en `origin/main` no está `.github/workflows/e2e-nocturno.yml` y
la API de Actions devuelve 404 para el workflow y para su dispatch. No se puede correr el job real desde esta rama,
así que la verificación funcional del nocturno queda para después del merge de PR #928 (o MSF-858).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | `git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml` | fail (esperado) | Sin salida: el archivo no está en la rama por defecto; el cron sigue apagado. |
| Reproducción (post-fix) | `gh run list --workflow=e2e-nocturno.yml` | fail (esperado) | `HTTP 404: Not Found`. |
| Reproducción (post-fix) | `gh api -X POST repos/.../actions/workflows/e2e-nocturno.yml/dispatches -f ref=dokploy` | fail (esperado) | `HTTP 404`: tampoco se puede disparar a mano desde `dokploy`. |
| Guarda nueva | `pnpm e2e:nocturno:check` | pass | Contrato completo en la rama. |
| Tests de la guarda | `pnpm test:e2e:nocturno` | pass | 10/10; cada invariante tiene su mutación. |
| Documentación | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | OK, 0 archivos comparados (sin commits) y 0 migraciones nuevas. |
| Regresión | `pnpm test:e2e:omitidos` y `pnpm test:e2e:escritura` | not-run | No se tocaron; corren en `application` igual que antes. |

## Output Excerpts

```text
$ pnpm test:e2e:nocturno
✔ el repo cumple el contrato del E2E nocturno
✔ falla si desaparece el cron diario (mutación: cambia la hora)
✔ falla si desaparece el disparo manual
✔ falla si el job pasa a bloquear PRs
✔ falla si los permisos dejan de ser de solo lectura
✔ falla si el cron deja de probar dokploy
✔ falla si la suite deja de correr en serie
✔ falla si el job deja de levantar la base real o migrarla
✔ falla si la documentación deja de describir el nocturno
✔ falla si falta el workflow o la documentación
ℹ tests 10  ℹ pass 10  ℹ fail 0
```

```text
$ git ls-tree origin/main -- .github/workflows/e2e-nocturno.yml
(sin salida)

$ gh run list --workflow=e2e-nocturno.yml
HTTP 404: Not Found
```

## Residual Risks

- El cron no corre hasta mergear PR #928 o MSF-858; la guarda no puede detectar ese estado sin poner rojo el CI de
  todos los PRs de `dokploy`.
- La suite completa no se ejecutó en esta verificación (necesita el stack del runner); se valida en el primer run
  manual después del merge a `main`.
- Sin Edge Runtime el nocturno omite `tienda-seo` y el caso «recuperar» de `cuenta-web-cliente`, igual que antes.

## Recommendation

Hold hasta mergear PR #928 (o completar MSF-858); después, disparar a mano `acceso-publico` y recién entonces cerrar
MSF-852. La guarda y la documentación de esta rama no cambian el comportamiento del CI.
