-- Privilegios por defecto de `authenticated` sobre tablas NUEVAS de `public` (MSF-670, auditoría L01 / MSF-865).
--
-- Problema: `20270304100000_endurecer_privilegios_anon_y_plataforma_ia` quitó `TRUNCATE`, `REFERENCES` y `TRIGGER` a
-- `authenticated` solo sobre las tablas que YA existían. En Supabase, `pg_default_acl` del rol `postgres` en el esquema
-- `public` sigue otorgando a `authenticated` (y a `service_role`) `arwdDxt` sobre las tablas que se creen después, así que cada
-- tabla nueva volvía a nacer con TRUNCATE (que no pasa por RLS), REFERENCES y TRIGGER para `authenticated`, y el endurecimiento
-- se deshacía solo con el tiempo.
--
-- Qué hace (solo `alter default privileges`, sin tocar tablas existentes ni datos):
--   * `public`: las tablas que cree `postgres` desde ahora nacen SIN TRUNCATE, REFERENCES ni TRIGGER (ni MAINTAIN en PG 17+)
--     para `authenticated`. SELECT/INSERT/UPDATE/DELETE por defecto quedan como estaban: cada migración que crea una tabla
--     decide con su `grant` explícito y RLS gobierna las filas; no se rompe ningún flujo.
--   * `anon`: ya no recibe nada por defecto (`20261013130000` y `20270304100000`); no hace falta tocarlo.
--   * `service_role`: NO se toca. Los workers y las Edge Functions lo usan con sus propios grants por tabla.
--   * `dominio`: no tiene privilegios por defecto (`20270302105000`: las tablas nuevas nacen sin grant); si algún entorno los
--     tuviera, se retiran igual. Es un no-op cuando no existen.
--   * `MAINTAIN` solo existe desde PG 17: se incluye únicamente si el servidor es 17 o posterior (en PG 15 daría error).
--
-- Reaplicable: `revoke` de un privilegio por defecto que no existe no falla ni cambia nada.
-- Cubierto por el pgTAP `acl_por_defecto_authenticated.test.sql`.
--
-- Reversión (solo si hiciera falta; en una migración posterior): volver a otorgar lo que se quitó, por ejemplo
--   alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to authenticated;
-- (las tablas ya creadas no cambian con esta migración ni con su reversión).

do $$
declare
  v_privilegios text := 'truncate, references, trigger';
  v_esquema text;
begin
  if current_setting('server_version_num')::int >= 170000 then
    v_privilegios := v_privilegios || ', maintain';
  end if;

  foreach v_esquema in array array['public', 'dominio'] loop
    if exists (select 1 from pg_namespace where nspname = v_esquema) then
      execute format('alter default privileges for role postgres in schema %I revoke %s on tables from authenticated',
        v_esquema, v_privilegios);
    end if;
  end loop;
end $$;
