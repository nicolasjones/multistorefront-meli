---
sources:
  - .github/workflows
  - infra
---

# Operación

## Deploy

- **DEV:** merge a la rama de deploy del producto (en MSF, `dokploy`); Dokploy reconstruye.
- **STG/PRD:** promoción con aprobación humana; el flujo actualiza `Deployment Status`.
- **Panel de control:** el orquestador corre en VPS1 (Dokploy, proyecto SDLC).
- Referencia: **[Deployment](../deployment.md)** y **[Ambientes](../ambientes-verificacion.md)**.

## CI

- `Validate`: docs, lint, tests, pgTAP, build, e2e público.
- `quality`: secretos, SAST, dead code, duplicación, arquitectura, versiones, commitlint.
- `nightly`: regresiones y chequeos programados.
- **Regla:** no se mergea con un check **requerido** en rojo; los no requeridos no frenan el merge pero se miran.

## Backups y recuperación

- Backups de Postgres/volúmenes y copia offsite; ensayo de restauración mensual.
- Referencia: **[CI self-hosted y storage](../ci-self-hosted-storage.md)** y la documentación de infra.

## Analítica

- Superset para dashboards; los dashboards se exportan a YAML y se versionan.
- Referencia: **[Operar Superset](../operar-superset.md)**.

## E2E y evidencia

- Playwright graba **video + traza**; en el visor → **Grabaciones** se abre el reporte HTML.
- Los recorridos con sesión requieren Supabase local o DEV con credenciales.
- Referencia: **[E2E de la app](../e2e-app.md)**.

## Documentación y diagramas

- `pnpm docs:wiki:check` valida el sitio y el inventario; `pnpm docs:manifest` y `pnpm docs:drift` verifican que cada página no quedó vieja respecto de sus fuentes.
- Los diagramas Archify se sirven en el visor → **Diagramas**.
- Un cambio de código/datos que no actualice su doc debe fallar el check (o quedar como deuda con dueño).
