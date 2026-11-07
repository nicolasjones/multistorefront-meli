-- F-SVC-02 (MSF-283, épica MSF-182): uso de modelos y estados por reparaciones.
-- Esquema: sin tablas nuevas (Principio VII).
--
-- Devuelven cuántas reparaciones usan cada modelo / estado, para avisar antes de desactivarlos
-- (FR-019). `security invoker`: rige la RLS de `dominio.reparaciones` (organización + nivel de
-- `service_tecnico`). Con `p_id` null devuelven todos los de la organización con al menos un uso.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.uso_estado_reparacion(uuid);
--   drop function public.uso_modelo_equipo(uuid);

create or replace function public.uso_modelo_equipo(p_id uuid default null)
returns table (id uuid, cantidad bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.modelo_id, count(*)
    from dominio.reparaciones r
   where p_id is null or r.modelo_id = p_id
   group by r.modelo_id;
$$;

comment on function public.uso_modelo_equipo(uuid) is
  'F-SVC-02: cantidad de reparaciones por modelo (todas las de la organización si p_id es null). RLS del llamador.';

revoke execute on function public.uso_modelo_equipo(uuid) from public, anon;
grant execute on function public.uso_modelo_equipo(uuid) to authenticated;

create or replace function public.uso_estado_reparacion(p_id uuid default null)
returns table (id uuid, cantidad bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.estado_id, count(*)
    from dominio.reparaciones r
   where p_id is null or r.estado_id = p_id
   group by r.estado_id;
$$;

comment on function public.uso_estado_reparacion(uuid) is
  'F-SVC-02: cantidad de reparaciones por estado (todas las de la organización si p_id es null). RLS del llamador.';

revoke execute on function public.uso_estado_reparacion(uuid) from public, anon;
grant execute on function public.uso_estado_reparacion(uuid) to authenticated;
