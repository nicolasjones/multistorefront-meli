# Alta de nuevas organizaciones (superadmin)

Spec: `specs/20261016-130000-organizaciones-nuevas/` (épica MSF-162, F-ORG-02).
Sin migraciones: se usa lo que trae el template.
Pruebas: `supabase/functions/crear-organizacion/handler.test.ts` (`pnpm test:edge:crear-organizacion`),
`apps/web/src/pages/organizaciones/create.test.tsx`, `supabase/tests/database/alta_organizacion_nueva.test.sql`
y `supabase/tests/database/aislamiento_organizaciones.test.sql`.

## Cómo se da de alta

Solo un **superadmin** crea organizaciones, desde `/organizaciones` → «Crear organización»
(nombre + correo del fundador). No hay autoservicio.

1. La pantalla `pages/organizaciones/create.tsx` invoca la Edge Function `crear-organizacion`.
2. La función verifica con el JWT del llamador que sea superadmin (si no, **403** y no crea nada).
3. Crea la fila en `organizaciones`, invita por correo al fundador y lo vincula en
   `usuarios_organizacion` con rol `administrador`.
4. Si la invitación o la membresía fallan, **borra la organización creada** y devuelve el motivo
   (p. ej. el correo ya tiene cuenta → 400; falla de envío → 502).

No hay policy ni privilegio de `INSERT` en `organizaciones` para `authenticated` ni `anon`: la única
vía de alta es la función con la service-role key (que nunca llega al navegador).

## Esquemas (Principio VII)

Sin tablas nuevas. `organizaciones`, `usuarios_organizacion` y `superadmins` viven en `public`
(plataforma) con RLS por organización; la prueba de aislamiento recorre `public` + `dominio`.

## Límite: un usuario, una organización

`usuarios_organizacion.user_id` es clave primaria: un correo pertenece a **una sola** organización.
Un correo que ya tiene cuenta no puede ser fundador de otra organización (el alta se revierte).
Queda fuera de alcance: un usuario en varias organizaciones, selector de organización, autoservicio
y facturación propia. Las empresas de la organización nueva las da de alta su administrador con la
pantalla de Empresas (ver `docs/empresas.md`).

## Aislamiento

El fundador de una organización nueva ve solo su organización y su membresía, no puede escribir en
otra, y las demás organizaciones no ven la suya (ver `docs/aislamiento-por-organizacion.md`).
