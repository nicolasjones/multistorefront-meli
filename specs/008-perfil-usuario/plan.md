# Implementation Plan: Gestión del perfil personal

**Branch**: \`008-perfil-usuario\` | **Date**: 2026-09-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from \`specs/008-perfil-usuario/spec.md\`

## Summary

Incorporar una pantalla de perfil y un acceso visible a ella desde la sesión activa. La persona actualizará sus propios nombre, apellido y foto, consultará su cuenta y las 20 acciones de seguridad más recientes, y accederá a los flujos existentes de contraseña y cambio confirmado de correo. Refine implementa las pantallas y Supabase aporta Auth, una tabla de perfiles, eventos de seguridad, Storage privado y RLS.

## Technical Context

**Language/Version**: TypeScript 6.0 en Refine/Vite; SQL de PostgreSQL 17; Supabase CLI 2

**Primary Dependencies**: React 18, Refine 5, Material UI 6 y \`@supabase/supabase-js\` 2.115

**Storage**: Supabase Auth para identidad/correo; PostgreSQL para \`perfiles_usuario\` y \`eventos_seguridad_usuario\`; Supabase Storage privado para fotos

**Testing**: Vitest para rutas, formularios y llamadas aislables; pgTAP para RLS de perfiles, eventos y Storage; Supabase local y Mailpit para cambios de correo y notificaciones

**Target Platform**: Navegador moderno y Supabase local/Cloud

**Project Type**: Aplicación web monorepo

**Performance Goals**: perfil y últimas 20 acciones visibles en menos de 2 segundos con conectividad normal; completar edición de nombre/apellido o foto en menos de 2 minutos

**Constraints**: solo el titular puede leer o modificar su fila de perfil y sus eventos; la foto visible solo dentro de su organización se obtiene desde Storage sin leer perfiles ajenos; fotos y eventos no cruzan organizaciones; 20 eventos por titular; no se exponen service-role, contraseñas, tokens, enlaces ni correos de terceros

**Scale/Scope**: una nueva ruta autenticada, un bucket privado, dos tablas públicas expuestas con RLS, un hook de Auth y cambios de configuración de correo; sin preferencias, MFA, eliminación de cuenta ni gestión de sesiones

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Estado antes de diseño | Aplicación en esta entrega |
|---|---|---|
| Aislamiento multi-tenant y RLS | Pasa | Las tablas nuevas usan RLS solo de titular para perfil/eventos; \`storage.objects\` habilita fotos propias o de personas cuya organización coincide con el contexto del lector. |
| Secretos fuera del navegador | Pasa | El cliente usa la publishable key y su JWT; no hay service-role ni endpoint administrativo en el navegador. |
| Especificar antes de implementar | Pasa | La spec aclaró visibilidad de fotos, contenido y límite del historial antes de crear el plan. |
| Idempotencia y auditoría | Pasa | Las escrituras de perfil/foto se pueden repetir sin duplicar identidad; Auth y el trigger producen eventos de seguridad acotados por usuario. |
| Despliegues independientes | Pasa | Cambios limitados a \`apps/web\` y \`supabase\`; sin Compose raíz ni workers nuevos. |
| Migraciones aditivas/reversibles | Pasa | La migración agrega tablas, bucket, policies, trigger y hook; su reversión se documentará sin borrar datos sin un camino explícito. |

**Revisión posterior al diseño**: pasa. Las funciones privilegiadas del hook de Auth no serán invocables por \`anon\`, \`authenticated\` ni \`public\`; los permisos quedan limitados a \`supabase_auth_admin\` y sus efectos se prueban antes de habilitarlo.

## Project Structure

### Documentation (this feature)

\`\`\`text
specs/008-perfil-usuario/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── perfil-personal.md
└── tasks.md                 # creado por /speckit-tasks
\`\`\`

### Source Code (repository root)

\`\`\`text
apps/web/src/
├── App.tsx
├── components/SiderConSeccionesSuperadmin.tsx
├── lib/supabase.ts
├── pages/cuenta/perfil.tsx
├── pages/cuenta/cambiar-contrasena.tsx
├── providers/authProvider.ts
└── pages/**/*.test.tsx

supabase/
├── config.toml
├── migrations/
└── tests/database/
\`\`\`

**Structure Decision**: mantener el frontend en \`apps/web\` y los cambios de identidad/datos en Supabase. No se agrega backend propio: Auth gestiona correo y contraseña; una función de hook de Postgres registra inicios de sesión, y un trigger interno registra cambios efectivos de correo y contraseña.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Ninguna | — | — |
