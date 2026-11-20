# Bug Assessment: el tope de ramas con CI en vuelo del orquestador quedó en el default 2

- **Slug**: msf-903 (provisto por el usuario)
- **Created**: 2026-11-20
- **Source**: descripción del tracker (auditoría H05, severidad Media, 2026-11-13) e informe del Revisor del PR #1152.
- **Verdict**: valid (configuración del flujo desactualizada; no es un defecto de código)
- **Severity**: media

## Symptom

El orquestador frena la apertura de ramas nuevas con «el CI del repo está saturado: N rama(s) con CI en vuelo (límite 2)»
aunque el pool tiene capacidad de sobra.

## Reproduction

1. `grep CI_RANAS_MAXIMAS /opt/ai-dev-orchestrator/.env` → vacío: rige `RAMAS_CI_MAXIMAS_POR_DEFECTO = 2`
   (`packages/core/ci.js`).
2. `gh variable list` → `CI_LANES=15`, `CI_LOAD_MAX=2.5`, `CI_RUNS_ON_PESADO=["ubuntu-latest"]` (2026-11-20).
3. `gh api repos/:owner/:repo/actions/runners` → **5** runners self-hosted online (2026-11-20).
4. En `runs/poll.log` aparece el mensaje de saturación con `límite 2`.

## Root Cause Hypothesis

`CI_RANAS_MAXIMAS` vive en el `.env` del orquestador (`packages/core/ci.js`) y no está seteada en VPS2; el tope efectivo
es `min(2, runners online) = 2`. El valor no sigue al cambio de capacidad del repo (15 carriles, jobs pesados en hosted).

## Proposed Remediation

Documentar el procedimiento en `docs/control-ci.md`: subir `CI_RANAS_MAXIMAS` a 4 en el `.env` de VPS2, reiniciar
`ai-dev-gateway`, distinguir las variables de repo del producto (`CI_LANES`, `CI_LOAD_MAX`) de la del orquestador y
dejar constancia de que `CI_RANAS_MAXIMAS` falta en el `.env.example` del orquestador. Regenerar `docs/manifest.json`.

## Risks & Considerations

- No se toca `CI_LANES` ni `CI_LOAD_MAX` (fuera de alcance).
- El cambio real de configuración es una acción en el servidor (Nicolás): este PR sólo la documenta y corrige las cifras.
- Un `.env.example` del orquestador sin la variable deja a un nodo nuevo en el default 2: se anota en el procedimiento.
