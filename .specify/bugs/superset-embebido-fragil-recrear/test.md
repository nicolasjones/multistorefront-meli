# Bug Verification: analítica embebida de Superset frágil ante recrear contenedores

- **Slug**: superset-embebido-fragil-recrear
- **Tested**: 2026-09-25
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Permisos del rol `Guest` y orígenes del embed: verificado de punta a punta
(falla antes, pasa después, idempotente, en API y en navegador). La red
declarada en Compose y el timeout de la función solo se validaron
estáticamente: ejercitarlos exige recrear `superset` y reiniciar las Edge
Functions del stack compartido, y eso queda para después del merge.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción antes (403 del embed) | `WEB_ORIGIN=http://localhost:3100 pnpm test:superset:embebido` | fail esperado (rc 1) | 5/5 `/embedded/<uuid>` → 403 |
| Script desde cero | `configurar_embebido.py` ×2 sobre un rol descartable | pass | 19 permisos = `Guest` real; 2da corrida 0 cambios; rol borrado |
| Aplicación real | `configurar_embebido.py` ×2 con la config del contenedor | pass | 5 cambios aditivos, luego 0 |
| Reproducción después (API) | `WEB_ORIGIN=http://localhost:3100 pnpm test:superset:embebido` | pass (rc 0) | 35/35 charts 200 con guest token |
| Reproducción después (navegador) | Chrome headless + `playwright-core`, login real, `/reportes` | pass | 5/5 reportes pintan charts, sin 403/Forbidden |
| Red Compose + alias al recrear | recrear `superset` | not-run | exige recrear el contenedor del stack compartido; `docker compose config` muestra la red y el alias |
| Timeout en `emitir-acceso-reporte` | función desplegada sin red | not-run | no se puede desplegar al runtime compartido desde este checkout; no hay `deno` local |
| Config Compose | `pnpm infra:config` (+ `compose.vps.yaml`) | pass | el config de VPS no lleva la red externa |
| Lint / build | `pnpm lint`, `pnpm build` | pass | 2 warnings de lint previos |
| Docs / catálogo | `pnpm docs:check`, `pnpm template:capabilities:check`, `pnpm test:template:adoption` | pass | 11/11 |

## Output Excerpts

```
antes-3100:  FALLA /embedded/1fb2bf57-… con Referer http://localhost:3100: 403 … 5 fallos
prueba rol:  configurar_embebido: 0 cambios / SOLO_EN_PRUEBA [] / SOLO_EN_GUEST_REAL []
después:     Todo OK (35 charts 200)
navegador:   # Libro Mayor (Colppy): ok (11 charts)
```

## Residual Risks

- La red externa no se probó recreando el contenedor. Si el nombre no
  coincide, el error es inmediato y explícito en `docker compose up`.
- `pnpm dev:superset` ahora exige Supabase levantado antes.
- `datasource_access` derivado se amplía solo a datasets de dashboards con
  embed; el aislamiento por organización sigue en el RLS del guest token.
- La prueba en navegador es un script ad hoc (evidencia), no una suite
  versionada. La prueba versionada es la de API, que cubre el mismo chequeo
  de `allow_domain_list` por `Referer`.

## Recommendation

Mergear. Después del merge, en el producto: recrear `superset` +
`superset-init` desde el checkout que levanta el stack y correr
`pnpm test:superset:embebido`. Con eso, lo que queda en `not-run` pasa a
verificado.
