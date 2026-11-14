# Bug Test: verificación del deploy a DEV de MSF-192

- **Slug**: msf-785-deploy-dev-msf-192
- **Resultado**: verificación de humo OK; E2E funcional completo pendiente de QA

## Humo contra DEV (https://dev.212-90-120-53.sslip.io, 2026-11-04)
| Ruta | HTTP |
|------|------|
| `/rentabilidad` | 200 |
| `/rentabilidad/costos` | 200 |
| `/rentabilidad/ventas-reales` | 200 |

## Alcance
Un 200 solo confirma que el host sirve la SPA; no sustituye al recorrido autenticado. Ese lo corre QA y deja el resultado en `Implementation Report` de MSF-192, con el E2E existente `apps/web/e2e/rentabilidad-real-reportes-roles.e2e.ts` (SC-013). Si aparece un defecto, se abre como historia nueva en MSF-192, sin reabrir la épica.
