-- Categorías: guardar, reordenar y eliminar vuelven a funcionar con cualquiera de los dos modelos de niveles.
--
-- Problema: `guardar_categoria`, `reordenar_categorias` y `eliminar_categoria` ejecutaban
-- `set constraints dominio.categorias_dos_niveles immediate`. En una base donde el constraint de 2 niveles fue
-- reemplazado por el de 3 (`categorias_tres_niveles`) esa sentencia falla con «constraint does not exist» y
-- ninguna escritura de categorías se puede guardar (la app solo muestra «No pudimos guardar la categoría»).
--
-- Arreglo: las tres funciones fuerzan la validación inmediata sobre el constraint que exista (2 o 3 niveles),
-- para seguir fallando con el mensaje claro y no recién en el commit. Las definiciones son las vigentes.
-- Migración aditiva; reversión: volver a la definición anterior de cada función.

CREATE OR REPLACE FUNCTION public.guardar_categoria(p_id uuid, p_nombre text, p_padre_id uuid, p_empresa_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
      set constraints dominio.categorias_dos_niveles immediate;
    elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
      set constraints dominio.categorias_tres_niveles immediate;
    end if;
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_id;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.reordenar_categorias(p_orden jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if jsonb_array_length(p_orden) > 5000 then
    raise exception 'El orden admite hasta 5000 categorías por vez' using errcode = '22023';
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
    if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
      set constraints dominio.categorias_dos_niveles immediate;
    elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
      set constraints dominio.categorias_tres_niveles immediate;
    end if;
    perform set_config('catalogo.cat_ctx', '', true);
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_cambios;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.eliminar_categoria(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Nota: el conteo de productos del evento se hace bajo el RLS de quien llama (sin lectura en
  -- `productos` el resumen diría 0); la desasignación sí ocurre por la FK.
  -- Los productos quedan sin categoría por `on delete set null (categoria_id)`.
  delete from dominio.categorias where id = p_id and organizacion_id = v_org;
  if exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_dos_niveles') then
    set constraints dominio.categorias_dos_niveles immediate;
  elsif exists (select 1 from pg_constraint where conrelid = 'dominio.categorias'::regclass and conname = 'categorias_tres_niveles') then
    set constraints dominio.categorias_tres_niveles immediate;
  end if;

  perform set_config('catalogo.cat_ctx', '', true);
  perform set_config('catalogo.cat_eliminada_info', '', true);

  return jsonb_build_object('productos', v_productos, 'subcategorias', v_hijos);
end;
$function$

;

