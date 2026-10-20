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
| Mensajes | **commitlint** (sólo en PR, con rango) | commits en formato conventional (evita mensajes basura; habilita release/changelog); se exceptúan los merge commits y los commits del runner de historias (`MSF-123: título`) |

Si una herramienta no está disponible, el check se **saltea** con aviso (no rompe).

## Estado

- **No bloqueante** por ahora (`continue-on-error: true` en `.github/workflows/quality.yml`). Cuando el
  baseline esté limpio, se quita y `quality` pasa a **check requerido** junto con `database`.
- Baseline medido (2026-10-18, `origin/main`): gitleaks **22 hallazgos, todos ejemplos/placeholders**
  (0 reales); jscpd **0,44%**; knip **1** (`useFeatureHabilitada`); sin ciclos.

## Roadmap del programa
F1 (esto) · F2 fitness functions + observabilidad (Grafana/Prometheus) · F3 errores/backups/secretos ·
F4 release/preview/flags · F5 mutation/a11y/perf.
