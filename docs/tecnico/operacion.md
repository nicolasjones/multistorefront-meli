---
owner: operacion
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

- `Validate`: docs, lint, tests, pgTAP, build, e2e público; el job manual `e2e-visible-sesion` graba el recorrido con sesión y adjunta el video (ver [E2E de la app](../e2e-app.md)).
- `quality`: secretos, SAST, dead code, duplicación, arquitectura, versiones, commitlint.
- `nightly`: regresiones y chequeos programados.
- **Regla:** no se mergea con un check **requerido** en rojo; los no requeridos no frenan el merge pero se miran.

## Backups y recuperación

- Backups de Postgres/volúmenes y copia offsite; ensayo de restauración mensual.
- Referencia: **[CI self-hosted y storage](../ci-self-hosted-storage.md)** y la documentación de infra.

## Analítica

- Superset para dashboards; los dashboards se exportan a YAML y se versionan.
- Referencia: **[Operar Superset](../operar-superset.md)**.

## Avisos de consultas (MSF-122)

- El flow `avisos-consultas` (`infra/kestra/flows/avisos-consultas.yml`) corre **cada minuto**, barre
  `dominio.consultas_avisos` y llama a la Edge Function `enviar-aviso-consulta` con `{"barrer": true}`.
- Variables: `SMTP_*`, `PANEL_URL` y `AVISOS_CONSULTAS_TOKEN` en `supabase/functions/.env.example`; el token y
  la URL/clave del barrido en `infra/kestra/.env.example`. Sin secretos en Git.
- Reintentos: tope de 5 intentos y reserva de 2 minutos; un aviso `enviado` no se reenvía. Un fallo de
  correo **no** revierte la consulta.
- En local, el correo se lee en **Mailpit**. Para reprocesar a mano, invocá la función con
  `{"barrer": true}` y el header `x-aviso-token`. Detalle: [Consultas](consultas.md#aviso-por-correo).

## Migración inicial de datos (MSF-142)

- Los datos reales se cargan **solo en producción** con el asistente, por un Administrador. El repo,
  los tests y el PR usan únicamente fixtures inventados.
- El ensayo reproducible es pgTAP: `pnpm dev:supabase` y luego
  `supabase test db --local supabase/tests/database/migracion_ensayo.test.sql` (dos corridas y
  `migracion_conciliacion.test.sql`). La evidencia son las líneas `# EVIDENCIA corrida 1/2: {...}`;
  el CI las corre con `pnpm test:db`.
- Antes del corte: Catálogo cargado, stock inicial por F-STK-07, export CSV UTF-8 del panel anterior,
  copia de seguridad verificada y ensayo en verde. Orden: clientes → proveedores → vínculos →
  archivo de ingresos; se lee el informe de conciliación después de cada carga.
- Reintentar la misma carga no duplica (idempotencia por `(carga, fila)` e identificador externo). La
  vuelta atrás completa es restaurar la copia previa.
- Detalle: [Migración inicial de datos](migracion-inicial-de-datos.md) y
  [plan de corte](../producto/migracion-inicial-de-datos.md#el-dia-del-corte).

## E2E y evidencia

- Playwright graba **video + traza**; en el visor → **Grabaciones** se abre el reporte HTML.
- Los recorridos con sesión requieren Supabase local o DEV con credenciales.
- Referencia: **[E2E de la app](../e2e-app.md)**.

## Documentación y diagramas

- `pnpm docs:wiki:check` valida el sitio y el inventario; `pnpm docs:manifest` y `pnpm docs:drift` verifican que cada página no quedó vieja respecto de sus fuentes.
- Los diagramas Archify se sirven en el visor → **Diagramas**.
- Un cambio de código/datos que no actualice su doc debe fallar el check (o quedar como deuda con dueño).
