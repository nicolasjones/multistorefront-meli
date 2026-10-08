-- Contexto de lectura para el panel operativo (spec 018-kit-panel-operable).
-- Migración aditiva: no crea tablas ni modifica las policies existentes.

create or replace function public.contexto_panel_actual()
returns table (
  es_superadmin boolean,
  organizacion_id uuid,
  organizacion_nombre text,
  rol_efectivo text,
  puede_escribir boolean,
  puede_copiar_identificador_tecnico boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with contexto as (
    select
      (select private.is_superadmin()) as es_superadmin,
      (select private.organizacion_id()) as organizacion_id,
      (select private.rol_id()) as rol_efectivo,
      (select private.puede_escribir()) as puede_escribir
  )
  select
    c.es_superadmin,
    c.organizacion_id,
    o.nombre as organizacion_nombre,
    c.rol_efectivo,
    c.puede_escribir,
    c.es_superadmin as puede_copiar_identificador_tecnico
  from contexto c
  left join public.organizaciones o on o.id = c.organizacion_id;
$$;

comment on function public.contexto_panel_actual() is
  'Contexto mínimo del JWT actual para presentar navegación y permisos del panel. No autoriza mutaciones ni acepta user_id.';

revoke all on function public.contexto_panel_actual() from public, anon;
grant execute on function public.contexto_panel_actual() to authenticated;
