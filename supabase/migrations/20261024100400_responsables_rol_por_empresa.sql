-- MSF-186 · F-CON-01 (FR-003), devolución del Revisor: el nivel de `consultas` de un responsable
-- posible se resuelve con su rol EN LA EMPRESA (usuarios_empresas.rol_id), no con el de la
-- organización — igual que private.nivel_seccion. El Administrador usa `administrador`.
-- También: private.nombre_responsable_consulta exige `consultas` >= lectura a quien llama.
--
-- Esquema (Principio VII): sin tablas; solo se redefinen funciones. Migración aditiva.
-- Reversión: reaplicar las definiciones de 20261024100200 y 20261024100300.

create or replace function private.responsables_posibles(p_organizacion_id uuid, p_empresa_id uuid)
returns table (user_id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id,
         coalesce(nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''), a.email::text) as nombre
  from public.usuarios_organizacion u
  join auth.users a on a.id = u.user_id
  left join public.perfiles_usuario p on p.user_id = u.user_id
  left join public.usuarios_empresas ue
    on ue.user_id = u.user_id and ue.empresa_id = p_empresa_id and ue.organizacion_id = u.organizacion_id
  where u.organizacion_id = p_organizacion_id
    and u.estado = 'activo'
    and (u.rol_id = 'administrador' or ue.user_id is not null)
    and private.nivel_de_rol(
          u.organizacion_id,
          case when u.rol_id = 'administrador' then 'administrador' else ue.rol_id end,
          'consultas'
        ) in ('lectura', 'edicion');
$$;

revoke execute on function private.responsables_posibles(uuid, uuid) from public, anon, authenticated;

create or replace function private.nombre_responsable_consulta(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(concat_ws(' ', pf.nombre, pf.apellido)), ''), a.email::text)
  from public.usuarios_organizacion u
  join auth.users a on a.id = u.user_id
  left join public.perfiles_usuario pf on pf.user_id = u.user_id
  where u.user_id = p_user_id
    and u.organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('consultas')) in ('lectura', 'edicion');
$$;

revoke execute on function private.nombre_responsable_consulta(uuid) from public, anon;
grant execute on function private.nombre_responsable_consulta(uuid) to authenticated;
