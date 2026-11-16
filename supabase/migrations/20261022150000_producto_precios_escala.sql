-- F-PRE-15 (MSF-220, épica MSF-114): precios por escala del producto.
-- Esquema (Principio VII): `dominio.producto_precios_escala` es un dato de negocio del producto
-- (su precio según la escala de venta) → `dominio`, nunca `public`. La RPC es superficie de
-- ejecución en `public` y no almacena datos.
--
-- Modelo (FR-024): **x1 es el precio de lista** del producto (no se duplica acá); la tabla guarda
-- solo x5, x10 y x50, sin IVA y en la moneda del producto. `precio` nulo = «escala sin precio
-- cargado» (cae en el precio de lista): como la tabla no tiene DELETE, así se quita una escala.
-- Aislamiento: FK compuesta (producto_id, organizacion_id) → no puede apuntar a un producto de
-- otra organización. Lectura: sección `productos` ≥ lectura. Escritura: `productos` = edición.
-- Sin DELETE. `anon` sin privilegios.
--
-- `public.guardar_precios_escala(producto, x5, x10, x50)` guarda las TRES escalas de una vez
-- (nulo = sin precio), es idempotente (guardar lo mismo no toca nada ni deja evento) y es
-- SECURITY INVOKER: rigen las políticas RLS del llamador.
-- Errores: 42501 sin permiso · P0002 producto inexistente (o ajeno) · 23514 precio negativo o con
-- más de 2 decimales · 22003 importe demasiado grande.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes los precios):
--   drop trigger producto_precios_escala_registrar on dominio.producto_precios_escala;
--   drop function private.registrar_precio_escala();
--   drop trigger producto_precios_escala_tocar on dominio.producto_precios_escala;
--   drop function private.tocar_precio_escala();
--   drop function public.guardar_precios_escala(uuid, numeric, numeric, numeric);
--   drop table dominio.producto_precios_escala;

create table dominio.producto_precios_escala (
  producto_id uuid not null,
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  escala text not null check (escala in ('x5', 'x10', 'x50')),
  precio numeric(14, 2) check (precio >= 0),
  updated_at timestamptz not null default now(),
  primary key (producto_id, escala),
  foreign key (producto_id, organizacion_id)
    references dominio.productos (id, organizacion_id) on delete cascade
);

comment on table dominio.producto_precios_escala is
  'Precio sin IVA de las escalas x5, x10 y x50 de un producto, en su moneda (F-PRE-15). x1 es productos.precio_lista. Sin política DELETE: precio nulo = sin precio cargado.';

create index producto_precios_escala_organizacion_idx
  on dominio.producto_precios_escala (organizacion_id);

create or replace function private.tocar_precio_escala()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.precio is not distinct from old.precio then
    new.updated_at := old.updated_at;
  else
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke execute on function private.tocar_precio_escala() from public, anon, authenticated;

create trigger producto_precios_escala_tocar
  before update on dominio.producto_precios_escala
  for each row execute function private.tocar_precio_escala();

-- Actividad: un cambio real de una escala deja `producto.precio_actualizado` (sin importes en el detalle).
create or replace function private.registrar_precio_escala()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_nombre text;
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.precio is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.precio is not distinct from old.precio then
    return new;
  end if;
  select p.nombre into v_nombre from dominio.productos p where p.id = new.producto_id;
  perform private.insertar_actividad(
    new.organizacion_id, v_actor, 'producto.precio_actualizado',
    format('Cambió el precio de la escala %s de %s', new.escala, coalesce(v_nombre, 'un producto')),
    null
  );
  return new;
end;
$$;

revoke execute on function private.registrar_precio_escala() from public, anon, authenticated;

create trigger producto_precios_escala_registrar
  after insert or update on dominio.producto_precios_escala
  for each row execute function private.registrar_precio_escala();

alter table dominio.producto_precios_escala enable row level security;

create policy producto_precios_escala_select on dominio.producto_precios_escala
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) in ('lectura', 'edicion')
  );

create policy producto_precios_escala_insert on dominio.producto_precios_escala
  for insert to authenticated
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

create policy producto_precios_escala_update on dominio.producto_precios_escala
  for update to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  )
  with check (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('productos')) = 'edicion'
  );

grant usage on schema dominio to authenticated;

revoke all on dominio.producto_precios_escala from public, anon, authenticated;
grant select on dominio.producto_precios_escala to authenticated;
grant insert (producto_id, organizacion_id, escala, precio) on dominio.producto_precios_escala to authenticated;
grant update (precio) on dominio.producto_precios_escala to authenticated;

-- ============================================================================
-- RPC: guardar los precios por escala de un producto
-- ============================================================================

create or replace function public.guardar_precios_escala(
  p_producto uuid,
  p_x5 numeric default null,
  p_x10 numeric default null,
  p_x50 numeric default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_escala text;
  v_precio numeric;
begin
  if v_org is null or (select private.nivel_seccion('productos')) <> 'edicion' then
    raise exception 'Tu rol no puede editar productos' using errcode = '42501';
  end if;
  if not exists (select 1 from dominio.productos p where p.id = p_producto and p.organizacion_id = v_org) then
    raise exception 'El producto no existe' using errcode = 'P0002';
  end if;

  for v_escala, v_precio in
    select t.escala, t.precio from (values ('x5', p_x5), ('x10', p_x10), ('x50', p_x50)) as t (escala, precio)
  loop
    if v_precio is not null and (v_precio < 0 or v_precio <> round(v_precio, 2)) then
      raise exception 'El precio de la escala % debe ser cero o mayor, con hasta 2 decimales', v_escala
        using errcode = '23514';
    end if;
    if v_precio is not null and v_precio >= 1e12 then
      raise exception 'El precio de la escala % es demasiado grande', v_escala using errcode = '22003';
    end if;
    -- Sin precio y sin fila previa no hay nada que guardar.
    if v_precio is null and not exists (
      select 1 from dominio.producto_precios_escala s
       where s.producto_id = p_producto and s.escala = v_escala
    ) then
      continue;
    end if;
    insert into dominio.producto_precios_escala as s (producto_id, organizacion_id, escala, precio)
    values (p_producto, v_org, v_escala, v_precio)
    on conflict (producto_id, escala) do update
      set precio = excluded.precio
      where s.precio is distinct from excluded.precio;
  end loop;
end;
$$;

comment on function public.guardar_precios_escala(uuid, numeric, numeric, numeric) is
  'F-PRE-15: guarda los precios sin IVA de las escalas x5, x10 y x50 de un producto (nulo = sin precio; x1 es el precio de lista). Idempotente. 42501 sin permiso, P0002 producto inexistente, 23514 inválido, 22003 demasiado grande.';

revoke execute on function public.guardar_precios_escala(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.guardar_precios_escala(uuid, numeric, numeric, numeric) to authenticated;
