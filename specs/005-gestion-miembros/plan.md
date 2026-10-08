# Implementation Plan: Gestión de miembros de organización

**Branch**: `005-gestion-miembros` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-gestion-miembros/spec.md`

## Summary

Permitir que administradores —y superadmins solo dentro de su organización activa—
listen, incorporen, cambien de rol y remuevan miembros de una organización. La
interfaz se implementa en Refine; Supabase protege el aislamiento con RLS y
RPCs de modificación. Una Edge Function conserva el uso de la service-role
key para invitar cuentas nuevas por correo; las cuentas existentes sin
membresía se vinculan directamente, sin reenviar correo. Todas las operaciones
efectivas quedan auditadas y las mutaciones no pueden dejar una organización
sin administrador.

## Technical Context

**Language/Version**: TypeScript 6.0 (Refine/Vite) y TypeScript sobre Deno 2 (Supabase Edge Functions); SQL PostgreSQL 17

**Primary Dependencies**: React 18, Refine 5, Material UI 6, `@supabase/supabase-js` 2 y Supabase CLI 2

**Storage**: Supabase Postgres (`usuarios_organizacion`, tabla nueva de auditoría y `auth.users` como identidad)

**Testing**: Vitest para frontend cuando se agregue lógica aislable; pgTAP vía `supabase test db --local` para RLS, autorización, último administrador y auditoría; validación manual de Edge Function y Mailpit local

**Target Platform**: Navegador moderno para Refine; Supabase local/Cloud para Postgres, Auth y Edge Functions

**Project Type**: Aplicación web monorepo con frontend y backend gestionado

**Performance Goals**: Listado de hasta 1.000 membresías de una organización dentro de 2 segundos en entorno normal; cada operación individual de rol/remoción concluye en menos de 2 segundos, sin contar la entrega externa del correo

**Constraints**: RLS activa en toda tabla expuesta; service-role solo en Edge Function; `auto_expose_new_tables = false` exige grants explícitos; sin registro público, roles limitados a `administrador` y `miembro`, y una persona pertenece a una sola organización

**Scale/Scope**: Un recurso Refine nuevo (`miembros`), una Edge Function de incorporación, dos RPCs de modificación, helpers/policies/migración de auditoría y extensión de la suite pgTAP existente

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Estado antes de diseño | Aplicación en esta entrega |
|---|---|---|
| Aislamiento multi-tenant y RLS | Pasa | La lectura se limita a membresía propia o a la organización gestionable; las mutaciones validan actor y organización en servidor. |
| Secretos fuera del navegador | Pasa | La service-role permanece solo en `invitar-miembro`; el frontend usa la clave pública y el JWT del usuario. |
| Especificar antes de implementar | Pasa | `spec.md` fue aclarada y este plan genera investigación, modelo, contratos y guía de validación antes de `tasks.md`. |
| Idempotencia y auditoría | Pasa | La incorporación duplicada no duplica membresía/evento; los cambios efectivos escriben una auditoría append-only dentro de la misma operación. |
| Despliegues independientes | Pasa | Cambios solo en `apps/web` (Vercel) y `supabase` (Supabase Cloud); cada uno conserva su flujo de despliegue. |
| Migraciones aditivas/reversibles | Pasa | Se agrega tabla/índices/functions/policies sin eliminar columnas ni tablas; el plan documenta cómo revertir los objetos de esta entrega. |

**Revisión posterior al diseño**: Pasa. No se agrega infraestructura ni producto Docker; los contratos separan la operación con service-role del navegador y los tests pgTAP cubren las nuevas fronteras RLS.

**Reversión de migración**: si se debe revertir esta entrega, una migración
posterior retira primero los grants, policies y RPCs de membresía; después los
helpers, índices y la tabla `eventos_membresia`. Antes de eliminar la tabla se
exportan sus eventos si la entrega hubiera llegado a un entorno compartido. No
se eliminan ni alteran las tablas existentes `usuarios_organizacion` ni
`auth.users`.

**Resolución de cuentas existentes**: la Edge Function busca la cuenta mediante
la API administrativa de Auth con su cliente de servidor. No se expone una
función `security definer` en `public` para consultar `auth.users`; el
navegador no recibe capacidad de enumerar cuentas.

## Project Structure

### Documentation (this feature)

```text
specs/005-gestion-miembros/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
```text
apps/web/src/
├── components/                       # guard e indicador de organización activa reutilizables
├── hooks/                            # resolución de permisos del cliente
├── lib/                              # cliente Supabase y recursos dependientes de organización
├── pages/miembros/                   # listado, alta y acciones de membresía
├── providers/                        # autorización del menú Refine
└── App.tsx                           # recurso y rutas protegidas

supabase/
├── functions/invitar-miembro/        # Auth Admin API, validación del actor e incorporación
├── migrations/                       # migración aditiva de RLS, RPCs y auditoría
└── tests/database/
    └── aislamiento_organizaciones.test.sql  # pgTAP extendido
```

**Structure Decision**: Aplicación web con backend Supabase gestionado. El
frontend permanece en `apps/web`; Auth Admin se aísla en una Edge Function y
las operaciones de base se concentran en una migración/RPCs para conservar las
garantías de autorización y auditoría.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Ninguna | — | — |
