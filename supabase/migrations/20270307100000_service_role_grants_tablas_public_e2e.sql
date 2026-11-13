-- Privilegios mínimos de `service_role` sobre tres tablas de `public` que la suite E2E de la tienda siembra y limpia
-- con la service-role key (MSF-499, CI del job `e2e-tienda`).
--
-- Síntoma: en el stack del CI (`scripts/reset-db-ci.mjs`) los specs `tienda-analitica`, `tienda-promocion` y
-- `tienda-publicacion` fallaban con 403 `42501` («GRANT ... ON public.<tabla> TO service_role»). Causa: el reset del CI
-- hace `drop schema public cascade` + `create schema public`, y eso borra los privilegios POR DEFECTO que trae `public`
-- en un Supabase (los que dan ALL a `service_role` sobre toda tabla nueva). En dev/stg/prd, y en una base de desarrollo
-- creada con `supabase start` + `migration up`, esos defaults siguen ahí y por eso nadie lo notó; una base creada solo
-- con las migraciones sobre un `public` recreado no los tiene. Mismo caso que `20270302105000` para `dominio`: lo que
-- existía por defecto o «a mano» pasa a estar declarado en una migración.
--
-- Qué se da, y solo a `service_role` (nada para `anon` ni `authenticated`; `service_role` ya omite RLS pero RLS no
-- reemplaza a los GRANT):
--   - `public.usuarios_organizacion`: SELECT (leer la membresía recién creada) y DELETE (limpieza del usuario de prueba).
--     El INSERT ya lo da `20260908172920_fundacion_multitenant`.
--   - `public.usuario_empresa_activa`: SELECT, INSERT y DELETE (fijar la empresa activa del administrador sembrado y
--     limpiarla).
--   - `public.banderas_plataforma`: SELECT y UPDATE (encender la bandera `promociones_precio` y devolver su valor previo).
--     Sin INSERT ni DELETE: las banderas las crea una migración.
-- No se usa `grant ... on all tables` ni `alter default privileges` (daría escritura a toda tabla futura; ver la
-- migración `20270302105000`). Una tabla de `public` nueva que el E2E necesite escribir declara su propio grant.
--
-- Aditiva e idempotente (GRANT repetido no cambia nada). No crea ni altera tablas (Principio VII). Si el rol o la tabla
-- no existen (Postgres sin Supabase) no hace nada.
--
-- Reversión (solo para bases reproducibles: en dev/stg/prd estos privilegios ya los tenía por los defaults de `public`
-- y revocarlos los quitaría también):
--   revoke select, delete on public.usuarios_organizacion from service_role;
--   revoke select, insert, delete on public.usuario_empresa_activa from service_role;
--   revoke select, update on public.banderas_plataforma from service_role;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise notice 'service_role no existe: se omiten los grants de tablas de public para el E2E.';
    return;
  end if;
  if to_regclass('public.usuarios_organizacion') is not null then
    grant select, delete on public.usuarios_organizacion to service_role;
  end if;
  if to_regclass('public.usuario_empresa_activa') is not null then
    grant select, insert, delete on public.usuario_empresa_activa to service_role;
  end if;
  if to_regclass('public.banderas_plataforma') is not null then
    grant select, update on public.banderas_plataforma to service_role;
  end if;
end
$$;
