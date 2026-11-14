-- MSF-816 / F-3 (spec 20261113-120000-precio-promocional-en-pos-y-comprobantes, FR-009, T014): guarda de precios
-- desactualizados en la confirmación de facturas.
--
-- Qué hace:
--   · `private.lineas_con_promocion_desactualizada(comprobante, ahora)`: cuenta las líneas del comprobante cuya
--     promoción cobrada ya no es la vigente. Por línea (no manual, no `sin_stock`) mira la promoción vigente ahora de la
--     tienda del comprobante (`private.promocion_vigente_fila`, búsqueda indexada); es CANDIDATA si esa promoción no es
--     la guardada (`promocion_id` distinto: vencida, nueva o sustituida, aun con el mismo precio) o si es la misma con
--     un precio que difiere del `precio_unitario` guardado en más de 0.005. Solo las candidatas se recalculan con
--     `private.precio_linea_venta` (mismo tipo de cliente, descuento y cantidad que `guardar_lineas_comprobante`) y se
--     cuentan si el `promocion_id` o el precio calculados difieren de lo guardado. NO recalcula el precio normal de una
--     línea cuya promoción guardada sigue vigente al mismo precio (FR-024: `precio_para` cuesta ≈8,5 ms por llamada):
--     un cambio del precio normal —lista, escala, cotización o descuento del cliente— que deje a la promoción sin ganar
--     NO se rechaza y se cobra la promoción mostrada (decisión explícita, seguimiento S7). Omite las líneas con
--     precio manual, las `sin_stock` y las candidatas sin precio calculable (producto en dólares sin cotización,
--     permiso perdido). Con la bandera `promociones_precio` apagada devuelve 0 (no actúa ni sobre líneas guardadas con
--     la bandera encendida). `security definer`, `search_path = ''`, sin grant a ningún rol (la ejecuta la RPC).
--   · `public.confirmar_comprobante`: el cuerpo es el VIGENTE de 20270216400000 (misma firma, grants, mensajes,
--     motivos, stock, costos e idempotencia); solo se suma la guarda, después del bloqueo `for update`, de los chequeos
--     de permiso/estado/idempotencia y de la comprobación de líneas, y ANTES de tocar costos, stock o estado:
--     `40001` con `hint = 'precios_cambiaron'`. El instante es `clock_timestamp()` tomado tras el `for update`. Con la
--     bandera apagada el comportamiento es idéntico al anterior. Una factura ya `confirmada` vuelve antes de la guarda.
--
-- Esquema (Principio VII): sin objetos de datos nuevos; solo lógica en `private` y la RPC en `public`. Lee
-- `dominio.comprobantes_venta_lineas`, `dominio.comprobantes_venta` y `public.clientes`.
--
-- Migración aditiva (función nueva y `create or replace` de la RPC). Idempotente.
-- Reversión (migración posterior): restituir `public.confirmar_comprobante` con su definición de 20270216400000 y
-- `drop function private.lineas_con_promocion_desactualizada(uuid, timestamptz);`

create or replace function private.lineas_con_promocion_desactualizada(
  p_comprobante uuid,
  p_ahora timestamptz default now()
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c record;
  v_tipo_cliente text;
  v_descuento numeric := 0;
  v_n integer;
begin
  if not private.bandera_activa('promociones_precio') then
    return 0;
  end if;

  select c.organizacion_id, c.empresa_id, c.cliente_id into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante;
  if not found or v_c.empresa_id is null then
    return 0;
  end if;

  -- Mismo origen del tipo y del descuento que `guardar_lineas_comprobante`.
  select cl.tipo, coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento
    from public.clientes cl
   where cl.id = v_c.cliente_id and cl.organizacion_id = v_c.organizacion_id;
  v_descuento := coalesce(v_descuento, 0);

  -- FR-024: `precio_para` (escala, propio, lista, cotización) cuesta mucho más que una búsqueda indexada. Primero se
  -- mira, por línea, solo la promoción vigente (`promocion_vigente_fila`, índice de MSF-363); únicamente las líneas
  -- candidatas (la promoción vigente no es la guardada, o es la misma con otro precio) pasan por el cálculo completo
  -- `precio_linea_venta`, que decide con la misma regla del guardado. Una línea sin promoción guardada ni vigente, o
  -- con la misma promoción al mismo precio, no se recalcula: un cambio solo del precio normal no se rechaza (la guarda
  -- mira promociones, igual que hoy no se rechazan los cambios de lista). Un `cross join lateral` sin fila (precio no
  -- calculable) omite la línea, y `neto_unitario` nulo también.
  with candidatas as materialized (
    select l.producto_id, l.cantidad, l.promocion_id, l.precio_unitario
      from dominio.comprobantes_venta_lineas l
      left join lateral private.promocion_vigente_fila(l.producto_id, v_c.empresa_id, p_ahora) f on true
     where l.comprobante_id = p_comprobante
       and l.organizacion_id = v_c.organizacion_id
       and not l.precio_manual
       and not l.sin_stock
       and l.producto_id is not null
       and (f.promocion_id is distinct from l.promocion_id
            or (f.promocion_id is not null and abs(f.precio - l.precio_unitario) > 0.005))
  )
  select count(*)::int into v_n
    from candidatas c
   cross join lateral private.precio_linea_venta(
           c.producto_id, v_c.empresa_id, v_tipo_cliente, c.cantidad, v_descuento, p_ahora) p
   where p.neto_unitario is not null
     and (p.promocion_id is distinct from c.promocion_id
          or (p.promocion_id is not null and abs(p.neto_unitario - c.precio_unitario) > 0.005));
  return v_n;
end;
$$;

revoke execute on function private.lineas_con_promocion_desactualizada(uuid, timestamptz)
  from public, anon, authenticated, service_role;

comment on function private.lineas_con_promocion_desactualizada(uuid, timestamptz) is
  'MSF-816: cuenta las líneas de un comprobante cuya promoción (o precio promocional) ya no es la que se cobraría ahora. Omite precio manual, sin_stock y líneas sin precio calculable; con la bandera promociones_precio apagada devuelve 0. La usa confirmar_comprobante.';

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
  v_ahora timestamptz;
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

  -- MSF-816 (FR-009): guarda de precios desactualizados. El instante se toma DESPUÉS del `for update` y la guarda corre
  -- antes de tocar costos, stock o estado: el rechazo no deja rastro. Con la bandera `promociones_precio` apagada no
  -- actúa (la función auxiliar devuelve 0). Los mensajes y el `hint` son contrato con la UI (F-2).
  v_ahora := clock_timestamp();
  if (select private.lineas_con_promocion_desactualizada(v_c.id, v_ahora)) > 0 then
    raise exception 'Los precios de la venta cambiaron (promoción vencida o nueva): revisá el total'
      using errcode = '40001', hint = 'precios_cambiaron';
  end if;

  -- F-REN-09 (FR-007) + MSF-352: costo en pesos y cotización del momento, por línea, con la cotización de la EMPRESA
  -- del comprobante según el alcance (`private.cotizacion_para`: la propia con alcance «empresa», la general si no
  -- tiene fila o el alcance es «sistema»). Una sola cotización por comprobante: la subconsulta nunca devuelve varias filas.
  -- Antes: F-REN-09. Corre una sola vez: un reintento sobre
  -- una `confirmada` ya salió arriba (idempotencia) y nada posterior reescribe estas columnas.
  update dominio.comprobantes_venta_lineas l
     set costo_unitario = private.a_pesos(k.costo, p.moneda, v_org, v_c.empresa_id),
         cotizacion = private.cotizacion_para(v_org, v_c.empresa_id)
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

revoke execute on function public.confirmar_comprobante(uuid) from public, anon;
grant execute on function public.confirmar_comprobante(uuid) to authenticated;

comment on function public.confirmar_comprobante(uuid) is
  'Confirma una factura en borrador (F-VTA-07): guarda costo y cotización por línea (F-REN-09) y saltea las líneas sin stock (F-SVC-13: ni salida ni reserva). Salida de stock por línea y depósito, reserva de líneas «A pedido», todo o nada e idempotente. Exige ventas en edición en la empresa del comprobante. MSF-816: rechaza con 40001/precios_cambiaron (sin efectos) si una promoción cobrada venció, cambió o hay una nueva más baja. Contrato en docs/ventas-comprobantes.md.';

