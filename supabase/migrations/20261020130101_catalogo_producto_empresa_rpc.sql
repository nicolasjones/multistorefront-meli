-- F-CAT-07 (MSF-276, épica MSF-160): RPC para definir las empresas de un producto y evento de Actividad.
-- Esquema: sin tablas nuevas (opera sobre dominio.producto_empresa; Principio VII). La RPC vive en
-- `public` (contrato de la app) y los triggers/funciones internas en `private`.
--
-- `definir_empresas_producto` es SECURITY INVOKER: rigen las políticas RLS de quien llama
-- (edición en `productos`). Es atómica (una transacción) e idempotente: calcula el delta contra el
-- estado actual, inserta solo lo que falta y borra solo lo que sobra; repetir la misma lista no
-- cambia nada ni deja evento. Errores: 42501 sin permiso, P0002 producto inexistente, 22023 empresa
-- ajena o inexistente (sin cambios parciales).
--
-- Actividad (FR-014): el evento `producto.empresas_actualizadas` lo emiten triggers por sentencia
-- (con tablas de transición) en la MISMA transacción, solo ante cambios reales y con sesión. La RPC
-- inserta primero y borra después: el trigger de alta guarda lo agregado en una variable local de la
-- transacción y el de baja emite UN solo evento «agregó …; quitó …». Sin precios ni costo.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger producto_empresa_actividad_baja on dominio.producto_empresa;
--   drop trigger producto_empresa_actividad_alta on dominio.producto_empresa;
--   drop function private.registrar_actividad_empresas_baja();
--   drop function private.registrar_actividad_empresas_alta();
--   drop function private.registrar_actividad_empresas_producto(uuid, uuid, text, text);
--   drop function public.definir_empresas_producto(uuid, uuid[]);

create or replace function public.definir_empresas_producto(p_producto_id uuid, p_empresa_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[];
  v_total integer;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.productos p where p.id = p_producto_id and p.organizacion_id = v_org
  ) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  if exists (select 1 from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id) where x.id is null) then
    raise exception 'La lista de empresas tiene valores vacíos' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id);

  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (
       select 1 from dominio.empresas e where e.id = x.id and e.organizacion_id = v_org
     )
  ) then
    raise exception 'Alguna de las empresas no existe o no pertenece a tu organización' using errcode = '22023';
  end if;

  -- Serializa dos guardados simultáneos del mismo producto (delta consistente).
  perform pg_advisory_xact_lock(hashtextextended('producto_empresa:' || p_producto_id::text, 0));

  -- Marca la transacción para que los triggers combinen alta y baja en un solo evento.
  perform set_config('catalogo.pe_producto', p_producto_id::text, true);
  perform set_config('catalogo.pe_agregadas', '', true);

  insert into dominio.producto_empresa (producto_id, empresa_id, organizacion_id)
  select p_producto_id, x.id, v_org
    from unnest(v_ids) as x(id)
   where not exists (
     select 1 from dominio.producto_empresa pe
      where pe.producto_id = p_producto_id and pe.empresa_id = x.id
   );

  -- Corre siempre (aunque no borre filas): el trigger de baja emite el evento combinado.
  delete from dominio.producto_empresa pe
   where pe.producto_id = p_producto_id and pe.empresa_id <> all (v_ids);

  perform set_config('catalogo.pe_producto', '', true);
  perform set_config('catalogo.pe_agregadas', '', true);

  select count(*)::integer into v_total from dominio.producto_empresa pe where pe.producto_id = p_producto_id;
  return v_total;
end;
$$;

comment on function public.definir_empresas_producto(uuid, uuid[]) is
  'F-CAT-07: reemplaza el conjunto de empresas que venden un producto (atómica e idempotente). Exige edición en productos; 22023 empresa ajena, P0002 producto inexistente. Devuelve cuántas empresas quedan.';

revoke execute on function public.definir_empresas_producto(uuid, uuid[]) from public, anon;
grant execute on function public.definir_empresas_producto(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Actividad: un evento por producto con el detalle de lo agregado y lo quitado.
-- ============================================================================

create or replace function private.registrar_actividad_empresas_producto(
  p_organizacion_id uuid,
  p_producto_id uuid,
  p_agregadas text,
  p_quitadas text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_producto dominio.productos;
begin
  if v_actor is null or (coalesce(p_agregadas, '') = '' and coalesce(p_quitadas, '') = '') then
    return;
  end if;
  select * into v_producto from dominio.productos where id = p_producto_id;
  if not found then
    return;
  end if;
  perform private.insertar_actividad(
    p_organizacion_id, v_actor, 'producto.empresas_actualizadas',
    format('Cambió las empresas del producto %s%s: %s',
      v_producto.nombre,
      case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end,
      array_to_string(array[
        case when coalesce(p_agregadas, '') <> '' then 'agregó ' || p_agregadas end,
        case when coalesce(p_quitadas, '') <> '' then 'quitó ' || p_quitadas end
      ], '; ')),
    null
  );
end;
$$;

revoke execute on function private.registrar_actividad_empresas_producto(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function private.registrar_actividad_empresas_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_producto text := nullif(current_setting('catalogo.pe_producto', true), '');
  v_fila record;
begin
  if v_producto is not null then
    -- Desde la RPC: se guarda lo agregado; el trigger de baja emite el evento combinado.
    perform set_config('catalogo.pe_agregadas',
      coalesce((select string_agg(e.nombre, ', ' order by e.nombre)
                  from nuevas n join dominio.empresas e on e.id = n.empresa_id), ''),
      true);
    return null;
  end if;
  -- Alta directa (sin la RPC): un evento por producto.
  for v_fila in
    select n.organizacion_id, n.producto_id, string_agg(e.nombre, ', ' order by e.nombre) as nombres
      from nuevas n join dominio.empresas e on e.id = n.empresa_id
     group by n.organizacion_id, n.producto_id
  loop
    perform private.registrar_actividad_empresas_producto(v_fila.organizacion_id, v_fila.producto_id, v_fila.nombres, null);
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_empresas_alta() from public, anon, authenticated;

create trigger producto_empresa_actividad_alta
  after insert on dominio.producto_empresa
  referencing new table as nuevas
  for each statement execute function private.registrar_actividad_empresas_alta();

create or replace function private.registrar_actividad_empresas_baja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_producto text := nullif(current_setting('catalogo.pe_producto', true), '');
  v_agregadas text := coalesce(current_setting('catalogo.pe_agregadas', true), '');
  v_quitadas text;
  v_org uuid;
  v_fila record;
begin
  if v_producto is not null then
    select string_agg(e.nombre, ', ' order by e.nombre) into v_quitadas
      from viejas o join dominio.empresas e on e.id = o.empresa_id
     where o.producto_id = v_producto::uuid;
    select p.organizacion_id into v_org from dominio.productos p where p.id = v_producto::uuid;
    perform private.registrar_actividad_empresas_producto(v_org, v_producto::uuid, v_agregadas, v_quitadas);
    return null;
  end if;
  -- Baja directa (sin la RPC, o en cascada): un evento por producto.
  for v_fila in
    select o.organizacion_id, o.producto_id, string_agg(e.nombre, ', ' order by e.nombre) as nombres
      from viejas o join dominio.empresas e on e.id = o.empresa_id
     group by o.organizacion_id, o.producto_id
  loop
    perform private.registrar_actividad_empresas_producto(v_fila.organizacion_id, v_fila.producto_id, null, v_fila.nombres);
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_empresas_baja() from public, anon, authenticated;

create trigger producto_empresa_actividad_baja
  after delete on dominio.producto_empresa
  referencing old table as viejas
  for each statement execute function private.registrar_actividad_empresas_baja();
