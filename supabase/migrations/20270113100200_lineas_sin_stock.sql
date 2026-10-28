-- F-SVC-13 (MSF-418, épica MSF-232, spec 20261028-100000-service-cobro-y-avisos, FR-003, FR-006):
-- líneas de comprobante SIN STOCK (las que nacen de una reparación de Service).
--
-- Esquema (Principio VII): `dominio.comprobantes_venta_lineas` ya es dominio del producto; solo se agrega una
-- columna y se relajan tres. Sin tablas nuevas, sin cambio de RLS.
--
-- `sin_stock = true` marca una línea que NO mueve stock: ni salida al confirmar, ni reserva, ni devolución al
-- anular o emitir una nota de crédito. Es una marca distinta de `a_pedido` (que reserva). Solo esas líneas
-- admiten `producto_id`, `deposito_id` y `escala` nulos (descripción, cantidad y precio son una copia del ítem
-- de la reparación). Las líneas de catálogo existentes quedan igual (`sin_stock = false`, check intacto).
--
-- Funciones reemplazadas (create or replace; misma firma, mismos permisos y comentarios, cambio mínimo):
--   · confirmar_comprobante: saltea las líneas sin_stock (ni salida ni reserva).
--   · private.revertir_venta_comprobante y private.devolver_stock_nota_credito: no devuelven stock de esas líneas.
--   · emitir_nota_credito: la línea de la nota copia la marca sin_stock de la línea acreditada.
--   · guardar_lineas_comprobante: conserva las líneas sin_stock al re-guardar las líneas de catálogo; las
--     suma a los totales. Una persona edita en Ventas las líneas de catálogo; las de Service se ven y se anulan
--     con el comprobante.
--   · private.datos_documento_comprobante (PDF) y detalle_anulacion_nota_credito: `left join` de depósito, para
--     que la línea sin depósito no desaparezca del documento ni de las líneas acreditables.
--
-- Migración aditiva. Reversión (migración posterior; antes borrar o migrar las filas con sin_stock):
--   restaurar las siete funciones de sus migraciones originales (20261204140000, 20261212120100, 20261212120300,
--   20261212120400, 20261203200300, 20261211120200, 20261212120600), y luego:
--   alter table dominio.comprobantes_venta_lineas drop constraint comprobantes_venta_lineas_sin_stock_check;
--   alter table dominio.comprobantes_venta_lineas
--     alter column producto_id set not null, alter column deposito_id set not null, alter column escala set not null;
--   alter table dominio.comprobantes_venta_lineas drop column sin_stock;

alter table dominio.comprobantes_venta_lineas
  add column sin_stock boolean not null default false;

alter table dominio.comprobantes_venta_lineas
  alter column producto_id drop not null,
  alter column deposito_id drop not null,
  alter column escala drop not null;

alter table dominio.comprobantes_venta_lineas
  add constraint comprobantes_venta_lineas_sin_stock_check
  check (sin_stock or (producto_id is not null and deposito_id is not null and escala is not null));

comment on column dominio.comprobantes_venta_lineas.sin_stock is
  'F-SVC-13: la línea no mueve stock (confirmar, anular y notas de crédito la saltean). Solo estas líneas admiten producto, depósito y escala nulos.';


-- Confirmar: las líneas sin_stock no se descuentan ni se reservan.
create or replace function public.confirmar_comprobante(p_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_linea record;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
  v_disponible integer;
  v_lineas integer := 0;
  v_lineas_stock integer := 0;
  v_procesadas integer := 0;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para confirmar comprobantes' using errcode = '42501';
  end if;

  -- Serializa las confirmaciones del mismo comprobante: la segunda espera y ve `confirmada`.
  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede confirmar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'Un presupuesto no se confirma: solo las facturas descuentan o reservan stock'
      using errcode = '22023';
  end if;
  -- Idempotencia (FR-035): un reintento no duplica movimientos.
  if v_c.estado = 'confirmada' then
    return v_c;
  end if;
  if v_c.estado <> 'borrador' then
    raise exception 'La factura ya está cerrada y no se puede confirmar' using errcode = '55000';
  end if;

  select count(*)::int, (count(*) filter (where not l.sin_stock))::int into v_lineas, v_lineas_stock
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'La factura no tiene productos: agregá al menos uno para confirmarla' using errcode = '22023';
  end if;

  -- Motivo de sistema, una vez por organización (solo para salidas).
  insert into dominio.motivos_movimiento (organizacion_id, nombre, aplica_a)
  values (v_org, 'Venta de factura', '{salida}')
  on conflict (organizacion_id, lower(btrim(nombre))) do nothing;
  select m.id into v_motivo
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_org and lower(btrim(m.nombre)) = lower('Venta de factura')
     and m.activo and 'salida' = any (m.aplica_a);
  -- Un motivo del mismo nombre creado a mano (inactivo o sin `salida`) no sirve: se falla claro, no se reutiliza mal.
  if v_motivo is null then
    raise exception 'El motivo «Venta de factura» existe pero está inactivo o no aplica a salidas: activalo o corregilo en Motivos de movimiento'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pu.nombre, pu.apellido)), ''), u.email::text)
    into v_nombre_actor
    from auth.users u
    left join public.perfiles_usuario pu on pu.user_id = u.id
   where u.id = v_actor;

  -- Orden fijo (producto, depósito, línea): los bloqueos de existencias se toman siempre igual.
  for v_linea in
    select l.id, l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido,
           p.nombre as producto, d.nombre as deposito, d.activo as deposito_activo
      from dominio.comprobantes_venta_lineas l
      join dominio.productos p on p.id = l.producto_id and p.organizacion_id = l.organizacion_id
      join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org and not l.sin_stock
     order by l.producto_id, l.deposito_id, l.orden
  loop
    if not v_linea.deposito_activo then
      raise exception 'El depósito % está inactivo: elegí otro para %', v_linea.deposito, v_linea.producto
        using errcode = '22023';
    end if;

    -- Solo el motor de stock captura el faltante: un check de movimientos o reservas es un bug real y se propaga.
    begin
      if v_linea.a_pedido then
        -- «A pedido»: reserva, no descuenta (la entrega la descuenta, MSF-135).
        perform private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, 0, v_linea.cantidad, false);
      else
        v_saldo := private.aplicar_movimiento_deposito(
          v_org, v_linea.producto_id, v_linea.deposito_id, -v_linea.cantidad, 0, true);
      end if;
    exception when check_violation then
      -- Faltante: mensaje con producto y depósito; al propagarse revierte la transacción entera (FR-034).
      select greatest(x.cantidad - x.reservado, 0) into v_disponible
        from dominio.existencias_deposito x
       where x.producto_id = v_linea.producto_id and x.deposito_id = v_linea.deposito_id;
      raise exception 'No hay stock suficiente de % en el depósito %: hay % y la factura pide %',
        v_linea.producto, v_linea.deposito, coalesce(v_disponible, 0), v_linea.cantidad
        using errcode = 'P0001', hint = 'stock';
    end;

    if v_linea.a_pedido then
      insert into dominio.reservas_stock
        (organizacion_id, producto_id, deposito_id, cantidad, referencia, responsable_id, responsable_nombre)
      values
        (v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad,
         'comprobante:' || v_c.id || ':linea:' || v_linea.orden, v_actor, v_nombre_actor);
    else
      insert into dominio.movimientos_stock
        (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
         actor_id, actor_nombre, deposito_id)
      values
        (v_org, v_linea.producto_id, 'salida', v_linea.cantidad, -v_linea.cantidad, v_saldo, v_motivo,
         left('Factura ' || v_c.numero, 500), current_date, v_actor, v_nombre_actor, v_linea.deposito_id);
    end if;
    v_procesadas := v_procesadas + 1;
  end loop;

  -- Defensa: si un join dejó fuera una línea (FK suelta), no se confirma sin mover su stock.
  if v_procesadas <> v_lineas_stock then
    raise exception 'La factura tiene % líneas con stock pero solo se pudieron procesar %: revisá producto y depósito de cada una', v_lineas_stock, v_procesadas
      using errcode = '22023';
  end if;

  update dominio.comprobantes_venta
     set estado = 'confirmada',
         confirmado_en = now(),
         confirmado_por = v_actor,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.confirmado',
    format('Confirmó la factura %s: %s %s', v_fila.numero, v_lineas, case when v_lineas = 1 then 'línea' else 'líneas' end),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- Anular: las líneas sin_stock no devuelven stock.
create or replace function private.revertir_venta_comprobante(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_linea record;
  v_reserva dominio.reservas_stock;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para revertir una venta' using errcode = '42501';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.tipo <> 'factura' then
    raise exception 'La factura no existe' using errcode = 'P0002';
  end if;
  -- Idempotente: una factura ya anulada no se revierte dos veces.
  if v_c.anulado_en is not null then
    return;
  end if;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Anulación de factura', 'entrada');
  v_nombre_actor := private.nombre_actor_stock(v_actor);

  for v_linea in
    select l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org and not l.sin_stock
     order by l.producto_id, l.deposito_id, l.orden
  loop
    v_reserva := null;
    if v_linea.a_pedido then
      -- Mismo orden de bloqueos que liberar_reserva: primero el producto, después la reserva.
      perform 1 from dominio.existencias e
       where e.producto_id = v_linea.producto_id and e.organizacion_id = v_org
       for update;
      select r.* into v_reserva
        from dominio.reservas_stock r
       where r.organizacion_id = v_org
         and r.referencia = 'comprobante:' || v_c.id || ':linea:' || v_linea.orden
       for update;
      -- Sin reserva, o ya liberada: la línea no movió stock que devolver.
      if not found or v_reserva.estado = 'liberada' then
        continue;
      end if;
    end if;

    if v_linea.a_pedido and v_reserva.estado = 'activa' then
      -- «A pedido» vigente: se libera el reservado; la cantidad no cambia.
      perform private.aplicar_movimiento_deposito(v_org, v_reserva.producto_id, v_reserva.deposito_id, 0, -v_reserva.cantidad, false);
      update dominio.reservas_stock
         set estado = 'liberada', resuelto_en = now(), updated_at = now()
       where id = v_reserva.id;
    else
      -- Salida de la confirmación (o reserva ya descontada por la entrega): vuelve al MISMO depósito.
      v_saldo := private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad, 0, true);
      insert into dominio.movimientos_stock
        (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
         actor_id, actor_nombre, deposito_id)
      values
        (v_org, v_linea.producto_id, 'entrada', v_linea.cantidad, v_linea.cantidad, v_saldo, v_motivo,
         left('Anulación de la factura ' || v_c.numero, 500), current_date, v_actor, v_nombre_actor, v_linea.deposito_id);
    end if;
  end loop;
end;
$$;

-- Nota de crédito: las líneas sin_stock no devuelven stock.
create or replace function private.devolver_stock_nota_credito(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_n dominio.comprobantes_venta;
  v_origen dominio.comprobantes_venta;
  v_linea record;
  v_motivo uuid;
  v_nombre_actor text;
  v_saldo integer;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para devolver stock' using errcode = '42501';
  end if;
  select * into v_n
    from dominio.comprobantes_venta c
   where c.id = p_nota_id and c.organizacion_id = v_org and c.tipo = 'nota_credito';
  if not found then
    raise exception 'La nota de crédito no existe' using errcode = 'P0002';
  end if;
  -- Sin mercadería de vuelta no hay stock que tocar.
  if v_n.nc_tipo <> 'devolucion_productos' then
    return;
  end if;
  select * into v_origen
    from dominio.comprobantes_venta c
   where c.id = v_n.comprobante_origen_id and c.organizacion_id = v_org;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Devolución de cliente', 'entrada');
  v_nombre_actor := private.nombre_actor_stock(v_actor);

  for v_linea in
    select l.orden, l.producto_id, l.deposito_id, l.cantidad, l.a_pedido
      from dominio.comprobantes_venta_lineas l
     where l.comprobante_id = v_n.id and l.organizacion_id = v_org and not l.sin_stock
     order by l.producto_id, l.deposito_id, l.orden
  loop
    if v_linea.a_pedido and not exists (
      select 1 from dominio.reservas_stock r
       where r.organizacion_id = v_org and r.estado = 'descontada'
         and r.referencia = 'comprobante:' || v_n.comprobante_origen_id || ':linea:' || v_linea.orden
    ) then
      continue;
    end if;

    v_saldo := private.aplicar_movimiento_deposito(v_org, v_linea.producto_id, v_linea.deposito_id, v_linea.cantidad, 0, true);
    insert into dominio.movimientos_stock
      (organizacion_id, producto_id, tipo, cantidad, diferencia, saldo, motivo_id, nota, fecha,
       actor_id, actor_nombre, deposito_id)
    values
      (v_org, v_linea.producto_id, 'entrada', v_linea.cantidad, v_linea.cantidad, v_saldo, v_motivo,
       left('Nota de crédito ' || v_n.numero || ' sobre la factura ' || v_origen.numero, 500), current_date,
       v_actor, v_nombre_actor, v_linea.deposito_id);
  end loop;
end;
$$;

-- Nota de crédito: la línea acreditada copia la marca sin_stock.
create or replace function public.emitir_nota_credito(
  p_factura_id uuid,
  p_tipo text,
  p_lineas jsonb,
  p_concepto text default null
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_nota dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
  v_items jsonb;
  v_item record;
  v_l dominio.comprobantes_venta_lineas;
  v_prev_cant integer;
  v_prev_sub numeric(14, 2);
  v_prev_iva numeric(14, 2);
  v_sub numeric(14, 2);
  v_iva numeric(14, 2);
  v_total_sin numeric(14, 2) := 0;
  v_total_con numeric(14, 2) := 0;
  v_resta_sin numeric(14, 2);
  v_resta_con numeric(14, 2);
  v_importe numeric(14, 2);
  v_numero integer;
  v_fecha date;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para emitir notas de crédito' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('devolucion_productos', 'devolucion_importe', 'descuento') then
    raise exception 'Elegí el motivo de la nota de crédito' using errcode = '22023', hint = 'tipo';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0
     or jsonb_array_length(p_lineas) > 500 then
    raise exception 'Indicá qué se acredita en la nota de crédito' using errcode = '22023', hint = 'lineas';
  end if;
  if length(coalesce(v_concepto, '')) > 200 then
    raise exception 'El concepto no puede superar los 200 caracteres' using errcode = '22023', hint = 'concepto';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_factura_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'La factura no existe' using errcode = 'P0002';
  end if;
  if not (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')) then
    raise exception 'Tu rol no puede emitir notas de crédito en esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'La nota de crédito se emite sobre una factura' using errcode = '22023';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de emitir una nota de crédito' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite notas de crédito' using errcode = '55000';
  end if;

  -- Lo aún acreditable (sin IVA y con IVA) = factura − notas previas.
  select v_c.total_sin_iva - coalesce(sum(n.total_sin_iva), 0), v_c.total_con_iva - coalesce(sum(n.total_con_iva), 0)
    into v_resta_sin, v_resta_con
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito';

  if p_tipo <> 'devolucion_productos' and v_concepto is null then
    raise exception 'Escribí el concepto de la nota de crédito' using errcode = '22023', hint = 'concepto';
  end if;

  v_numero := private.siguiente_numero_comprobante(v_c.empresa_id, 'nota_credito');
  v_fecha := (select (now() at time zone o.zona_horaria)::date from public.organizaciones o where o.id = v_org);

  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, confirmado_en, confirmado_por,
    comprobante_origen_id, nc_tipo, nc_concepto
  )
  values (
    v_org, v_c.empresa_id, v_c.cliente_id, 'nota_credito', lpad(v_numero::text, 8, '0'), v_numero,
    coalesce(v_fecha, current_date), 'confirmada', 0, 0, v_c.canal, v_actor, now(), v_actor,
    v_c.id, p_tipo, v_concepto
  )
  returning * into v_nota;

  if p_tipo = 'devolucion_productos' then
    begin
      select jsonb_agg(jsonb_build_object('linea_id', q.linea_id, 'cantidad', q.cantidad) order by q.linea_id)
        into v_items
        from (
          select (e ->> 'linea_id')::uuid as linea_id, sum((e ->> 'cantidad')::integer)::integer as cantidad
            from jsonb_array_elements(p_lineas) e
           group by 1
        ) q;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception 'Las líneas de la nota de crédito no son válidas' using errcode = '22023', hint = 'lineas';
    end;

    for v_item in select x.linea_id, x.cantidad from jsonb_to_recordset(v_items) as x(linea_id uuid, cantidad integer)
    loop
      if v_item.linea_id is null or v_item.cantidad is null or v_item.cantidad < 1 then
        raise exception 'Cada línea de la nota necesita el producto y una cantidad de al menos 1' using errcode = '22023', hint = 'lineas';
      end if;
      select * into v_l
        from dominio.comprobantes_venta_lineas l
       where l.id = v_item.linea_id and l.comprobante_id = v_c.id and l.organizacion_id = v_org;
      if not found then
        raise exception 'Una de las líneas no pertenece a la factura' using errcode = '22023', hint = 'lineas';
      end if;

      select coalesce(sum(nl.cantidad), 0), coalesce(sum(nl.subtotal_sin_iva), 0), coalesce(sum(nl.iva), 0)
        into v_prev_cant, v_prev_sub, v_prev_iva
        from dominio.comprobantes_venta_lineas nl
        join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.organizacion_id = nl.organizacion_id
       where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id
         and n.nc_tipo = 'devolucion_productos' and n.id <> v_nota.id and nl.orden = v_l.orden;

      if v_prev_cant + v_item.cantidad > v_l.cantidad then
        raise exception 'No podés devolver más de lo facturado: de % quedan % por acreditar', v_l.descripcion, v_l.cantidad - v_prev_cant
          using errcode = 'P0001', hint = 'tope';
      end if;

      if v_prev_cant + v_item.cantidad = v_l.cantidad then
        -- Cierra la línea: el resto exacto, sin deriva de redondeo.
        v_sub := v_l.subtotal_sin_iva - v_prev_sub;
        v_iva := v_l.iva - v_prev_iva;
      else
        v_sub := round(v_l.subtotal_sin_iva * v_item.cantidad / v_l.cantidad, 2);
        v_iva := round(v_l.iva * v_item.cantidad / v_l.cantidad, 2);
      end if;

      insert into dominio.comprobantes_venta_lineas (
        organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
        precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva, sin_stock
      )
      values (
        v_org, v_nota.id, v_l.orden, v_l.producto_id, v_l.descripcion, v_l.codigo, v_item.cantidad, v_l.precio_unitario,
        v_l.escala, v_l.precio_manual, v_l.alicuota_id, v_l.alicuota_porcentaje, v_l.deposito_id, v_l.a_pedido, v_sub, v_iva, v_l.sin_stock
      );
      v_total_sin := v_total_sin + v_sub;
      v_total_con := v_total_con + v_sub + v_iva;
    end loop;
  else
    if jsonb_array_length(p_lineas) <> 1 then
      raise exception 'Indicá un solo importe' using errcode = '22023', hint = 'importe';
    end if;
    begin
      v_importe := round((p_lineas -> 0 ->> 'importe_sin_iva')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or null_value_not_allowed then
      raise exception 'El importe de la nota de crédito no es válido' using errcode = '22023', hint = 'importe';
    end;
    if v_importe is null or v_importe <= 0 then
      raise exception 'El importe de la nota de crédito debe ser mayor a cero' using errcode = '22023', hint = 'importe';
    end if;
    if v_importe > v_resta_sin then
      raise exception 'No podés acreditar más de lo facturado: quedan % por acreditar (sin IVA)', v_resta_sin
        using errcode = 'P0001', hint = 'tope';
    end if;
    v_total_sin := v_importe;
    -- El IVA sale de la proporción de la factura; cerrando lo acreditable, el resto exacto.
    v_total_con := case when v_importe = v_resta_sin then v_resta_con
                        else round(v_importe * v_c.total_con_iva / v_c.total_sin_iva, 2) end;
  end if;

  if v_total_sin <= 0 then
    raise exception 'La nota de crédito no acredita ningún importe' using errcode = '22023';
  end if;
  if v_total_sin > v_resta_sin or v_total_con > v_resta_con then
    raise exception 'No podés acreditar más de lo facturado: quedan % por acreditar (sin IVA)', v_resta_sin
      using errcode = 'P0001', hint = 'tope';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin, total_con_iva = v_total_con
   where id = v_nota.id
  returning * into v_fila;

  perform private.devolver_stock_nota_credito(v_fila.id);

  -- La factura cambió (ya no se puede anular): quien la tenía abierta recibe el conflicto de edición.
  update dominio.comprobantes_venta set updated_at = clock_timestamp() where id = v_c.id;

  v_etiqueta := case p_tipo
    when 'devolucion_productos' then 'Devolución de productos'
    when 'devolucion_importe' then 'Devolución de importe'
    else 'Descuento o bonificación' end;
  perform private.registrar_actividad(
    'comprobante.nota_credito_emitida',
    format('Emitió la nota de crédito %s (%s) sobre la factura %s', v_fila.numero, v_etiqueta, v_c.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- Guardar líneas: conserva las líneas sin_stock.
create or replace function public.guardar_lineas_comprobante(
  p_id uuid,
  p_lineas jsonb,
  p_actualizado_en timestamptz
)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_fila dominio.comprobantes_venta;
  v_tipo_cliente text;
  v_defecto uuid;
  v_puede_precio boolean;
  v_previas jsonb;
  v_elem jsonb;
  v_orden integer := 0;
  v_base integer := 0;
  v_texto text;
  v_producto dominio.productos;
  v_cantidad integer;
  v_deposito uuid;
  v_manual numeric;
  v_precio record;
  v_unitario numeric;
  v_porcentaje numeric;
  v_subtotal numeric;
  v_iva numeric;
  v_total_sin numeric := 0;
  v_total_iva numeric := 0;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para editar comprobantes' using errcode = '42501';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then
    raise exception 'Las líneas deben ser una lista' using errcode = '22023', hint = 'lineas';
  end if;
  if jsonb_array_length(p_lineas) > 200 then
    raise exception 'Un comprobante admite hasta 200 líneas' using errcode = '22023', hint = 'lineas';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede editar comprobantes de esta tienda' using errcode = '42501';
  end if;
  if not ((v_c.tipo = 'factura' and v_c.estado = 'borrador')
       or (v_c.tipo = 'presupuesto' and v_c.estado = 'pendiente')) then
    raise exception 'El comprobante ya está cerrado y no se puede modificar' using errcode = '55000';
  end if;
  if p_actualizado_en is distinct from v_c.updated_at then
    raise exception 'Otra persona modificó este comprobante. Recargalo para ver los cambios' using errcode = '40001';
  end if;

  select cl.tipo into v_tipo_cliente
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_org;
  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_c.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;
  v_puede_precio := (select private.puede_editar_precio_en_empresa(v_c.empresa_id));

  -- Precios manuales ya guardados: un re-guardado sin permiso no puede perderlos ni cambiarlos.
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', l.producto_id, 'precio', l.precio_unitario)), '[]'::jsonb)
    into v_previas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.precio_manual;

  -- Las líneas sin_stock (de Service) no se editan acá: se conservan y suman a los totales.
  delete from dominio.comprobantes_venta_lineas where comprobante_id = v_c.id and not sin_stock;
  select coalesce(max(l.orden), 0), coalesce(sum(l.subtotal_sin_iva), 0), coalesce(sum(l.iva), 0)
    into v_base, v_total_sin, v_total_iva
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;

  for v_elem in select e.value from jsonb_array_elements(p_lineas) as e(value) loop
    v_orden := v_orden + 1;
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'La línea % no es válida', v_orden using errcode = '22023', hint = 'lineas';
    end if;

    -- Producto: de la organización y activo (FR-011).
    v_texto := v_elem ->> 'producto_id';
    begin
      select * into v_producto
        from dominio.productos p
       where p.id = v_texto::uuid and p.organizacion_id = v_org and p.activo;
    exception when invalid_text_representation then
      raise exception 'La línea % tiene un producto inválido', v_orden using errcode = '22023', hint = 'producto_id';
    end;
    if not found then
      raise exception 'La línea % tiene un producto que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;

    -- Cantidad entera mayor a cero (FR-011).
    v_texto := v_elem ->> 'cantidad';
    if v_texto is null or v_texto !~ '^[0-9]{1,7}$' or v_texto::integer < 1 then
      raise exception 'La cantidad de la línea % debe ser un entero mayor a cero', v_orden
        using errcode = '22023', hint = 'cantidad';
    end if;
    v_cantidad := v_texto::integer;

    -- Depósito de salida (FR-011, FR-013): de la organización y activo; sin elegir, el principal.
    v_texto := v_elem ->> 'deposito_id';
    if v_texto is null then
      v_deposito := v_defecto;
    else
      begin
        v_deposito := v_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'La línea % tiene un depósito inválido', v_orden using errcode = '22023', hint = 'deposito_id';
      end;
    end if;
    if v_deposito is null or not exists (
      select 1 from dominio.depositos d where d.id = v_deposito and d.organizacion_id = v_org and d.activo
    ) then
      raise exception 'La línea % tiene un depósito que no existe o está inactivo', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;
    if not exists (
      select 1 from dominio.depositos_empresas de
       where de.deposito_id = v_deposito and de.empresa_id = v_c.empresa_id and de.organizacion_id = v_org
    ) then
      raise exception 'La línea % tiene un depósito desde el que esta tienda no vende', v_orden
        using errcode = '22023', hint = 'deposito_id';
    end if;

    -- Precio manual (FR-016): número >= 0, solo con permiso o si ya estaba guardado igual.
    v_manual := null;
    if v_elem ? 'precio_manual' and jsonb_typeof(v_elem -> 'precio_manual') <> 'null' then
      if jsonb_typeof(v_elem -> 'precio_manual') <> 'number' then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      v_manual := round((v_elem ->> 'precio_manual')::numeric, 2);
      if v_manual < 0 or v_manual >= 1000000000000 then
        raise exception 'El precio de la línea % debe ser un número de cero o más', v_orden
          using errcode = '22023', hint = 'precio_manual';
      end if;
      if not v_puede_precio and not exists (
        select 1 from jsonb_array_elements(v_previas) q
         where (q.value ->> 'producto_id')::uuid = v_producto.id and (q.value ->> 'precio')::numeric = v_manual
      ) then
        raise exception 'Tu rol no puede editar precios' using errcode = '42501', hint = 'precio_manual';
      end if;
    end if;

    -- Precio, escala e IVA (FR-014, FR-015): los calcula el servidor.
    select * into v_precio
      from private.precio_para(v_producto.id, v_c.empresa_id, private.escala_para_linea(v_tipo_cliente, v_cantidad));
    if not found then
      raise exception 'No pudimos calcular el precio de la línea %', v_orden using errcode = '22023', hint = 'producto_id';
    end if;
    v_unitario := coalesce(v_manual, round(v_precio.neto, 2));
    if v_unitario is null then
      raise exception 'El producto de la línea % no tiene precio en pesos (falta la cotización del dólar)', v_orden
        using errcode = '22023', hint = 'producto_id';
    end if;
    v_porcentaje := case when v_precio.alicuota_exenta then 0 else coalesce(v_precio.alicuota_porcentaje, 0) end;
    v_subtotal := round(v_unitario * v_cantidad, 2);
    if v_subtotal >= 1000000000000 then
      raise exception 'El importe de la línea % es demasiado grande', v_orden using errcode = '22023', hint = 'cantidad';
    end if;
    v_iva := round(v_subtotal * v_porcentaje / 100, 2);

    insert into dominio.comprobantes_venta_lineas (
      organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
      precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva
    )
    values (
      v_org, v_c.id, v_base + v_orden, v_producto.id, v_producto.nombre, v_producto.sku, v_cantidad, v_unitario,
      v_precio.escala_usada, v_manual is not null, v_precio.alicuota_id, v_porcentaje, v_deposito,
      v_producto.disponibilidad_manual is not distinct from 'a_pedido', v_subtotal, v_iva
    );

    v_total_sin := v_total_sin + v_subtotal;
    v_total_iva := v_total_iva + v_iva;
  end loop;

  if v_total_sin + v_total_iva >= 1000000000000 then
    raise exception 'El total del comprobante es demasiado grande' using errcode = '22023', hint = 'lineas';
  end if;

  update dominio.comprobantes_venta
     set total_sin_iva = v_total_sin,
         total_con_iva = v_total_sin + v_total_iva,
         updated_at = clock_timestamp()
   where id = v_c.id
  returning * into v_fila;

  perform private.registrar_actividad(
    'comprobante.editado',
    format('Actualizó las líneas de %s %s', case v_fila.tipo when 'factura' then 'la factura' else 'el presupuesto' end, v_fila.numero),
    v_fila.empresa_id
  );
  return v_fila;
end;
$$;

-- Documento PDF: la línea sin depósito no desaparece.
create or replace function private.datos_documento_comprobante(p_documento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc dominio.comprobante_documentos;
  v_vigente boolean;
  v_c dominio.comprobantes_venta;
  v_resultado jsonb;
  v_forma_pago text;
  v_envio text;
begin
  v_doc := private.autorizar_worker_documento(p_documento_id);
  if v_doc.estado <> 'pendiente' then
    raise exception 'DOCUMENTO_NO_PENDIENTE: el documento % ya está cerrado', p_documento_id using errcode = 'P0001';
  end if;
  select ev.en_curso into v_vigente from private.estado_ejecucion_vigente(v_doc.ejecucion_id) ev;
  if not coalesce(v_vigente, false) then
    raise exception 'EJECUCION_NO_EN_CURSO: %', v_doc.ejecucion_id using errcode = 'P0001';
  end if;

  select * into v_c from dominio.comprobantes_venta c
  where c.id = v_doc.comprobante_id and c.organizacion_id = v_doc.organizacion_id;
  if not found or v_c.empresa_id is distinct from v_doc.empresa_id then
    raise exception 'CONFIGURACION_INVALIDA: el comprobante del documento % no coincide con su empresa', p_documento_id
      using errcode = 'P0001';
  end if;

  -- Forma de pago y de envío: solo el nombre elegido, si el catálogo de la tienda lo tiene.
  select f.nombre into v_forma_pago from dominio.formas_pago f
  where f.id = v_c.forma_pago_id and f.organizacion_id = v_c.organizacion_id and f.empresa_id = v_c.empresa_id;
  select f.nombre into v_envio from dominio.formas_envio f
  where f.id = v_c.envio_id and f.organizacion_id = v_c.organizacion_id and f.empresa_id = v_c.empresa_id;

  select jsonb_build_object(
    'documento', jsonb_build_object(
      'id', v_doc.id,
      'tipo', v_doc.tipo_documento,
      -- Única ruta que acepta `cerrar_documento_comprobante`: el worker sube exactamente ahí.
      'ruta', v_doc.organizacion_id::text || '/' || v_doc.empresa_id::text || '/' || v_doc.comprobante_id::text
              || '/' || v_doc.id::text || '.pdf'
    ),
    'empresa', jsonb_build_object(
      'nombre', e.nombre,
      'razon_social', nullif(btrim(e.razon_social), ''),
      'cuit', e.cuit,
      'direccion', nullif(btrim(e.direccion), ''),
      'correo', nullif(btrim(e.correo), ''),
      'whatsapp', nullif(btrim(e.whatsapp), ''),
      'logo_ruta', ti.logo_ruta
    ),
    'cliente', jsonb_build_object(
      'nombre', cl.nombre,
      'documento', nullif(btrim(cl.documento), ''),
      'condicion_iva', nullif(btrim(cl.condicion_iva), ''),
      'direccion', nullif(btrim(concat_ws(', ', nullif(cl.direccion, ''), nullif(cl.localidad, ''), nullif(cl.provincia, ''))), '')
    ),
    'comprobante', jsonb_build_object(
      'tipo', v_c.tipo,
      'numero', v_c.numero,
      'estado', v_c.estado,
      'fecha', v_c.fecha,
      'valido_hasta', v_c.valido_hasta,
      'operador', nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), ''),
      'forma_pago', v_forma_pago,
      'envio', v_envio,
      'total_sin_iva', v_c.total_sin_iva,
      'iva', v_c.total_con_iva - v_c.total_sin_iva,
      'total_con_iva', v_c.total_con_iva
    ),
    'lineas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orden', l.orden,
          'descripcion', l.descripcion,
          'codigo', nullif(btrim(l.codigo), ''),
          'cantidad', l.cantidad,
          'precio_unitario', l.precio_unitario,
          'subtotal_sin_iva', l.subtotal_sin_iva,
          'deposito', d.nombre
        )
        order by l.orden
      )
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos d on d.id = l.deposito_id and d.organizacion_id = l.organizacion_id
      where l.comprobante_id = v_c.id and l.organizacion_id = v_c.organizacion_id
    ), '[]'::jsonb)
  )
  into v_resultado
  from dominio.empresas e
  join public.clientes cl on cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id
  left join dominio.tienda_identidad ti on ti.empresa_id = e.id and ti.organizacion_id = e.organizacion_id
  left join public.perfiles_usuario p on p.user_id = v_c.operador_id
  where e.id = v_c.empresa_id and e.organizacion_id = v_c.organizacion_id;

  return v_resultado;
end;
$$;

-- Líneas acreditables: la línea sin depósito no desaparece.
create or replace function public.detalle_anulacion_nota_credito(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_c dominio.comprobantes_venta;
  v_resta numeric(14, 2);
  v_tiene_notas boolean;
  v_operativa boolean;
begin
  if v_org is null or (select auth.uid()) is null then
    raise exception 'Necesitás una sesión con organización para ver comprobantes' using errcode = '42501';
  end if;
  select * into v_c from dominio.comprobantes_venta c where c.id = p_id and c.organizacion_id = v_org;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comprobantes de esta tienda' using errcode = '42501';
  end if;

  select v_c.total_sin_iva - coalesce(sum(n.total_sin_iva), 0), count(*) > 0
    into v_resta, v_tiene_notas
    from dominio.comprobantes_venta n
   where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito';
  v_operativa := v_c.tipo = 'factura' and v_c.estado not in ('borrador', 'anulada');

  return jsonb_build_object(
    'puede_anular', v_operativa and v_c.estado <> 'cobrado' and not v_tiene_notas
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'anular')),
    'puede_emitir_nota_credito', v_operativa and v_resta > 0
      and (select private.puede_accion_comprobante(v_c.empresa_id, 'emitir_nota_credito')),
    'anulacion', case when v_c.anulado_en is null then null else jsonb_build_object(
      'cuando', v_c.anulado_en,
      'quien', coalesce((
        select nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
          from public.perfiles_usuario p where p.user_id = v_c.anulado_por), 'Usuario sin nombre'),
      'motivo', v_c.motivo_anulacion
    ) end,
    'acreditable_sin_iva', case when v_c.tipo = 'factura' then v_resta else 0 end,
    'lineas_acreditables', case when v_c.tipo <> 'factura' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'linea_id', l.id,
        'orden', l.orden,
        'descripcion', l.descripcion,
        'cantidad', l.cantidad,
        'devuelta', d.devuelta,
        'disponible', l.cantidad - d.devuelta,
        'precio_unitario', l.precio_unitario,
        'deposito', dep.nombre
      ) order by l.orden)
      from dominio.comprobantes_venta_lineas l
      left join dominio.depositos dep on dep.id = l.deposito_id and dep.organizacion_id = l.organizacion_id
      cross join lateral (
        select coalesce(sum(nl.cantidad), 0)::integer as devuelta
          from dominio.comprobantes_venta_lineas nl
          join dominio.comprobantes_venta n on n.id = nl.comprobante_id and n.organizacion_id = nl.organizacion_id
         where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id
           and n.nc_tipo = 'devolucion_productos' and nl.orden = l.orden
      ) d
      where l.comprobante_id = v_c.id and l.organizacion_id = v_org
    ), '[]'::jsonb) end,
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'numero', n.numero,
        'nc_tipo', n.nc_tipo,
        'concepto', n.nc_concepto,
        'fecha', n.fecha,
        'total_sin_iva', n.total_sin_iva,
        'total_con_iva', n.total_con_iva,
        'lineas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'orden', nl.orden,
            'descripcion', nl.descripcion,
            'cantidad', nl.cantidad,
            'precio_unitario', nl.precio_unitario,
            'subtotal_sin_iva', nl.subtotal_sin_iva,
            'iva', nl.iva
          ) order by nl.orden)
          from dominio.comprobantes_venta_lineas nl
          where nl.comprobante_id = n.id and nl.organizacion_id = v_org
        ), '[]'::jsonb)
      ) order by n.numero_entero)
      from dominio.comprobantes_venta n
      where n.organizacion_id = v_org and n.comprobante_origen_id = v_c.id and n.tipo = 'nota_credito'
    ), '[]'::jsonb)
  );
end;
$$;
