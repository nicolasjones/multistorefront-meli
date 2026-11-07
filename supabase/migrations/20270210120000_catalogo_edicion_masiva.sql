-- F-CAT-12 (MSF-392, épica MSF-218): edición masiva de productos (categoría, estado y empresas).
-- Esquemas (Principio VII): NO se crea ni altera ninguna tabla. Las tres RPC van en `public` (contrato
-- de la app); los datos siguen en `dominio` (productos, producto_empresa). El ayudante de validación
-- vive en `private`.
--
-- Las RPC son SECURITY INVOKER: rigen las políticas RLS de quien llama y la sección `productos` en
-- edición. Aceptan de 1 a 100 ids, son atómicas (cualquier error revierte todo) e idempotentes, y
-- devuelven cuántos productos cambiaron de verdad. Cada una llama por producto a la RPC individual
-- existente (asignar_categoria_producto, cambiar_estado_producto, definir_empresas_producto), así que
-- los eventos de Actividad (producto.categoria_asignada, producto.activado|desactivado,
-- producto.empresas_actualizadas) salen uno por producto y solo ante un cambio real.
-- Errores: 42501 sin permiso; 22023 lista vacía, más de 100 ids o argumentos inválidos; P0002 producto
-- o categoría inexistente o de otra organización (empresa ajena o inexistente: 22023, como en la RPC
-- individual). Las filas se bloquean en orden de id para evitar interbloqueos entre dos ediciones masivas.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.definir_empresas_productos(uuid[], uuid[], uuid[]);
--   drop function public.cambiar_estado_productos(uuid[], boolean);
--   drop function public.mover_productos_categoria(uuid[], uuid);
--   drop function private.bloquear_productos_masivo(uuid[], uuid);

-- Valida la lista (1 a 100 ids, sin nulos), comprueba que todos son de la organización y bloquea las
-- filas en orden de id. Devuelve los ids sin repetir y ordenados.
create or replace function private.bloquear_productos_masivo(p_ids uuid[], p_org uuid)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_bloqueados uuid[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elegí al menos un producto' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ids) as x(id) where x.id is null) then
    raise exception 'La lista de productos tiene valores vacíos' using errcode = '22023';
  end if;
  select array_agg(distinct x.id order by x.id) into v_ids from unnest(p_ids) as x(id);
  if cardinality(v_ids) > 100 then
    raise exception 'Se pueden editar hasta 100 productos a la vez' using errcode = '22023';
  end if;

  select coalesce(array_agg(l.id order by l.id), '{}'::uuid[]) into v_bloqueados
    from (
      select p.id from dominio.productos p
       where p.id = any (v_ids) and p.organizacion_id = p_org
       order by p.id
       for update
    ) l;
  if cardinality(v_bloqueados) <> cardinality(v_ids) then
    raise exception 'Alguno de los productos no existe o no pertenece a tu organización' using errcode = 'P0002';
  end if;
  return v_ids;
end;
$$;

revoke execute on function private.bloquear_productos_masivo(uuid[], uuid) from public, anon;
grant execute on function private.bloquear_productos_masivo(uuid[], uuid) to authenticated;

-- ============================================================================
-- Mover de categoría
-- ============================================================================

create or replace function public.mover_productos_categoria(p_producto_ids uuid[], p_categoria_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_id uuid;
  v_cambiados integer := 0;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if p_categoria_id is null then
    raise exception 'La categoría es obligatoria' using errcode = '22023';
  end if;
  v_ids := private.bloquear_productos_masivo(p_producto_ids, v_org);
  if not exists (select 1 from dominio.categorias c where c.id = p_categoria_id and c.organizacion_id = v_org) then
    raise exception 'La categoría no existe' using errcode = 'P0002';
  end if;

  foreach v_id in array v_ids loop
    if exists (
      select 1 from dominio.productos p
       where p.id = v_id and p.categoria_id is distinct from p_categoria_id
    ) then
      perform public.asignar_categoria_producto(v_id, p_categoria_id);
      v_cambiados := v_cambiados + 1;
    end if;
  end loop;
  return v_cambiados;
end;
$$;

comment on function public.mover_productos_categoria(uuid[], uuid) is
  'F-CAT-12: mueve de 1 a 100 productos a una categoría (atómica e idempotente). Exige edición en productos; 22023 lista vacía, más de 100 o categoría nula; P0002 producto o categoría inexistentes. Devuelve cuántos cambiaron.';

revoke execute on function public.mover_productos_categoria(uuid[], uuid) from public, anon;
grant execute on function public.mover_productos_categoria(uuid[], uuid) to authenticated;

-- ============================================================================
-- Cambiar estado
-- ============================================================================

create or replace function public.cambiar_estado_productos(p_producto_ids uuid[], p_activo boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_id uuid;
  v_cambiados integer := 0;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de los productos' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;
  v_ids := private.bloquear_productos_masivo(p_producto_ids, v_org);

  foreach v_id in array v_ids loop
    if exists (select 1 from dominio.productos p where p.id = v_id and p.activo <> p_activo) then
      perform public.cambiar_estado_producto(v_id, p_activo);
      v_cambiados := v_cambiados + 1;
    end if;
  end loop;
  return v_cambiados;
end;
$$;

comment on function public.cambiar_estado_productos(uuid[], boolean) is
  'F-CAT-12: activa o desactiva de 1 a 100 productos (atómica e idempotente). Exige edición en productos; 22023 lista vacía, más de 100 o estado nulo; P0002 producto inexistente. Devuelve cuántos cambiaron.';

revoke execute on function public.cambiar_estado_productos(uuid[], boolean) from public, anon;
grant execute on function public.cambiar_estado_productos(uuid[], boolean) to authenticated;

-- ============================================================================
-- Cambiar empresas: (actuales ∪ agregar) − quitar, por producto
-- ============================================================================

create or replace function public.definir_empresas_productos(p_producto_ids uuid[], p_agregar uuid[], p_quitar uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_id uuid;
  v_agregar uuid[];
  v_quitar uuid[];
  v_actuales uuid[];
  v_nuevas uuid[];
  v_cambiados integer := 0;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_agregar, '{}'::uuid[]) || coalesce(p_quitar, '{}'::uuid[])) as x(id) where x.id is null) then
    raise exception 'La lista de empresas tiene valores vacíos' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_agregar from unnest(coalesce(p_agregar, '{}'::uuid[])) as x(id);
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_quitar from unnest(coalesce(p_quitar, '{}'::uuid[])) as x(id);
  if cardinality(v_agregar) = 0 and cardinality(v_quitar) = 0 then
    raise exception 'Elegí al menos una empresa para agregar o quitar' using errcode = '22023';
  end if;
  if v_agregar && v_quitar then
    raise exception 'Una empresa no puede estar a la vez en agregar y en quitar' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_agregar || v_quitar) as x(id)
     where not exists (select 1 from dominio.empresas e where e.id = x.id and e.organizacion_id = v_org)
  ) then
    raise exception 'Alguna de las empresas no existe o no pertenece a tu organización' using errcode = '22023';
  end if;
  v_ids := private.bloquear_productos_masivo(p_producto_ids, v_org);

  foreach v_id in array v_ids loop
    select coalesce(array_agg(pe.empresa_id order by pe.empresa_id), '{}'::uuid[]) into v_actuales
      from dominio.producto_empresa pe
     where pe.producto_id = v_id and pe.organizacion_id = v_org;
    select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_nuevas
      from (select unnest(v_actuales || v_agregar) as id) x
     where x.id <> all (v_quitar);
    -- distinct sobre el resultado: una empresa ya vinculada y en agregar no se repite.
    select coalesce(array_agg(distinct y.id order by y.id), '{}'::uuid[]) into v_nuevas from unnest(v_nuevas) as y(id);
    if v_nuevas is distinct from v_actuales then
      perform public.definir_empresas_producto(v_id, v_nuevas);
      v_cambiados := v_cambiados + 1;
    end if;
  end loop;
  return v_cambiados;
end;
$$;

comment on function public.definir_empresas_productos(uuid[], uuid[], uuid[]) is
  'F-CAT-12: agrega y/o quita empresas a de 1 a 100 productos (atómica e idempotente). Exige edición en productos; 22023 lista vacía, más de 100, empresas en ambas listas, ambas vacías o empresa ajena; P0002 producto inexistente. Devuelve cuántos cambiaron.';

revoke execute on function public.definir_empresas_productos(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.definir_empresas_productos(uuid[], uuid[], uuid[]) to authenticated;
