-- F-STK-16 (MSF-337, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-030…FR-035, FR-037, D-7, D-8): reserva y descuento de productos «A pedido».
--
-- Esquema (Principio VII): `dominio.reservas_stock` es negocio de Stock → `dominio`, nunca `public`.
-- Las tres RPC viven en `public` (contrato para el formulario de venta, otra épica).
--   dominio.reservas_stock  (nueva)  una fila por reserva: producto, depósito, cantidad, estado
--                                    (activa | descontada | liberada), referencia opcional, responsable.
--   dominio.motivos_movimiento (existente) se crea por organización, la primera vez que se descuenta,
--                                    el motivo de sistema «Entrega de producto a pedido» (D-7).
--
-- RLS por organización y `private.nivel_seccion('stock')` (lectura/edición). Sin escritura directa de
-- `authenticated`: solo escriben las RPC `security definer`. Sin DELETE. `anon` sin privilegios.
--
-- Mecánica: toda variación de reservado/cantidad pasa por `private.aplicar_movimiento_deposito`
-- (F-STK-14), que serializa por producto (`select … for update` sobre `existencias`) y bloquea sobre el
-- DISPONIBLE del depósito (cantidad − reservado): el disponible nunca queda < 0 (FR-032). Las RPC toman
-- primero el mismo lock del producto para que idempotencia, estado y barrera se evalúen serializados.
--   reservar_stock   : solo productos «A pedido», depósito activo, cantidad ≤ disponible del depósito;
--                      reservado += n (depósito y total). Misma `p_referencia` → misma reserva (D-8).
--   liberar_reserva  : activa → liberada; reservado −= n; la cantidad no cambia.
--   descontar_reserva: activa → descontada; cantidad −= n y reservado −= n y una SALIDA en el libro, en el
--                      depósito de la reserva, con el motivo de sistema (todo en una transacción).
-- Una reserva que no está activa se rechaza sin doble efecto (FR-035).
--
-- Las tres exigen `nivel_seccion('stock') = 'edicion'` (FR-037), `search_path = ''`,
-- `revoke … from public, anon` y `grant execute … to authenticated`.
--
-- Migración aditiva. Reversión (migración posterior; exportar antes `dominio.reservas_stock`):
--   -- liberar antes las reservas activas (reservado de existencias_deposito y existencias);
--   drop function public.reservar_stock(uuid, uuid, integer, text);
--   drop function public.liberar_reserva(uuid);
--   drop function public.descontar_reserva(uuid);
--   drop table dominio.reservas_stock;
--   (el motivo «Entrega de producto a pedido» es dato: se desactiva, no se borra, si hay movimientos.)

-- ============================================================================
-- dominio.reservas_stock (FR-030)
-- ============================================================================

create table dominio.reservas_stock (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  producto_id uuid not null,
  deposito_id uuid not null,
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'activa' check (estado in ('activa', 'descontada', 'liberada')),
  -- Idempotencia (D-8): la define quien llama (p. ej. la línea de venta).
  referencia text check (referencia is null or (btrim(referencia) <> '' and length(referencia) <= 200)),
  responsable_id uuid,
  responsable_nombre text,
  creado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (producto_id, organizacion_id)
    references dominio.existencias (producto_id, organizacion_id) on delete cascade,
  foreign key (deposito_id, organizacion_id)
    references dominio.depositos (id, organizacion_id),
  check ((estado = 'activa' and resuelto_en is null) or (estado <> 'activa' and resuelto_en is not null))
);

comment on table dominio.reservas_stock is
  'Reservas de productos «A pedido» (F-STK-16): activa → descontada | liberada. Solo las escriben reservar_stock, liberar_reserva y descontar_reserva.';

create unique index reservas_stock_referencia_uq
  on dominio.reservas_stock (organizacion_id, referencia) where referencia is not null;
create index reservas_stock_producto_idx on dominio.reservas_stock (producto_id, estado);
create index reservas_stock_deposito_idx on dominio.reservas_stock (deposito_id);
create index reservas_stock_organizacion_idx on dominio.reservas_stock (organizacion_id, creado_en desc);

alter table dominio.reservas_stock enable row level security;

create policy reservas_stock_select on dominio.reservas_stock
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );

revoke all on dominio.reservas_stock from public, anon, authenticated;
grant select on dominio.reservas_stock to authenticated;

-- ============================================================================
-- reservar_stock (FR-031, FR-032, FR-037)
-- ============================================================================

create or replace function public.reservar_stock(
  p_producto uuid,
  p_deposito uuid,
  p_cantidad integer,
  p_referencia text default null
)
returns dominio.reservas_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_referencia text := nullif(btrim(coalesce(p_referencia, '')), '');
  v_disponibilidad text;
  v_deposito dominio.depositos;
  v_existente dominio.reservas_stock;
  v_nombre_actor text;
  v_nombre_producto text;
  v_fila dominio.reservas_stock;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede reservar stock' using errcode = '42501';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a reservar debe ser un entero mayor a cero' using errcode = '22023';
  end if;
  if v_referencia is not null and length(v_referencia) > 200 then
    raise exception 'La referencia admite hasta 200 caracteres' using errcode = '22023';
  end if;

  -- Serializa por producto (mismo lock que aplicar_movimiento_deposito): idempotencia, barrera y
  -- escritura se evalúan en orden aunque lleguen a la vez.
  perform 1 from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  -- Idempotencia (D-8): la misma referencia devuelve la reserva ya hecha, sin duplicar.
  if v_referencia is not null then
    select r.* into v_existente
      from dominio.reservas_stock r
     where r.organizacion_id = v_organizacion and r.referencia = v_referencia;
    if found then
      if v_existente.producto_id <> p_producto or v_existente.deposito_id <> p_deposito
         or v_existente.cantidad <> p_cantidad then
        raise exception 'Esa referencia ya tiene una reserva con otros datos' using errcode = '23505';
      end if;
      return v_existente;
    end if;
  end if;

  select p.disponibilidad_manual, p.nombre into v_disponibilidad, v_nombre_producto
    from dominio.productos p
   where p.id = p_producto and p.organizacion_id = v_organizacion;
  if v_disponibilidad is distinct from 'a_pedido' then
    raise exception 'Solo se puede reservar stock de productos A pedido' using errcode = '22023';
  end if;

  select d.* into v_deposito
    from dominio.depositos d
   where d.id = p_deposito and d.organizacion_id = v_organizacion
   for share;
  if not found then
    raise exception 'No encontramos ese depósito' using errcode = '22023';
  end if;
  if not v_deposito.activo then
    raise exception 'El depósito está inactivo: elegí otro para reservar' using errcode = '22023';
  end if;

  -- Barrera: cantidad ≤ disponible del depósito; si no, «No hay stock suficiente» (23514).
  perform private.aplicar_movimiento_deposito(v_organizacion, p_producto, v_deposito.id, 0, p_cantidad, false);

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  insert into dominio.reservas_stock
    (organizacion_id, producto_id, deposito_id, cantidad, referencia, responsable_id, responsable_nombre)
  values
    (v_organizacion, p_producto, v_deposito.id, p_cantidad, v_referencia, v_actor, v_nombre_actor)
  returning * into v_fila;

  perform private.registrar_actividad(
    'stock.reserva',
    format('Reserva de %s unidades de %s en %s', p_cantidad, v_nombre_producto, v_deposito.nombre)
  );

  return v_fila;
end;
$$;

comment on function public.reservar_stock(uuid, uuid, integer, text) is
  'F-STK-16: reserva stock de un producto A pedido en un depósito (cantidad ≤ disponible). Exige edición en Stock. La misma p_referencia no duplica la reserva.';

revoke execute on function public.reservar_stock(uuid, uuid, integer, text) from public, anon;
grant execute on function public.reservar_stock(uuid, uuid, integer, text) to authenticated;

-- ============================================================================
-- liberar_reserva (FR-033, FR-035, FR-037)
-- ============================================================================

create or replace function public.liberar_reserva(p_reserva uuid)
returns dominio.reservas_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_producto uuid;
  v_reserva dominio.reservas_stock;
  v_fila dominio.reservas_stock;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede liberar reservas' using errcode = '42501';
  end if;

  select r.producto_id into v_producto
    from dominio.reservas_stock r
   where r.id = p_reserva and r.organizacion_id = v_organizacion;
  if not found then
    raise exception 'No encontramos esa reserva' using errcode = '22023';
  end if;

  -- Mismo orden de locks que reservar_stock: primero el producto, después la reserva.
  perform 1 from dominio.existencias e
   where e.producto_id = v_producto and e.organizacion_id = v_organizacion
   for update;

  select r.* into v_reserva
    from dominio.reservas_stock r
   where r.id = p_reserva and r.organizacion_id = v_organizacion
   for update;
  if v_reserva.estado <> 'activa' then
    raise exception 'La reserva ya fue %', v_reserva.estado using errcode = '22023';
  end if;

  perform private.aplicar_movimiento_deposito(
    v_organizacion, v_reserva.producto_id, v_reserva.deposito_id, 0, -v_reserva.cantidad, false);

  update dominio.reservas_stock
     set estado = 'liberada', resuelto_en = now(), updated_at = now()
   where id = v_reserva.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'stock.reserva_liberada',
    format('Liberó una reserva de %s unidades', v_reserva.cantidad)
  );

  return v_fila;
end;
$$;

comment on function public.liberar_reserva(uuid) is
  'F-STK-16: libera una reserva activa (reservado vuelve, la cantidad no cambia). Rechaza una reserva ya descontada o liberada.';

revoke execute on function public.liberar_reserva(uuid) from public, anon;
grant execute on function public.liberar_reserva(uuid) to authenticated;

-- ============================================================================
-- descontar_reserva (FR-034, FR-035, FR-037, D-7)
-- ============================================================================

create or replace function public.descontar_reserva(p_reserva uuid)
returns dominio.reservas_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_producto uuid;
  v_reserva dominio.reservas_stock;
  v_fila dominio.reservas_stock;
  v_motivo uuid;
  v_saldo integer;
  v_nombre_actor text;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede descontar reservas' using errcode = '42501';
  end if;

  select r.producto_id into v_producto
    from dominio.reservas_stock r
   where r.id = p_reserva and r.organizacion_id = v_organizacion;
  if not found then
    raise exception 'No encontramos esa reserva' using errcode = '22023';
  end if;

  perform 1 from dominio.existencias e
   where e.producto_id = v_producto and e.organizacion_id = v_organizacion
   for update;

  select r.* into v_reserva
    from dominio.reservas_stock r
   where r.id = p_reserva and r.organizacion_id = v_organizacion
   for update;
  if v_reserva.estado <> 'activa' then
    raise exception 'La reserva ya fue %', v_reserva.estado using errcode = '22023';
  end if;

  -- Motivo de sistema (D-7): se crea una vez por organización, solo para salidas.
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values (v_organizacion, 'Entrega de producto a pedido', '{salida}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = lower('Entrega de producto a pedido');

  -- cantidad −n y reservado −n: el disponible del depósito no cambia, así que la barrera no frena.
  v_saldo := private.aplicar_movimiento_deposito(
    v_organizacion, v_reserva.producto_id, v_reserva.deposito_id,
    -v_reserva.cantidad, -v_reserva.cantidad, true);

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- La salida dispara stock.actualizado (FR-038) con el reservado y el disponible ya actualizados.
  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
     actor_id, actor_nombre, deposito_id)
  values
    (v_organizacion, v_reserva.producto_id, 'salida', v_reserva.cantidad, -v_reserva.cantidad, v_saldo,
     v_motivo, left('Reserva ' || coalesce(v_reserva.referencia, v_reserva.id::text), 500), current_date,
     v_actor, v_nombre_actor, v_reserva.deposito_id);

  update dominio.reservas_stock
     set estado = 'descontada', resuelto_en = now(), updated_at = now()
   where id = v_reserva.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'stock.reserva_descontada',
    format('Descontó una reserva de %s unidades, stock resultante %s', v_reserva.cantidad, v_saldo)
  );

  return v_fila;
end;
$$;

comment on function public.descontar_reserva(uuid) is
  'F-STK-16: descuenta una reserva activa (cantidad y reservado −n) y registra la salida en el libro con el motivo «Entrega de producto a pedido». Rechaza una reserva ya descontada o liberada.';

revoke execute on function public.descontar_reserva(uuid) from public, anon;
grant execute on function public.descontar_reserva(uuid) to authenticated;
