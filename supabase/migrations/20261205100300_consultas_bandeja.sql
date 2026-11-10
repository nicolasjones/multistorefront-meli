-- MSF-186 · F-CON-01 (FR-004): superficie de lectura de la bandeja de consultas.
--
-- Esquema (Principio VII): ninguna tabla nueva. Vista y RPC viven en `public` (superficie de
-- lectura/ejecución, no almacenan datos); los datos son los de `dominio.consultas`.
--
-- Seguridad:
--   * `public.consultas_bandeja` es `security_invoker`: aplica la RLS de `dominio.consultas`
--     (organización, empresa accesible y sección `consultas`). `anon` sin privilegios.
--   * Los nombres del producto y del responsable se resuelven con dos funciones internas
--     SECURITY DEFINER acotadas a la organización de la sesión, porque quien ve consultas puede no
--     tener acceso al catálogo ni a los perfiles ajenos.
--   * `contar_consultas_nuevas` es SECURITY INVOKER (cuenta lo que la RLS deja ver).
--   * `responsables_consultas` exige `consultas` >= lectura y empresa accesible.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop view public.consultas_bandeja;
--   drop function public.contar_consultas_nuevas(uuid);
--   drop function public.responsables_consultas(uuid);
--   drop function private.nombre_producto_consulta(uuid);
--   drop function private.nombre_responsable_consulta(uuid);

create or replace function private.nombre_producto_consulta(p_producto_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.nombre
  from dominio.productos p
  where p.id = p_producto_id
    and p.organizacion_id = (select private.organizacion_id());
$$;

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
    and u.organizacion_id = (select private.organizacion_id());
$$;

revoke execute on function private.nombre_producto_consulta(uuid) from public, anon;
revoke execute on function private.nombre_responsable_consulta(uuid) from public, anon;
grant execute on function private.nombre_producto_consulta(uuid) to authenticated;
grant execute on function private.nombre_responsable_consulta(uuid) to authenticated;

create or replace view public.consultas_bandeja
with (security_invoker = true) as
select
  c.id,
  c.empresa_id,
  e.nombre as empresa_nombre,
  c.origen,
  c.nombre,
  c.contacto,
  c.mensaje,
  c.producto_id,
  private.nombre_producto_consulta(c.producto_id) as producto_nombre,
  c.estado,
  c.responsable_id,
  private.nombre_responsable_consulta(c.responsable_id) as responsable_nombre,
  c.nota_interna,
  c.created_at,
  c.updated_at
from dominio.consultas c
join dominio.empresas e on e.id = c.empresa_id and e.organizacion_id = c.organizacion_id;

revoke all on public.consultas_bandeja from public, anon, authenticated;
grant select on public.consultas_bandeja to authenticated;

comment on view public.consultas_bandeja is
  'MSF-186: bandeja de consultas (security_invoker: RLS de dominio.consultas). producto_nombre es null si la consulta no tiene producto; la pantalla muestra «Sin producto».';

create or replace function public.contar_consultas_nuevas(p_empresa_id uuid default null)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from dominio.consultas c
  where c.estado = 'nueva'
    and (p_empresa_id is null or c.empresa_id = p_empresa_id);
$$;

revoke execute on function public.contar_consultas_nuevas(uuid) from public, anon;
grant execute on function public.contar_consultas_nuevas(uuid) to authenticated;

comment on function public.contar_consultas_nuevas(uuid) is
  'MSF-186: consultas en estado «nueva» que la RLS deja ver al usuario (contador del menú); filtra por empresa si se indica.';

create or replace function public.responsables_consultas(p_empresa_id uuid)
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null
     or (select private.nivel_seccion('consultas')) not in ('lectura', 'edicion')
     or not exists (select 1 from private.empresas_accesibles() ea where ea = p_empresa_id) then
    raise exception 'No tenés permiso para ver las consultas' using errcode = '42501';
  end if;

  return query
    select r.user_id, r.nombre
    from private.responsables_posibles(v_org, p_empresa_id) r
    order by lower(r.nombre), r.user_id;
end;
$$;

revoke execute on function public.responsables_consultas(uuid) from public, anon;
grant execute on function public.responsables_consultas(uuid) to authenticated;

comment on function public.responsables_consultas(uuid) is
  'MSF-186: personas a quienes se puede asignar una consulta de la empresa (activas, con acceso a la empresa y a la sección consultas).';
