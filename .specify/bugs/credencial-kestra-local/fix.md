# Bug Fix: credencial local de Kestra reproducible

- **Slug**: credencial-kestra-local
- **Fixed**: 2026-09-25
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se agregó una sincronización local explícita del rol JDBC de Kestra con el
entorno ignorado. Así, la contraseña configurada para el contenedor coincide
con la del rol sin introducirla en una migración ni imprimirla.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `infra/kestra/sincronizar-rol-orquestacion.mjs` | added | Reconcilia el rol por stdin y exige la variable de entorno. |
| `package.json` | modified | Expone `pnpm kestra:sincronizar-rol-local`. |
| `infra/kestra/sincronizar-rol-orquestacion.test.mjs` | added | Fija el rechazo seguro de un entorno incompleto. |
| `docs/adoptar-tooling-typescript.md` | modified | Documenta el paso previo al E2E local. |

## Tests Added or Updated

- `infra/kestra/sincronizar-rol-orquestacion.test.mjs` — exige la variable y
  confirma que la salida no revela un valor sensible.

## Local Verification

- Commands run: `pnpm test:kestra:deploy-flow` → 4 pruebas aprobadas.
- Commands run: `pnpm infra:config:kestra` → configuración válida.
- Manual checks: `pnpm kestra:sincronizar-rol-local` con la variable del
  entorno ignorado → rol local sincronizado, sin mostrar su valor.

## Deviations from Assessment

Ninguna.

## Follow-ups

- Validar el recorrido JDBC real con `pnpm test:kestra:secretos:e2e`.
