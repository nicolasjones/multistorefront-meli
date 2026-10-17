# Implementation Plan: Acceso, organización y permisos · Perfil y permisos avanzados

**Branch**: `epic/MSF-148-acceso-organizacion-y-permisos-perfil-y-` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261016-130000-perfil-y-permisos-avanzados/spec.md`

## Summary

F-PRF-01 verifica lo que el template ya trae (perfil y cambio de contraseña) y ajusta textos. F-ROL-05 agrega a `AccesoRestringido` el botón «Solicitar acceso»: una RPC registra el pedido del día (tabla `public.solicitudes_acceso`, una por persona/sección/día) y una Edge Function envía un correo al administrador de la organización. Dos historias independientes, ambas con MSF-125 ya integrada.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL (Postgres/Supabase) y Deno (Edge Functions)

**Primary Dependencies**: MUI + `@refinedev/mui`, sistema de diseño MSF-117; sin dependencias nuevas previstas (SMTP desde Deno, p. ej. `denomailer`, a confirmar en T008)

**Storage**: Postgres (Supabase **self-hosted**, sin Cloud), esquema `public` (ver spec, *Esquemas de datos*)

**Testing**: pgTAP (`supabase/tests/database`), Vitest + Testing Library, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`. No hay suite Playwright de la app (solo `infra/playwright`): los escenarios se cubren con Vitest y pgTAP.

**Delivery scope**: `refine` + `supabase`

**Constraints**: migración aditiva con reversión documentada; RLS en la tabla nueva; `anon` sin ejecución de la RPC (ver `docs/acceso-ingreso.md`); sin service-role en el navegador; sin secretos en Git (solo `.env.example`); no copiar HTML/CSS del prototipo; textos en castellano.

## Constitution Check

- **I Aislamiento**: `solicitudes_acceso` con RLS por `private.organizacion_id()`; pgTAP lo cubre. ✅
- **II Especificar antes**: esta spec; requisitos por FR. ✅
- **III Idempotencia/auditoría**: una fila por persona/sección/día (`unique`), correo ligado al registro; el registro guarda actor y timestamps. ✅
- **VI Panel operable**: no se crea pantalla ni ítem de menú; extiende `AccesoRestringido` (audiencia: persona sin acceso a la sección, organización activa); usa `EstadoVacio`/estados compartidos de error y éxito; teclado, lector y 320/768/1440 px. ✅
- **VII Esquemas**: `solicitudes_acceso` → `public` (plataforma/permisos), no `dominio`; se re-verifica en tareas, implementación y PR (T016). ✅
- **VIII Documentación**: `docs/solicitar-acceso.md` + `docs/roadmap-template.md` al cerrar. ✅
- Una pantalla de personas por producto: no aplica (no se crea pantalla). Migración aditiva. Sin violaciones.

## Diseño de datos (propuesta técnica; esquema `public`)

- `solicitudes_acceso (id, organizacion_id, usuario_id, seccion, dia date default current_date, creada_en, correo_enviado_en)` con `unique (organizacion_id, usuario_id, seccion, dia)`. RLS: el solicitante ve sus filas; los administradores de la organización ven las de su organización; sin `insert/update` directo (solo por RPC). Sin privilegios para `anon`.
- `public.solicitar_acceso(p_seccion text)`: `security definer`, `search_path=''`; exige sesión y membresía activa en la organización de trabajo; valida la sección contra el catálogo de secciones de MSF-125; inserta `on conflict do nothing`; devuelve si el pedido es nuevo y los datos para el correo. `revoke … from public, anon` + `grant … to authenticated`.
- **Reversión** (documentada, no ejecutada en este PR): eliminar `public.solicitar_acceso(text)` y después `public.solicitudes_acceso` en una migración posterior.

## Correo de negocio

Decisión de Nicolás: usar el sistema de correo de Supabase y verificar que sale del servidor. Supabase solo ofrece correo transaccional libre a través de su SMTP (el de Supabase Auth), así que la función usa **ese mismo SMTP**: en local, el Mailpit del stack (`supabase/config.toml`, `SUPABASE_MAILPIT_PORT`); en el servidor self-hosted, el relay configurado para Auth (`GOTRUE_SMTP_*`). Sin proveedor nuevo ni dependencias de pago.

- `supabase/functions/solicitar-acceso/`: valida el JWT de la persona, llama a `solicitar_acceso`, y si el pedido es nuevo (o el correo del día aún no salió) envía el correo a los administradores activos de la organización y marca `correo_enviado_en`. Reintento seguro por la unicidad diaria.
- `supabase/functions/_shared/correo.ts`: envío por SMTP con host/puerto/usuario/clave por variables de entorno (solo `.env.example`; mismas credenciales que Auth, nunca al navegador). Si MSF-224 trae un mecanismo antes, se reemplaza el transporte.
- **Verificación de salida (FR-012)**: (a) local: test/guion que dispara el flujo y comprueba el mensaje en la API de Mailpit; (b) servidor: guion opt-in (`pnpm`/script, fuera de `pnpm test` y CI) que envía a la casilla externa de prueba (variable `CORREO_PRUEBA`, `nicolas.m.jones@gmail.com`) y deja evidencia en el PR. Si el relay SMTP del servidor no está configurado, se documenta el hallazgo y se traza como seguimiento (infraestructura), sin bloquear el resto de la historia.

## Project Structure

```text
supabase/migrations/<ts>_solicitudes_acceso.sql        # tabla + RLS
supabase/migrations/<ts>_rpc_solicitar_acceso.sql      # RPC + grants
supabase/tests/database/solicitudes_acceso.test.sql    # pgTAP: aislamiento, un pedido por día, anon
supabase/functions/solicitar-acceso/                   # Edge Function
supabase/functions/_shared/correo.ts                   # envío de correo de negocio
apps/web/src/pages/acceso-restringido/AccesoRestringido.tsx (+ test)   # botón y confirmación
apps/web/src/pages/cuenta/{perfil,cambiar-contrasena}.tsx (+ tests)    # textos y verificación
apps/web/src/lib/passwordPolicy.ts                      # regla centralizada
docs/solicitar-acceso.md
specs/20261016-130000-perfil-y-permisos-avanzados/{spec,plan,tasks}.md
```

## Fases

1. **US1 — F-PRF-01 (P2, S)**: verificación y ajuste de textos.
2. **US2 — F-ROL-05 (P2, M)**: migración, RPC, correo, UI.
3. **Cierre**: verificación de esquemas de punta a punta, evidencia local y roadmap.

`/speckit-implement` se invoca historia por historia (con `/clear` entre una y otra).

## Riesgos

- **Correo**: depende de que el SMTP del servidor self-hosted esté configurado y salga a internet (FR-012); credenciales solo en `.env.example`/secretos. Si falla el envío, el registro no se pierde. Riesgo de entregabilidad (SPF/DKIM del remitente) a cargo de infraestructura.
- **Seguridad**: RPC `security definer` y Edge Function con service-role → revisión de `authz-security` (RLS/RPC) y `crypto-secrets` (credenciales SMTP); validar sección y membresía en servidor; no revelar datos de otras organizaciones.
- **Concurrencia**: doble clic/reintentos concurrentes → la unicidad diaria + `on conflict` evitan duplicados.
- **Migración**: aditiva; revisión obligatoria.
- **Contrato**: no cambia contratos existentes; `AccesoRestringido` conserva sus props.
- **Accesibilidad**: confirmación anunciada por `role="status"`/`alert`; foco visible en el botón.
- **Evidencia**: el Desarrollador deja evidencia de verificación local (lint/build/test/pgTAP) o explica qué queda para el CI.
