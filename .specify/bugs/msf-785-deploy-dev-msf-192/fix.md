# Bug Fix: Deploy Status de MSF-192 desactualizado

- **Slug**: msf-785-deploy-dev-msf-192
- **Status**: no aplica código (corrección de estado en el tracker)

## Summary
La re-verificación del deploy muestra que el código de MSF-192 está en DEV. No hay cambio de código, migraciones ni RLS. El campo del tracker lo corrige el Release (no el Desarrollador).

## Evidencia (2026-11-04)
- PR #669 (`epic/MSF-192-…` → `dokploy`): `MERGED`, `mergedAt 2026-11-04T01:45:37Z`, merge commit `57e29561da359d94e12b97dae96b5a04b2673271`.
- `git merge-base --is-ancestor 57e29561 origin/dokploy` → sí; `02d6634` (head de la épica) → también ancestro de `origin/dokploy`.
- CI del PR #669: `changes`, `quality`, `application`, `validacion`, `liberar` = SUCCESS; `web`, `infrastructure`, `database` = SKIPPED.
- Rutas `/rentabilidad`, `/rentabilidad/productos|comparativo|historia|ventas-reales|costos` presentes en `origin/dokploy:apps/web/src/App.tsx`.

## Valores a escribir en MSF-192 (Release)
`Deploy Status = Dev Deployed` · `Dev Deployed At = 2026-11-04T01:45:37Z`

## Tests Added or Updated
Ninguno (sin cambio de comportamiento).
