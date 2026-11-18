---
owner: producto
sources:
  - specs
  - .github/workflows/nightly.yml
  - .lighthouserc.json
  - .lighthouserc.tienda.json
  - scripts/medir-tienda-lighthouse.mjs
---

# F5 — Profundidad (no bloqueante)

Checks que no frenan PRs, pero **fallan el nightly** (rojo) si encuentran algo (MSF-687). Corren en `.github/workflows/nightly.yml` (06:00 UTC o a mano).

| Check | Herramienta | Qué mide |
|---|---|---|
| **Performance** | **Lighthouse CI** (`.lighthouserc.json`) | perf/a11y/best-practices sobre el build (`apps/web/dist`) |
| **Accesibilidad** | **axe-core CLI** | violaciones a11y sobre el preview |
| **Rendimiento de la tienda** | **Lighthouse CI** (`.lighthouserc.tienda.json`) + `psql` | LCP/FCP/CLS/TBT en perfil móvil del catálogo y la ficha de las dos tiendas del seed, y costo de `publico.catalogo_pagina_por_dominio` con 500 productos |

Reportes en `reports/lighthouse/` y `reports/axe/axe.json` (artefacto `nightly-reportes`). Las aserciones de
`.lighthouserc.json` son `error` y axe corre con `--exit`; las herramientas van con versión fija (`@lhci/cli@0.16.0`,
`@axe-core/cli@4.14.0`).

El job `medir` del nightly (MSF-552) mide la **tienda pública**, no el panel: levanta el stack de Supabase con el
seed, siembra 500 productos por tienda, compila el front con `VITE_PANEL_HOSTS` y mide `/catalogo` y `/producto/:id`
de `mundojc.localhost` y `sanjavucho.localhost` con el perfil móvil (390×844, CPU ×4, «4G lento», 3 corridas). Su
config es aparte (`.lighthouserc.tienda.json`) porque `.lighthouserc.json` mide el panel sobre el dist estático y
sus aserciones son `error`. Falla si alguna ruta supera el objetivo de LCP (3 s). Comando local:
`pnpm medir:tienda` (con el stack con el seed y la web servida). Reportes: `reports/lighthouse-tienda/` y
`reports/medir-tienda/` (artefacto `medir-tienda`). Las cifras y el diagnóstico están en
[Tiendas online](tiendas-online.md#rendimiento-en-celular-t071-sc-010).

## Pendiente (necesita devDependencies)
- **Mutation testing** (**Stryker**): requiere `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` como devDeps (no se agregan sin poder actualizar el lockfile). Config sugerida: mutar `apps/web/src/lib/**` y `packages/**`.
- **Cobertura del diff** (**diff-cover**): requiere un reporte de cobertura (`@vitest/coverage-v8` + `test:coverage`). Una vez habilitado, `diff-cover coverage/cobertura.xml --compare-branch=origin/main` en el PR.

## Cómo habilitarlos cuando se sumen las deps
1. `pnpm add -D @vitest/coverage-v8 @stryker-mutator/core @stryker-mutator/vitest-runner`
2. Agregar `test:coverage` (vitest --coverage) y `mutation` (stryker run) a `package.json`.
3. En `quality` (PR): `diff-cover`. En `nightly`: `stryker run`.
