-- F-STK-07 (MSF-380, épica MSF-368, spec 20261024-130000-stock-carga-exportacion-y-avisos, T002/T003,
-- FR-006, FR-008, FR-009, FR-011, FR-012): carga inicial y masiva de stock desde planilla.
--
--   1. Motivo de sistema «Carga inicial de stock» (aplica a `ajuste`): `private.sembrar_motivos_movimiento`
--      lo suma a los siete motivos vigentes (20261202130000) y se rellenan las organizaciones existentes.
--   2. `private.validar_filas_carga_stock`: validación por fila compartida por las dos RPC.
--   3. `public.validar_carga_stock(p_deposito, p_filas)`: vista previa (no escribe).
--   4. `public.aplicar_carga_inicial_stock(p_deposito, p_filas, p_clave)`: aplica SOLO las filas válidas en
--      una transacción, revalidando bajo bloqueo; un ajuste por diferencia vía `registrar_movimiento_stock`
--      (única vía de escritura de stock; nunca deja el stock negativo) y registra la carga en
--      `dominio.cargas_iniciales_stock`. Idempotente por clave.
--
-- Esquema (Principio VII): sin tablas nuevas aquí (la tabla vive en `dominio`, 20261206100000).
--
-- Concurrencia: un bloqueo de transacción por organización serializa las cargas (idempotencia por clave
-- sin carreras) y, dentro, cada producto se bloquea en orden de id; la restricción única
-- `(organizacion_id, producto_id)` es la red de seguridad: una segunda carga inicial del mismo producto
-- se omite como «Ya tuvo carga inicial».
--
-- Reglas: la fila «Sin cambios» (cantidad igual a la actual) no es error y no consume la carga inicial.
-- Una cantidad menor a lo reservado en ese depósito es error de fila («Por debajo de lo reservado»): se
-- ajusta el stock físico y las reservas no cambian, así que no puede quedar por debajo de ellas.
-- Reintento con la misma clave: devuelve las filas que esa clave aplicó (`omitidas` = 0 y `repetido` = true).
--
-- Contrato nuevo (aditivo): `revoke ... from public, anon` + `grant ... to authenticated`.
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.aplicar_carga_inicial_stock(uuid, jsonb, uuid);
--   drop function public.validar_carga_stock(uuid, jsonb);
--   drop function private.validar_filas_carga_stock(uuid, uuid, jsonb);
--   restaurar `private.sembrar_motivos_movimiento` de 20261202130000 (siete motivos);
--   delete from dominio.motivos_movimiento m where lower(btrim(m.nombre)) = 'carga inicial de stock'
--     and not exists (select 1 from dominio.movimientos_stock s where s.motivo_id = m.id);
--   (con ajustes ya registrados el libro es de solo agregado: se desactiva desde Motivos).

-- ============================================================================
-- 1. Motivo de sistema
-- ============================================================================

create or replace function private.sembrar_motivos_movimiento(p_organizacion_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values
    (p_organizacion_id, 'Compra a proveedor', '{entrada}'),
    (p_organizacion_id, 'Venta en local', '{salida}'),
    (p_organizacion_id, 'Conteo de inventario', '{ajuste}'),
    (p_organizacion_id, 'Devolución', '{entrada,salida}'),
    (p_organizacion_id, 'Rotura o pérdida', '{salida,ajuste}'),
    (p_organizacion_id, 'Anulación de ingreso de mercadería', '{salida}'),
    (p_organizacion_id, 'Toma de inventario', '{ajuste}'),
    (p_organizacion_id, 'Carga inicial de stock', '{ajuste}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
$$;

revoke execute on function private.sembrar_motivos_movimiento(uuid) from public, anon, authenticated;

select private.sembrar_motivos_movimiento(o.id) from public.organizaciones o;

-- ============================================================================
-- 2. Validación por fila (compartida)
-- ============================================================================

create or replace function private.validar_filas_carga_stock(
  p_organizacion uuid,
  p_deposito uuid,
  p_filas jsonb
)
returns table (
  fila integer,
  sku text,
  producto_id uuid,
  producto text,
  stock_actual integer,
  en_planilla integer,
  quedara integer,
  diferencia integer,
  estado text,
  mensaje text,
  nota text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'La planilla debe ser una lista de filas' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'La planilla admite hasta 2000 filas' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_filas) e(v) where jsonb_typeof(e.v) <> 'object') then
    raise exception 'Cada fila de la planilla debe ser un objeto con sku y cantidad' using errcode = '22023';
  end if;

  return query
  with entrada as (
    select
      coalesce(case when (e.v ->> 'fila') ~ '^[0-9]{1,9}$' then (e.v ->> 'fila')::integer end, e.n::integer) as fila,
      e.n as orden,
      btrim(coalesce(e.v ->> 'sku', '')) as sku,
      btrim(coalesce(e.v ->> 'cantidad', '')) as cantidad,
      nullif(btrim(coalesce(e.v ->> 'motivo', '')), '') as motivo
    from jsonb_array_elements(p_filas) with ordinality e(v, n)
  ),
  base as (
    select
      en.*,
      p.id as pid,
      p.nombre as pnombre,
      count(*) over (partition by lower(en.sku)) as veces,
      coalesce(x.cantidad, 0) as actual,
      coalesce(x.reservado, 0) as reservado,
      (c.id is not null) as ya_tuvo,
      (en.cantidad ~ '^[0-9]{1,9}$') as cantidad_ok
    from entrada en
    left join dominio.productos p
      on en.sku <> ''
     and p.organizacion_id = p_organizacion
     and p.activo
     and lower(btrim(p.sku)) = lower(en.sku)
    left join dominio.existencias_deposito x
      on x.producto_id = p.id and x.deposito_id = p_deposito
    left join dominio.cargas_iniciales_stock c
      on c.producto_id = p.id and c.organizacion_id = p_organizacion
  ),
  calc as (
    select
      b.*,
      case
        when b.sku = '' then 'SKU vacío'
        when b.veces > 1 then 'SKU repetido en la planilla'
        when b.pid is null then 'SKU no existe'
        when not b.cantidad_ok then 'Cantidad inválida'
        when b.motivo is not null and length(b.motivo) > 500 then 'Motivo demasiado largo (máximo 500)'
        when b.ya_tuvo then 'Ya tuvo carga inicial'
        when b.cantidad::integer < b.reservado then 'Por debajo de lo reservado'
        else null
      end as error
    from base b
  )
  select
    c.fila,
    c.sku,
    c.pid,
    c.pnombre,
    case when c.pid is null then null else c.actual end,
    case when c.cantidad_ok then c.cantidad::integer end,
    case when c.cantidad_ok and c.pid is not null then c.cantidad::integer end,
    case when c.cantidad_ok and c.pid is not null then c.cantidad::integer - c.actual end,
    case
      when c.error is not null then 'error'
      when c.cantidad::integer = c.actual then 'sin_cambios'
      else 'ajuste'
    end,
    case
      when c.error is not null then c.error
      when c.cantidad::integer = c.actual then 'Sin cambios'
      else 'Ajuste'
    end,
    c.motivo
  from calc c
  order by c.orden;
end;
$$;

revoke execute on function private.validar_filas_carga_stock(uuid, uuid, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3. Vista previa
-- ============================================================================

create or replace function public.validar_carga_stock(p_deposito uuid, p_filas jsonb)
returns table (
  fila integer,
  sku text,
  producto text,
  stock_actual integer,
  en_planilla integer,
  quedara integer,
  diferencia integer,
  estado text,
  mensaje text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar stock por planilla' using errcode = '42501';
  end if;

  if not exists (
    select 1 from dominio.depositos d
     where d.id = p_deposito and d.organizacion_id = v_organizacion and d.activo
  ) then
    raise exception 'Elegí un depósito activo para la carga' using errcode = '22023';
  end if;

  return query
  select v.fila, v.sku, v.producto, v.stock_actual, v.en_planilla, v.quedara, v.diferencia, v.estado, v.mensaje
    from private.validar_filas_carga_stock(v_organizacion, p_deposito, p_filas) v;
end;
$$;

comment on function public.validar_carga_stock(uuid, jsonb) is
  'F-STK-07: vista previa de la carga de stock por planilla (no escribe). Valida cada fila en el servidor. Exige edición en Stock.';

revoke execute on function public.validar_carga_stock(uuid, jsonb) from public, anon;
grant execute on function public.validar_carga_stock(uuid, jsonb) to authenticated;

-- ============================================================================
-- 4. Aplicar
-- ============================================================================

create or replace function public.aplicar_carga_inicial_stock(
  p_deposito uuid,
  p_filas jsonb,
  p_clave uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_actor_nombre text;
  v_clave uuid := coalesce(p_clave, gen_random_uuid());
  v_deposito dominio.depositos;
  v_motivo uuid;
  v_fila record;
  v_actual integer;
  v_reservado integer;
  v_mov dominio.movimientos_stock;
  v_detalle jsonb := '[]'::jsonb;
  v_aplicadas integer := 0;
  v_omitidas integer := 0;
  v_estado text;
  v_mensaje text;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar stock por planilla' using errcode = '42501';
  end if;

  -- Serializa las cargas de la organización: idempotencia por clave y una sola ganadora por producto.
  perform pg_advisory_xact_lock(hashtextextended('cargas_iniciales_stock:' || v_organizacion::text, 0));

  -- Reintento con la misma clave: devuelve lo que esa clave ya aplicó, sin mover stock otra vez.
  if exists (
    select 1 from dominio.cargas_iniciales_stock c
     where c.organizacion_id = v_organizacion and c.clave_idempotencia = v_clave
  ) then
    return jsonb_build_object(
      'aplicadas', (select count(*) from dominio.cargas_iniciales_stock c
                     where c.organizacion_id = v_organizacion and c.clave_idempotencia = v_clave),
      'omitidas', 0,
      'repetido', true,
      'detalle', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'fila', null, 'sku', p.sku, 'estado', 'ajuste', 'mensaje', 'Ajuste') order by p.sku)
          from dominio.cargas_iniciales_stock c
          join dominio.productos p on p.id = c.producto_id and p.organizacion_id = c.organizacion_id
         where c.organizacion_id = v_organizacion and c.clave_idempotencia = v_clave
      ), '[]'::jsonb)
    );
  end if;

  select d.* into v_deposito
    from dominio.depositos d
   where d.id = p_deposito and d.organizacion_id = v_organizacion
   for share;
  if not found or not v_deposito.activo then
    raise exception 'Elegí un depósito activo para la carga' using errcode = '22023';
  end if;

  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = 'carga inicial de stock'
     and m.activo;
  if v_motivo is null then
    raise exception 'El motivo «Carga inicial de stock» no está disponible: activalo desde Motivos' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_actor_nombre
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- Filas que no son «ajuste» (errores y sin cambios): se informan sin tocar nada.
  for v_fila in
    select v.* from private.validar_filas_carga_stock(v_organizacion, p_deposito, p_filas) v
     where v.estado <> 'ajuste'
     order by v.fila
  loop
    if v_fila.estado = 'error' then
      v_omitidas := v_omitidas + 1;
    end if;
    v_detalle := v_detalle || jsonb_build_object(
      'fila', v_fila.fila, 'sku', v_fila.sku, 'estado', v_fila.estado, 'mensaje', v_fila.mensaje);
  end loop;

  -- Filas con ajuste: en orden estable de producto y revalidando bajo bloqueo.
  for v_fila in
    select v.* from private.validar_filas_carga_stock(v_organizacion, p_deposito, p_filas) v
     where v.estado = 'ajuste'
     order by v.producto_id
  loop
    perform 1 from dominio.existencias e
     where e.producto_id = v_fila.producto_id and e.organizacion_id = v_organizacion
     for update;

    v_estado := 'ajuste';
    v_mensaje := 'Ajuste';

    if exists (
      select 1 from dominio.cargas_iniciales_stock c
       where c.organizacion_id = v_organizacion and c.producto_id = v_fila.producto_id
    ) then
      v_estado := 'error';
      v_mensaje := 'Ya tuvo carga inicial';
    else
      select coalesce(x.cantidad, 0), coalesce(x.reservado, 0) into v_actual, v_reservado
        from (select 1) s
        left join dominio.existencias_deposito x
          on x.producto_id = v_fila.producto_id and x.deposito_id = p_deposito;
      if v_fila.en_planilla < v_reservado then
        v_estado := 'error';
        v_mensaje := 'Por debajo de lo reservado';
      elsif v_fila.en_planilla = v_actual then
        v_estado := 'sin_cambios';
        v_mensaje := 'Sin cambios';
      end if;
    end if;

    if v_estado = 'ajuste' then
      v_mov := public.registrar_movimiento_stock(
        v_fila.producto_id, 'ajuste', v_fila.en_planilla, v_motivo,
        v_fila.nota, current_date, p_deposito);

      insert into dominio.cargas_iniciales_stock
        (organizacion_id, producto_id, deposito_id, movimiento_id, cantidad, clave_idempotencia, actor_id, actor_nombre)
      values
        (v_organizacion, v_fila.producto_id, p_deposito, v_mov.id, v_fila.en_planilla, v_clave, v_actor, v_actor_nombre);

      v_aplicadas := v_aplicadas + 1;
    elsif v_estado = 'error' then
      v_omitidas := v_omitidas + 1;
    end if;

    v_detalle := v_detalle || jsonb_build_object(
      'fila', v_fila.fila, 'sku', v_fila.sku, 'estado', v_estado, 'mensaje', v_mensaje);
  end loop;

  perform private.registrar_actividad(
    'stock.carga_inicial',
    format('Carga de stock por planilla en %s: %s %s, %s %s',
      v_deposito.nombre,
      v_aplicadas, case when v_aplicadas = 1 then 'ajuste' else 'ajustes' end,
      v_omitidas, case when v_omitidas = 1 then 'fila omitida' else 'filas omitidas' end)
  );

  return jsonb_build_object(
    'aplicadas', v_aplicadas,
    'omitidas', v_omitidas,
    'repetido', false,
    'detalle', (select coalesce(jsonb_agg(d order by (d ->> 'fila')::integer nulls last), '[]'::jsonb)
                  from jsonb_array_elements(v_detalle) d)
  );
end;
$$;

comment on function public.aplicar_carga_inicial_stock(uuid, jsonb, uuid) is
  'F-STK-07: aplica solo las filas válidas de la planilla (un ajuste por diferencia, motivo «Carga inicial de stock»), todo o nada, idempotente por clave. Exige edición en Stock; una segunda carga inicial del mismo producto se omite.';

revoke execute on function public.aplicar_carga_inicial_stock(uuid, jsonb, uuid) from public, anon;
grant execute on function public.aplicar_carga_inicial_stock(uuid, jsonb, uuid) to authenticated;
