# Implementation Plan: Acceso, organización y permisos · Administración de usuarios y organización

**Branch**: `epic/MSF-132-acceso-organizacion-y-permisos-administr` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)

## Summary

Construcción chica sobre patrones existentes. F-ORG-03: pantalla `/organizacion` con edición de nombre, logo y zona horaria vía una RPC con control de administrador, más el listado de empresas ya existente. F-USR-03: completar el «Restablecer contraseña» que ya trae el diálogo «Editar usuario» (MSF-125) para que respete Suspendido y quede probado de punta a punta; reusa el correo de F-ACC-02.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL (Postgres/Supabase self-hosted)
**Dependencies**: MUI + `@refinedev/mui`, sistema de diseño MSF-117; sin dependencias nuevas
**Storage**: `public.organizaciones` (columnas aditivas); Storage solo si se elige archivo para el logo (ver decisión)
**Testing**: pgTAP (`supabase/tests/database`), Vitest + Testing Library, E2E Playwright (según `pruebas-plataforma`), `pnpm lint`, `pnpm build`, `pnpm docs:check`
**Delivery scope**: `refine` + `supabase`
**Constraints**: migraciones aditivas con reversión; RLS; sin service-role en el navegador; RPC con `revoke … from public, anon` + `grant … to authenticated`; no copiar HTML/CSS

## Constitution Check

- I Aislamiento: escritura solo por RPC que fija la organización con `private.organizacion_id()`; pgTAP entre organizaciones. ✅
- II Spec antes de implementar: esta spec. ✅
- VI Panel: ruta, audiencia, estados compartidos y a11y declarados en la spec. ✅
- VII Esquemas: `organizaciones` es `public` (plataforma); `dominio.empresas` solo se lee. Re-verificar en tareas e implementación. ✅
- VIII Documentación: `docs/administracion-organizacion.md` + `docs/acceso-ingreso.md`/`permisos-por-rol.md` si cambian. ✅
- Supabase self-hosted, sin Cloud. ✅

## Decisiones de diseño

1. **Escritura por RPC, no por política UPDATE**: `public.actualizar_organizacion(p_nombre, p_zona_horaria, p_logo_path)` `security definer`, `set search_path = ''`, resuelve la organización con `private.organizacion_id()` y exige `private.es_administrador_de(...)` (excluye suspendidos). Evita que un UPDATE directo toque columnas futuras. Camino de reversión: `drop function`; las columnas se retiran en un PR posterior (aditivo).
2. **Zona horaria**: `text` validada contra `pg_timezone_names`; default `America/Argentina/Buenos_Aires` (supuesto del componente: Argentina).
3. **Logo**: columna `logo_path` y bucket `logos-organizacion` con políticas por prefijo de organización, solo imágenes (PNG/JPG/WebP/SVG sanitizado no: se excluye SVG) con tope de tamaño. *Si la infraestructura de Storage self-hosted no está habilitada, alternativa mínima: dejar el logo fuera y avisarlo en el PR; no se inventa otro mecanismo.*
4. **Listado de empresas**: lectura de `dominio.empresas` con el hook/recurso existente; enlace a `/empresas/edit/:id`. Sin botón de alta.
5. **F-USR-03**: sin RPC nueva. En `pages/usuarios/list.tsx` el botón ya existe; se deshabilita/oculta para `estado = 'suspendido'` con texto explicativo y se mantiene oculto para uno mismo y para no administradores. El envío sigue por `resetPasswordForEmail` (correo de Auth, F-ACC-02).
6. **Navegación**: `/organizacion` en `App.tsx` dentro de `RequiereOrganizacionActiva`; entrada de menú según la audiencia administrador; ubicación/icono final al dibujar.

## Project Structure

```text
specs/20261014-140000-administracion-de-usuarios-y-organizacion/{spec,plan,tasks}.md
supabase/migrations/<ts>_organizacion_datos_y_configuracion.sql
supabase/tests/database/organizacion_datos_y_configuracion.test.sql
apps/web/src/pages/organizacion/{edit.tsx,edit.test.tsx}
apps/web/src/pages/usuarios/list.tsx (+ list.test.tsx)
apps/web/src/App.tsx
docs/administracion-organizacion.md
```

## Reversión

Migración aditiva (columnas nullables/con default + función + bucket). Revertir = `drop function public.actualizar_organizacion`, eliminar políticas/bucket, y retirar columnas en una migración posterior (no en el mismo PR). El cierre es merge commit; deshacer la spec completa = `git revert -m 1 <hash>`.

## Riesgos

- Logo: superficie de carga de archivos (tipo, tamaño, aislamiento); se acota y se prueba.
- La spec de F-ORG-03 es corta: los campos finales dependen del dibujo de Etapa 2.
- Bloqueada por MSF-125 y MSF-138: no implementar antes de que estén integradas.
