---
owner: operacion
sources:
  - infra/kestra/flows/alertas.yml
  - infra/kestra/flows/limpieza-evidencia.yml
  - infra/kestra/flows/depuracion-actividad.yml
  - infra/kestra/flows/depuracion-monitoreo.yml
  - infra/kestra/flows/purgar-api-llamadas.yml
  - infra/kestra/flows/purgar-almacenamiento-kestra.yml
  - infra/kestra/flows/retencion-copias.yml
  - infra/kestra/flows/alerta-ausencia-respaldos.yml
  - infra/kestra/compose.yaml
  - workers/CONTRATO.md
  - package.json
---

# Operar el sistema

Para el equipo técnico que mantiene los ambientes en marcha. Entregar el sistema a un
cliente o equipo nuevo: [entregar-sistema.md](entregar-sistema.md).

## Ambientes

`dev`, `stg` y `prd` corren en Dokploy (VPS2) detrás de Traefik; el desarrollo diario es local.
Detalle de URLs, flujo de promoción y GitHub Environments:
[deployment.md](deployment.md), [ambientes-verificacion.md](ambientes-verificacion.md) y
[adoptar-cicd-staging-produccion.md](adoptar-cicd-staging-produccion.md).

Cada producto tiene su Compose (`infra/<producto>/compose.yaml`; nunca un Compose raíz) y se
levanta con `pnpm dev:<producto>` / se baja con `pnpm dev:down:<producto>`:
`refine` (o `dev:refine:host` fuera de Docker), `supabase`, `kestra`, `superset`, `nango`,
`playwright`, `runner`, `mcp-server`, `glitchtip`. Validar la configuración: `pnpm infra:config`.

Los pasos de infraestructura que solo puede hacer Nicolás en el VPS2 (publicar el sitio de
docs, el orden de arranque de `tailnet-forwards`, recrear el stack Edge de dev, revocar la
clave de API de prueba) están en [pasos-manuales-vps2.md](pasos-manuales-vps2.md), con su
verificación y su reversión.

## Supabase (self-hosted)

- Es self-hosted en nuestro VPS; **no se usa Supabase Cloud** (constitución, sección de calidad).
- Todo cambio de base es una migración en `supabase/migrations`, aditiva o con reversión documentada.
- Antes de promover, `pnpm db:validar:aditivas`; los tests de base (`pnpm test:db`) requieren `pnpm dev:supabase`.
- Aislamiento por organización y RLS: [aislamiento-por-organizacion.md](aislamiento-por-organizacion.md).

## Kestra

Orquesta las automatizaciones y las copias. Los flows viven versionados en
`infra/kestra/flows/` y se publican con el workflow `publicar-flows-kestra.yml`.
Reintentos, ejecuciones y conexiones trabadas: [adoptar-ciclo-ejecuciones.md](adoptar-ciclo-ejecuciones.md).
Diseño de conectores: [disenar-conector.md](disenar-conector.md). Credenciales OAuth:
[adoptar-conexiones-oauth.md](adoptar-conexiones-oauth.md).

**Corridas perdidas tras una caída (MSF-871).** Los sondeos que corren cada 15 minutos o menos (reclamos de
outbox, avisos, monitoreos, despachadores) llevan `recoverMissedSchedules: NONE`: al volver Kestra no se
reproducen las corridas perdidas una por una (serían decenas de ejecuciones simultáneas) y la siguiente corrida
retoma lo pendiente. Los flows diarios, semanales y mensuales (respaldos, depuraciones, resumen semanal,
verificación de restauración) no lo fijan a propósito: ante una caída recuperan la corrida perdida.

## Superset

Analítica embebida; los dashboards se exportan a YAML y se commitean. Operación local:
[operar-superset.md](operar-superset.md).

## Workers

Procesos aislados en `workers/` (contrato en `workers/CONTRATO.md`). Imágenes blindadas y
sus listas de salida permitida: [adoptar-blindaje-imagenes-workers.md](adoptar-blindaje-imagenes-workers.md).
El pool de Postgres de cada worker tiene topes configurables por entorno (`WORKER_PG_STATEMENT_TIMEOUT_MS`,
`WORKER_PG_CONNECT_TIMEOUT_MS`, `WORKER_PG_IDLE_TIMEOUT_MS`; defaults 5 min, 10 s y 30 s): ver «Topes de
Postgres» en `workers/CONTRATO.md`.

## Purgas, retenciones y alertas programadas

Flows diarios de Kestra que mantienen acotado lo que crece solo (horario del servidor, verificado en `infra/kestra/flows/*.yml`; cada uno
es idempotente y falla en rojo si no puede borrar):

| Flow | Hora | Qué purga o vigila |
|---|---|---|
| `limpieza-evidencia` | 03:30 | almacenamiento interno de Kestra (capturas y logs publicados) de ejecuciones de despacho con más de `EVIDENCIA_RETENCION_DIAS` (30) |
| `depuracion-actividad` | 04:00 | eventos del registro de actividad con más de 24 meses (deja un evento «Sistema» por organización) |
| `retencion-copias` | 04:30 | copias de base e imágenes fuera de retención (ver [copias-y-restauracion.md](copias-y-restauracion.md)) |
| `depuracion-monitoreo` | 04:30 | eventos de monitoreo con más de 30 días, alertas resueltas con más de 90 y procesos masivos terminados con más de 180 |
| `purgar-api-llamadas` | 04:30 | llamadas de la API con más de `API_AUDITORIA_RETENCION_DIAS` (90), claves revocadas o vencidas y eventos de cola ya terminados |
| `purgar-almacenamiento-kestra` | 04:45 | ejecuciones de Kestra terminadas con más de `KESTRA_RETENCION_EJECUCIONES_DIAS` (7), con sus archivos |
| `alerta-ausencia-respaldos` | 06:30 | avisa por correo si no hay copia de base **y** foto de imágenes de las últimas `RESPALDOS_AUSENCIA_HORAS` (30) |

## Alertas

El subflow `platform.alertas` (`infra/kestra/flows/alertas.yml`) enruta avisos técnicos y de
credencial a un webhook (`KESTRA_ALERTAS_WEBHOOK_URL`). Los fallos de copia avisan por correo
al equipo de soporte.

## Copias y restauración

Copias de la base, de las imágenes, retención, verificación periódica y el procedimiento
guiado de restauración están en [copias-y-restauracion.md](copias-y-restauracion.md) y el simulacro en
[simulacro-restauracion.md](simulacro-restauracion.md) (pendiente de ejecución en staging).

## CI

Corre por defecto en runners self-hosted (los jobs pesados pueden ir a runners hosted con la variable `CI_RUNS_ON_PESADO`, ver [control-ci.md](control-ci.md)) ([adoptar-runners-locales.md](adoptar-runners-locales.md),
[ci-self-hosted-storage.md](ci-self-hosted-storage.md)). Validaciones locales: `pnpm lint`,
`pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm docs:check`.
