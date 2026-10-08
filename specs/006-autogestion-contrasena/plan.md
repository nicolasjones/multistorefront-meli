# Implementation Plan: Autogestión de contraseña

**Branch**: `006-autogestion-contrasena` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-autogestion-contrasena/spec.md`

## Summary

Permitir que una persona invitada defina su contraseña, la recupere por correo
y la cambie desde una sesión propia. Refine aporta las rutas y formularios;
Supabase Auth valida enlaces y contraseñas, entrega los correos y revoca las
otras sesiones tras un cambio. No se incorporan tablas ni roles nuevos.

## Technical Context

**Language/Version**: TypeScript 6.0 en Refine/Vite; Supabase Auth local mediante CLI 2

**Primary Dependencies**: React 18, Refine 5, Material UI 6, `@supabase/supabase-js` 2.115

**Storage**: Supabase Auth para usuarios, enlaces y sesiones; no hay tablas de aplicación nuevas

**Testing**: Vitest para rutas/formularios y llamadas aislables; Mailpit y Supabase local para enlaces/correo; pgTAP solo si una migración toca RLS

**Target Platform**: Navegador moderno y Supabase local/Cloud

**Project Type**: Aplicación web monorepo

**Performance Goals**: crear/cambiar contraseña en menos de 30 segundos una vez abierta una ruta; cumplir SC-001 y SC-002

**Constraints**: contraseñas de 12+ caracteres con mayúscula, minúscula, número y símbolo; enlaces de un solo uso por una hora; un correo por dirección cada 15 minutos; ningún secreto ni contraseña llega a logs o al navegador fuera del campo de entrada

**Scale/Scope**: tres rutas públicas/autenticadas y ajustes de Auth/email; sin registro público, MFA, cambio de correo ni administración de contraseñas ajenas

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Estado antes de diseño | Aplicación en esta entrega |
|---|---|---|
| Aislamiento multi-tenant y RLS | Pasa | No se agrega tabla expuesta ni se amplía el acceso a datos de organizaciones. |
| Secretos fuera del navegador | Pasa | El navegador usa solo la clave pública y el JWT propio; no accede a claves administrativas. |
| Especificar antes de implementar | Pasa | La spec define actor, fallos, límites y sesiones antes de crear tareas. |
| Idempotencia y auditoría | Pasa | Las solicitudes repetidas quedan limitadas; las notificaciones de cambio son provistas por Auth sin registrar secretos. |
| Despliegues independientes | Pasa | Cambios en `apps/web` y configuración versionada de `supabase`; sin Compose raíz. |
| Migraciones aditivas/reversibles | Pasa | No se requieren cambios de esquema; la configuración de Auth se revierte restaurando sus valores previos documentados. |

**Revisión posterior al diseño**: pasa. La revocación de sesiones usa el alcance que conserva la sesión actual; los tokens de acceso ya emitidos pueden seguir siendo válidos hasta su expiración máxima configurada de una hora, sin capacidad de renovación posterior.

## Project Structure

### Documentation (this feature)

```text
specs/006-autogestion-contrasena/
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
├── App.tsx                         # rutas pública y autenticada de contraseña
├── lib/supabase.ts                 # cliente y sesión de Auth existente
├── pages/login.tsx                 # acceso y enlace de recuperación
├── pages/acceso/                   # solicitar/enlazar/definir contraseña
├── pages/cuenta/                   # cambio de contraseña del usuario autenticado
└── providers/authProvider.ts        # cierre de sesión explícito

supabase/
├── config.toml                     # política, frecuencia, expiración y notificación de Auth
└── functions/invitar-miembro/      # redirección de invitación a la ruta de creación
```

**Structure Decision**: aplicación web con identidad gestionada por Supabase.
Los formularios quedan en `apps/web`; Auth conserva contraseñas, enlaces,
sesiones y correos. No se crea backend ni tabla adicional.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Ninguna | — | — |
