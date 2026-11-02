-- F-REN-09 (MSF-223, épica MSF-192, FR-007): `public.confirmar_comprobante(uuid)` guarda en cada línea el costo del
-- producto en pesos y la cotización vigentes al confirmar. MISMA firma y grants que la definición de
-- 20261204140000 (F-VTA-07); el cuerpo es idéntico salvo el `update` de costo y cotización marcado con F-REN-09.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.comprobantes_venta_lineas` (`dominio`, columnas de
-- 20270201110000). Lee `dominio.producto_costos`, `dominio.productos` y `dominio.cotizacion_inicial`.
--
-- Idempotente: una factura ya `confirmada` devuelve antes de llegar al `update`; un cambio posterior de costo o
-- de cotización no altera lo guardado. Todo o nada: si falta stock, la transacción revierte también el costo.
-- Sin costo cargado (o USD sin cotización) la línea queda con `costo_unitario` null y no entra al margen real.
--
-- Notas de crédito: las líneas de «Devolución de productos» las escribe `public.emitir_nota_credito`
-- (20261212120400), que NO se reescribe: un trigger BEFORE INSERT copia el costo y la cotización de la línea
-- original (misma factura, mismo `orden`), así la devolución resta el costo con que se vendió. Las notas por
-- importe no tienen líneas y no mueven el margen real.
--
-- Migración aditiva. Reversión (migración posterior): restituir `public.confirmar_comprobante` con su definición
-- de 20261204140000 y
--   drop trigger comprobantes_venta_lineas_costo_nota on dominio.comprobantes_venta_lineas;
--   drop function private.copiar_costo_linea_nota();

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

  select count(*)::int into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'La factura no tiene productos: agregá al menos uno para confirmarla' using errcode = '22023';
  end if;

  -- F-REN-09 (FR-007): costo en pesos y cotización del momento, por línea. Corre una sola vez: un reintento sobre
  -- una `confirmada` ya salió arriba (idempotencia) y nada posterior reescribe estas columnas.
  update dominio.comprobantes_venta_lineas l
     set costo_unitario = private.a_pesos(k.costo, p.moneda, v_org),
         cotizacion = coalesce(
           (select ca.valor from dominio.cotizacion_aplicada ca where ca.organizacion_id = v_org),
           (select ci.valor from dominio.cotizacion_inicial ci where ci.organizacion_id = v_org))
    from dominio.productos p
    left join dominio.producto_costos k on k.producto_id = p.id and k.organizacion_id = p.organizacion_id
   where l.comprobante_id = v_c.id and l.organizacion_id = v_org
     and p.id = l.producto_id and p.organizacion_id = l.organizacion_id;

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
     where l.comprobante_id = v_c.id and l.organizacion_id = v_org
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
  if v_procesadas <> v_lineas then
    raise exception 'La factura tiene % líneas pero solo se pudieron procesar %: revisá producto y depósito de cada una', v_lineas, v_procesadas
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

revoke execute on function public.confirmar_comprobante(uuid) from public, anon;
grant execute on function public.confirmar_comprobante(uuid) to authenticated;

comment on function public.confirmar_comprobante(uuid) is
  'Confirma una factura en borrador (F-VTA-07) y guarda costo y cotización por línea (F-REN-09): salida de stock por línea y depósito, reserva de líneas «A pedido», todo o nada e idempotente. Exige ventas en edición en la empresa del comprobante. Contrato en docs/ventas-comprobantes.md.';

-- Copia del costo a las líneas de una nota de crédito de devolución (la RPC de emisión no cambia).
create or replace function private.copiar_costo_linea_nota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.costo_unitario is null and new.cotizacion is null then
    select o.costo_unitario, o.cotizacion into new.costo_unitario, new.cotizacion
      from dominio.comprobantes_venta n
      join dominio.comprobantes_venta_lineas o
        on o.comprobante_id = n.comprobante_origen_id and o.organizacion_id = n.organizacion_id and o.orden = new.orden
     where n.id = new.comprobante_id and n.organizacion_id = new.organizacion_id
       and n.tipo = 'nota_credito' and n.nc_tipo = 'devolucion_productos';
  end if;
  return new;
end;
$$;

revoke execute on function private.copiar_costo_linea_nota() from public, anon, authenticated;

create trigger comprobantes_venta_lineas_costo_nota
  before insert on dominio.comprobantes_venta_lineas
  for each row execute function private.copiar_costo_linea_nota();
