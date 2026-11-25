-- Dos menores que quedaron abiertos de PRs ya mergeados (lote 86).
--
-- (1) Privilegios por defecto de `supabase_admin` (seguimiento de 20270507600000). Esa migración solo endureció el rol
--     `postgres`; las tablas que crea `supabase_admin` (Studio, extensiones) en `public` seguían naciendo con TRUNCATE,
--     REFERENCES y TRIGGER (y MAINTAIN en PG 17+) para `authenticated`. Se extiende el mismo `revoke` a
--     `for role supabase_admin in schema public|dominio`, con el patrón de 20261013130000: SOLO si el rol existe y quien migra
--     es miembro suyo (si no, `alter default privileges for role` falla por falta de permiso). Si no puede, la migración sigue
--     con un aviso (`raise notice`) y el entorno queda como estaba; en local y en producción puede diferir. Reaplicable:
--     revocar un privilegio por defecto inexistente no falla ni cambia nada. No toca tablas existentes ni `service_role`.
--
-- (2) `actualizar_credencial_conexion(uuid, text)` y `confirmar_conexion_oauth(uuid, text)` (public) buscaban la conexión
--     SIN filtrar por organización y distinguían «no existe» (PT404) de «ajena» (42501): con un UUID ajeno se podía saber que
--     la conexión existe. Ahora el lookup solo ve conexiones de una organización de la que la persona es miembro (o si es
--     superadmin): una ajena y una inexistente responden lo mismo, PT404 con el mensaje «La conexión <id> no existe». Los
--     demás errores no cambian: un miembro sin rol de administrador de su propia organización sigue recibiendo 42501 con el
--     mismo mensaje. Se conservan `security definer`, `set search_path = ''` y el ACL (`create or replace` no lo toca).
--
-- Reaplicable (`create or replace` y `revoke`). Cubierto por `lote79_conexiones_sin_fuga_de_existencia.test.sql` y por
-- `acl_por_defecto_authenticated.test.sql`.
--
-- Reversión (en una migración posterior): para (2), volver a las definiciones anteriores, que son las de
-- 20270507490000 (la última migración que define cada función; verificado con
-- `grep -ln "function public.actualizar_credencial_conexion\|function public.confirmar_conexion_oauth" supabase/migrations/*.sql`):
-- `create or replace function public.actualizar_credencial_conexion(...)` y `public.confirmar_conexion_oauth(uuid, text)`
-- copiando su cuerpo, cuyo lookup es `where c.id = p_conexion_id` / `where id = p_conexion_id` sin filtro de organización.
-- Para (1), volver a otorgar lo quitado, solo si quien migra es miembro de supabase_admin:
--   alter default privileges for role supabase_admin in schema public grant truncate, references, trigger on tables to authenticated;
-- (las tablas ya creadas no cambian ni con esta migración ni con su reversión).

-- (1) Privilegios por defecto de supabase_admin.
do $$
declare
  v_privilegios text := 'truncate, references, trigger';
  v_esquema text;
begin
  if current_setting('server_version_num')::int >= 170000 then
    v_privilegios := v_privilegios || ', maintain';
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_admin')
     and pg_has_role(current_user, 'supabase_admin', 'member') then
    foreach v_esquema in array array['public', 'dominio'] loop
      if exists (select 1 from pg_namespace where nspname = v_esquema) then
        execute format('alter default privileges for role supabase_admin in schema %I revoke %s on tables from authenticated',
          v_esquema, v_privilegios);
      end if;
    end loop;
  else
    raise notice 'Se omiten los privilegios por defecto de supabase_admin (no existe o el rol que migra no es miembro); local y producción pueden diferir.';
  end if;
end $$;

-- (2) Conexiones: ajena e inexistente responden igual.
create or replace function public.actualizar_credencial_conexion(
  p_conexion_id uuid,
  p_nueva_credencial text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_vault_id uuid;
begin
  select c.organizacion_id, c.credencial_vault_id into v_organizacion_id, v_vault_id
  from public.conexiones c
  where c.id = p_conexion_id
    and ((select private.is_superadmin())
         or exists (select 1 from public.usuarios_organizacion u
                    where u.user_id = (select auth.uid()) and u.organizacion_id = c.organizacion_id));

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'PT404';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  perform vault.update_secret(v_vault_id, p_nueva_credencial);

  -- Una credencial nueva se presume válida, como al crear la conexión: sale
  -- de credencial_invalida para que la próxima ejecución la pruebe (FR-013).
  update public.conexiones
  set estado = case when estado = 'credencial_invalida' then 'activa' else estado end,
      updated_at = clock_timestamp()
  where id = p_conexion_id;
end;
$$;

create or replace function public.confirmar_conexion_oauth(p_conexion_id uuid, p_nango_connection_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion_id uuid;
  v_estado text;
begin
  select c.organizacion_id, c.estado into v_organizacion_id, v_estado
  from public.conexiones_oauth c
  where c.id = p_conexion_id
    and ((select private.is_superadmin())
         or exists (select 1 from public.usuarios_organizacion u
                    where u.user_id = (select auth.uid()) and u.organizacion_id = c.organizacion_id));

  if v_organizacion_id is null then
    raise exception 'La conexión % no existe', p_conexion_id using errcode = 'PT404';
  end if;

  if not (select private.es_administrador_de(v_organizacion_id)) then
    raise exception 'No puede gestionar conexiones de esta organización' using errcode = '42501';
  end if;

  update public.conexiones_oauth
  set estado = 'activa', nango_connection_id = p_nango_connection_id, updated_at = clock_timestamp()
  where id = p_conexion_id;

  insert into public.eventos_conexion_oauth (conexion_id, tipo, actor)
  values (p_conexion_id, case when v_estado = 'pendiente' then 'creada' else 'reautorizada' end, (select auth.uid()));
end;
$$;
