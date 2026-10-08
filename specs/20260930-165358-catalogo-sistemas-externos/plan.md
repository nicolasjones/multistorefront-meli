# Implementation Plan: Catálogo real para sistema_externo en conexiones

**Branch**: `nicolasjones/catalogo-sistemas-externos` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/20260930-165358-catalogo-sistemas-externos/spec.md`

## Summary

`conexiones.sistema_externo` (spec 013) es hoy `text not null` sin catálogo ni
check. Se agrega una tabla catálogo `sistemas_externos` (mismo patrón que
`roles_organizacion`: `id text primary key`, `descripcion text not null`,
RLS de solo lectura para `authenticated`) y una foreign key `NOT VALID` desde
`conexiones.sistema_externo` hacia ella. `NOT VALID` en vez de una FK
validada de entrada porque esta migración viaja a productos derivados vía
`git merge upstream/main` (regla de CLAUDE.md sobre mecanismos de plataforma
reutilizables) y algún fork puede ya tener filas de negocio en `conexiones`
cuyo `sistema_externo` todavía no tiene fila en el catálogo (vacío al momento
de esta migración) — la migración no puede bloquearse por datos que no
controla. El catálogo se crea vacío: cargar valores reales es responsabilidad
de cada producto derivado, en su propia migración.

## Technical Context

**Language/Version**: SQL (PostgreSQL, vía Supabase CLI) — sin cambios de
lenguaje de aplicación.

**Primary Dependencies**: Supabase Postgres (extensión `pgtap` ya habilitada
para tests). Ninguna dependencia nueva.

**Storage**: PostgreSQL (Supabase). Una tabla nueva (`sistemas_externos`) y
una constraint nueva sobre `conexiones` existente.

**Testing**: pgTAP (`supabase/tests/database/*.test.sql`), vía `pnpm test`
con `pnpm dev:supabase` corriendo.

**Target Platform**: Supabase Cloud (producción) / Supabase CLI local
(desarrollo) — sin cambio de plataforma.

**Project Type**: migración de esquema de plataforma (sin superficie nueva en
`apps/web` ni `workers/`).

**Performance Goals**: N/A — tabla catálogo de cardinalidad baja (decenas de
filas como máximo, igual que `roles_organizacion`), sin impacto de
rendimiento medible.

**Constraints**: la migración MUST aplicarse sin error tanto si `conexiones`
está vacía (este template) como si ya tiene filas cuyo `sistema_externo` no
resuelve contra el catálogo (forks). Ninguna columna o tabla existente se
destruye en este PR (constitución, Technology and Quality Gates).

**Scale/Scope**: una tabla nueva, una constraint nueva, cero pantallas,
actualización de fixtures en los tests pgTAP existentes que ya insertan
`conexiones` con `sistema_externo` de prueba.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principio I (Aislamiento multi-tenant por diseño)**: `sistemas_externos`
  es un catálogo de plataforma sin `organizacion_id` (igual que
  `roles_organizacion`) — no hay datos de una organización que aislar de
  otra. RLS habilitado igual: `select` para cualquier `authenticated`, sin
  policy de escritura (nadie escribe vía RLS; el alta de valores queda fuera
  de alcance, ver spec Assumptions).
- **Principio II (Especificar antes de implementar)**: cubierto por
  `spec.md` de esta feature.
- **Principio III (Automatizaciones idempotentes y auditables)**: no aplica
  — no hay workflow ni worker nuevo, es una tabla catálogo estática.
- **Principio IV (Un monorepo, despliegues independientes)**: cambio
  contenido en `supabase/migrations`; no toca Refine, Kestra ni Superset.
- **Principio V (Simplicidad operativa)**: sin infraestructura nueva.
- **Principio VI (Panel operable y extensible)**: no aplica — no hay
  pantalla nueva en el panel (alta/gestión del catálogo queda fuera de
  alcance).
- **Migraciones aditivas o reversibles (Technology and Quality Gates)**: la
  migración solo crea la tabla `sistemas_externos` y agrega una constraint
  `NOT VALID` sobre `conexiones.sistema_externo` — no se destruye ni
  modifica ninguna columna ni tabla existente. Reversión documentada en
  `data-model.md` y en el comentario de cabecera de la migración (drop en
  orden inverso).
- **Prueba de aislamiento (Technology and Quality Gates)**: no aplica en el
  sentido estricto de RLS multi-tenant (el catálogo no tiene
  `organizacion_id`), pero se agrega un test pgTAP dedicado que prueba la
  integridad referencial nueva (FK) y la policy de solo lectura — ver
  `quickstart.md`.
- **Documentación como parte del cambio (Principio VII)**: esta misma spec
  (`specs/20260930-165358-catalogo-sistemas-externos/`) es la documentación
  requerida por `pnpm docs:check` para el cambio en `supabase/migrations`.

**Resultado**: PASS. Sin violaciones que requieran justificación — no hace
falta la sección de Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/20260930-165358-catalogo-sistemas-externos/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

Sin `contracts/`: esta spec no agrega ni cambia ninguna RPC ni endpoint — la
firma de `public.crear_conexion(uuid, text, text)` no cambia, solo su
comportamiento interno (ahora puede fallar por FK). El contrato relevante ya
documentado en spec 013
(`specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md`)
sigue vigente sin modificación.

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_catalogo_sistemas_externos.sql   # tabla + FK NOT VALID + RLS + grants
└── tests/
    └── database/
        ├── catalogo_sistemas_externos.test.sql       # nuevo: FK, select policy, sin escritura
        ├── orquestacion_multi_organizacion.test.sql  # fixture: catalogar 'sistema-de-prueba'
        ├── ciclo_ejecuciones_workers.test.sql         # fixture: catalogar 'sistema-x', 'sistema-y', 'sistema-x-inactivo'
        ├── conexion_invalida_trabada.test.sql         # fixture: catalogar 'sistema-trabado'
        ├── ejecucion_en_curso_worker.test.sql         # fixture: catalogar 'sistema-en-curso'
        └── outbox_ejecuciones.test.sql                # fixture: catalogar 'outbox-x', 'outbox-y'
```

**Structure Decision**: único directorio afectado es `supabase/` (migración +
tests pgTAP). No hay `apps/web` ni `workers/` en esta spec (Delivery scope:
`supabase`, ver `spec.md`). Los 5 archivos de test existentes que insertan
`conexiones` directo con un `sistema_externo` de prueba (`ciclo_ejecuciones_workers`,
`conexion_invalida_trabada`, `ejecucion_en_curso_worker`, `outbox_ejecuciones`,
`orquestacion_multi_organizacion`) necesitan una fila de fixture nueva en la
tabla catálogo antes de esa inserción — la FK, aunque es `NOT VALID` para
datos preexistentes, sigue aplicando a toda fila nueva insertada después de
crearse. Esas filas de fixture son datos de prueba de este template
(`'sistema-de-prueba'`, `'sistema-x'`, etc.), no valores de negocio reales —
no violan el alcance "plataforma pura, sin nombres de sistemas externos
reales" de la spec.

## Complexity Tracking

*No aplica — Constitution Check no encontró violaciones.*
