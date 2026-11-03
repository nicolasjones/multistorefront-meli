-- F-CAT-08 (spec 20261020-120000-catalogo-listado-y-categorias, Decisión 1 revisada): las categorías del catálogo
-- admiten 3 niveles (categoría / subcategoría / sub subcategoría) en vez de 2.
--
-- Por qué: el catálogo real del cliente (San Javucho) tiene árbol de tres niveles —«ACCESORIOS VIDEOJUEGOS >
-- SONY > PS3»— y hay que poder cargarlo tal cual, sin achatarlo ni renombrar sus categorías.
--
-- Qué cambia (nada se destruye: todo es aditivo o una redefinición de función):
--   * `private.validar_categorias_tres_niveles()` reemplaza a la de 2 niveles: una categoría puede tener padre
--     hasta el segundo nivel (queda en el tercero) y una categoría de tercer nivel no puede tener subcategorías.
--     Sigue sin permitirse que una categoría sea su propio padre ni que un nodo sea antepasado de sí mismo
--     (ciclos), ahora con la profundidad calculada sobre el árbol completo.
--   * El disparador diferido pasa de `dominio.categorias_dos_niveles` a `dominio.categorias_tres_niveles`, así
--     las validaciones siguen corriendo sobre el estado final de la transacción (un reordenado válido no falla
--     por estados intermedios) y las RPC siguen fallando con su mensaje claro.
--   * `private.categorias_visibles_efectivas(empresa)` es la nueva definición de «categoría visible»: la
--     categoría es visible si ella y TODAS sus antecesoras lo son (antes solo miraba al padre). Se usa en la
--     visibilidad efectiva del catálogo, en la lectura anónima y en la imagen pública.
--   * `private.ruta_categoria(id)` arma la ruta completa («Raíz > Sub > SubSub») para el registro de actividad.
--
-- Reversión (migración posterior, solo mientras no haya datos de tres niveles):
--   drop function private.categorias_visibles_efectivas(uuid);
--   drop function private.validar_categorias_tres_niveles();
--   create or replace function private.validar_categorias_dos_niveles() ... (la versión de 2 niveles);
--   drop trigger categorias_tres_niveles on dominio.categorias;
--   create constraint trigger categorias_dos_niveles after insert or update of padre_id on dominio.categorias
--     deferrable initially deferred for each row execute function private.validar_categorias_dos_niveles();
--   y volver a definir las RPC y las funciones de lectura con la versión de 2 niveles.

-- ============================================================================
-- Validación de la profundidad del árbol
-- ============================================================================

create or replace function private.validar_categorias_tres_niveles()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_padre uuid;
  v_profundidad integer := 1; -- 1 = raíz, 2 = subcategoría, 3 = sub subcategoría
  v_ciclo boolean := false;
begin
  select c.padre_id into v_padre from dominio.categorias c where c.id = new.id;
  if not found or v_padre is null then
    v_profundidad := 1;
  else
    if v_padre = new.id then
      raise exception 'Una categoría no puede ser su propia categoría padre' using errcode = '23514';
    end if;
    -- Profundidad del padre = cantidad de antecesoras (incluido él). El `union` (no `union all`) corta el
    -- recorrido aunque el árbol tuviera un ciclo, así que la consulta nunca se queda colgada.
    with recursive ancestros(id) as (
      select c.id from dominio.categorias c where c.id = v_padre
      union
      select c.padre_id
        from ancestros a
        join dominio.categorias c on c.id = a.id
       where c.padre_id is not null
    )
    select count(*), bool_or(a.id = new.id)
      into v_profundidad, v_ciclo
      from ancestros a;
    v_profundidad := coalesce(v_profundidad, 1) + 1;
    if v_ciclo then
      raise exception 'Una categoría no puede ser antepasada de sí misma' using errcode = '23514';
    end if;
    if v_profundidad > 3 then
      raise exception 'Las categorías admiten hasta 3 niveles: elegí una categoría de primer o segundo nivel como padre'
        using errcode = '23514';
    end if;
  end if;

  -- Una categoría de tercer nivel no puede tener subcategorías (el árbol tiene 3 niveles, no más).
  if v_profundidad >= 3 and exists (
    select 1 from dominio.categorias h where h.padre_id = new.id
  ) then
    raise exception 'Una categoría de tercer nivel no puede tener subcategorías (máximo 3 niveles)'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function private.validar_categorias_tres_niveles() from public, anon, authenticated;

drop trigger if exists categorias_dos_niveles on dominio.categorias;
drop trigger if exists categorias_tres_niveles on dominio.categorias;

create constraint trigger categorias_tres_niveles
  after insert or update of padre_id on dominio.categorias
  deferrable initially deferred
  for each row execute function private.validar_categorias_tres_niveles();

drop function if exists private.validar_categorias_dos_niveles();

-- ============================================================================
-- Visibilidad efectiva de una categoría: la categoría y todas sus antecesoras
-- ============================================================================

create or replace function private.categorias_visibles_efectivas(p_empresa uuid)
returns table (categoria_id uuid, visible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive cat as (
    select c.id, c.padre_id, coalesce(ct.visible, true) as visible
      from dominio.categorias c
      join dominio.empresas e on e.id = p_empresa and e.organizacion_id = c.organizacion_id
      left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
  ),
  efectivas as (
    select c.id, c.visible, 1 as nivel from cat c where c.padre_id is null
    union all
    select c.id, c.visible and p.visible, p.nivel + 1
      from cat c
      join efectivas p on p.id = c.padre_id
     where p.nivel < 5
  )
  select e.id, e.visible from efectivas e;
$$;

revoke execute on function private.categorias_visibles_efectivas(uuid) from public, anon, authenticated;

comment on function private.categorias_visibles_efectivas(uuid) is
  'F-CAT-08: visibilidad efectiva de cada categoría de una empresa: visible si ella y todas sus antecesoras lo están (árbol de 3 niveles).';

-- ============================================================================
-- Catálogo efectivo de la tienda (la usa la gestión y las lecturas públicas)
-- ============================================================================

create or replace function private.catalogo_tienda_efectivo(p_empresa uuid)
returns table (
  producto_id uuid,
  nombre text,
  activo boolean,
  moneda text,
  precio numeric,
  stock integer,
  categoria_id uuid,
  visible boolean,
  destacado boolean,
  efectivo boolean,
  motivo text
)
language sql
stable
security definer
set search_path = ''
as $$
  with cat as (
    -- Una categoría es visible si ella y todas sus antecesoras lo son.
    select v.categoria_id as id, v.visible
      from private.categorias_visibles_efectivas(p_empresa) v
  ),
  base as (
    select p.id, p.nombre, p.activo, p.moneda, p.precio_lista, p.categoria_id,
           coalesce(pt.visible, true) as visible,
           coalesce(pt.destacado, false) as destacado,
           coalesce(cat.visible, true) as cat_visible,
           ex.cantidad
      from dominio.producto_empresa pe
      join dominio.productos p on p.id = pe.producto_id and p.organizacion_id = pe.organizacion_id
      left join dominio.productos_tienda pt on pt.empresa_id = pe.empresa_id and pt.producto_id = p.id
      left join cat on cat.id = p.categoria_id
      left join dominio.existencias ex on ex.producto_id = p.id and ex.organizacion_id = p.organizacion_id
     where pe.empresa_id = p_empresa
  )
  select b.id, b.nombre, b.activo, b.moneda, b.precio_lista, b.cantidad, b.categoria_id, b.visible, b.destacado,
         b.activo and b.visible and b.cat_visible,
         case
           when not b.activo then 'No se muestra: producto inactivo'
           when not b.cat_visible then 'No se muestra: categoría oculta'
         end
    from base b;
$$;

comment on function private.catalogo_tienda_efectivo(uuid) is
  'MSF-312: productos de una tienda con su visibilidad efectiva y motivo. Interna: sin chequeo de permisos, la llaman las RPC que ya lo hacen.';

-- ============================================================================
-- Lectura anónima: catálogo y categorías visibles por host
-- ============================================================================

create or replace function publico.catalogo_visible_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select e.id as empresa_id, e.organizacion_id
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ),
  prod as (
    select x.*
      from t, lateral private.catalogo_tienda_efectivo(t.empresa_id) x
     where x.efectivo
  ),
  cat as (
    select c.id, c.nombre, c.padre_id, c.posicion
      from t
      join dominio.categorias c on c.organizacion_id = t.organizacion_id
      join private.categorias_visibles_efectivas(t.empresa_id) v on v.categoria_id = c.id
     where v.visible
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'padre_id', c.padre_id)
                       order by (c.padre_id is not null), c.posicion, c.id) from cat c), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.producto_id,
               'nombre', p.nombre,
               'moneda', p.moneda,
               'precio', p.precio,
               'tiene_imagen', exists (select 1 from dominio.producto_imagenes i where i.producto_id = p.producto_id),
               'categoria_id', p.categoria_id,
               'destacado', p.destacado
             ) order by p.destacado desc, lower(p.nombre), p.producto_id) from prod p), '[]'::jsonb)
  ) end;
$$;

create or replace function publico.categorias_por_dominio(host text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select e.id as empresa_id, e.organizacion_id
      from dominio.tiendas ti
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id
     where ti.dominio = private.normalizar_host(host) and e.activa
  ),
  prod as (
    select x.categoria_id
      from t, lateral private.catalogo_tienda_efectivo(t.empresa_id) x
     where x.efectivo and x.categoria_id is not null
  ),
  conteo as (
    select categoria_id, count(*) as n from prod group by categoria_id
  ),
  cat as (
    select c.id, c.nombre, c.padre_id, c.posicion
      from t
      join dominio.categorias c on c.organizacion_id = t.organizacion_id
      join private.categorias_visibles_efectivas(t.empresa_id) v on v.categoria_id = c.id
     where v.visible
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'productos', coalesce((select k.n from conteo k where k.categoria_id = c.id), 0)
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from cat c), '[]'::jsonb)
  ) end;
$$;

-- La imagen pública de un producto exige que su categoría (y todas sus antecesoras) se vean en la tienda.
create or replace function private.imagen_publica(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from dominio.producto_imagenes i
      join dominio.productos p on p.id = i.producto_id and p.organizacion_id = i.organizacion_id
      join dominio.producto_empresa pe on pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id
      join dominio.tiendas ti on ti.empresa_id = pe.empresa_id and ti.organizacion_id = pe.organizacion_id
      join dominio.empresas e on e.id = ti.empresa_id and e.organizacion_id = ti.organizacion_id and e.activa
      left join dominio.productos_tienda pt on pt.empresa_id = e.id and pt.producto_id = p.id
      left join dominio.categorias_tienda ct on ct.empresa_id = e.id and ct.categoria_id = p.categoria_id
     where i.ruta = p_ruta
       and p.activo
       and coalesce(pt.visible, true)
       and coalesce(ct.visible, true)
       and not exists (
         select 1
           from private.categorias_visibles_efectivas(e.id) v
          where v.categoria_id = p.categoria_id and not v.visible
       )
  );
$$;

comment on function private.imagen_publica(text) is
  'F-TDA-12 (D1): true si la ruta del bucket productos-imagenes es una imagen de un producto efectivamente visible de una tienda activa. Respalda la política de lectura de anon; devuelve solo el booleano.';

-- ============================================================================
-- Ruta completa de la categoría (registro de actividad)
-- ============================================================================

create or replace function private.ruta_categoria(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with recursive ruta(id, nombre, padre_id, camino, nivel) as (
    select c.id, c.nombre, c.padre_id, c.nombre, 1
      from dominio.categorias c
     where c.id = p_id
    union all
    select p.id, p.nombre, p.padre_id, p.nombre || ' > ' || r.camino, r.nivel + 1
      from ruta r
      join dominio.categorias p on p.id = r.padre_id
     where r.nivel < 5
  )
  select camino from ruta order by nivel desc limit 1;
$$;

-- ============================================================================
-- RPC de categorías: el mismo comportamiento con 3 niveles
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
      select p_id, x.id, v_org from unnest(v_ids) as x(id)
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
    -- Valida los 3 niveles ahora para fallar con el mensaje claro (no recién en el commit).
    set constraints dominio.categorias_tres_niveles immediate;
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_id;
end;
$$;

comment on function public.guardar_categoria(uuid, text, uuid, uuid[]) is
  'F-CAT-08: crea (p_id nulo) o edita una categoría con su visibilidad por tienda. Exige edición en categorias; 22023 datos inválidos, P0002 inexistente, 23505 nombre repetido en el nivel, 23514 más de 3 niveles. Devuelve el id.';

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
    -- Una sola sentencia: un solo evento de Actividad y los 3 niveles se validan sobre el estado final.
    update dominio.categorias c
       set padre_id = x.padre_id, posicion = x.posicion
      from jsonb_to_recordset(p_orden) as x(id uuid, padre_id uuid, posicion integer)
     where c.id = x.id
       and c.organizacion_id = v_org
       and (c.padre_id is distinct from x.padre_id or c.posicion <> x.posicion);
    get diagnostics v_cambios = row_count;
    set constraints dominio.categorias_tres_niveles immediate;
    perform set_config('catalogo.cat_ctx', '', true);
  exception when unique_violation then
    raise exception 'Ya existe una categoría con ese nombre en ese nivel' using errcode = '23505';
  end;

  return v_cambios;
end;
$$;

comment on function public.reordenar_categorias(jsonb) is
  'F-CAT-08: persiste padre y posición de las categorías ([{id, padre_id, posicion}]) de forma atómica, con candado por organización y validación de 3 niveles sobre el estado final. Devuelve cuántas cambiaron.';

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

  -- Nota: el conteo de productos del evento se hace bajo el RLS de quien llama (sin lectura en
  -- `productos` el resumen diría 0); la desasignación sí ocurre por la FK.
  -- Los productos quedan sin categoría por `on delete set null (categoria_id)`.
  delete from dominio.categorias where id = p_id and organizacion_id = v_org;
  set constraints dominio.categorias_tres_niveles immediate;

  perform set_config('catalogo.cat_ctx', '', true);
  perform set_config('catalogo.cat_eliminada_info', '', true);

  return jsonb_build_object('productos', v_productos, 'subcategorias', v_hijos);
end;
$$;

comment on function public.eliminar_categoria(uuid) is
  'F-CAT-08: elimina una categoría de forma atómica. Los productos quedan sin categoría y las subcategorías suben a raíz (23505 si el nombre choca con una raíz). Devuelve {productos, subcategorias}.';

-- ============================================================================
-- Listado de productos: la ruta de la categoría y la cadena de antecesoras
-- ============================================================================
-- `categoria_ruta` pasa a ser la ruta completa («Raíz > Sub > SubSub») y `categoria_ids` la cadena
-- [categoría, padre, abuelo], para que el filtro por una raíz siga incluyendo toda su rama.

create or replace view public.v_productos_listado
with (security_invoker = true) as
with recursive cat as (
  select c.id, c.organizacion_id, c.nombre, c.padre_id,
         c.nombre::text as ruta,
         array[c.id] as ids,
         1 as nivel
    from dominio.categorias c
   where c.padre_id is null
  union all
  select p.id, p.organizacion_id, p.nombre, p.padre_id,
         c.ruta || ' > ' || p.nombre,
         array[p.id] || c.ids,
         c.nivel + 1
    from dominio.categorias p
    join cat c on p.padre_id = c.id and p.organizacion_id = c.organizacion_id
   where c.nivel < 3
)
select
  p.id,
  p.organizacion_id,
  p.nombre,
  p.sku,
  p.activo,
  (select i.ruta
     from dominio.producto_imagenes i
    where i.producto_id = p.id and i.organizacion_id = p.organizacion_id
    order by i.posicion
    limit 1) as imagen_ruta,
  p.updated_at,
  coalesce(
    (select array_agg(pe.empresa_id order by pe.empresa_id)
       from dominio.producto_empresa pe
      where pe.producto_id = p.id and pe.organizacion_id = p.organizacion_id),
    '{}'::uuid[]
  ) as empresa_ids,
  p.categoria_id,
  (select c.ruta from cat c where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ruta,
  (select c.ids from cat c where c.id = p.categoria_id and c.organizacion_id = p.organizacion_id) as categoria_ids,
  -- F-CAT-17: misma regla que private.disponibilidad_producto(uuid), evaluada por lotes.
  coalesce(
    p.disponibilidad_manual,
    case when p.id in (select private.productos_con_stock()) then 'stock' else 'sin_stock' end
  ) as disponibilidad,
  -- F-CAT-14: búsqueda por escaneo (coincidencia exacta de EAN-13 en el servidor).
  p.codigo_barras
from dominio.productos p;

comment on view public.v_productos_listado is
  'F-CAT-01/07/08/17/14: listado de productos (id, nombre, SKU, estado, imagen principal, empresa_ids, categoría (ruta y cadena de antecesoras), disponibilidad, código de barras). security_invoker: rige la RLS de las tablas base. Sin costo.';

revoke all on public.v_productos_listado from public, anon;
grant select on public.v_productos_listado to authenticated;

-- ============================================================================
-- Actividad de baja: la ruta completa de la categoría eliminada
-- ============================================================================

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
    with recursive ruta as (
      select o.organizacion_id, o.id, o.padre_id, o.nombre::text as camino, 1 as nivel
        from viejas o
      union all
      select r.organizacion_id, p.id, p.padre_id, r.camino || ' > ' || p.nombre, r.nivel + 1
        from ruta r
        join dominio.categorias p on p.id = r.padre_id and p.organizacion_id = r.organizacion_id
       where r.nivel < 3
    )
    select distinct on (organizacion_id, id) organizacion_id, id, camino
      from ruta
     order by organizacion_id, id, nivel desc
  loop
    perform private.insertar_actividad(
      v_fila.organizacion_id, v_actor, 'categoria.eliminada',
      format('Eliminó la categoría %s%s', v_fila.camino,
        case when v_info is null then '' else ': ' || v_info end),
      null
    );
  end loop;
  return null;
end;
$$;

revoke execute on function private.registrar_actividad_categoria_baja() from public, anon, authenticated;
