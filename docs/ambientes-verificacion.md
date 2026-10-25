---
owner: tecnico
sources:
  - specs
---

# Ambientes y despliegue controlado — verificación (F-OPS-02)

Épica MSF-455, spec `20261016-120000-actividad-y-ambientes` (US2, FR-009, SC-004), tareas T016–T019.
Es una **adopción y verificación** del CI staging → producción del template
(`docs/adoptar-cicd-staging-produccion.md`); no agrega mecanismos nuevos.
Verificado el 2026-10-16 contra `nicolasjones/multistorefront-meli`.

## T016 · Environments, secretos y workflows

Los seis GitHub Environments existen y cada uno tiene sus propios secretos
(consultado con `gh api repos/{owner}/{repo}/environments/<env>/secrets`, solo
nombres; los valores no son legibles):

| Environment | Secretos |
|---|---|
| `migraciones-cloud-staging` / `-production` | `SUPABASE_DB_URL` |
| `deploy-infraestructura-vps-staging` / `-production` | `VPS_DEPLOY_ENV`, `VPS_SSH_HOST`, `VPS_SSH_PRIVATE_KEY`, `VPS_SSH_USER` |
| `publicar-flows-kestra-staging` / `-production` | `KESTRA_BASIC_AUTH_USERNAME`, `KESTRA_BASIC_AUTH_PASSWORD`, `KESTRA_PUBLIC_URL` |

Los secretos son por Environment: staging y producción no comparten ninguno.
Los workflows `migraciones-cloud.yml`, `deploy-infraestructura-vps.yml` y
`publicar-flows-kestra.yml` tienen `staging` (en `push`) y `production` (solo
`workflow_dispatch`/`workflow_call`), y `promover-todo-a-produccion.yml` los
invoca juntos.

### Supabase es siempre self-hosted

`migraciones-cloud.yml` y `pnpm db:migrar:cloud` **conservan el nombre del
template**, pero solo consumen `SUPABASE_DB_URL` del Environment: no crean
proyectos ni usan la Management API de Supabase Cloud. «cloud» es una etiqueta
heredada, no una dependencia de Supabase Cloud.

**Pendiente de confirmación humana**: el valor de `SUPABASE_DB_URL` de cada
Environment no se puede leer desde la API de GitHub. Quien administra los
secretos debe confirmar que ambos apuntan al Postgres self-hosted del VPS
(nunca a un host `*.supabase.co`) y que son distintos entre sí.

## T017 · Compuerta `verificar-staging-exitoso.mjs`

`pnpm ci:verificar-staging-exitoso` consulta los runs exitosos de `push` del
mismo workflow y rechaza (exit 1) si ninguno tiene el mismo `head_sha`. Los tres
jobs `production` la ejecutan antes de tocar secretos.

- Prueba automática: `node --test scripts/verificar-staging-exitoso.test.mjs`
  → 6/6 verdes, incluidos «rechaza cuando staging nunca corrió exitosamente para
  ese head_sha» y «rechaza cuando no hay ningún run exitoso de staging».
- Evidencia en vivo: el run de producción `38289027004` (commit `9e63409`, sin
  run de staging exitoso para ese commit) terminó en `failure` en los tres jobs
  `production`. El log ya no está disponible, así que el motivo exacto no se
  pudo releer; la prueba automática es la garantía del rechazo.

## T018 · Promoción staging → producción (evidencia)

Recorrido real sobre un mismo commit, `2411fb84c20c1af8be39559d5b4833278b6c78af`:

1. Staging, `push` a `main`: <https://github.com/nicolasjones/multistorefront-meli/actions/runs/38592333660> (success).
2. Producción, `workflow_dispatch` del mismo commit: <https://github.com/nicolasjones/multistorefront-meli/actions/runs/38592807917> (success; job `production` ejecutado, `staging` omitido).

Más reciente: el merge de la épica MSF-475 corrió staging en `38828685788`
(success). **Desvío**: no se disparó un cambio de prueba nuevo en esta historia,
porque promover a producción es una acción externa que requiere decisión humana;
la evidencia anterior cumple SC-004 con el flujo real. Al mergear la épica, el
cierre (T023) puede repetirlo.

## T019 · Aislamiento entre ambientes

- Datos: cada ambiente usa su propia instancia de Postgres (secreto
  `SUPABASE_DB_URL` distinto por Environment); la separación por organización
  dentro de una instancia la impone RLS (`docs/aislamiento-por-organizacion.md`,
  pgTAP `rls_en_toda_tabla` y `aislamiento_organizaciones`).
- Secretos: ningún secreto es de repositorio ni se comparte entre
  `-staging` y `-production`; el navegador solo recibe claves públicas.
- Datos de ejemplo: el seed de actividad es solo local (`supabase/seed.sql`),
  nunca llega a staging ni a producción.
- Limitación: que los *valores* de los secretos de staging y producción sean
  distintos solo lo puede confirmar quien los administra (ver T016).

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
