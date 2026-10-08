# Implementation Plan: Nombre visible entre miembros de una organización

**Branch**: `010-nombre-miembros-organizacion` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-nombre-miembros-organizacion/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Un administrador (o superadmin operando la organización) debe ver el
nombre y apellido de sus compañeros en la pantalla de miembros, en vez del
`user_id` crudo, sin que ese acceso cruce el límite de organización ni
alcance otros campos de `perfiles_usuario` (spec 008). El enfoque técnico
es una función `security definer` puntual — `listar_miembros_organizacion()`
— que arma el listado (`user_id`, `rol_id`, `created_at`, `nombre`,
`apellido`) de la organización efectiva del llamador (`private.organizacion_id()`,
ya resuelve el caso superadmin de spec 003/004) sin tocar las policies RLS
existentes de `perfiles_usuario` ni de `usuarios_organizacion`. La pantalla
de miembros (`apps/web/src/pages/miembros/list.tsx`) consume esta función en
vez de `useTable` sobre `usuarios_organizacion`, y muestra un texto
explícito ("Sin nombre completado") cuando falta el dato.

## Technical Context

**Language/Version**: TypeScript 5 (React 18, Refine) para `apps/web`; PL/pgSQL para Supabase.

**Primary Dependencies**: Refine (`@refinedev/core`, `@refinedev/mui`), `@supabase/supabase-js`, MUI.

**Storage**: PostgreSQL (Supabase) — tablas existentes `perfiles_usuario` (spec 008) y `usuarios_organizacion` (spec 003); ninguna tabla nueva.

**Testing**: `pgTAP` (`supabase/tests/database/*.test.sql`, vía `pnpm test` + `pnpm dev:supabase`) para RLS/función; Vitest + Testing Library (`apps/web/src/**/*.test.tsx`) para la pantalla de miembros.

**Target Platform**: Web (SPA Refine servida en `apps/web`).

**Project Type**: Web application dentro del monorepo (frontend `apps/web` + Supabase).

**Performance Goals**: N/A — no hay requisito de throughput; el listado de miembros ya pagina/limita por organización (decenas de filas típicas).

**Constraints**: Aislamiento multi-tenant estricto (Principio I): el acceso ampliado a nombre/apellido no debe traspasar el límite de organización ni alcanzar otros campos de `perfiles_usuario` (FR-002, FR-005).

**Scale/Scope**: Un endpoint de lectura (función RPC) + un componente de pantalla existente modificado; sin nuevas tablas ni pantallas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Aislamiento multi-tenant por diseño**: la función nueva es
  `security definer` pero replica el mismo filtro que ya usan
  `clientes_select`, `panel_de_funcionalidades` y `analitica_embebida`:
  `organizacion_id = private.organizacion_id()`; además solo responde si
  el llamador cumple `private.puede_gestionar_membresias()` (administrador
  o superadmin activo), devolviendo conjunto vacío si no — el control de
  acceso vive en la función, no solo en el frontend. No se relaja RLS de
  `perfiles_usuario` (sigue self-only) ni se otorgan columnas nuevas al rol
  `authenticated` sobre esa tabla — cumple.
- **II. Especificar antes de implementar**: spec 010 ya aprobada y
  clarificada (sesión 2026-09-12); este plan no agrega alcance de negocio
  nuevo, solo el mecanismo técnico para lo ya especificado — cumple.
- **III. Automatizaciones idempotentes y auditables**: es una función de
  solo lectura (`stable`/`security definer`, sin efectos secundarios); no
  aplica auditoría de escritura — cumple, no introduce riesgo nuevo.
- **IV. Un monorepo, despliegues independientes**: cambios contenidos en
  `apps/web` y `supabase/migrations` — cumple.
- **V. Simplicidad operativa**: no se agrega infraestructura; una función
  SQL adicional y un cambio de fuente de datos en una pantalla existente —
  cumple.
- **Migraciones aditivas**: la migración solo agrega una función nueva
  (`create function`) y su `grant execute`; no modifica ni elimina policies,
  columnas ni tablas existentes. Reversión: `drop function` — cumple el
  gate de camino de reversión explícito.

Sin violaciones. No aplica Complexity Tracking.

### Nota: sin precondición pendiente sobre `usuarios_organizacion`

La pantalla de miembros ya es exclusiva de quien administra membresías
(spec 005, Clarifications de spec 010) — `usuarios_organizacion_select`
ya deja ver a esa persona todas las filas de su organización vía
`private.puede_gestionar_membresias()`. `listar_miembros_organizacion()`
no necesita ampliar ningún acceso sobre esa tabla: solo agrega el `left
join` a `perfiles_usuario` (self-only hoy) para traer `nombre`/`apellido`,
que es la única regla de acceso que esta spec efectivamente cambia
(FR-001). Ver `research.md`.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── <timestamp>_nombre_miembros_organizacion.sql   # función listar_miembros_organizacion()
└── tests/
    └── database/
        └── nombre_miembros_organizacion.test.sql       # pgTAP: aislamiento + fallback

apps/web/src/
└── pages/
    └── miembros/
        ├── list.tsx        # reemplaza useTable(usuarios_organizacion) por la RPC nueva
        └── list.test.tsx   # casos: nombre visible, fallback "Sin nombre completado"
```

**Structure Decision**: Se reutiliza la estructura ya existente del monorepo
(`supabase/` para la función y su test pgTAP, `apps/web/src/pages/miembros/`
para la pantalla ya implementada por la spec 005). No se crean paquetes,
carpetas ni productos nuevos — solo una migración aditiva y una edición de
componente existente.

## Constitution Check (post-diseño)

Tras `research.md`, `data-model.md` y `contracts/listar-miembros-organizacion.md`:
el diseño final no agregó tablas, no tocó ninguna policy existente y
mantuvo la función nueva acotada a `nombre`/`apellido` + las columnas de
`usuarios_organizacion` ya visibles hoy para quien administra membresías.
Los gates siguen cumplidos sin cambios respecto a la evaluación inicial;
no se abre Complexity Tracking.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Sin violaciones — tabla no aplica.
