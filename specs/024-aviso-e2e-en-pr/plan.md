# Plan: aviso de cobertura E2E en el PR

**Feature Branch**: `feat/024-aviso-e2e`

## Enfoque

1. **Grabar siempre en PR.** `E2E_VIDEO=on` en el job `application`. La suite
   pública son dos recorridos (~1 min); el costo es acotado y el beneficio es ver
   la app real en cada cambio.
2. **Un comentario, no uno por push.** `gh pr comment --edit-last
   --create-if-none`: el bot edita su último comentario del PR.
3. **Link configurable.** Variable `EVIDENCIAS_E2E_VIEWER_URL` (no hardcodear el
   host del panel: cambia entre dev/stg/prd y entre entornos locales).
4. **Best-effort.** Si falta la variable o los secretos, se omite sin fallar.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `.github/workflows/validate.yml` | `E2E_VIDEO=on` en PR; permiso `pull-requests: write`; paso de comentario |
| `docs/e2e-app.md` | Cómo se avisa y qué variable configurar |
| `specs/024-aviso-e2e-en-pr/*` | Spec, plan y tasks |

## Verificación

- Este PR: el propio job comenta el link (con la variable configurada).
- `actionlint` no disponible localmente: validación con `python -c yaml.safe_load`.
- `pnpm docs:check` y drift.
