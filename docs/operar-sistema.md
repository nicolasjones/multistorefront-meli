---
owner: tecnico
sources: []
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
`playwright`, `runner`, `mcp-server`. Validar la configuración: `pnpm infra:config`.

## Supabase (self-hosted)

- Es self-hosted en nuestro VPS; **no se usa Supabase Cloud** (constitución, sección de calidad).
- Todo cambio de base es una migración en `supabase/migrations`, aditiva o con reversión documentada.
- Antes de promover, `pnpm db:validar-aditivas`; los tests de base (`pnpm test:db`) requieren `pnpm dev:supabase`.
- Aislamiento por organización y RLS: [aislamiento-por-organizacion.md](aislamiento-por-organizacion.md).

## Kestra

Orquesta las automatizaciones y las copias. Los flows viven versionados en
`infra/kestra/flows/` y se publican con el workflow `publicar-flows-kestra.yml`.
Reintentos, ejecuciones y conexiones trabadas: [adoptar-ciclo-ejecuciones.md](adoptar-ciclo-ejecuciones.md).
Diseño de conectores: [disenar-conector.md](disenar-conector.md). Credenciales OAuth:
[adoptar-conexiones-oauth.md](adoptar-conexiones-oauth.md).

## Superset

Analítica embebida; los dashboards se exportan a YAML y se commitean. Operación local:
[operar-superset.md](operar-superset.md).

## Workers

Procesos aislados en `workers/` (contrato en `workers/CONTRATO.md`). Imágenes blindadas y
sus listas de salida permitida: [adoptar-blindaje-imagenes-workers.md](adoptar-blindaje-imagenes-workers.md).

## Alertas

El subflow `platform.alertas` (`infra/kestra/flows/alertas.yml`) enruta avisos técnicos y de
credencial a un webhook (`KESTRA_ALERTAS_WEBHOOK_URL`). Los fallos de copia avisan por correo
al equipo de soporte.

## Copias y restauración

Copias de la base, de las imágenes, retención, verificación periódica y el procedimiento
guiado de restauración están en [copias-y-restauracion.md](copias-y-restauracion.md) y el simulacro en
[simulacro-restauracion.md](simulacro-restauracion.md) (pendiente de ejecución en staging).

## CI

Corre en runners self-hosted ([adoptar-runners-locales.md](adoptar-runners-locales.md),
[ci-self-hosted-storage.md](ci-self-hosted-storage.md)). Validaciones locales: `pnpm lint`,
`pnpm build`, `pnpm infra:config`, `pnpm test`, `pnpm docs:check`.
