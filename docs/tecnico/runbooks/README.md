---
owner: producto
sources: []
---

# Runbooks

Procedimientos para incidentes y operaciones. Cada alerta/trigger debe apuntar a un runbook concreto (convención: `runbook_url` en la regla de alerta). Si no hay alerta, el runbook igual sirve para la guardia.

| Runbook | Cuándo |
|---|---|
| [Deploy fallido](deploy-fallido.md) | El deploy a DEV/STG/PRD falla o queda a medias |
| [Restaurar base](db-restore.md) | Corrupción, borrado o pérdida de datos |
| [CI trabado](ci-trabado.md) | Un job no arranca, queda en cola o el merge no avanza |
| [Supabase caído](supabase-caido.md) | El panel no responde o Auth/Postgres/Storage fallan |
| [Cola de eventos trabada](cola-eventos.md) | Los workers no procesan o el outbox crece |

## Reglas

- **Dueño:** cada runbook tiene un responsable (equipo/persona).
- **Verificación:** termina con un chequeo concreto (health, query, test).
- **Dry-run:** los pasos destructivos se ensayan en staging antes de PRD.
- **Postmortem:** si hubo impacto, se abre un incidente con timeline y acciones.
