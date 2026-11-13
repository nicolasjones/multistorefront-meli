# Bug Verification: fila «Empresa activa» en la matriz de la spec 023

- **Slug**: msf-863
- **Tested**: 2026-11-13
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma no se reproduce: con la fila «Empresa activa» agregada a la matriz de `specs/023-visor-componentes/spec.md`, el gate `pnpm matriz:check` pasa contra la base real del PR (`origin/dokploy`) con el mismo mensaje que daba el CI. Se reprodujo el fallo antes del arreglo (exit 1, mismo texto que el log del run 43482415728) y se comprobó que pasa después (exit 0). No hubo regresiones en los chequeos que el job `application` corre.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (pre-fix) | `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` | fail | Exit 1: `Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo). - specs/023-visor-componentes/spec.md` (idéntico al log del CI) |
| Reproduction (post-fix) | `MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs` | pass | Exit 0: `Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).` |
| New / updated tests | `pnpm test:matriz:pantalla` | pass | 10/10 (el archivo no se modificó: la regla ya tenía sus tests) |
| Estructura de la tabla | conteo de celdas de la fila «Empresa activa» contra el encabezado | pass | 2 celdas = 2 columnas del encabezado (la primera versión tenía 3 y el criterio se perdía al renderizar) |
| CI (PR #929) | run `43491976550`, job `application` id `132131028268` | pass | `application` en success sobre el SHA `73de5501`: `pnpm matriz:check` pasó contra `origin/dokploy` |
| CI (PR #934) | run `43492109016`, job `validacion` id `132126092325` | pass | `validacion` en success (único check requerido de `dokploy`) |
| Regression suite | `GITHUB_BASE_REF=dokploy pnpm docs:check` · `pnpm prototipo:check` · `pnpm lint` · `pnpm build` | pass | docs:check OK (596 archivos contra origin/dokploy) · migraciones OK · prototipo OK (120 pantallas) · lint exit 0 · build `✓ built` |
| Lint / type-check | `pnpm lint` | pass | Exit 0; sólo warnings de oxlint preexistentes del PR #929 |
| Calidad determinista | `pnpm calidad` | partial | oxlint/jscpd/dependency-cruiser/syncpack **ok**. gitleaks no corrió (sin Docker en este entorno) y knip reporta 6 hallazgos **preexistentes de `main`** (`docs/javascripts/zoom-imagenes.js` sin usar, `@playwright/test` sin listar en `scripts/armar-video-evidencia.mjs` y 4 binarios sin listar): ajenos a este cambio (sólo 3 `.md`), fuera del alcance indicado (el job `quality` no bloquea el merge, decisión MSF-683/PR #737) |

## Output Excerpts

```
$ MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs     # antes del arreglo
Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo).
 - specs/023-visor-componentes/spec.md
EXIT=1

$ MATRIZ_CHECK_BASE=origin/dokploy node scripts/verificar-matriz-pantalla.mjs     # después del arreglo
Matriz pantalla↔criterios: OK (6 specs nuevas revisadas, 0 exentas).
EXIT=0

$ pnpm test:matriz:pantalla
ℹ tests 10 · ℹ pass 10 · ℹ fail 0

$ GITHUB_BASE_REF=dokploy pnpm docs:check
Documentación de cambios: OK (596 archivos comparados contra origin/dokploy).
Migraciones OK: 644 archivo(s), 1 nuevo(s) contra origin/dokploy.

$ pnpm prototipo:check
Inventario del prototipo: OK (120 pantallas al día).
```

## Residual Risks

- La verificación local reproduce el paso que falló (`matriz:check` con base `origin/dokploy`), pero el job `application` completo (que además corre `test:docs:pasos-manuales`, `test:db:guard-migraciones`, `estilos:check`, `test:estilos:sueltos`, `e2e:escritura:check`, `test:e2e:escritura`, `ui:empresas:check`, `test:ui:empresas`, `prototipo:check`, `test:prototipo:inventario`, `test:matriz:pantalla`, `pnpm lint` y el build) sólo se puede certificar en el CI: en el log del run 43482415728 todos esos pasos anteriores a `matriz:check` ya habían pasado, y el cambio es una fila de texto en una spec, sin efecto sobre ellos. **Certificado en el CI**: run `43491976550`, job `application` id `132131028268` → success.
- El job `quality` (knip) del PR #929 sigue en rojo por el tooling de evidencia E2E que el PR trae de `main` sin actualizar la configuración de knip; no bloquea el merge (`validacion` depende de `changes, application, web, infrastructure, database`, no de `quality`).

## Recommendation

Cerrar el bug: verificado localmente con el gate real contra la base del PR y
confirmado en el CI (`application` y `validacion` en verde sobre el SHA del
arreglo).
