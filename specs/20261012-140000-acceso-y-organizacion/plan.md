# Implementation Plan: Acceso, organización y permisos · Acceso y organización

**Branch**: `epic/MSF-119-acceso-organizacion-y-permisos-acceso-y-` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261012-140000-acceso-y-organizacion/spec.md`

## Summary

Adecuar sobre el template lo ya existente (login, recuperación y definir contraseña, rutas protegidas, `usuarios_organizacion` con RLS, pgTAP de aislamiento) y agregar solo lo que falta: `usuarios_organizacion.estado`, «Mantener la sesión iniciada», bloqueo por intentos, vencimiento de sesión, reglas de contraseña del producto y la prueba que exige RLS en toda tabla. Sin construir de cero nada que el template ya resuelva.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL (Supabase/Postgres)

**Primary Dependencies**: Refine, `@refinedev/mui`, MUI, `@supabase/supabase-js`; sin dependencias nuevas previstas

**Storage**: Supabase Postgres — migración aditiva `usuarios_organizacion.estado` (esquema `public`: membresía/auth, plataforma); tabla `intentos_acceso` (esquema `public`: soporte de autenticación, plataforma) solo si el límite de Supabase Auth no alcanza (decisión en T003)

**Testing**: Vitest + Testing Library (`apps/web`), pgTAP (`supabase/tests/database/`), E2E de ingreso, recuperación y cierre de sesión (infra Playwright existente, `infra/playwright`)

**Delivery scope**: `refine`, `supabase`

**Constraints**: migraciones aditivas; RLS en toda tabla expuesta; nunca service-role en el navegador; sin secretos en Git (solo `.env.example`); estética del sistema de diseño MSF-117; mensajes que no revelan existencia de cuentas

## Constitution Check

- I (aislamiento): FR-011/FR-012 refuerzan RLS y lo prueban con pgTAP. Cumple.
- VII (plataforma y dominio): `usuarios_organizacion` e `intentos_acceso` son de plataforma/auth → `public`, declarado en la spec; la prueba de catálogo recorre `public` + `dominio`. Cumple.
- II (especificar primero): esta spec. Cumple.
- IV (despliegues independientes): `refine` → Vercel; `supabase` → Supabase Cloud vía migraciones. Sin Compose raíz.
- VI (panel operable): pantallas de acceso y menú de cuenta usan patrones compartidos de carga/error/éxito, teclado, 320/768/1440 px. Cumple (FR-014).
- Calidad: toda migración con camino de reversión documentado (abajo). Sin violaciones ni Complexity Tracking.

## Project Structure

```text
apps/web/src/pages/login.tsx                       # ingreso: «Mantener la sesión iniciada», mensajes, aviso de bloqueo
apps/web/src/pages/acceso/                         # solicitar-recuperacion, definir-contrasena (existentes, se adecuan)
apps/web/src/providers/authProvider.ts             # persistencia de sesión, rechazo de suspendidos, logout
apps/web/src/components/navegacion/                # MenuCuenta: «Cerrar sesión»
apps/web/src/lib/                                  # validador de reglas de contraseña (si no existe)
supabase/migrations/<ts>_usuarios_organizacion_estado.sql
supabase/migrations/<ts>_intentos_acceso.sql       # condicional (T003)
supabase/config.toml                               # [auth.sessions], [auth.rate_limit], expiración de enlaces
supabase/tests/database/                           # estado_usuario, rls_en_toda_tabla (+ aislamiento existente)
docs/                                              # reglas de acceso y regla de aislamiento para tablas de dominio
specs/20261012-140000-acceso-y-organizacion/{spec,plan,tasks}.md
```

## Decisiones de diseño

1. **Estado de usuario (F-ACC-01)**: `alter table public.usuarios_organizacion add column estado text not null default 'activo' check (estado in ('activo','suspendido'))`. `private.organizacion_id()` / `private.puede_escribir()` se ajustan (migración aditiva con `create or replace`) para que un suspendido no obtenga organización; así el rechazo vale a nivel de datos y no solo de UI. **Reversión**: migración inversa que restaura las funciones y elimina la columna en un PR posterior (no en el mismo PR que la crea).
2. **Bloqueo por intentos (F-ACC-01)**: primero probar `[auth.rate_limit]` de Supabase Auth con una prueba de comportamiento real. Si no permite 5 intentos / 15 min por correo, crear `public.intentos_acceso` (plataforma/auth; correo en hash o normalizado, contador, `bloqueado_hasta`, RLS) y una función `security definer` invocada por el flujo de ingreso; F-ACC-01 pasa a talla M. Decisión registrada en `tasks.md` (T003).
3. **Sesión (F-ACC-03)**: verificar que el plan contratado admite `[auth.sessions] inactivity_timeout`/`timebox`. «Mantener la sesión iniciada» se resuelve en el cliente eligiendo persistencia de la sesión y se combina con el timebox. Si el plan no lo permite, se documenta la alternativa (cierre por inactividad en cliente) y se anota en `tasks.md`.
4. **Corte de sesión del suspendido (F-ACC-03)**: la verificación de `estado` en `authProvider.check` y la invalidación de sesiones (`auth.sessions`) al pasar a `suspendido` (trigger/función) usando la columna de F-ACC-01.
5. **Contraseña y enlaces (F-ACC-02)**: reutilizar el flujo de spec 006 (mínimo 12 caracteres, mayúscula, minúscula, número, símbolo; enlace de 1 hora, uno por 15 min). Se adecuan textos y pantalla al prototipo/sistema de diseño; se verifica `otp_expiry = 3600` y un solo uso.
6. **Aislamiento (F-ORG-01)**: la regla ya existe (spec 003). Se agrega la prueba pgTAP que recorre `pg_class`/`pg_tables` de todos los esquemas expuestos (`public` y `dominio`) exigiendo RLS y falla si alguna tabla no lo tiene; se documenta la regla.

## Validación y despliegue

| Producto | Archivo que cambia | Validación | Destino |
|---|---|---|---|
| refine | `apps/web/src/**` | `pnpm lint`, `pnpm build`, `pnpm test`, E2E | Vercel |
| supabase | `supabase/migrations/**`, `supabase/config.toml`, `supabase/tests/database/**` | `pnpm test:db`, `pnpm test:db:validar-aditivas` | Supabase Cloud |

Verificación de la épica: `pnpm lint && pnpm build && pnpm test`, pruebas pgTAP de aislamiento y E2E de ingreso, recuperación y cierre de sesión. `pnpm docs:check` por la documentación obligatoria. Variables nuevas: ninguna prevista (si surgen, solo `.env.example`).

## Fases

1. **US1 F-ACC-01** (crea `estado`; bloquea US3). 2. **US2 F-ACC-02** (independiente). 3. **US3 F-ACC-03** (tras US1). 4. **US4 F-ORG-01** (independiente). 5. **Cierre**: documentación, E2E, verificación. `/speckit-implement` se invoca fase por fase.

## Riesgos / puntos abiertos (no bloqueantes)

- Supuestos S1–S4 a confirmar con el cliente; viven como configuración, no como código disperso.
- Límite de Supabase Auth vs. `intentos_acceso` (T003) y soporte de inactividad en el plan contratado (T012).
