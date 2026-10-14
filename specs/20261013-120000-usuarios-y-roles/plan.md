# Implementation Plan: Acceso, organización y permisos · Usuarios y roles

**Branch**: `epic/MSF-125-acceso-organizacion-y-permisos-usuarios-` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261013-120000-usuarios-y-roles/spec.md`

## Summary

Extender el modelo de acceso del template (`administrador`/`miembro` + `private.puede_escribir()`) a seis roles de negocio con permisos por sección y por acción propios de cada organización, aplicados en RLS (`private.nivel_seccion`, `private.puede_accion`) y en el panel (menú, `accessControlProvider`, pantalla de acceso restringido). Sobre ese modelo: invitaciones con vencimiento a 7 días, listado/edición/suspensión de usuarios y la matriz editable por el Administrador de cada organización. Orden de entrega según los bloqueos: F-ROL-01 → F-ROL-03 → F-USR-01 → F-USR-02 → F-ROL-02.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL (Postgres/Supabase) y Deno (Edge Functions)

**Primary Dependencies**: MUI + `@refinedev/mui` (ya presentes), sistema de diseño MSF-117 (`apps/web/src/tema`, `components/base`); sin dependencias nuevas previstas

**Storage**: Postgres (Supabase), esquema `public` para todas las tablas nuevas (ver spec, *Esquemas de datos*); funciones nuevas en `private`

**Testing**: pgTAP (`supabase/tests/database`), Vitest + Testing Library (`pnpm test`), E2E de invitar/editar/suspender/acceso restringido (Playwright, según `pruebas-plataforma`), `pnpm lint`, `pnpm build`, `pnpm docs:check`

**Delivery scope**: `refine` + `supabase`

**Constraints**: migraciones aditivas con reversión documentada; RLS en toda tabla nueva; sin service-role en el navegador; sin secretos en Git; no copiar HTML/CSS del prototipo; no cambiar el comportamiento de tablas que aún usan `private.puede_escribir()`

## Constitution Check

- **I Aislamiento**: tablas nuevas con RLS por `private.organizacion_id()`; pgTAP de aislamiento recorre `public` + `dominio` y debe cubrirlas. ✅
- **II Especificar antes**: esta spec; requisitos referenciados por FR. ✅
- **VI Panel operable**: ubicación en navegación, rutas, audiencia, estados compartidos, accesibilidad y carga diferida declarados en la spec. ✅
- **VII Esquemas**: cada tabla declara `public` y su justificación (spec); ninguna es de producto, por eso ninguna va a `dominio`. Se re-verifica al implementar y al revisar (T047). ✅
- **VIII Documentación**: `docs/permisos-por-rol.md` (contrato `nivel_seccion`/`puede_accion`) + `docs/roadmap-template.md` al cerrar. ✅
- Migraciones aditivas; reversión abajo. Sin violaciones ni Complexity Tracking.

## Diseño de datos (propuesta técnica; esquema `public`)

- `roles_organizacion`: `insert` de `operador`, `consulta`, `mostrador`, `deposito`, `administracion` (ids en minúscula sin tilde, descripciones del prototipo).
- `permisos_rol (organizacion_id, rol_id, seccion, nivel)` con `nivel in ('edicion','lectura','ninguno')`, PK compuesta, check que impide `administrador` ≠ `edicion`. Las 16 secciones como catálogo cerrado (`secciones_panel` o check); agregar una sección es una fila/valor nuevo.
- `permisos_rol_accion (organizacion_id, rol_id, seccion, accion, permitido)` con `accion in ('eliminar','exportar','ver_costos')`.
- Valores iniciales: función `private.sembrar_permisos(organizacion_id)` con la matriz de `Roles.dc.html` (y valores propuestos para acciones), invocada al crear organización y por backfill de las existentes; reutilizada por «Restablecer valores iniciales».
- `invitaciones_organizacion (id, organizacion_id, email, rol_id, estado, vence_en default now()+7 días, creada_por, …)`; el token real vive en el mecanismo de invitación de Supabase Auth, no en la tabla.
- `private.nivel_seccion(seccion) returns text` y `private.puede_accion(seccion, accion) returns boolean`: `stable security definer`, resuelven rol del usuario vía `usuarios_organizacion` + `private.organizacion_id()`, excluyen estado Suspendido, superadmin con organización activa = administrador.
- RLS: `permisos_rol`/`permisos_rol_accion` lectura para miembros de la organización, escritura solo si `nivel_seccion('Usuarios y permisos') = 'edicion'` y rol `administrador`; `invitaciones_organizacion` ídem. Funciones expuestas con GRANT explícito (`auto_expose_new_tables` en false).
- `usuarios_organizacion.estado`: lo crea MSF-119; las políticas de acceso se apoyan en él para negar a Suspendido.
- **Reversión** (documentada, no ejecutada en el mismo PR): `drop` de `invitaciones_organizacion`, `permisos_rol_accion`, `permisos_rol`, funciones `private.*` y `delete` de las 5 filas de rol (solo si ningún usuario las usa), en una migración posterior de rollback; el estado previo del template (`puede_escribir`) no se modifica.

## Project Structure

```text
supabase/migrations/<ts>_roles_negocio_permisos.sql        # roles, permisos_rol, permisos_rol_accion, funciones private
supabase/migrations/<ts>_invitaciones_usuarios.sql         # invitaciones_organizacion, estado/suspensión
supabase/functions/invitar-miembro/                        # extendida: rol de negocio, vencimiento, reenvío, cancelación
supabase/tests/database/permisos_por_rol.test.sql          # pgTAP por rol y aislamiento
supabase/tests/database/invitaciones_usuarios.test.sql
apps/web/src/providers/accessControlProvider.ts            # nivel por sección/acción
apps/web/src/hooks/useNivelSeccion.ts, usePuedeAccion.ts
apps/web/src/pages/usuarios/                               # listado + diálogos Invitar/Editar/Suspender (absorbe pages/miembros)
apps/web/src/pages/roles/                                  # grilla editable
apps/web/src/pages/acceso-restringido/                     # pantalla de acceso restringido
apps/web/src/pages/acceso/definir-contrasena.tsx           # ajuste a prototipo
docs/permisos-por-rol.md                                   # contrato para las demás épicas
specs/20261013-120000-usuarios-y-roles/{spec,plan,tasks}.md
```

**Usuarios absorbe Miembros (FR-019)**: `pages/usuarios/` se construye sobre `pages/miembros/list.tsx` y `create.tsx` (RPC `listar_miembros_organizacion`, `cambiar_rol_miembro`, `remover_miembro`, Edge Function `invitar-miembro`, `IdentidadVisible`, `ContenidoAdaptable`, estados compartidos). Los RPC se extienden (estado, seis roles, último acceso) de forma aditiva. Se elimina el ítem «Miembros» del menú y `/miembros`, `/miembros/create` pasan a redirigir a `/usuarios`; los tests de `pages/miembros` se migran a `pages/usuarios`. `GrillaPermisosPorRol.tsx` se revisa y se reutiliza o reemplaza sin romper sus tests.

## Fases

1. **US1 — F-ROL-01 (P0, L)**: migraciones de roles/permisos/funciones, siembra, accessControlProvider y menú, pgTAP por rol.
2. **US2 — F-ROL-03 (P0, S)**: pantalla de acceso restringido.
3. **US3 — F-USR-01 (P0, M)**: invitaciones y Definir contraseña.
4. **US4 — F-USR-02 (P0, M)**: listado, edición, suspensión/reactivación.
5. **US5 — F-ROL-02 (P0, L)**: grilla editable, acciones, restablecer.
6. **Cierre**: docs y roadmap.

`/speckit-implement` se invoca fase por fase (con `/clear` entre fases), usando el Checkpoint de `tasks.md`.

## Riesgos

- **F-ROL-01 / F-ROL-02** reemplazan `puede_escribir` por permisos por sección y acción en panel y políticas: mantener `puede_escribir()` operativo para tablas no migradas y cubrir con pgTAP de regresión. **Cambio de contrato/API → alto riesgo (gate humano)**: lo consumen todas las épicas de dominio.
- Dependencia de MSF-119 (`estado`): si no está mergeada, US4 queda bloqueada; US1–US3 no dependen.
- Migraciones: revisión obligatoria; solo aditivas.
- Seguridad: revisión de `authz-security` sobre RLS/funciones y de `crypto-secrets` sobre la invitación.
- Horas (44 h) no entran en 16–22 de octubre: replanificar con MSF-121.
- Diseño pendiente (acciones, restablecer, confirmaciones): implementar con componentes base y marcar en el PR lo no dibujado.
- Evidencia: el Desarrollador deja evidencia de verificación local (lint/build/test/pgTAP) o explica qué queda para el CI.
