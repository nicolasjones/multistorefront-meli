-- Endurecimiento de privilegios (hallazgo del barrido de seguridad de dev del 2026-11-13).
--
-- Regla del repo (CLAUDE.md): `anon` solo ejecuta las RPC de acceso y las tablas nacen sin privilegios para `anon`
-- (migración 20261013130000). Pero las tablas anteriores a esa migración conservaban, otorgados por `postgres`, los privilegios
-- que Supabase da por defecto y que las migraciones posteriores NO quitaron: TRUNCATE, REFERENCES y TRIGGER sobre ~28 tablas de
-- `public` (83 filas de `role_table_grants`). No se explotan por la API (PostgREST no expone TRUNCATE y RLS gobierna lo demás),
-- pero TRUNCATE no pasa por RLS y la regla es que `anon` no tenga nada.
--
-- Qué hace (solo REVOKE, sin tocar datos ni funciones):
--   1. `anon`: sin ningún privilegio sobre las tablas y secuencias de `public` y `dominio`.
--   2. Privilegios por defecto del rol que corre las migraciones: lo que se cree desde ahora no le da nada a `anon`.
--   3. `authenticated`: sin TRUNCATE, REFERENCES ni TRIGGER (no los usa ninguna pantalla ni RPC; los DML siguen como estaban,
--      gobernados por RLS).
--   4. `authenticated`: sin escritura directa sobre las tablas de la plataforma de IA que solo escriben las RPC `security
--      definer` y el service_role (`fuentes_chat_ia`, `fuentes_mcp`, `capacidades_mcp`, `acciones_mcp`): las pantallas solo
--      las leen. Es el mismo criterio de MSF-724 para `capacidades_chat_ia` y `acciones_chat_ia`.
--
-- Migración aditiva. Reversión (en una migración posterior), solo si hiciera falta: volver a otorgar lo que se quitó, por ejemplo
--   grant insert, update, delete on table public.fuentes_chat_ia to authenticated;
-- (reabrir los privilegios de `anon` no se recomienda).

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'dominio') then
    execute 'revoke all on all tables in schema dominio from anon';
    execute 'revoke all on all sequences in schema dominio from anon';
    execute 'revoke truncate, references, trigger on all tables in schema dominio from authenticated';
  end if;
end $$;

-- Lo que cree el rol de las migraciones desde ahora nace sin privilegios para `anon`.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Tablas de la plataforma de IA que las pantallas solo leen y que escriben las RPC security definer o el service_role.
do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array['fuentes_chat_ia', 'fuentes_mcp', 'capacidades_mcp', 'acciones_mcp'] loop
    if to_regclass('public.' || v_tabla) is not null then
      execute format('revoke insert, update, delete on table public.%I from authenticated', v_tabla);
    end if;
  end loop;
end $$;
