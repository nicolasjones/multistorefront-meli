-- F-CAT-18 (MSF-416, épica MSF-229): productos relacionados (lista ordenada por producto).
-- Esquemas (Principio VII), verificados objeto por objeto:
--   dominio.producto_relacionados  dominio (tabla nueva)  vínculo ordenado entre dos productos: entidad de negocio
--                                                         del catálogo, junto a dominio.productos.
--   public.guardar_relacionados    public (función)       contrato de aplicación (security definer: el evento de
--                                                         actividad solo lo puede registrar una función definer;
--                                                         valida organización y rol edición antes de escribir).
--   public.v_producto_relacionados public (VISTA)         contrato de lectura; no es una tabla.
-- Aísla por organización con RLS y FKs compuestas a ambos extremos (un vínculo no cruza organizaciones).
-- Unidireccional: relacionar A con B no relaciona B con A. El vínculo se quita de verdad (sin historia propia).
--
-- Migración aditiva. Reversión (migración posterior, no en este PR; la tabla es dato nuevo):
--   drop function public.guardar_relacionados(uuid, uuid[]);
--   drop view public.v_producto_relacionados;
--   drop table dominio.producto_relacionados;

create table dominio.producto_relacionados (
  producto_id uuid not null,
  relacionado_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  orden integer not null check (orden >= 1),
  creado_en timestamptz not null default now(),
  primary key (producto_id, relacionado_id),
  check (producto_id <> relacionado_id),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade,
  foreign key (relacionado_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_relacionados is
  'F-CAT-18: productos relacionados de un producto, en el orden que ve el cliente (orden 1..N). Escritura por public.guardar_relacionados; lectura por RLS de organización y sección productos.';

create index if not exists producto_relacionados_orden_idx on dominio.producto_relacionados (organizacion_id, producto_id, orden);
-- Borrado en cascada del producto relacionado (segundo extremo de la FK).
create index if not exists producto_relacionados_relacionado_idx on dominio.producto_relacionados (relacionado_id, organizacion_id);

alter table dominio.producto_relacionados enable row level security;

create policy producto_relacionados_select on dominio.producto_relacionados
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy producto_relacionados_insert on dominio.producto_relacionados
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_relacionados_update on dominio.producto_relacionados
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_relacionados_delete on dominio.producto_relacionados
  for delete to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

-- Sin privilegios para anon; solo el orden se puede actualizar.
revoke all on dominio.producto_relacionados from public, anon, authenticated;
grant select, delete on dominio.producto_relacionados to authenticated;
grant insert (producto_id, relacionado_id, organizacion_id, orden) on dominio.producto_relacionados to authenticated;
grant update (orden) on dominio.producto_relacionados to authenticated;

-- ============================================================================
-- Escritura: reemplazo completo, atómico e idempotente (FR-017)
-- ============================================================================

create or replace function public.guardar_relacionados(p_producto uuid, p_relacionados uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_ids uuid[] := coalesce(p_relacionados, '{}'::uuid[]);
  v_antes uuid[];
  v_producto dominio.productos;
  v_actor uuid := (select auth.uid());
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;

  select * into v_producto from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org;
  if not found then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  if exists (select 1 from unnest(v_ids) as x(id) where x.id is null) then
    raise exception 'La lista de relacionados tiene valores vacíos' using errcode = '22023';
  end if;
  if p_producto = any (v_ids) then
    raise exception 'Un producto no puede relacionarse consigo mismo' using errcode = '22023';
  end if;
  if (select count(*) from unnest(v_ids)) <> (select count(distinct x.id) from unnest(v_ids) as x(id)) then
    raise exception 'La lista de relacionados repite un producto' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (select 1 from dominio.productos r where r.id = x.id and r.organizacion_id = v_org)
  ) then
    raise exception 'Alguno de los productos relacionados no existe' using errcode = 'P0002';
  end if;

  -- Serializa dos guardados simultáneos del mismo producto.
  perform pg_advisory_xact_lock(hashtextextended('producto_relacionados:' || p_producto::text, 0));

  select coalesce(array_agg(r.relacionado_id order by r.orden), '{}'::uuid[]) into v_antes
    from dominio.producto_relacionados r where r.producto_id = p_producto;

  if v_antes is distinct from v_ids then
    delete from dominio.producto_relacionados r
     where r.producto_id = p_producto and r.relacionado_id <> all (v_ids);

    insert into dominio.producto_relacionados (producto_id, relacionado_id, organizacion_id, orden)
    select p_producto, x.id, v_org, x.pos::integer
      from unnest(v_ids) with ordinality as x(id, pos)
    on conflict (producto_id, relacionado_id) do update set orden = excluded.orden;

    -- Evento solo con cambio real y con sesión; sin precios ni costo.
    if v_actor is not null then
      perform private.registrar_actividad(
        'producto.relacionados_editados',
        format('Cambió los productos relacionados de %s%s: %s',
          v_producto.nombre,
          case when v_producto.sku is null then '' else format(' (SKU %s)', v_producto.sku) end,
          case when cardinality(v_ids) = 0 then 'quitó todos'
               else (select string_agg(r.nombre, ', ' order by x.pos)
                       from unnest(v_ids) with ordinality as x(id, pos)
                       join dominio.productos r on r.id = x.id) end),
        null
      );
    end if;
  end if;

  return jsonb_build_object(
    'relacionados',
    coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'orden', x.pos) order by x.pos)
                from unnest(v_ids) with ordinality as x(id, pos)), '[]'::jsonb)
  );
end;
$$;

comment on function public.guardar_relacionados(uuid, uuid[]) is
  'F-CAT-18: reemplaza la lista ordenada de relacionados de un producto (atómica e idempotente). Exige edición en productos (42501); P0002 producto o relacionado inexistente/otra organización; 22023 el propio producto, un id repetido o vacío. Evento producto.relacionados_editados solo con cambio real.';

revoke execute on function public.guardar_relacionados(uuid, uuid[]) from public, anon;
grant execute on function public.guardar_relacionados(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Lectura: contrato para la ficha pública y los comprobantes (FR-018)
-- ============================================================================

create view public.v_producto_relacionados
with (security_invoker = true) as
select
  pr.producto_id,
  pr.relacionado_id,
  pr.orden,
  r.nombre,
  r.sku,
  (select case when cp.id is null then c.nombre else cp.nombre || ' > ' || c.nombre end
     from dominio.categorias c
     left join dominio.categorias cp on cp.id = c.padre_id and cp.organizacion_id = c.organizacion_id
    where c.id = r.categoria_id and c.organizacion_id = r.organizacion_id) as categoria,
  r.precio_lista as precio,
  r.moneda,
  r.activo
from dominio.producto_relacionados pr
join dominio.productos r on r.id = pr.relacionado_id and r.organizacion_id = pr.organizacion_id
order by pr.producto_id, pr.orden;

comment on view public.v_producto_relacionados is
  'F-CAT-18: relacionados de cada producto, ordenados (producto_id, relacionado_id, orden, nombre, sku, categoría, precio, moneda, activo). security_invoker: rige la RLS de las tablas base.';

revoke all on public.v_producto_relacionados from public, anon;
grant select on public.v_producto_relacionados to authenticated;
