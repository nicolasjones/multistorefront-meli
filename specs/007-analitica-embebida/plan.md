# Implementation Plan: Analítica embebida por organización

**Branch**: `007-analitica-embebida` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-analitica-embebida/spec.md`

## Summary

Superset pasa de ser una herramienta interna a una funcionalidad más del
producto, pero solo del lado de la creación queda intacto: el superadmin
sigue creando reportes/datasets/charts directo en Superset, con su propio
login (Clarifications, spec 007) — no hay puente de autenticación ni
edición embebida. Lo que se construye acá es la capa que falta:

1. Un catálogo interno (`reportes`) que referencia el UUID de embedding de
   un dashboard de Superset ya preparado por el superadmin.
2. Asignación de un reporte a una, varias o todas las organizaciones, con
   visibilidad por rol que se hereda del default global al momento de
   asignarse (congelada — FR-004) y que el admin de cada organización puede
   ajustar después para la suya (FR-005), sin poder tocar nunca el acceso
   incondicional de `administrador` (FR-006, garantizado por un `check`
   de esquema, no solo por UI).
3. Una Edge Function que emite un guest token de Superset con la
   organización de quien lo pide forzada en su cláusula `rls` — la
   autorización (¿esta organización y este rol pueden ver este reporte?)
   se resuelve dejando que la propia RLS de Postgres filtre la consulta,
   no duplicando esa lógica en JavaScript.
4. Una pantalla de Refine que embebe el reporte con
   `@superset-ui/embedded-sdk`, con el mensaje de "analítica no disponible"
   (Clarifications) como único fallback visible.

El aislamiento de datos real sigue viviendo en Postgres (RLS) igual que el
resto del producto — Superset solo aplica el filtro que la Edge Function le
manda armado, nunca decide por su cuenta qué organización es cuál.

## Technical Context

**Language/Version**: SQL (migración Postgres + pgTAP), TypeScript/Deno
(Edge Function), TypeScript/React (Refine, `apps/web`).

**Primary Dependencies**: Supabase (Postgres, RLS, RPC `security definer`,
Edge Functions) — todo ya en el repo; `@superset-ui/embedded-sdk` (nuevo,
`apps/web`); Superset REST API (`/api/v1/security/login`,
`/api/v1/security/guest_token/`) consumida solo desde la Edge Function, con
credenciales de una cuenta de servicio dedicada (no la cuenta interactiva
del superadmin). Sin frameworks de agentes ni herramientas nuevas fuera de
esto — ver research.md para el detalle de cada decisión.

**Storage**: Postgres vía Supabase — 5 tablas nuevas (`reportes`,
`reportes_roles_default`, `reportes_organizaciones`,
`reportes_organizaciones_roles`, `eventos_reportes`), ninguna modifica
esquema existente. Ver data-model.md.

**Testing**: pgTAP nuevo (`supabase/tests/database/analitica_embebida.test.sql`)
para RLS y permisos de las RPCs — obligatorio por tratarse de aislamiento
multi-tenant (constitución, Technology and Quality Gates). Sin tests nuevos
de Edge Function ni del embed SDK: mismo criterio que las specs 003/004 (no
hay tests de función ya en el repo para `crear-organizacion` ni
`invitar-miembro`, y mockear un SDK de terceros completo no aporta
señal) — la validación de esa parte es manual, ver quickstart.md. Sí se
agregan un par de tests de Vitest para el componente de la grilla de
permisos y el estado vacío/fallback, que sí son lógica propia.

**Target Platform**: el mismo stack ya operativo — Refine local/Vercel,
Supabase local/Cloud, Superset local/VPS (ya desplegado, solo se reconfigura).

**Project Type**: extensión del monorepo existente, sin producto ni Compose
nuevo — Superset ya está en `infra/superset/`.

**Performance Goals**: N/A — no hay volumen ni latencia crítica declarada en
la spec; el guest token es de vida corta por diseño de Superset, no hay
requisito propio que ajustar.

**Constraints**: cualquier dataset de Superset que un reporte use para esta
funcionalidad DEBE tener una columna `organizacion_id` con los mismos
valores que `organizaciones.id` — es el campo sobre el que la Edge Function
arma la cláusula `rls` del guest token (research.md). Es una convención de
autoría que el superadmin sigue al construir datasets en Superset, no algo
que este código valide — está fuera del alcance de esta spec (Assumptions).

**Scale/Scope**: 1 migración (5 tablas, 2 funciones `private`, 1 trigger, 5
RPCs `public`), 1 Edge Function nueva, 4 pantallas de Refine, 2 hooks, 1
componente de embed con fallback, 1 archivo pgTAP, cambios de configuración
en `infra/superset/superset_config.py` (feature flag + CORS) sin tocar su
Compose.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: PASS. Las 5 tablas
  nuevas tienen RLS activado; las mutaciones pasan exclusivamente por RPCs
  `security definer` (patrón endurecido de la spec 005 —
  `revoke all ... from anon, authenticated; grant select ...` — ver
  research.md sobre por qué se replica en vez de importarse). El
  aislamiento hacia Superset (qué datos ve cada organización dentro de un
  reporte compartido) se fuerza server-side en la cláusula `rls` del guest
  token, nunca confiando en un parámetro del cliente (FR-010). Lleva pgTAP
  nuevo, no solo revisión manual.
- **Principio II (Especificar antes de implementar)**: cumplido — spec
  clarificada (2 preguntas) antes de este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**:
  `asignar_reporte`/`desasignar_reporte` son idempotentes (`on conflict do
  nothing` / verificación de fila antes de auditar — no se duplica el
  evento si no hubo cambio real). `eventos_reportes` registra actor, acción
  y detalle de cada asignación y cambio de visibilidad (FR-012, SC-004).
- **Principio IV (Un monorepo, despliegues independientes)**: sin cambios —
  todo entra en `supabase/` y `apps/web/`; Superset se reconfigura
  (`infra/superset/superset_config.py`), no se agrega un producto nuevo.
- **Principio V (Simplicidad operativa)**: PASS — no se agrega infra nueva,
  se activa una capacidad ya presente (Superset embebido) recién ahora que
  existe el caso de uso de negocio, tal como pide la constitución.
- **Migraciones aditivas o reversibles (Delivery Workflow, 1.4.0)**: la
  migración de esta spec solo crea tablas y funciones nuevas — ninguna
  altera ni destruye una tabla existente. PASS.

**Resultado**: PASS. Sin violaciones que requieran justificación.

**Re-chequeo post-diseño (Fase 1)**: data-model.md, contracts/ y
quickstart.md no introdujeron ninguna tabla, policy ni producto adicional
más allá de lo previsto arriba — se mantiene PASS sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/007-analitica-embebida/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── contracts/           # Fase 1 (RPCs de gestión + Edge Function de acceso)
├── quickstart.md        # Fase 1
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_analitica_embebida.sql
│       # tablas: reportes, reportes_roles_default, reportes_organizaciones,
│       #   reportes_organizaciones_roles, eventos_reportes
│       # funciones private: rol_id(), puede_gestionar_reportes(organizacion_id),
│       #   heredar_roles_default_reporte() (trigger AFTER INSERT)
│       # RPCs public (security definer): registrar_reporte,
│       #   establecer_roles_default_reporte, asignar_reporte,
│       #   desasignar_reporte, establecer_roles_reporte_organizacion
│       # RLS + grants: patrón endurecido (spec 005) — solo SELECT directo,
│       #   mutaciones únicamente vía RPC
├── functions/
│   ├── emitir-acceso-reporte/
│   │   └── index.ts        # nuevo — guest token con rls forzada
│   └── .env.example         # nuevo — SUPERSET_URL, SUPERSET_GUEST_TOKEN_USERNAME,
│                             #   SUPERSET_GUEST_TOKEN_PASSWORD (no se commitea el .env real)
└── tests/database/
    └── analitica_embebida.test.sql   # nuevo, pgTAP

infra/superset/
└── superset_config.py   # + FEATURE_FLAGS EMBEDDED_SUPERSET, CORS, GUEST_TOKEN_JWT_SECRET

apps/web/src/
├── lib/
│   └── recursosDependientesDeOrganizacion.ts   # agrega 'analitica' (mismo criterio que 'clientes')
├── hooks/
│   └── useReportesAsignados.ts    # nuevo — reportes visibles para el usuario actual
├── components/
│   └── ReporteEmbebido.tsx        # nuevo — pide el guest token, monta el SDK, fallback FR-015
├── pages/analitica/
│   ├── list.tsx                    # US2 — reportes asignados a mi organización
│   ├── administrar.tsx             # US1 — catálogo del superadmin + asignación + default
│   └── permisos.tsx                # US3 — grilla de roles por reporte, admin de organización
└── App.tsx                          # wiring: resources + rutas nuevas
```

**Structure Decision**: se reutiliza la estructura ya establecida
(`apps/web/src`, `supabase/migrations`, `supabase/functions`,
`supabase/tests/database`) de las specs 003-004 — no hace falta ninguna
carpeta nueva a nivel de repo. `infra/superset/` ya existe; esta spec solo
edita su archivo de configuración, no su Compose.

## Complexity Tracking

*Sin violaciones — sección no aplica.*
