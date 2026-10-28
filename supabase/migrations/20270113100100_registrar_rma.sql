-- F-VTA-28 (MSF-288, épica MSF-178, FR-002): `public.registrar_rma`, el alta de una devolución o reclamo por ítem.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.rma` y `dominio.rma_items` (dominio, 20270113100000) y,
-- por `private.registrar_actividad`, `public.registro_actividad` (plataforma).
--
-- `p_lineas`: arreglo de `{linea_id, cantidad}` con líneas DEL comprobante (se suman las repetidas).
--
-- Reglas:
--   · Solo sobre una `factura` confirmada y no anulada (borrador, anulada, presupuesto y nota: 55000 / 22023).
--   · Cada línea es del comprobante y la cantidad no excede lo vendido menos lo ya devuelto en RMA previos de esa línea
--     (P0001). El comprobante se toma `for update`: dos altas simultáneas sobre lo mismo se serializan y la segunda ve
--     lo que dejó la primera.
--   · Número correlativo `RMA-####` por organización; el contador se calcula bajo un lock de aviso transaccional, así que
--     si el alta falla el número no se consume.
--   · Todo en una transacción: rma + rma_items + evento `rma.registrada`.
--
-- Seguridad: `security definer`, `search_path = ''`; la organización y el actor salen de la sesión. Exige `ventas` en
-- `edicion` EN LA EMPRESA del comprobante (`private.nivel_ventas_en_empresa`). `revoke … from public, anon` y
-- `grant execute … to authenticated` explícitos.
--
-- Errores: 42501 permiso · P0002 no existe · 22023 dato inválido · 55000 comprobante sin estado válido · P0001 tope.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.registrar_rma(uuid, jsonb, text, text, text);

create or replace function public.registrar_rma(
  p_comprobante_id uuid,
  p_lineas jsonb,
  p_forma_rma text,
  p_motivo text,
  p_observaciones text default null
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.comprobantes_venta;
  v_rma dominio.rma;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_obs text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_items jsonb;
  v_item record;
  v_l dominio.comprobantes_venta_lineas;
  v_devuelto integer;
  v_numero integer;
  v_etiqueta text;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para registrar devoluciones' using errcode = '42501';
  end if;
  if p_forma_rma is null
     or p_forma_rma not in ('cambio_directo', 'enviado_a_proveedor', 'faltante_envio', 'reclamo_faltante', 'devolucion_importe') then
    raise exception 'Elegí la forma de RMA' using errcode = '22023', hint = 'forma_rma';
  end if;
  if v_motivo = '' then
    raise exception 'Escribí el motivo de la devolución' using errcode = '22023', hint = 'motivo';
  end if;
  if length(v_motivo) > 200 then
    raise exception 'El motivo no puede superar los 200 caracteres' using errcode = '22023', hint = 'motivo';
  end if;
  if length(coalesce(v_obs, '')) > 1000 then
    raise exception 'Las observaciones no pueden superar los 1000 caracteres' using errcode = '22023', hint = 'observaciones';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0
     or jsonb_array_length(p_lineas) > 200 then
    raise exception 'Elegí el ítem a devolver' using errcode = '22023', hint = 'lineas';
  end if;

  select * into v_c
    from dominio.comprobantes_venta c
   where c.id = p_comprobante_id and c.organizacion_id = v_org
   for update;
  if not found or v_c.empresa_id is null then
    raise exception 'El comprobante no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede registrar devoluciones en esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'La devolución se registra sobre una factura' using errcode = '22023', hint = 'comprobante';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de registrar una devolución' using errcode = '55000';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite devoluciones' using errcode = '55000';
  end if;

  begin
    select jsonb_agg(jsonb_build_object('linea_id', q.linea_id, 'cantidad', q.cantidad) order by q.linea_id)
      into v_items
      from (
        select (e ->> 'linea_id')::uuid as linea_id, sum((e ->> 'cantidad')::integer)::integer as cantidad
          from jsonb_array_elements(p_lineas) e
         group by 1
      ) q;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    raise exception 'Los ítems de la devolución no son válidos' using errcode = '22023', hint = 'lineas';
  end;

  -- Número correlativo por organización: el lock de aviso serializa el cálculo hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtextextended('rma:' || v_org::text, 0));
  select coalesce(max(substring(r.numero from 5)::integer), 0) + 1 into v_numero
    from dominio.rma r where r.organizacion_id = v_org;

  insert into dominio.rma (organizacion_id, empresa_id, comprobante_id, numero, forma_rma, motivo, observaciones, estado, operador_id)
  values (v_org, v_c.empresa_id, v_c.id, 'RMA-' || lpad(v_numero::text, 4, '0'), p_forma_rma, v_motivo, v_obs, 'abierto', v_actor)
  returning * into v_rma;

  for v_item in select x.linea_id, x.cantidad from jsonb_to_recordset(v_items) as x(linea_id uuid, cantidad integer)
  loop
    if v_item.linea_id is null or v_item.cantidad is null or v_item.cantidad < 1 then
      raise exception 'Cada ítem necesita una cantidad de al menos 1' using errcode = '22023', hint = 'lineas';
    end if;
    select * into v_l
      from dominio.comprobantes_venta_lineas l
     where l.id = v_item.linea_id and l.comprobante_id = v_c.id and l.organizacion_id = v_org;
    if not found then
      raise exception 'Uno de los ítems no pertenece a la factura' using errcode = '22023', hint = 'lineas';
    end if;

    select coalesce(sum(i.cantidad), 0) into v_devuelto
      from dominio.rma_items i
     where i.organizacion_id = v_org and i.comprobante_linea_id = v_l.id;

    if v_devuelto + v_item.cantidad > v_l.cantidad then
      raise exception 'No podés devolver más de lo vendido: de % quedan % por devolver', v_l.descripcion, v_l.cantidad - v_devuelto
        using errcode = 'P0001', hint = 'tope';
    end if;

    insert into dominio.rma_items (organizacion_id, rma_id, comprobante_linea_id, producto_id, cantidad)
    values (v_org, v_rma.id, v_l.id, v_l.producto_id, v_item.cantidad);
  end loop;

  v_etiqueta := case p_forma_rma
    when 'cambio_directo' then 'Cambio directo'
    when 'enviado_a_proveedor' then 'Enviado a proveedor'
    when 'faltante_envio' then 'Faltante en envío'
    when 'reclamo_faltante' then 'Reclamo faltante'
    else 'Devolución de importe' end;
  perform private.registrar_actividad(
    'rma.registrada',
    format('Registró la devolución %s (%s) sobre la factura %s', v_rma.numero, v_etiqueta, v_c.numero),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

revoke execute on function public.registrar_rma(uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.registrar_rma(uuid, jsonb, text, text, text) to authenticated;

comment on function public.registrar_rma(uuid, jsonb, text, text, text) is
  'Alta de una devolución o reclamo por ítem sobre una factura confirmada, sin exceder lo vendido ni lo ya devuelto (F-VTA-28, FR-002). Exige ventas en edición en la tienda del comprobante.';
