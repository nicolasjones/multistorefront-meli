# Implementation Plan: Panel de funcionalidades por organización

**Branch**: `009-panel-de-funcionalidades` | **Date**: 2026-09-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-panel-de-funcionalidades/spec.md`

## Summary

Generaliza el patrón ya validado en la spec 007 (catálogo + asignación por
organización + auditoría, aplicado ahí solo a reportes de Superset) a un
mecanismo genérico de habilitación: un catálogo de funcionalidades
(`features`) que arranca vacío, una tabla de habilitación directa por
organización (`organizaciones_features`, fail-closed), auditoría
append-only (`eventos_features`), y una única función de autorización
(`private.tiene_feature`) que cualquier funcionalidad futura puede usar
tanto en su propio RLS como desde el frontend — no solo para ocultar UI.

A diferencia de 007, esta spec no entrega ninguna funcionalidad de
negocio real: entrega el mecanismo. El catálogo se puebla exclusivamente
por migraciones de specs futuras (`registrar_feature`), nunca por una
pantalla de alta — y no se conecta a ninguna pantalla existente del
producto (clientes, miembros, analítica, perfil).

## Technical Context

**Language/Version**: SQL (migración Postgres + pgTAP),
TypeScript/React (Refine, `apps/web`).

**Primary Dependencies**: Supabase (Postgres, RLS, RPC `security
definer`) — todo ya en el repo. Sin librerías nuevas, sin Edge Function
(no hay integración externa en esta spec, a diferencia de 007).

**Storage**: Postgres vía Supabase — 3 tablas nuevas (`features`,
`organizaciones_features`, `eventos_features`), ninguna modifica esquema
existente. Ver data-model.md.

**Testing**: pgTAP nuevo
(`supabase/tests/database/panel_de_funcionalidades.test.sql`) obligatorio
por tratarse de aislamiento multi-tenant (constitución, Technology and
Quality Gates) — réplica deliberada de los tres bugs de aislamiento
reales ya encontrados en 007 (research.md #6, data-model.md de esa spec).
Vitest puntual para `GrillaFeaturesPorOrganizacion.tsx` (togglear una
celda dispara la RPC correcta) y el estado vacío del catálogo (FR-013).

**Target Platform**: el mismo stack ya operativo — Refine local/Vercel,
Supabase local/Cloud. Sin Kestra ni Superset (alcance de entrega:
`refine | supabase`).

**Project Type**: extensión del monorepo existente, sin producto ni
Compose nuevo.

**Performance Goals**: N/A — no hay volumen ni latencia crítica declarada
en la spec; el catálogo y las habilitaciones son de escala chica por
diseño (un puñado de organizaciones y funcionalidades).

**Constraints**: ninguna funcionalidad futura queda obligada
automáticamente a usar este mecanismo — es responsabilidad de esa spec
futura llamar a `private.tiene_feature`/`useFeatureHabilitada` desde su
propio RLS y su propia UI (research.md, Assumptions de spec.md). Una
funcionalidad futura implementada fuera de Refine/Supabase (por ejemplo,
un flow de Kestra) debe consultar `organizaciones_features` por su cuenta
al arrancar — no hay integración automática con productos fuera de este
alcance de entrega.

**Scale/Scope**: 1 migración (3 tablas, 2 funciones `private`, 4 RPCs
`public`), 1 pantalla nueva de Refine (superadmin-only), 1 componente de
grilla nuevo, 1 hook nuevo, cambios puntuales en
`accessControlProvider.ts` y `SiderConSeccionesSuperadmin.tsx`, 1 archivo
pgTAP.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: PASS. Las 3
  tablas nuevas tienen RLS activado; las mutaciones pasan exclusivamente
  por RPCs `security definer` (mismo patrón endurecido de la spec 007).
  `organizaciones_features` usa `private.puede_ver_feature_organizacion`
  (compara `organizacion_id` de la fila), nunca `private.tiene_feature`
  (research.md #6) — evita a propósito el mismo tipo de bug de
  aislamiento ya encontrado y corregido en 007. Lleva pgTAP nuevo, no solo
  revisión manual.
- **Principio II (Especificar antes de implementar)**: cumplido — spec
  clarificada (1 pregunta, sobre el estado vacío del catálogo) antes de
  este plan.
- **Principio III (Automatizaciones idempotentes y auditables)**:
  `habilitar_feature`/`deshabilitar_feature` son idempotentes (`on
  conflict do nothing` / verificación de fila antes de auditar — mismo
  patrón que `asignar_reporte`/`desasignar_reporte`, FR-012).
  `eventos_features` registra actor, acción y organización de cada
  cambio (FR-005, SC-003).
- **Principio IV (Un monorepo, despliegues independientes)**: sin
  cambios — todo entra en `supabase/` y `apps/web/`; no se agrega
  producto ni Compose nuevo.
- **Principio V (Simplicidad operativa)**: PASS — no se agrega infra
  especulativa. Se evaluó explícitamente integrar una herramienta externa
  de feature flags (research.md #5) y se descartó: resolvería un problema
  más grande del que hace falta, y de todas formas requeriría sincronizar
  su resultado hacia esta misma base para protegerlo con RLS. Tampoco se
  agrega la capa de "planes" (research.md #3) sin un caso de negocio real
  todavía.
- **Migraciones aditivas o reversibles (Delivery Workflow, 1.4.0)**: la
  migración de esta spec solo crea tablas y funciones nuevas — ninguna
  altera ni destruye algo existente. Lleva comentario de reversión
  explícito (data-model.md). PASS.

**Resultado**: PASS. Sin violaciones que requieran justificación.

**Re-chequeo post-diseño (Fase 1)**: data-model.md, contracts/ y
quickstart.md no introdujeron ninguna tabla, policy ni producto adicional
más allá de lo previsto arriba — se mantiene PASS sin cambios. La única
corrección respecto al diseño inicial (visibilidad de `features`
restringida en vez de abierta a cualquier `authenticated`, research.md
#4) refuerza el Principio I, no lo debilita.

## Project Structure

### Documentation (this feature)

```text
specs/009-panel-de-funcionalidades/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md         # Fase 1
├── contracts/            # Fase 1 (RPCs de gestión)
├── quickstart.md         # Fase 1
└── tasks.md              # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_panel_de_funcionalidades.sql
│       # tablas: features, organizaciones_features, eventos_features
│       # funciones private: tiene_feature(feature_id),
│       #   puede_ver_feature_organizacion(feature_id, organizacion_id)
│       # RPCs public (security definer): registrar_feature,
│       #   habilitar_feature, deshabilitar_feature, tiene_feature_publica
│       # RLS + grants: mismo patrón endurecido que 007 — solo SELECT
│       #   directo, mutaciones únicamente vía RPC
└── tests/database/
    └── panel_de_funcionalidades.test.sql   # nuevo, pgTAP

apps/web/src/
├── lib/
│   ├── features.ts                          # nuevo — checkFeatureHabilitada(featureId)
│   └── recursosCondicionadosAFeature.ts      # nuevo — mapa resource → featureId
├── hooks/
│   └── useFeatureHabilitada.ts               # nuevo — mismo esqueleto que useIsSuperadmin
├── components/
│   └── GrillaFeaturesPorOrganizacion.tsx     # nuevo — grilla organización×feature con Switch
├── pages/features/
│   └── administrar.tsx                       # nuevo — pantalla superadmin-only (US1)
├── providers/accessControlProvider.ts        # + rama para recursos condicionados a feature
├── components/SiderConSeccionesSuperadmin.tsx # + 'features-administrar' a RECURSOS_EXCLUSIVOS_SUPERADMIN
└── App.tsx                                    # wiring: resource + ruta nueva
```

**Structure Decision**: se reutiliza la estructura ya establecida
(`apps/web/src`, `supabase/migrations`, `supabase/tests/database`) de las
specs 003-008 — no hace falta ninguna carpeta nueva a nivel de repo. Sin
`supabase/functions/` nuevo (no hay integración externa en esta spec).

## Complexity Tracking

*Sin violaciones — sección no aplica.*
