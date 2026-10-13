# Implementation Plan: Acceso, organización y permisos · Empresas

**Branch**: `epic/MSF-138-acceso-organizacion-y-permisos-empresas` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261012-140000-empresas/spec.md`

## Summary

Crear la entidad `empresas` en el esquema `dominio` (N por organización, RLS por organización) y las pantallas de listado, datos generales con pausa/reactivación y cambio rápido de empresa, siguiendo el patrón CRUD de clientes del template (`pages/clientes/{list,edit}.tsx`, `ContenidoAdaptable`, estados compartidos, aviso de cambios sin guardar). Sin crear (F-EMP-03) ni borrar.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Primary Dependencies**: Refine, MUI — ya presentes; sin dependencias nuevas

**Storage**: Postgres (Supabase), tabla `dominio.empresas` (esquema `dominio` ya expuesto en `supabase/config.toml`)

**Testing**: Vitest + Testing Library; pgTAP en `supabase/tests/database/`; Playwright E2E (listar, editar, pausar, cambiar de empresa)

**Delivery scope**: `refine`, `supabase`

**Constraints**: migración aditiva; RLS en la tabla; nunca service-role en el navegador; sin asumir 2 empresas; sin copiar HTML/CSS del prototipo

## Constitution Check

- **I / VII**: tabla de negocio → `dominio`; RLS con `private.organizacion_id()` / `private.puede_escribir()`; pgTAP recorre `public` + `dominio`. ✔
- **II**: spec con permisos, fallos, datos y auditoría (eventos hacia F-AUD-01). ✔
- **VI**: destino «Empresas» en el sider (icono `Storefront`, audiencia `administrador`, ruta `/empresas`, sin rutas anteriores), contexto de organización con `ContextoOrganizacionActiva`, estados compartidos, 320/768/1440 px, sin UUID visible; carga inicial liviana (sin peso fuera del recorrido). ✔
- **VIII**: documentación en `docs/empresas.md` + esta spec. ✔
- Sin violaciones; sin Complexity Tracking.

## Diseño de datos

Migración `supabase/migrations/<ts>_empresas.sql` (aditiva):

- `dominio.empresas`: `id uuid pk default gen_random_uuid()`, `organizacion_id uuid not null references public.organizaciones(id) on delete cascade`, `nombre text not null` (check no vacío), `whatsapp text`, `correo text`, `instagram text`, `direccion text`, `activa boolean not null default true`, `created_at`, `updated_at`. Índice en `organizacion_id`. **Sin** unique que limite a dos; no hay columna de dominio (se muestra «Sin configurar» hasta Tiendas online), ni de idioma/moneda (constantes es-AR/ARS).
- RLS habilitada: `select` (`organizacion_id = private.organizacion_id()`), `update` (mismo predicado + `private.puede_escribir()`, en `using` y `with check`). Sin política `insert`/`delete` (F-EMP-03 la agrega). `grant` a `authenticated` solo de select/update.
- **Reversión** (documentada, no se ejecuta en el mismo PR): `drop table dominio.empresas;` en una migración posterior si la spec se revierte; el revert del PR (`git revert -m 1`) deja la tabla huérfana hasta esa migración.
- **Carga inicial** (San Javucho y Mundo JC): como dato, no en la migración de esquema; script/SQL documentado en `docs/empresas.md` para la organización del primer cliente. Las pruebas insertan sus propias filas (1, 2 y 3 por organización).

## Diseño de frontend

- Recurso Refine `empresas` (`list: /empresas`, `edit: /empresas/edit/:id`, sin `create`), acceso del data provider al esquema `dominio` (verificar en T001 cómo lo resuelve el cliente Supabase del template: opción de esquema por consulta o vista/RPC en `public`; si hiciera falta una vista, también con RLS efectiva).
- **Decisión T001**: `dominio` ya está en `[api] schemas` y `extra_search_path` de `supabase/config.toml`, pero el cliente `supabaseClient` consulta `public` por defecto (`Accept-Profile`) y el data provider de Refine no admite esquema por recurso. Se resuelve **esquema por consulta**: `useEmpresas` usa `supabaseClient.schema('dominio').from('empresas')`; la RLS aplica igual (sin vista/RPC). El recurso Refine `empresas` solo aporta rutas, menú y control de acceso (`accessControlProvider`: administrador, igual que `miembros`).
- `pages/empresas/list.tsx` y `pages/empresas/edit.tsx` (General) basados en clientes; `EncabezadoPagina`, `ContenedorSeccion`, `ContenidoAdaptable`, estados compartidos; estado activa/pausada con etiqueta de estado del sistema de diseño.
- Destino en `components/navegacion/destinosPanel.ts` (audiencia `administrador`); ruta protegida por la misma audiencia + acceso restringido para miembro.
- `SelectorEmpresa` (ya acepta `empresas`): alimentarlo con el listado de la organización y, al elegir, navegar a la misma sección de la otra empresa (`/empresas/edit/:id`); intercepta con el aviso de cambios sin guardar. Con una sola empresa queda como etiqueta fija (comportamiento actual).
- Eventos hacia F-AUD-01: contrato mínimo (`empresa.actualizada`, `empresa.pausada`, `empresa.reactivada`; actor, empresa, cambios, fecha) detrás de una función de emisión; el destino real se conecta cuando F-AUD-01 exponga su punto de entrada (Plataforma).

## Project Structure

```text
specs/20261012-140000-empresas/{spec,plan,tasks}.md
supabase/migrations/<ts>_empresas.sql
supabase/tests/database/empresas.test.sql          # + aislamiento_organizaciones recorre dominio
apps/web/src/pages/empresas/{list,edit}.tsx (+ .test.tsx)
apps/web/src/hooks/useEmpresas.ts
apps/web/src/components/navegacion/{destinosPanel.ts,SelectorEmpresa.tsx}
apps/web/e2e/empresas.spec.ts
docs/empresas.md
```

## Verificación

`pnpm lint && pnpm build && pnpm test` (con `pnpm dev:supabase` para pgTAP), `pnpm docs:check`, E2E de listar, editar, pausar y cambiar de empresa.
