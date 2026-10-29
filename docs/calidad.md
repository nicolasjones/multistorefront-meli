---
owner: tecnico
sources:
  - specs
---

# Calidad determinista (F1)

Checks que **no dependen del criterio** de una persona/agente. El objetivo es doble:

1. **Menos ida y vuelta dev↔revisor**: el Desarrollador corre `pnpm calidad` **antes** de pedir review.
2. **Evidencia para el Revisor**: los hallazgos son citables (no prosa).

## Uso

```bash
pnpm calidad                 # todo
pnpm calidad --code          # sin docker (sin secretos/SAST)
pnpm calidad --only=secrets,sast
node scripts/calidad.mjs --no-docker
```

Complementa (no reemplaza) el CI existente (`docs:check`, `estilos:check`, `prototipo:check`,
`matriz:check`, `lint`, `build`, `test:web`, `test:db`).

## Qué corre

| Check | Herramienta | Qué detecta |
|---|---|---|
| Secretos | **gitleaks** (docker) | claves/tokens commiteados (con allowlist de ejemplos/tests) |
| SAST | **semgrep** (docker, reglas `p/secrets`, `p/typescript`, `p/react`) | patrones inseguros, XSS, secretos en código |
| Código muerto | **knip** | archivos/exports/deps sin usar |
| Duplicación | **jscpd** (`.jscpd.json`) | bloques copiados |
| Arquitectura | **dependency-cruiser** (`.dependency-cruiser.cjs`) | ciclos, huérfanos, deps de dev en runtime |
| Versiones | **syncpack** | versiones divergentes entre workspaces |
| Mensajes | **commitlint** (sólo en PR, con rango) | commits en formato conventional (evita mensajes basura; habilita release/changelog); se exceptúan los merge commits y los commits del runner de historias (`MSF-123: F-XXX-01 · título`, formato exacto del runner) |
| Mensajes | **commitlint** (sólo en PR, con rango) | commits en formato conventional (evita mensajes basura; habilita release/changelog) |

Si una herramienta no está disponible, el check se **saltea** con aviso (no rompe).

## Estado

- **No bloqueante** por ahora (`continue-on-error: true` en `.github/workflows/quality.yml`). Cuando el
  baseline esté limpio, se quita y `quality` pasa a **check requerido** junto con `database`.
- Baseline medido (2026-10-18, `origin/main`): gitleaks **22 hallazgos, todos ejemplos/placeholders**
  (0 reales); jscpd **0,44%**; knip **1** (`useFeatureHabilitada`); sin ciclos.

## Tests web: timeouts

`apps/web/vite.config.ts` fija `testTimeout: 15000` (el default de vitest es 5 s). La suite
completa tarda ~30 min y corre en runners compartidos con los agentes: con 5 s, un test
lento falla por timeout aunque la lógica esté bien (MSF-189: `CuentaCobroDialog`, 874/875
tests OK, 1 timeout). 15 s sigue acotando un cuelgue real, pero evita el falso rojo que
obligaba a re-ejecutar el shard completo. Si un test necesita más, se le pasa el timeout
explícito en el propio test.

## Roadmap del programa
F1 (esto) · F2 fitness functions + observabilidad (Grafana/Prometheus) · F3 errores/backups/secretos ·
F4 release/preview/flags · F5 mutation/a11y/perf.
