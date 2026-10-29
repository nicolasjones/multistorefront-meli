-- F-STK-15 (MSF-353, épica MSF-292, spec 20261022-180000-stock-depositos-y-reservas,
-- FR-020, FR-021, FR-022, FR-023, FR-026, D-5): traslado de stock entre depósitos.
-- Esquema (Principio VII): sin tablas nuevas. `movimientos_stock` sigue en `dominio`
-- (negocio de Stock); la RPC y la lectura ampliada viven en `public` (contrato de la app).
--
-- 1. `dominio.movimientos_stock.traslado_id`: vincula la salida y la entrada de un traslado.
--    Índice único (traslado_id, tipo): un traslado tiene a lo sumo una salida y una entrada.
-- 2. Motivo de sistema «Traslado entre depósitos» (entrada/salida): se crea por organización
--    la primera vez que se traslada (dato, no esquema); no altera el sembrado de motivos.
-- 3. `public.trasladar_stock(p_producto, p_origen, p_destino, p_cantidad, p_nota, p_fecha)`:
--    valida, toma ambos depósitos `for share` (orden por id: sin cruces), y aplica salida en el
--    origen y entrada en el destino con `private.aplicar_movimiento_deposito` en UNA transacción.
--    La barrera es el disponible del origen (F-STK-14); el rechazo no deja rastro. El total
--    y el reservado totales no cambian.
-- 4. `private.emitir_stock_actualizado` omite el evento si el movimiento tiene `traslado_id`
--    (D-5): un traslado no cambia el stock total y los canales externos ven solo totales.
-- 5. `public.listar_movimientos_stock` gana `traslado_id` (columna al final) para distinguir
--    los dos movimientos (FR-026). Cambia el tipo de retorno → drop + create.
--
-- CONTRATO nuevo (alto riesgo, gate humano): RPC `trasladar_stock`; `listar_movimientos_stock`
-- gana una columna; `stock.actualizado` deja de emitirse para movimientos de traslado.
--
-- Migración aditiva. Reversión (migración posterior):
--   restaurar `private.emitir_stock_actualizado` de 20261023120300_stock_evento_deposito.sql;
--   restaurar `public.listar_movimientos_stock` de 20261023120400_stock_lecturas_deposito.sql;
--   drop function public.trasladar_stock(uuid, uuid, uuid, integer, text, date);
--   (exportar antes los movimientos con traslado_id: el libro es de solo agregado)
--   alter table dominio.movimientos_stock drop column traslado_id;  -- borra el índice único
--   el motivo «Traslado entre depósitos» queda como dato (se desactiva desde Motivos).

-- ============================================================================
-- movimientos_stock.traslado_id
-- ============================================================================

alter table dominio.movimientos_stock
  add column traslado_id uuid;

create unique index IF NOT EXISTS movimientos_stock_traslado_tipo_uq
  on dominio.movimientos_stock (traslado_id, tipo)
  where traslado_id is not null;

comment on column dominio.movimientos_stock.traslado_id is
  'F-STK-15: identificador del traslado entre depósitos que vincula su salida (origen) y su entrada (destino). Nulo en los demás movimientos.';

-- ============================================================================
-- Evento: un traslado no cambia el total, no se emite (D-5, FR-023)
-- ============================================================================

create or replace function private.emitir_stock_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservado integer;
  v_cantidad integer;
begin
  -- D-5: el traslado mueve unidades entre depósitos sin cambiar el total.
  if new.traslado_id is not null then
    return new;
  end if;

  select e.reservado, e.cantidad into v_reservado, v_cantidad
    from dominio.existencias e
   where e.producto_id = new.producto_id and e.organizacion_id = new.organizacion_id;

  insert into public.cola_eventos (organizacion_id, tipo, clave_idempotencia, carga)
  values (
    new.organizacion_id,
    'stock.actualizado',
    new.id::text,
    jsonb_build_object(
      'organizacion_id', new.organizacion_id,
      'producto_id', new.producto_id,
      'movimiento_id', new.id,
      'tipo_movimiento', new.tipo,
      'cantidad', new.saldo,
      'diferencia', new.diferencia,
      'deposito_id', new.deposito_id,
      'reservado', coalesce(v_reservado, 0),
      'disponible', coalesce(v_cantidad, new.saldo) - coalesce(v_reservado, 0),
      'ocurrido_en', clock_timestamp()
    )
  )
  on conflict (organizacion_id, tipo, clave_idempotencia) do nothing;
  return new;
end;
$$;

revoke execute on function private.emitir_stock_actualizado() from public, anon, authenticated;

comment on function private.emitir_stock_actualizado() is
  'F-STK-04/F-STK-14/F-STK-15: encola stock.actualizado por cada movimiento de stock (con deposito_id, reservado y disponible totales), en la misma transacción. Los movimientos de un traslado (traslado_id) no emiten: el total no cambia.';

-- ============================================================================
-- trasladar_stock (FR-020 … FR-023)
-- ============================================================================

create or replace function public.trasladar_stock(
  p_producto uuid,
  p_origen uuid,
  p_destino uuid,
  p_cantidad integer,
  p_nota text default null,
  p_fecha date default current_date
)
returns table (
  traslado_id uuid,
  movimiento_salida_id uuid,
  movimiento_entrada_id uuid,
  origen_cantidad integer,
  origen_disponible integer,
  destino_cantidad integer,
  destino_disponible integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_fecha date := coalesce(p_fecha, current_date);
  v_traslado uuid := gen_random_uuid();
  v_motivo uuid;
  v_origen dominio.depositos;
  v_destino dominio.depositos;
  v_nombre_actor text;
  v_producto text;
  v_total integer;
  v_salida uuid;
  v_entrada uuid;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede trasladar stock' using errcode = '42501';
  end if;

  if p_origen is null or p_destino is null then
    raise exception 'Elegí el depósito de origen y el de destino' using errcode = '22023';
  end if;
  if p_origen = p_destino then
    raise exception 'El depósito de origen y el de destino deben ser distintos' using errcode = '22023';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser un entero mayor a cero' using errcode = '22023';
  end if;
  if v_fecha > current_date then
    raise exception 'La fecha no puede ser futura' using errcode = '22023';
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    raise exception 'La nota admite hasta 500 caracteres' using errcode = '22023';
  end if;

  -- Serializa por producto (el segundo traslado espera y ve el resultado del primero).
  perform 1 from dominio.existencias e
   where e.producto_id = p_producto and e.organizacion_id = v_organizacion
   for update;
  if not found then
    raise exception 'No encontramos ese producto' using errcode = '22023';
  end if;

  -- Ambos depósitos `for share` en orden de id: no se pueden desactivar mientras se traslada.
  perform 1 from dominio.depositos d
   where d.organizacion_id = v_organizacion and d.id in (p_origen, p_destino)
   order by d.id
   for share;

  select d.* into v_origen from dominio.depositos d
   where d.id = p_origen and d.organizacion_id = v_organizacion;
  if not found then
    raise exception 'No encontramos el depósito de origen' using errcode = '22023';
  end if;
  select d.* into v_destino from dominio.depositos d
   where d.id = p_destino and d.organizacion_id = v_organizacion;
  if not found then
    raise exception 'No encontramos el depósito de destino' using errcode = '22023';
  end if;
  if not v_origen.activo then
    raise exception 'El depósito de origen está inactivo: elegí otro' using errcode = '22023';
  end if;
  if not v_destino.activo then
    raise exception 'El depósito de destino está inactivo: elegí otro' using errcode = '22023';
  end if;

  -- Motivo de sistema, por organización, la primera vez. Se usa por id (no se valida el
  -- «aplica a»: es un motivo propio de esta rutina).
  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = 'traslado entre depósitos';
  if v_motivo is null then
    insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
    values (v_organizacion, 'Traslado entre depósitos', '{entrada,salida}')
    on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
    select m.id into v_motivo
      from dominio.motivos_movimiento m
     where m.organizacion_id = v_organizacion
       and lower(btrim(m.nombre)) = 'traslado entre depósitos';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- Salida del origen: la barrera es su disponible (lanza 23514 y revierte todo).
  v_total := private.aplicar_movimiento_deposito(v_organizacion, p_producto, p_origen, -p_cantidad);
  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
     actor_id, actor_nombre, deposito_id, traslado_id, creado_en)
  values
    (v_organizacion, p_producto, 'salida', p_cantidad, -p_cantidad, v_total, v_motivo, v_nota, v_fecha,
     v_actor, v_nombre_actor, p_origen, v_traslado, clock_timestamp())
  returning id into v_salida;

  -- Entrada al destino: el total vuelve al valor original.
  v_total := private.aplicar_movimiento_deposito(v_organizacion, p_producto, p_destino, p_cantidad);
  insert into dominio.movimientos_stock
    (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
     actor_id, actor_nombre, deposito_id, traslado_id, creado_en)
  values
    (v_organizacion, p_producto, 'entrada', p_cantidad, p_cantidad, v_total, v_motivo, v_nota, v_fecha,
     v_actor, v_nombre_actor, p_destino, v_traslado, clock_timestamp())
  returning id into v_entrada;

  select p.nombre || case when p.sku is null then '' else ' (SKU ' || p.sku || ')' end
    into v_producto
    from dominio.productos p
   where p.id = p_producto;

  perform private.registrar_actividad(
    'stock.traslado',
    format('Traslado de %s: %s unidades de %s a %s', v_producto, p_cantidad, v_origen.nombre, v_destino.nombre)
  );

  return query
    select v_traslado, v_salida, v_entrada,
           o.cantidad, o.cantidad - o.reservado,
           d.cantidad, d.cantidad - d.reservado
      from dominio.existencias_deposito o
      join dominio.existencias_deposito d on d.producto_id = o.producto_id
     where o.producto_id = p_producto and o.deposito_id = p_origen and d.deposito_id = p_destino;
end;
$$;

comment on function public.trasladar_stock(uuid, uuid, uuid, integer, text, date) is
  'F-STK-15: traslada unidades entre dos depósitos activos de la organización. Exige edición en Stock; bloquea sobre el disponible del origen; deja dos movimientos vinculados por traslado_id en una transacción; el total no cambia y no se emite stock.actualizado.';

revoke execute on function public.trasladar_stock(uuid, uuid, uuid, integer, text, date) from public, anon;
grant execute on function public.trasladar_stock(uuid, uuid, uuid, integer, text, date) to authenticated;

-- ============================================================================
-- listar_movimientos_stock: + traslado_id (FR-026)
-- ============================================================================

drop function IF EXISTS public.listar_movimientos_stock(uuid, integer, integer);

create function public.listar_movimientos_stock(
  p_producto uuid default null,
  p_limite integer default 25,
  p_desplazamiento integer default 0
)
returns table (
  id uuid,
  fecha date,
  creado_en timestamptz,
  producto_id uuid,
  producto_nombre text,
  producto_sku text,
  tipo text,
  motivo text,
  nota text,
  cantidad integer,
  diferencia integer,
  saldo integer,
  responsable text,
  total bigint,
  deposito_id uuid,
  deposito_nombre text,
  traslado_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    m.fecha,
    m.creado_en,
    m.producto_id,
    p.nombre,
    p.sku,
    m.tipo,
    mo.nombre,
    m.nota,
    m.cantidad,
    m.diferencia,
    m.saldo,
    m.actor_nombre,
    count(*) over (),
    m.deposito_id,
    dep.nombre,
    m.traslado_id
  from dominio.movimientos_stock m
  left join dominio.productos p
    on p.id = m.producto_id and p.organizacion_id = m.organizacion_id
  left join dominio.motivos_movimiento mo
    on mo.id = m.motivo_id and mo.organizacion_id = m.organizacion_id
  left join dominio.depositos dep
    on dep.id = m.deposito_id and dep.organizacion_id = m.organizacion_id
  where (p_producto is null or m.producto_id = p_producto)
  order by m.creado_en desc, m.id desc
  limit greatest(1, least(coalesce(p_limite, 25), 100))
  offset greatest(0, coalesce(p_desplazamiento, 0));
$$;

comment on function public.listar_movimientos_stock(uuid, integer, integer) is
  'Historial de movimientos de stock (F-STK-03, + depósito en F-STK-14, + traslado_id en F-STK-15). Solo lectura, security invoker (RLS), paginado con tope 100 y total.';

revoke execute on function public.listar_movimientos_stock(uuid, integer, integer) from public, anon;
grant execute on function public.listar_movimientos_stock(uuid, integer, integer) to authenticated;
