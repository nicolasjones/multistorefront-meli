# Implementation Plan: Plataforma · Actividad y ambientes

**Branch**: `epic/MSF-455-plataforma-actividad-y-ambientes` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

## Summary

Registro transversal `public.registro_actividad` (solo de agregado, RLS por organización y por `nivel_seccion('actividad')`) con una función de registro para los demás componentes, y la pantalla «Actividad» (`/actividad`) con filtros, búsqueda y paginación en servidor. F-OPS-02 adopta y verifica el CI staging → producción que el template ya trae.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Dependencies**: Refine, MUI — ya presentes; sin dependencias nuevas

**Storage**: Postgres self-hosted (Supabase). Tabla nueva en `public`.

**Testing**: pgTAP (`supabase/tests/database/`), Vitest + Testing Library, E2E Playwright del listado (si la suite de la app MSF-499 ya existe; si no, cierre con `Desvío:` y deuda trazada) y un cambio de prueba staging → producción.

**Delivery scope**: `refine`, `supabase`, CI/infra (verificación)

**Constraints**: migración aditiva con reversión; `anon` sin privilegios; nunca service-role en el navegador; hora en America/Argentina/Buenos_Aires; sin copiar HTML/CSS del prototipo; estética del sistema de diseño (MSF-117).

## Constitution Check

- **I / VII**: `registro_actividad` declarada en **`public`** (transversal, escrita por todos los componentes; no es entidad de negocio) con RLS por organización; sin tablas en `dominio`. Esquema re-verificado en spec, plan y tareas. ✔
- **II**: spec con permisos, fallos, auditoría y datos. ✔
- **III**: el registro es el soporte de auditoría; solo de agregado. ✔
- **IV**: Refine + Supabase, sin Compose raíz. ✔
- **V**: F-OPS-02 reutiliza lo del template. ✔
- **VI**: destino de menú «Actividad» con icono, audiencia Administrador/Operador, ruta `/actividad`, estados compartidos, 320/768/1440 px, sin UUID visible; carga diferida de la página (fuera del recorrido principal). ✔
- **VIII**: `docs/actividad.md` (+ ajustes a `docs/permisos-por-rol.md` y `docs/adoptar-cicd-staging-produccion.md`). ✔
- Sin violaciones; sin Complexity Tracking.

## Diseño de datos

Migración `supabase/migrations/20261016120000_registro_actividad.sql` (aditiva):

1. `public.registro_actividad`: `id uuid pk default gen_random_uuid()`, `organizacion_id uuid not null` (FK a `public.organizaciones`), `empresa_id uuid null` (sin FK dura: la empresa vive en `dominio`), `actor_id uuid null`, `tipo text not null` (check de formato `entidad.accion`), `detalle text not null` (largo acotado), `creado_en timestamptz not null default now()`.
2. Índices `(organizacion_id, creado_en desc)`, `(organizacion_id, tipo, creado_en desc)`, `(organizacion_id, actor_id, creado_en desc)`. Búsqueda por texto sobre `detalle`: `ilike` acotado por organización y período; índice trigram solo si la medición lo justifica y la extensión está habilitada.
3. RLS: `select` a `authenticated` con `organizacion_id = (select private.organizacion_id()) and (select private.nivel_seccion('actividad')) in ('lectura','edicion')`. **Sin policies de insert/update/delete.** Sin privilegios para `anon`/`public`; `grant select` solo a `authenticated`.
4. `private.registrar_actividad(p_tipo, p_detalle, p_empresa_id default null)`: `security definer`, `set search_path = ''`; organización y actor tomados en el servidor (`private.organizacion_id()`, `auth.uid()`); valida tipo/detalle; si hay empresa, verifica que sea de la misma organización. Es el contrato que llaman las RPC de los demás componentes, en la misma transacción que la operación de origen.
5. `public.registrar_actividad(...)` para eventos que nacen en el frontend (los `empresa.*` del destino de `eventosActividad.ts`): envoltorio con `revoke … from public, anon` y `grant execute … to authenticated`; no permite elegir organización ni actor.
6. RPC de lectura `public.listar_actividad(p_desde, p_hasta, p_actor, p_tipo, p_texto, p_pagina, p_tamano)`: filas + total, con el nombre del actor resuelto (sin UUID visible); `security invoker` para que rija la RLS; texto con comodines escapados y longitud acotada; tope de tamaño de página.
7. Seed de eventos de ejemplo por organización (solo local/staging, nunca producción).
8. Eventos propios de Acceso: se enchufan los puntos donde hoy solo hay `raise log` o tablas `eventos_*` (cambio de rol, invitación, suspensión, guardado de matriz) llamando a `private.registrar_actividad` desde sus RPC, **sin** cambiar su comportamiento. Los `empresa.*` del frontend se enchufan registrando el destino.
9. **Reversión** (en una migración posterior, no en el mismo PR): quitar `public.listar_actividad`, `public.registrar_actividad`, `private.registrar_actividad` y la tabla `public.registro_actividad`; restaurar la versión anterior de las RPC de Acceso modificadas.

## Diseño de frontend

- `apps/web/src/pages/actividad/` (`list.tsx`): listado con filtros (período, usuario, tipo), búsqueda y paginación en servidor; ruta con carga diferida. Hook `useActividad` sobre `listar_actividad`; período calculado en America/Argentina/Buenos_Aires.
- `destinosPanel.ts`: destino «Actividad» con icono y `seccionPermiso: 'actividad'`; `SECCION_POR_RECURSO` en `lib/permisos.ts`; ruta en `App.tsx` envuelta en `RequiereAccesoSeccion` (lo exige `App.guard.test.ts`).
- Componentes y tokens del template y del sistema de diseño; patrones compartidos de carga, vacío y error. Sin «Exportar» ni detalle con valor anterior/nuevo.
- Registrar el destino de `eventosActividad.ts` (`registrarDestinoActividad`) hacia `public.registrar_actividad`; un fallo no revierte la edición (contrato vigente).

## F-OPS-02 (ambientes)

- Verificar los seis GitHub Environments con secretos separados (manual, una vez), los workflows `migraciones-cloud.yml`, `deploy-infraestructura-vps.yml`, `publicar-flows-kestra.yml` y `promover-todo-a-produccion.yml`, y la compuerta `scripts/verificar-staging-exitoso.mjs`. Sin código nuevo salvo ajustes documentales; cada brecha real se traza.
- Cambio de prueba inocuo (p. ej. un comentario en doc) que recorre staging → producción; evidencia (links a los runs) en `docs/`.
- La constitución fija Supabase self-hosted: se verifica cómo está adoptado el CI de migraciones en este producto y se documenta cualquier diferencia con el template, sin introducir Supabase Cloud.

## Seguridad y concurrencia

- Revisión `authz-security` de RLS, `registrar_actividad` y `listar_actividad`: organización y actor en servidor, sin escritura directa, `anon` sin acceso, búsqueda sin inyección ni comodines.
- Solo agregado → sin conflictos de edición; el evento se inserta en la misma transacción que la operación de origen (un reintento no pierde ni duplica el evento).
- `rls_en_toda_tabla`, `aislamiento_organizaciones` y el test de ejecutabilidad por `anon` deben seguir verdes.

## Pruebas

- pgTAP `registro_actividad.test.sql`: aislamiento entre dos organizaciones; permisos por rol (administrador y operador leen; consulta/mostrador/depósito/administración y suspendido no); sin insert/update/delete directos; `anon` sin acceso; `registrar_actividad` fija organización y actor y rechaza empresa ajena; filtros y paginación de `listar_actividad`.
- Vitest: listado (filtros, búsqueda, paginación, estados, hora de Buenos Aires), guard de ruta, menú por `nivel_seccion`.
- E2E del listado con filtros; cambio de prueba staging → producción.

## Documentación

`docs/actividad.md` (contrato de registro para otros componentes, tipos, permisos, reversión); `docs/permisos-por-rol.md` (la auditoría de F-ROL-02 deja de ser solo un `raise log`); `docs/adoptar-cicd-staging-produccion.md` (evidencia de la verificación); `docs/roadmap-template.md` al cierre (paso manual).
