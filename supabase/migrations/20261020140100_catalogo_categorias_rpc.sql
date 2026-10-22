-- F-CAT-08 (MSF-298, épica MSF-160): RPC de categorías y eventos de Actividad.
-- Esquema: sin tablas nuevas (opera sobre dominio.categorias y dominio.categorias_empresa; Principio VII).
-- Las RPC viven en `public` (contrato de la app) y los triggers/funciones internas en `private`.
--
-- Las tres RPC son SECURITY INVOKER: rigen las políticas RLS de quien llama (edición en `categorias`,
-- nunca `puede_escribir()`), son atómicas (una transacción) y toman el candado asesor por organización
-- (el mismo que toma el disparador de escritura) para serializar escrituras simultáneas.
--   * guardar_categoria(p_id, p_nombre, p_padre_id, p_empresa_ids): alta (p_id nulo) o edición; devuelve el id.
--     Errores: 42501 sin permiso, 22023 datos inválidos, P0002 inexistente, 23505 nombre repetido en el
--     nivel, 23514 viola los 2 niveles.
--   * reordenar_categorias(p_orden): recibe `[{id, padre_id, posicion}]`, persiste padre y posición en una
--     sola sentencia y valida los 2 niveles sobre el estado final. Devuelve cuántas filas cambiaron.
--   * eliminar_categoria(p_id): las subcategorías suben a raíz (rechaza si el nombre choca con una raíz), los
--     productos quedan sin categoría (`on delete set null (categoria_id)` de la migración siguiente) y se
--     elimina. Devuelve `{productos, subcategorias}` afectados.
--
-- Actividad (FR-023): los eventos `categoria.creada|editada|eliminada|reordenada` los emiten triggers por
-- sentencia (con tablas de transición) en la MISMA transacción, solo con sesión y solo ante cambios reales.
-- Las RPC marcan la transacción con variables locales (`catalogo.cat_ctx`, `catalogo.cat_visibilidad`,
-- `catalogo.cat_eliminada_info`) para que el reordenado emita UN solo evento y la eliminación no deje un
-- «editada» por cada subcategoría que sube. Detalle sin datos sensibles.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop trigger categorias_actividad_alta on dominio.categorias;
--   drop trigger categorias_actividad_cambio on dominio.categorias;
--   drop trigger categorias_actividad_baja on dominio.categorias;
--   drop function private.registrar_actividad_categoria_alta();
--   drop function private.registrar_actividad_categoria_cambio();
--   drop function private.registrar_actividad_categoria_baja();
--   drop function private.ruta_categoria(uuid);
--   drop function public.guardar_categoria(uuid, text, uuid, uuid[]);
--   drop function public.reordenar_categorias(jsonb);
--   drop function public.eliminar_categoria(uuid);

-- ============================================================================
-- Ruta legible «Padre > Hija» (solo para el detalle de Actividad).
-- ============================================================================

create or replace function private.ruta_categoria(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.id is null then c.nombre else p.nombre || ' > ' || c.nombre end
    from dominio.categorias c
    left join dominio.categorias p on p.id = c.padre_id and p.organizacion_id = c.organizacion_id
   where c.id = p_id;
$$;

revoke execute on function private.ruta_categoria(uuid) from public, anon, authenticated;

-- ============================================================================
-- guardar_categoria
-- ============================================================================

create or replace function public.guardar_categoria(
  p_id uuid,
  p_nombre text,
  p_padre_id uuid,
  p_empresa_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_ids uuid[];
  v_id uuid := p_id;
  v_actual dominio.categorias;
  v_posicion integer;
  v_cambio_empresas boolean := false;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if v_nombre = '' then
    raise exception 'El nombre es obligatorio' using errcode = '22023';
  end if;
  if length(v_nombre) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id) where x.id is null) then
    raise exception 'La lista de empresas tiene valores vacíos' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x.id), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as x(id);
  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (select 1 from dominio.empresas e where e.id = x.id and e.organizacion_id = v_org)
  ) then
    raise exception 'Alguna de las empresas no existe o no pertenece a tu organización' using errcode = '22023';
  end if;

  -- Serializa con cualquier otra escritura de categorías de la organización.
  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  if p_padre_id is not null and not exists (
    select 1 from dominio.categorias c where c.id = p_padre_id and c.organizacion_id = v_org
  ) then
    raise exception 'La categoría padre no existe' using errcode = 'P0002';
  end if;

  begin
    if p_id is null then
      select coalesce(max(c.posicion) + 1, 0) into v_posicion
        from dominio.categorias c
       where c.organizacion_id = v_org and c.padre_id is not distinct from p_padre_id;
      insert into dominio.categorias (organizacion_id, nombre, padre_id, posicion)
      values (v_org, v_nombre, p_padre_id, v_posicion)
      returning id into v_id;
      insert into dominio.categorias_empresa (categoria_id, empresa_id, organizacion_id)
      select v_id, x.id, v_org from unnest(v_ids) as x(id);
    else
      select * into v_actual from dominio.categorias c where c.id = p_id and c.organizacion_id = v_org;
      if not found then
        raise exception 'La categoría no existe' using errcode = 'P0002';
      end if;
      v_posicion := v_actual.posicion;
      if v_actual.padre_id is distinct from p_padre_id then
        -- Cambia de nivel: va al final de su nuevo nivel.
        select coalesce(max(c.posicion) + 1, 0) into v_posicion
          from dominio.categorias c
         where c.organizacion_id = v_org and c.padre_id is not distinct from p_padre_id;
      end if;

      -- Visibilidad: calcula el delta contra el estado actual (idempotente).
      delete from dominio.categorias_empresa ce
       where ce.categoria_id = p_id and ce.empresa_id <> all (v_ids);
      if found then v_cambio_empresas := true; end if;
      insert into dominio.categorias_empresa (categoria_id, empresa_id, organizacion_id)
      select p_id, x.id, v_org
        from unnest(v_ids) as x(id)
       where not exists (
         select 1 from dominio.categorias_empresa ce where ce.categoria_id = p_id and ce.empresa_id = x.id
       );
      if found then v_cambio_empresas := true; end if;

      if v_cambio_empresas then
        perform set_config('catalogo.cat_visibilidad', p_id::text, true);
      end if;
      update dominio.categorias
         set nombre = v_nombre, padre_id = p_padre_id, posicion = v_posicion
       where id = p_id;
      perform set_config('catalogo.cat_visibilidad', '', true);
    end if;
    -- Valida los 2 niveles ahora para fallar con el mensaje claro (no recién en el commit).
    set constraints categorias_dos_niveles immediate;
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_id;
end;
$$;

comment on function public.guardar_categoria(uuid, text, uuid, uuid[]) is
  'F-CAT-08: crea (p_id nulo) o edita una categoría con su visibilidad por tienda. Exige edición en categorias; 22023 datos inválidos, P0002 inexistente, 23505 nombre repetido en el nivel, 23514 más de 2 niveles. Devuelve el id.';

revoke execute on function public.guardar_categoria(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.guardar_categoria(uuid, text, uuid, uuid[]) to authenticated;

-- ============================================================================
-- reordenar_categorias
-- ============================================================================

create or replace function public.reordenar_categorias(p_orden jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambios integer;
  v_total integer;
  v_distintos integer;
  v_validos integer;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;
  if p_orden is null or jsonb_typeof(p_orden) <> 'array' then
    raise exception 'El orden debe ser una lista de categorías' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  begin
    select count(*), count(distinct x.id),
           count(*) filter (where x.id is not null and x.posicion is not null and x.posicion >= 0)
      into v_total, v_distintos, v_validos
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer);
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    raise exception 'El orden tiene valores inválidos' using errcode = '22023';
  end;
  if v_total <> v_validos or v_total <> v_distintos then
    raise exception 'El orden tiene categorías repetidas o valores inválidos' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where not exists (select 1 from dominio.categorias c where c.id = x.id and c.organizacion_id = v_org)
        or (x.padre_id is not null
            and not exists (select 1 from dominio.categorias c where c.id = x.padre_id and c.organizacion_id = v_org))
  ) then
    raise exception 'Alguna categoría no existe' using errcode = 'P0002';
  end if;

  begin
    perform set_config('catalogo.cat_ctx', 'reordenar', true);
    -- Una sola sentencia: un solo evento de Actividad y los 2 niveles se validan sobre el estado final.
    update dominio.categorias c
       set padre_id = x.padre_id, posicion = x.posicion
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where c.id = x.id
       and c.organizacion_id = v_org
       and (c.padre_id is distinct from x.padre_id or c.posicion <> x.posicion);
    get diagnostics v_cambios = row_count;
    set constraints categorias_dos_niveles immediate;
    perform set_config('catalogo.cat_ctx', '', true);
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_cambios;
end;
$$;

comment on function public.reordenar_categorias(jsonb) is
  'F-CAT-08: persiste padre y posición de las categorías ([{id, padre_id, posicion}]) de forma atómica, con candado por organización y validación de 2 niveles sobre el estado final. Devuelve cuántas cambiaron.';

revoke execute on function public.reordenar_categorias(jsonb) from public, anon;
grant execute on function public.reordenar_categorias(jsonb) to authenticated;

-- ============================================================================
-- eliminar_categoria
-- ============================================================================

create or replace function public.eliminar_categoria(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actual dominio.categorias;
  v_productos integer;
  v_hijos integer;
  v_base integer;
begin
  if v_org is null or (select private.nivel_seccion('categorias')) <> 'edicion' then
    raise exception 'Tu rol no puede editar categorías' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('categorias:' || v_org::text, 0));

  select * into v_actual from dominio.categorias c where c.id = p_id and c.organizacion_id = v_org;
  if not found then
    raise exception 'La categoría no existe' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_productos from dominio.productos p
   where p.categoria_id = p_id and p.organizacion_id = v_org;
  select count(*)::integer into v_hijos from dominio.categorias c
   where c.padre_id = p_id and c.organizacion_id = v_org;

  -- Las subcategorías suben a raíz: no pueden chocar con el nombre de otra raíz.
  if exists (
    select 1
      from dominio.categorias h
      join dominio.categorias r
        on r.organizacion_id = h.organizacion_id and r.padre_id is null and r.id <> p_id
       and lower(btrim(r.nombre)) = lower(btrim(h.nombre))
     where h.padre_id = p_id and h.organizacion_id = v_org
  ) then
    raise exception 'No se puede eliminar: una subcategoría tiene el mismo nombre que otra categoría raíz. Renombrala primero.'
      using errcode = '23505';
  end if;

  perform set_config('catalogo.cat_ctx', 'eliminar', true);
  perform set_config(
    'catalogo.cat_eliminada_info',
    format('%s sin categoría; %s a raíz',
      case when v_productos = 1 then '1 producto quedó' else v_productos || ' productos quedaron' end,
      case when v_hijos = 1 then '1 subcategoría subió' else v_hijos || ' subcategorías subieron' end),
    true
  );

  select coalesce(max(c.posicion), -1) into v_base
    from dominio.categorias c where c.organizacion_id = v_org and c.padre_id is null;
  update dominio.categorias h
     set padre_id = null, posicion = v_base + x.rn
    from (
      select c.id, row_number() over (order by c.posicion, lower(c.nombre), c.id)::integer as rn
        from dominio.categorias c where c.padre_id = p_id and c.organizacion_id = v_org
    ) x
   where h.id = x.id;

  -- Los productos quedan sin categoría por `on delete set null (categoria_id)`.
  delete from dominio.categorias where id = p_id and organizacion_id = v_org;
  set constraints categorias_dos_niveles immediate;

  perform set_config('catalogo.cat_ctx', '', true);
  perform set_config('catalogo.cat_eliminada_info', '', true);

  return jsonb_build_object('productos', v_productos, 'subcategorias', v_hijos);
end;
$$;

comment on function public.eliminar_categoria(uuid) is
  'F-CAT-08: elimina una categoría de forma atómica. Los productos quedan sin categoría y las subcategorías suben a raíz (23505 si el nombre choca con una raíz). Devuelve {productos, subcategorias}.';

revoke execute on function public.eliminar_categoria(uuid) from public, anon;
grant execute on function public.eliminar_categoria(uuid) to authenticated;

-- ============================================================================
-- Actividad: categoria.creada | editada | reordenada | eliminada
-- ============================================================================

create or replace function private.registrar_actividad_categoria_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_fila record;
begin
  if v_actor is null then
    return null;
  end if;
  for v_fila in select n.id, n.organizacion_id, n.padre_id from nuevas n loop
    perform private.insertar_actividad(
      v_fila.organizacion_id, v_actor, 'categoria.creada',
      format('Creó la %s %s',
        case when v_fila.padre_id is null then 'categoría' else 'subcategoría' end,
        private.ruta_categoria(v_fila.id)),
      null
    );
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_categoria_alta() from public, anon, authenticated;

create trigger categorias_actividad_alta
  after insert on dominio.categorias
  referencing new table as nuevas
  for each statement execute function private.registrar_actividad_categoria_alta();

create or replace function private.registrar_actividad_categoria_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ctx text := coalesce(current_setting('catalogo.cat_ctx', true), '');
  v_visibilidad text := coalesce(current_setting('catalogo.cat_visibilidad', true), '');
  v_cambios integer;
  v_org uuid;
  v_fila record;
begin
  -- Al eliminar, las subcategorías que suben a raíz no son ediciones: las cubre `categoria.eliminada`.
  if v_actor is null or v_ctx = 'eliminar' then
    return null;
  end if;
  if v_ctx = 'reordenar' then
    select count(*)::integer, min(n.organizacion_id::text)::uuid into v_cambios, v_org
      from nuevas n join viejas o on o.id = n.id
     where n.padre_id is distinct from o.padre_id or n.posicion <> o.posicion;
    if v_cambios > 0 then
      perform private.insertar_actividad(
        v_org, v_actor, 'categoria.reordenada',
        format('Reordenó las categorías (%s %s)', v_cambios, case when v_cambios = 1 then 'cambio' else 'cambios' end),
        null
      );
    end if;
    return null;
  end if;
  for v_fila in
    select n.id, n.organizacion_id
      from nuevas n join viejas o on o.id = n.id
     where n.nombre <> o.nombre or n.padre_id is distinct from o.padre_id or n.id::text = v_visibilidad
  loop
    perform private.insertar_actividad(
      v_fila.organizacion_id, v_actor, 'categoria.editada',
      format('Editó la categoría %s', private.ruta_categoria(v_fila.id)),
      null
    );
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_categoria_cambio() from public, anon, authenticated;

create trigger categorias_actividad_cambio
  after update on dominio.categorias
  referencing old table as viejas new table as nuevas
  for each statement execute function private.registrar_actividad_categoria_cambio();

create or replace function private.registrar_actividad_categoria_baja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_info text := nullif(current_setting('catalogo.cat_eliminada_info', true), '');
  v_fila record;
begin
  if v_actor is null then
    return null;
  end if;
  for v_fila in
    select o.organizacion_id, o.nombre, p.nombre as padre
      from viejas o
      left join dominio.categorias p on p.id = o.padre_id and p.organizacion_id = o.organizacion_id
  loop
    perform private.insertar_actividad(
      v_fila.organizacion_id, v_actor, 'categoria.eliminada',
      format('Eliminó la categoría %s%s',
        case when v_fila.padre is null then v_fila.nombre else v_fila.padre || ' > ' || v_fila.nombre end,
        case when v_info is null then '' else ': ' || v_info end),
      null
    );
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_categoria_baja() from public, anon, authenticated;

create trigger categorias_actividad_baja
  after delete on dominio.categorias
  referencing old table as viejas
  for each statement execute function private.registrar_actividad_categoria_baja();
