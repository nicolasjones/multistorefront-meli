-- MSF-312 · F-TDA-04 (épica MSF-147, spec 20261022-084830-tienda-dominio-e-identidad,
-- FR-040, FR-043…FR-045, FR-047…FR-049): catálogo visible y destacados de la tienda.
--
-- Esquemas (Principio VII, re-verificado tabla por tabla):
--   * dominio.categorias_tienda -> `dominio`: qué categorías muestra la tienda de una empresa.
--   * dominio.productos_tienda  -> `dominio`: qué productos muestra y destaca esa tienda.
--   * `publico` (ya creado por F-TDA-01) sigue SIN tablas: solo la función de lectura anónima.
--   * Las RPC de gestión viven en `public` (contrato de la app) y los auxiliares en `private`.
--
-- Qué productos tiene una tienda: los de `dominio.producto_empresa` (F-CAT-07, «empresas que venden
-- el producto»). Ausencia de fila en las tablas nuevas = visible y no destacado (FR-040).
--
-- Visibilidad efectiva (FR-043): el producto está activo, su fila `visible` es verdadera y su categoría
-- (y la categoría padre, si es subcategoría) es visible; sin categoría depende solo de su estado y su
-- `visible`. El motivo de «no se muestra» se calcula en el servidor (FR-044): inactivo, o categoría oculta.
-- Un producto que la propia gestión dejó con `visible = false` no lleva motivo (el interruptor ya lo dice).
--
-- RLS: lectura por organización y sección Empresas. Las tablas NO tienen políticas de escritura ni
-- privilegios de escritura: solo escribe `public.guardar_catalogo_tienda` (SECURITY DEFINER con chequeo
-- explícito de edición en Empresas y de pertenencia a la organización). `anon` no recibe privilegios.
--
-- Migración aditiva. Reversión (migración posterior, solo mientras no haya datos productivos):
--   drop function publico.catalogo_visible_por_dominio(text);
--   drop function public.guardar_catalogo_tienda(uuid, jsonb, jsonb);
--   drop function public.listar_catalogo_tienda(uuid);
--   drop function private.catalogo_tienda_efectivo(uuid);
--   drop function private.actualizar_updated_at_tienda_catalogo();
--   drop table dominio.productos_tienda;
--   drop table dominio.categorias_tienda;
--   drop schema publico;   (solo si F-TDA-01/02/03 tampoco están aplicadas)

create schema if not exists publico;
revoke all on schema publico from public;
grant usage on schema publico to anon, authenticated;

-- ============================================================================
-- Tablas (FR-040)
-- ============================================================================

create table dominio.categorias_tienda (
  empresa_id uuid not null,
  categoria_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  visible boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, categoria_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  foreign key (categoria_id, organizacion_id)
    references dominio.categorias (id, organizacion_id) on delete cascade
);

comment on table dominio.categorias_tienda is
  'MSF-312 (F-TDA-04): visibilidad de una categoría en la tienda de una empresa. Sin fila = visible. Escritura solo por public.guardar_catalogo_tienda.';

create table dominio.productos_tienda (
  empresa_id uuid not null,
  producto_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  visible boolean not null default true,
  destacado boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, producto_id),
  foreign key (empresa_id, organizacion_id)
    references dominio.empresas (id, organizacion_id) on delete cascade,
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.productos_tienda is
  'MSF-312 (F-TDA-04): visibilidad y destacado de un producto en la tienda de una empresa. Sin fila = visible y no destacado. Escritura solo por public.guardar_catalogo_tienda.';

create index IF NOT EXISTS categorias_tienda_categoria_idx on dominio.categorias_tienda (categoria_id);
create index IF NOT EXISTS categorias_tienda_org_idx on dominio.categorias_tienda (organizacion_id);
create index IF NOT EXISTS productos_tienda_producto_idx on dominio.productos_tienda (producto_id);
create index IF NOT EXISTS productos_tienda_org_idx on dominio.productos_tienda (organizacion_id);

create or replace function private.actualizar_updated_at_tienda_catalogo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.actualizar_updated_at_tienda_catalogo() from public, anon, authenticated;

create trigger categorias_tienda_updated_at
  before update on dominio.categorias_tienda
  for each row execute function private.actualizar_updated_at_tienda_catalogo();
create trigger productos_tienda_updated_at
  before update on dominio.productos_tienda
  for each row execute function private.actualizar_updated_at_tienda_catalogo();

alter table dominio.categorias_tienda enable row level security;
alter table dominio.productos_tienda enable row level security;

create policy categorias_tienda_select on dominio.categorias_tienda
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

create policy productos_tienda_select on dominio.productos_tienda
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('empresas')) in ('lectura', 'edicion')
  );

revoke all on dominio.categorias_tienda, dominio.productos_tienda from public, anon, authenticated;
grant select on dominio.categorias_tienda, dominio.productos_tienda to authenticated;

-- ============================================================================
-- Visibilidad efectiva (FR-043, FR-044): una sola definición para la gestión, el resumen y la función pública
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
    -- Una categoría es visible si ella y su padre (si es subcategoría) lo son.
    select c.id,
           coalesce(ct.visible, true) and coalesce(cp.visible, true) as visible
      from dominio.categorias c
      join dominio.empresas e on e.id = p_empresa and e.organizacion_id = c.organizacion_id
      left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
      left join dominio.categorias_tienda cp on cp.empresa_id = p_empresa and cp.categoria_id = c.padre_id
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

revoke execute on function private.catalogo_tienda_efectivo(uuid) from public, anon, authenticated;

comment on function private.catalogo_tienda_efectivo(uuid) is
  'MSF-312: productos de una tienda con su visibilidad efectiva y motivo. Interna: sin chequeo de permisos, la llaman las RPC que ya lo hacen.';

-- ============================================================================
-- Lectura para la gestión (FR-043, FR-044, FR-045, FR-047)
-- ============================================================================

create or replace function public.listar_catalogo_tienda(p_empresa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_resultado jsonb;
begin
  if v_org is null or (select private.nivel_seccion('empresas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la tienda de esta empresa' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org) then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nombre', c.nombre,
               'padre_id', c.padre_id,
               'visible', coalesce(ct.visible, true),
               -- Productos de ESTA tienda asignados directamente a la categoría.
               'productos', (select count(*) from private.catalogo_tienda_efectivo(p_empresa) x where x.categoria_id = c.id)
             ) order by (c.padre_id is not null), c.posicion, c.id)
        from dominio.categorias c
        left join dominio.categorias_tienda ct on ct.empresa_id = p_empresa and ct.categoria_id = c.id
       where c.organizacion_id = v_org
    ), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.producto_id,
               'nombre', x.nombre,
               'moneda', x.moneda,
               'precio', x.precio,
               'stock', coalesce(x.stock, 0),
               'visible', x.visible,
               'destacado', x.destacado,
               'efectivo', x.efectivo,
               'motivo', x.motivo
             ) order by lower(x.nombre), x.producto_id)
        from private.catalogo_tienda_efectivo(p_empresa) x
    ), '[]'::jsonb),
    'resumen', (
      select jsonb_build_object(
               'visibles', count(*) filter (where x.efectivo),
               'destacados', count(*) filter (where x.efectivo and x.destacado))
        from private.catalogo_tienda_efectivo(p_empresa) x
    )
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke execute on function public.listar_catalogo_tienda(uuid) from public, anon;
grant execute on function public.listar_catalogo_tienda(uuid) to authenticated;

comment on function public.listar_catalogo_tienda(uuid) is
  'MSF-312: categorías (con conteo), productos (precio y stock de lectura, visibilidad efectiva y motivo) y resumen {visibles, destacados} de la tienda de una empresa. Lectura con sección Empresas.';

-- ============================================================================
-- Escritura transaccional e idempotente (FR-048)
-- ============================================================================

-- p_categorias: [{"id": uuid, "visible": bool}] · p_productos: [{"id": uuid, "visible": bool, "destacado": bool}]
-- Aplica solo la diferencia contra lo guardado; un valor igual al predeterminado (visible, no destacado)
-- borra la fila. Repetir la misma llamada no cambia nada ni deja evento. Devuelve el resumen.
create or replace function public.guardar_catalogo_tienda(p_empresa uuid, p_categorias jsonb, p_productos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_cambios integer := 0;
  v_n integer;
  v_empresa text;
  v_cats jsonb := coalesce(p_categorias, '[]'::jsonb);
  v_prods jsonb := coalesce(p_productos, '[]'::jsonb);
begin
  if v_org is null or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'Tu rol no puede editar la tienda de esta empresa' using errcode = '42501';
  end if;
  select e.nombre into v_empresa from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if v_empresa is null then
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_cats) <> 'array' or jsonb_typeof(v_prods) <> 'array' then
    raise exception 'Los cambios deben ser listas' using errcode = '22023';
  end if;

  -- Serializa dos guardados simultáneos de la misma tienda.
  perform pg_advisory_xact_lock(hashtextextended('tienda_catalogo:' || p_empresa::text, 0));

  -- Valida el formato sin tablas temporales (la función puede llamarse varias veces por transacción).
  begin
    perform 1 from jsonb_to_recordset(v_cats) as x(id uuid, visible boolean);
    perform 1 from jsonb_to_recordset(v_prods) as x(id uuid, visible boolean, destacado boolean);
  exception when others then
    raise exception 'Los cambios tienen un formato inválido' using errcode = '22023';
  end;

  if exists (select 1 from jsonb_to_recordset(v_cats) as x(id uuid, visible boolean) where x.id is null or x.visible is null)
     or exists (select 1 from jsonb_to_recordset(v_prods) as x(id uuid, visible boolean, destacado boolean)
                 where x.id is null or x.visible is null or x.destacado is null) then
    raise exception 'Los cambios tienen valores vacíos' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(v_cats) as x(id uuid)) <> (select count(distinct x.id) from jsonb_to_recordset(v_cats) as x(id uuid))
     or (select count(*) from jsonb_to_recordset(v_prods) as x(id uuid)) <> (select count(distinct x.id) from jsonb_to_recordset(v_prods) as x(id uuid)) then
    raise exception 'Hay elementos repetidos en los cambios' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(v_cats) as c(id uuid)
     where not exists (select 1 from dominio.categorias k where k.id = c.id and k.organizacion_id = v_org)
  ) then
    raise exception 'Alguna categoría no existe o no pertenece a tu organización' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_prods) as c(id uuid)
     where not exists (
       select 1 from dominio.producto_empresa pe
        where pe.producto_id = c.id and pe.empresa_id = p_empresa and pe.organizacion_id = v_org
     )
  ) then
    raise exception 'Algún producto no pertenece a esta tienda' using errcode = '22023';
  end if;

  -- Categorías: borra las que vuelven al valor predeterminado, inserta/actualiza el resto.
  delete from dominio.categorias_tienda t
   using jsonb_to_recordset(v_cats) as c(id uuid, visible boolean)
   where t.empresa_id = p_empresa and t.categoria_id = c.id and c.visible;
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  with up as (
    insert into dominio.categorias_tienda as t (empresa_id, categoria_id, organizacion_id, visible)
    select p_empresa, c.id, v_org, c.visible from jsonb_to_recordset(v_cats) as c(id uuid, visible boolean) where not c.visible
    on conflict (empresa_id, categoria_id) do update set visible = excluded.visible
      where t.visible is distinct from excluded.visible
    returning 1
  )
  select count(*) into v_n from up;
  v_cambios := v_cambios + v_n;

  -- Productos.
  delete from dominio.productos_tienda t
   using jsonb_to_recordset(v_prods) as c(id uuid, visible boolean, destacado boolean)
   where t.empresa_id = p_empresa and t.producto_id = c.id and c.visible and not c.destacado;
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  with up as (
    insert into dominio.productos_tienda as t (empresa_id, producto_id, organizacion_id, visible, destacado)
    select p_empresa, c.id, v_org, c.visible, c.destacado
      from jsonb_to_recordset(v_prods) as c(id uuid, visible boolean, destacado boolean)
     where not (c.visible and not c.destacado)
    on conflict (empresa_id, producto_id) do update
      set visible = excluded.visible, destacado = excluded.destacado
      where (t.visible, t.destacado) is distinct from (excluded.visible, excluded.destacado)
    returning 1
  )
  select count(*) into v_n from up;
  v_cambios := v_cambios + v_n;

  if v_cambios > 0 then
    perform private.insertar_actividad(
      v_org,
      (select auth.uid()),
      'tienda.catalogo_actualizado',
      format('Actualizó el catálogo visible de la tienda de «%s»', v_empresa),
      p_empresa
    );
  end if;

  return (
    select jsonb_build_object(
             'visibles', count(*) filter (where x.efectivo),
             'destacados', count(*) filter (where x.efectivo and x.destacado))
      from private.catalogo_tienda_efectivo(p_empresa) x
  );
end;
$$;

revoke execute on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) to authenticated;

comment on function public.guardar_catalogo_tienda(uuid, jsonb, jsonb) is
  'MSF-312: aplica en una transacción los cambios de visibilidad y destacados de la tienda de una empresa (edición en Empresas). Idempotente; emite tienda.catalogo_actualizado solo ante cambios reales. Devuelve {visibles, destacados}.';

-- ============================================================================
-- Lectura anónima (FR-049)
-- ============================================================================

-- Categorías visibles y productos efectivamente visibles (destacados primero). Lista blanca de campos:
-- nunca costos, stock exacto, proveedor ni ids de organización (ni rutas de imagen, que los llevan). Host desconocido o empresa desactivada
-- devuelven lo mismo: null.
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
      left join dominio.categorias_tienda ct on ct.empresa_id = t.empresa_id and ct.categoria_id = c.id
      left join dominio.categorias_tienda cp on cp.empresa_id = t.empresa_id and cp.categoria_id = c.padre_id
     where coalesce(ct.visible, true) and coalesce(cp.visible, true)
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

revoke execute on function publico.catalogo_visible_por_dominio(text) from public;
grant execute on function publico.catalogo_visible_por_dominio(text) to anon, authenticated;

comment on function publico.catalogo_visible_por_dominio(text) is
  'MSF-312: catálogo público de la tienda por host. Categorías visibles y productos efectivamente visibles (destacados primero) con nombre, precio, indicador de imagen (la ruta contiene el id de la organización y no se expone) y categoría. Sin costos, stock ni proveedor. Null si el dominio no existe o la empresa está desactivada.';
