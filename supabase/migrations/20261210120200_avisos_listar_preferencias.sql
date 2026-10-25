-- MSF-319 · F-NOT-01 (FR-003, FR-004): tipos de aviso visibles para el usuario con su preferencia.
-- Sin fila de preferencia = encendido.
--
-- Reversión (migración posterior): drop function public.listar_preferencias_aviso();

create or replace function public.listar_preferencias_aviso()
returns table (tipo text, nombre text, activo boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.clave, t.nombre, coalesce(p.activo, true)
  from public.tipos_aviso t
  left join public.preferencias_aviso p
    on p.tipo_aviso = t.clave and p.user_id = (select auth.uid())
  where (select private.nivel_seccion(t.seccion)) in ('lectura', 'edicion')
  order by t.nombre, t.clave;
$$;

comment on function public.listar_preferencias_aviso() is
  'Tipos de aviso de las secciones que el usuario actual puede ver (nivel >= lectura), con su preferencia; sin fila = encendido.';

revoke execute on function public.listar_preferencias_aviso() from public, anon;
grant execute on function public.listar_preferencias_aviso() to authenticated;
