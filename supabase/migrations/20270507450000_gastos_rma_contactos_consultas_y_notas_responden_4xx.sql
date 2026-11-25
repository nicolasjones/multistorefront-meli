-- Lote 73 (MSF-599, MSF-654 y MSF-655, décima ola de la convención de códigos de negocio mapeados a 4xx): quince RPC de
-- gastos, devoluciones (RMA), contactos de clientes, consultas, rendición de envíos en moto, notas de crédito y facturación de
-- presupuestos dejan de contestar HTTP 500 cuando rechazan por «no existe» (`P0002`), conflicto de edición (`40001`) o «el estado
-- o la regla de negocio no admite la acción» (`55000`). Pasan, con el mismo mensaje de siempre, a `PT404` (HTTP 404), `PT412`
-- (HTTP 412) y `PT409` (HTTP 409). Qué código emite cada función: ver la tabla de docs/errores-negocio-postgrest.md.
--
-- Funciones: guardar_gasto, anular_gasto, cambiar_estado_rma, registrar_rma, reingresar_stock_rma, vincular_nota_credito_rma,
-- rendir_envios_moto, emitir_nota_credito, facturar_presupuesto, actualizar_contacto, anonimizar_contacto, actualizar_consulta,
-- guardar_correo_avisos_consultas, cambiar_estado_estado_consulta y renombrar_estado_consulta.
--
-- Cada función parte de su definición VIGENTE (indicada sobre ella) y solo cambia el errcode: mensajes, cuerpo, firma,
-- `security definer`/`invoker`, `search_path` y grants son los mismos (`create or replace` conserva privilegios y comentario; no
-- hay drop, grant ni revoke). Ninguna de las definiciones fue reescrita in situ por un barrido posterior (el de
-- `public.clientes` a `dominio.clientes` de 20270418000401 no las alcanzó: ninguna nombra esa tabla en su cuerpo, y la de
-- `facturar_presupuesto` es posterior). Los comentarios de siete funciones mencionaban el código y se actualizan.
--
-- Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function: solo la web, que acepta el código viejo
-- y el nuevo (`esCodigoDeConflicto`, `esCodigoDeEstado`, `P0002` o `PT404`) porque la migración y el despliegue no son simultáneos.
-- El script de datos de demostración llama a `emitir_nota_credito` y `registrar_rma` sin leer el código de error.
--
-- Quedan con el código anterior a propósito:
--   (a) `emitir_nota_credito` y `facturar_presupuesto` conservan `P0002` («no existe»): esta ola solo convierte sus `55000`;
--   (b) el rechazo de `facturar_presupuesto` «figura como facturado pero no encontramos su factura» (`55000`) es una
--       inconsistencia de datos y no un estado que la persona pueda corregir, así que sigue siendo un error de servidor;
--   (c) el `40001` con hint `precios_cambiaron` (la guarda de precios de `facturar_presupuesto` y `confirmar_comprobante`, que lo
--       lanza un auxiliar de `private`): contrato propio por hint; `confirmar_comprobante` no se toca en esta ola;
--   (d) los `55000` que lanzan auxiliares de `private` (p. ej. `private.registrar_cobro_interno` dentro de `rendir_envios_moto`)
--       y los de bandera apagada.
--
-- Migración aditiva (create or replace). Reversión: volver a aplicar, en una migración nueva, la definición vigente indicada
-- sobre cada función (en el cuerpo, `PT404` vuelve a `P0002`, `PT412` a `40001` y `PT409` a `55000`) y restaurar los comentarios
-- de guardar_gasto y anular_gasto (20270349000100), actualizar_consulta (20261205100200), guardar_correo_avisos_consultas
-- (20261205200000), actualizar_contacto (20270201100200), anonimizar_contacto (20270201100500) y rendir_envios_moto
-- (20270228110100). Las migraciones ya aplicadas no se editan.

-- guardar_gasto: definición vigente en 20270349000100_gastos_rpc.sql (2 P0002 a PT404, 1 40001 a PT412)
create or replace function public.guardar_gasto(
  p_id uuid,
  p_empresa uuid,
  p_fecha date,
  p_categoria text,
  p_tipo_costo text,
  p_detalle text,
  p_importe numeric,
  p_moneda text,
  p_recurrente boolean,
  p_actualizado timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_detalle text := nullif(btrim(coalesce(p_detalle, '')), '');
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_campos text[];
  v_activa boolean;
  v_nombre text;
  v_actual dominio.gastos;
  v_cot numeric(14, 4);
  v_pesos numeric(14, 2);
  v_id uuid;
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar ni editar gastos' using errcode = '42501';
  end if;
  select e.activa, e.nombre into v_activa, v_nombre from dominio.empresas e where e.id = p_empresa and e.organizacion_id = v_org;
  if not found then
    raise exception 'La empresa no existe' using errcode = 'PT404';
  end if;
  if not v_activa then
    raise exception 'No se pueden cargar gastos a una empresa inactiva' using errcode = '22023';
  end if;
  if p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No podés cargar gastos para esa empresa' using errcode = '42501';
  end if;
  if p_fecha is null or p_fecha > v_hoy + 31 or p_fecha < date '2000-01-01' then
    raise exception 'La fecha es obligatoria, desde el 01/01/2000 y no puede superar los 31 días a futuro' using errcode = '22023';
  end if;
  if p_categoria is null or p_categoria not in ('Alquiler', 'Servicios', 'Sueldos', 'Fletes', 'Insumos', 'Impuestos', 'Otros') then
    raise exception 'La categoría no es válida' using errcode = '22023';
  end if;
  if p_tipo_costo is null or p_tipo_costo not in ('fijo', 'variable') then
    raise exception 'El tipo de costo debe ser fijo o variable' using errcode = '22023';
  end if;
  if v_detalle is not null and char_length(v_detalle) > 200 then
    raise exception 'El detalle admite hasta 200 caracteres' using errcode = '22023';
  end if;
  if p_importe is null or p_importe <= 0 or p_importe <> round(p_importe, 2) or p_importe >= 1000000000000 then
    raise exception 'El importe debe ser mayor que cero, con hasta 2 decimales' using errcode = '22023';
  end if;
  if p_moneda is null or p_moneda not in ('ARS', 'USD') then
    raise exception 'La moneda debe ser ARS o USD' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_actual from dominio.gastos g where g.id = p_id and g.organizacion_id = v_org for update;
    if not found then
      raise exception 'El gasto no existe' using errcode = 'PT404';
    end if;
    if v_actual.empresa_id not in (select private.empresas_accesibles()) then
      raise exception 'No podés editar gastos de esa empresa' using errcode = '42501';
    end if;
    if v_actual.anulado_en is not null then
      raise exception 'Un gasto anulado no se puede editar' using errcode = '22023';
    end if;
    if p_actualizado is null or p_actualizado <> v_actual.updated_at then
      raise exception 'El gasto cambió mientras lo editabas: recargá la lista' using errcode = 'PT412';
    end if;
  end if;

  -- Cotización congelada (D8, CA-GAS-5): se conserva solo si nada que la determine cambió (moneda USD igual, importe, fecha y
  -- tienda); si cambia alguno se recalcula con la del dólar aplicado más cercano a la fecha.
  if p_moneda = 'ARS' then
    v_cot := null;
    v_pesos := p_importe;
  else
    if p_id is not null and v_actual.moneda = 'USD' and v_actual.fecha = p_fecha and v_actual.empresa_id = p_empresa
       and v_actual.importe = p_importe then
      v_cot := v_actual.cotizacion_usada;
    else
      v_cot := analitica.cotizacion_cercana(v_org, ((p_fecha::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires'), p_empresa);
    end if;
    if v_cot is null then
      raise exception 'Cargá la cotización del dólar' using errcode = '22023';
    end if;
    if p_importe * v_cot >= 1000000000000 then
      raise exception 'El importe en pesos es demasiado grande: revisá el importe' using errcode = '22023';
    end if;
    v_pesos := round(p_importe * v_cot, 2);
    if v_pesos <= 0 then
      raise exception 'El importe en pesos debe ser mayor que cero' using errcode = '22023';
    end if;
  end if;

  if p_id is null then
    insert into dominio.gastos (organizacion_id, empresa_id, fecha, categoria, tipo_costo, detalle, importe, moneda,
                                cotizacion_usada, importe_pesos, recurrente, creado_por)
    values (v_org, p_empresa, p_fecha, p_categoria, p_tipo_costo, v_detalle, p_importe, p_moneda,
            v_cot, v_pesos, coalesce(p_recurrente, false), v_uid)
    returning id into v_id;
    perform private.insertar_cambio_actividad(
      v_org, v_uid, 'gasto.creado',
      format('Cargó un gasto de %s en %s', p_categoria, v_nombre),
      null,
      jsonb_build_object('categoria', p_categoria, 'empresa', v_nombre),
      p_empresa
    );
  else
    update dominio.gastos
       set empresa_id = p_empresa, fecha = p_fecha, categoria = p_categoria, tipo_costo = p_tipo_costo, detalle = v_detalle,
           importe = p_importe, moneda = p_moneda, cotizacion_usada = v_cot, importe_pesos = v_pesos,
           recurrente = coalesce(p_recurrente, false), updated_at = clock_timestamp()
     where id = p_id;
    v_id := p_id;
    -- Solo los NOMBRES de los campos que cambiaron, nunca sus valores.
    v_campos := array_remove(array[
      case when v_actual.empresa_id is distinct from p_empresa then 'empresa' end,
      case when v_actual.fecha is distinct from p_fecha then 'fecha' end,
      case when v_actual.categoria is distinct from p_categoria then 'categoria' end,
      case when v_actual.tipo_costo is distinct from p_tipo_costo then 'tipo_costo' end,
      case when v_actual.detalle is distinct from v_detalle then 'detalle' end,
      case when v_actual.importe is distinct from p_importe then 'importe' end,
      case when v_actual.moneda is distinct from p_moneda then 'moneda' end,
      case when v_actual.recurrente is distinct from coalesce(p_recurrente, false) then 'recurrente' end
    ], null);
    perform private.insertar_cambio_actividad(
      v_org, v_uid, 'gasto.editado',
      format('Editó un gasto de %s en %s', p_categoria, v_nombre),
      jsonb_build_object('categoria', v_actual.categoria,
                         'empresa', (select e.nombre from dominio.empresas e where e.id = v_actual.empresa_id)),
      jsonb_build_object('categoria', p_categoria, 'empresa', v_nombre, 'campos_modificados', to_jsonb(v_campos)),
      p_empresa
    );
  end if;
  return v_id;
end;
$$;

comment on function public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz) is
  'F-GAS-01: alta (p_id null) o edición de un gasto (solo edición en rentabilidad). Congela cotización e importe en pesos. 42501, PT404, 22023, PT412.';

-- anular_gasto: definición vigente en 20270349000100_gastos_rpc.sql (1 P0002 a PT404, 1 40001 a PT412)
create or replace function public.anular_gasto(p_id uuid, p_motivo text, p_actualizado timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_g dominio.gastos;
  v_emp_nombre text;
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede anular gastos' using errcode = '42501';
  end if;
  select * into v_g from dominio.gastos g where g.id = p_id and g.organizacion_id = v_org for update;
  if not found then
    raise exception 'El gasto no existe' using errcode = 'PT404';
  end if;
  if v_g.empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'No podés anular gastos de esa empresa' using errcode = '42501';
  end if;
  -- Idempotente: anular uno ya anulado no hace nada.
  if v_g.anulado_en is not null then
    return;
  end if;
  if v_motivo = '' or char_length(v_motivo) > 200 then
    raise exception 'El motivo es obligatorio y admite hasta 200 caracteres' using errcode = '22023';
  end if;
  if p_actualizado is null or p_actualizado <> v_g.updated_at then
    raise exception 'El gasto cambió mientras lo editabas: recargá la lista' using errcode = 'PT412';
  end if;
  update dominio.gastos
     set anulado_en = clock_timestamp(), anulado_por = v_uid, motivo_anulacion = v_motivo, updated_at = clock_timestamp()
   where id = p_id;
  select e.nombre into v_emp_nombre from dominio.empresas e where e.id = v_g.empresa_id;
  -- Sin cifras ni motivo: el motivo vive en `dominio.gastos` (visible con la sección rentabilidad).
  perform private.insertar_cambio_actividad(
    v_org, v_uid, 'gasto.anulado',
    format('Anuló un gasto de %s en %s', v_g.categoria, v_emp_nombre),
    jsonb_build_object('categoria', v_g.categoria, 'empresa', v_emp_nombre, 'vigente', true),
    jsonb_build_object('categoria', v_g.categoria, 'empresa', v_emp_nombre, 'vigente', false),
    v_g.empresa_id
  );
end;
$$;

comment on function public.anular_gasto(uuid, text, timestamptz) is
  'F-GAS-01: anula un gasto con motivo obligatorio; idempotente; sin borrado físico. 42501, PT404, 22023, PT412.';

-- cambiar_estado_rma: definición vigente en 20270113110000_cambiar_estado_rma.sql (1 P0002 a PT404, 1 40001 a PT412)
create or replace function public.cambiar_estado_rma(
  p_id uuid,
  p_estado text,
  p_actualizado_en timestamptz
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rma dominio.rma;
  v_desde text;
  v_etiquetas constant jsonb := '{"abierto": "Abierta", "en_gestion": "En gestión", "cerrado": "Cerrada"}';
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cambiar el estado de una devolución' using errcode = '42501';
  end if;
  if p_estado is null or p_estado not in ('abierto', 'en_gestion', 'cerrado') then
    raise exception 'El estado % no existe', coalesce(p_estado, '(vacío)') using errcode = '22023', hint = 'estado';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rma.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el estado de devoluciones en esta tienda' using errcode = '42501';
  end if;

  if v_rma.estado = p_estado then
    return v_rma;
  end if;
  if p_actualizado_en is null or v_rma.actualizado_en <> p_actualizado_en then
    raise exception 'La devolución fue modificada por otra persona' using errcode = 'PT412';
  end if;
  if not ((v_rma.estado = 'abierto' and p_estado = 'en_gestion') or (v_rma.estado = 'en_gestion' and p_estado = 'cerrado')) then
    raise exception 'No se puede pasar una devolución de % a %', v_etiquetas ->> v_rma.estado, v_etiquetas ->> p_estado
      using errcode = '22023', hint = 'estado';
  end if;

  v_desde := v_rma.estado;
  update dominio.rma
     set estado = p_estado, actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.estado_cambiado',
    format('Pasó la devolución %s de %s a %s', v_rma.numero, v_etiquetas ->> v_desde, v_etiquetas ->> p_estado),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

-- registrar_rma: definición vigente en 20270113100100_registrar_rma.sql (1 P0002 a PT404, 2 55000 a PT409)
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
    raise exception 'El comprobante no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_c.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede registrar devoluciones en esta tienda' using errcode = '42501';
  end if;
  if v_c.tipo <> 'factura' then
    raise exception 'La devolución se registra sobre una factura' using errcode = '22023', hint = 'comprobante';
  end if;
  if v_c.estado = 'borrador' then
    raise exception 'La factura está en borrador: confirmala antes de registrar una devolución' using errcode = 'PT409';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite devoluciones' using errcode = 'PT409';
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

-- reingresar_stock_rma: definición vigente en 20270113120200_reingresar_stock_rma.sql (1 P0002 a PT404, 1 55000 a PT409)
create or replace function public.reingresar_stock_rma(
  p_rma_id uuid,
  p_deposito_id uuid default null
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rma dominio.rma;
  v_motivo uuid;
  v_item record;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para resolver devoluciones' using errcode = '42501';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_rma_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'PT404';
  end if;
  if (select private.nivel_ventas_en_empresa(v_rma.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede reingresar stock de devoluciones en esta tienda' using errcode = '42501';
  end if;

  if v_rma.stock_reingresado_en is not null then
    return v_rma;
  end if;
  if v_rma.nota_credito_id is not null then
    raise exception 'La devolución ya se resolvió con una nota de crédito' using errcode = 'PT409';
  end if;

  v_motivo := private.motivo_sistema_movimiento(v_org, 'Devolución', 'entrada');

  for v_item in
    select i.producto_id, i.cantidad, l.deposito_id
      from dominio.rma_items i
      join dominio.comprobantes_venta_lineas l on l.id = i.comprobante_linea_id and l.organizacion_id = i.organizacion_id
     where i.rma_id = v_rma.id and i.organizacion_id = v_org
     order by i.producto_id, l.deposito_id, l.orden
  loop
    perform public.registrar_movimiento_stock(
      v_item.producto_id, 'entrada', v_item.cantidad, v_motivo, v_rma.numero, current_date,
      coalesce(p_deposito_id, v_item.deposito_id)
    );
  end loop;

  update dominio.rma
     set stock_reingresado_en = clock_timestamp(), estado = 'cerrado', actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.stock_reingresado',
    format('Reingresó al stock los ítems de la devolución %s', v_rma.numero),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

-- vincular_nota_credito_rma: definición vigente en 20270113120100_vincular_nota_credito_rma.sql (1 P0002 a PT404, 1 55000 a PT409)
create or replace function public.vincular_nota_credito_rma(
  p_rma_id uuid,
  p_tipo text,
  p_lineas jsonb default null,
  p_concepto text default null
)
returns dominio.rma
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_rma dominio.rma;
  v_nota dominio.comprobantes_venta;
  v_lineas jsonb := p_lineas;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para resolver devoluciones' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('devolucion_importe', 'devolucion_productos') then
    raise exception 'Elegí si la nota devuelve importe o productos' using errcode = '22023', hint = 'tipo';
  end if;

  select * into v_rma
    from dominio.rma r
   where r.id = p_rma_id and r.organizacion_id = v_org
   for update;
  if not found then
    raise exception 'La devolución no existe' using errcode = 'PT404';
  end if;
  if not (select private.puede_accion_comprobante(v_rma.empresa_id, 'emitir_nota_credito')) then
    raise exception 'Tu rol no puede emitir notas de crédito en esta tienda' using errcode = '42501';
  end if;

  if v_rma.nota_credito_id is not null then
    return v_rma;
  end if;
  if v_rma.stock_reingresado_en is not null then
    raise exception 'La devolución ya se resolvió con reingreso de stock' using errcode = 'PT409';
  end if;

  if p_tipo = 'devolucion_productos' and (v_lineas is null or jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0) then
    select jsonb_agg(jsonb_build_object('linea_id', i.comprobante_linea_id, 'cantidad', i.cantidad) order by i.comprobante_linea_id)
      into v_lineas
      from dominio.rma_items i
     where i.rma_id = v_rma.id and i.organizacion_id = v_org;
  end if;

  v_nota := public.emitir_nota_credito(v_rma.comprobante_id, p_tipo, v_lineas, p_concepto);

  update dominio.rma
     set nota_credito_id = v_nota.id, estado = 'cerrado', actualizado_en = clock_timestamp()
   where id = v_rma.id
  returning * into v_rma;

  perform private.registrar_actividad(
    'rma.nota_credito_vinculada',
    format('Vinculó la nota de crédito %s a la devolución %s', v_nota.numero, v_rma.numero),
    v_rma.empresa_id
  );
  return v_rma;
end;
$$;

-- rendir_envios_moto: definición vigente en 20270228110100_rendir_envios_moto_registra_cobro.sql (4 55000 a PT409)
create or replace function public.rendir_envios_moto(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_ids uuid[];
  v_encontrados integer;
  v_pendientes integer;
  v_no_enviados integer;
  v_mensajeros integer;
  v_mensajero text;
  v_total_abono numeric(14, 2);
  v_total_costo numeric(14, 2);
  v_total_cobrado numeric(14, 2) := 0;
  v_sin_cobro integer := 0;
  v_empresas uuid[] := array[]::uuid[];
  v_empresa uuid;
  v_numeros text[] := array[]::text[];
  v_comprobantes text;
  v_detalle text;
  v_anulada text;
  v_borradores text;
  v_e dominio.envios_moto;
  v_c dominio.comprobantes_venta;
  v_saldo record;
  v_importe numeric(14, 2);
  v_forma_pago_id uuid;
  v_cobro_id uuid;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para rendir envíos en moto' using errcode = '42501';
  end if;

  -- ── Validaciones del pedido (FR-021) ──────────────────────────────────────
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Elegí al menos un envío para rendir' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_ids) as x(id) where x.id is null) then
    raise exception 'Alguno de los envíos no es válido' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'No se pueden rendir más de 500 envíos a la vez' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x.id), array[]::uuid[]) into v_ids from unnest(p_ids) as x(id);

  -- ── El permiso ANTES de cualquier bloqueo y sin revelar la existencia (revisión de seguridad del 2026-11-12) ──
  -- Se resuelven los envíos SIN lock, con el permiso de la EMPRESA de cada uno (FR-020): solo el Administrador. Un id que no
  -- existe, es de otra organización o de una tienda donde no se puede rendir da el MISMO `42501`: no se sabe si existe, y quien
  -- no puede rendir no toma ningún lock.
  if (select private.nivel_seccion('ventas')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede rendir envíos en moto en esta tienda' using errcode = '42501';
  end if;

  select count(*) into v_encontrados
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and (select private.puede_rendir_envio_moto_en_empresa(c.empresa_id));
  if v_encontrados <> cardinality(v_ids) then
    raise exception 'Tu rol no puede rendir envíos en moto en esta tienda' using errcode = '42501';
  end if;

  -- ── Los envíos, con bloqueo de fila (en orden fijo, sin interbloqueos): serializa dos rendiciones ──
  -- Un reintento concurrente espera acá y después ve los envíos ya rendidos: no hay doble evento ni doble cobro.
  perform 1
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
   order by e.id
     for update;

  -- ── Lo pendiente: los ya rendidos se ignoran (idempotencia, FR-020) ───────
  select count(*),
         count(*) filter (where not e.enviado),
         count(distinct lower(e.mensajero)),
         min(e.mensajero),
         coalesce(sum(e.abono), 0),
         coalesce(sum(e.costo_envio), 0)
    into v_pendientes, v_no_enviados, v_mensajeros, v_mensajero, v_total_abono, v_total_costo
    from dominio.envios_moto e
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido;

  if v_pendientes = 0 then
    return jsonb_build_object(
      'cantidad', 0, 'mensajero', null, 'total_abono', 0, 'total_costo', 0, 'neto', 0,
      'total_cobrado', 0, 'sin_cobro', 0);
  end if;

  -- ── Factura anulada después de cargar el envío: no se rinde (decisión de Nicolás, 2026-11-12) ──
  select string_agg(c.numero, ', ' order by c.numero) into v_anulada
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido
     and c.estado = 'anulada';
  if v_anulada is not null then
    raise exception 'La factura % fue anulada: su envío en moto no se puede rendir, no se rindió ninguno', v_anulada
      using errcode = 'PT409';
  end if;

  -- ── Facturas en borrador con abono: se listan todas, como las anuladas ────
  select string_agg(c.numero, ', ' order by c.numero) into v_borradores
    from dominio.envios_moto e
    join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
   where e.id = any (v_ids)
     and e.organizacion_id = v_org
     and not e.rendido
     and e.abono > 0
     and c.estado = 'borrador';
  if v_borradores is not null then
    raise exception 'La factura % está en borrador: confirmala antes de rendir su envío en moto, no se rindió ninguno', v_borradores
      using errcode = 'PT409';
  end if;

  -- ── El cobro lo escribe `registrar_cobro_interno`, que exige que el actor sea miembro con acceso a la tienda ──
  -- (un superadmin con organización activa pero sin membresía pasa el permiso de rendir y no puede cobrar): se avisa antes
  -- de empezar, con un mensaje claro.
  if exists (
    select 1
      from dominio.envios_moto e
      join dominio.comprobantes_venta c on c.id = e.comprobante_id and c.organizacion_id = e.organizacion_id
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not e.rendido
       and e.abono > 0
       and c.estado <> 'cobrado'
       and not exists (
         select 1 from public.usuarios_organizacion u
          where u.user_id = v_actor
            and u.organizacion_id = v_org
            and u.estado = 'activo'
            and (u.rol_id = 'administrador' or exists (
              select 1 from public.usuarios_empresas ue
               where ue.user_id = u.user_id and ue.empresa_id = c.empresa_id)))
  ) then
    raise exception 'Para rendir y registrar el cobro tenés que ser miembro de la organización con acceso a la tienda de la factura: un superadmin sin membresía no puede rendir'
      using errcode = '42501';
  end if;

  -- ── Solo se rinde lo enviado (FR-020) ─────────────────────────────────────
  if v_no_enviados > 0 then
    raise exception 'Solo se rinden los envíos ya enviados: hay % sin marcar como enviado, no se rindió ninguno', v_no_enviados
      using errcode = '22023';
  end if;

  -- ── Un solo mensajero por rendición, sin distinguir mayúsculas (FR-021) ───
  if v_mensajeros > 1 then
    raise exception 'La selección mezcla mensajeros: rendí un mensajero por vez, no se rindió ninguno'
      using errcode = '22023';
  end if;

  -- ── La rendición y el cobro de cada envío, en orden de id ─────────────────
  for v_e in
    select e.*
      from dominio.envios_moto e
     where e.id = any (v_ids)
       and e.organizacion_id = v_org
       and not e.rendido
     order by e.id
  loop
    -- La factura, con bloqueo de fila (el orden de bloqueo es envío → factura, como en los contrarreembolsos).
    select * into v_c
      from dominio.comprobantes_venta c
     where c.id = v_e.comprobante_id
       and c.organizacion_id = v_org
       for update;

    -- Una anulación que llegó entre la lectura de arriba y este bloqueo también frena la rendición.
    if v_c.estado = 'anulada' then
      raise exception 'La factura % fue anulada: su envío en moto no se puede rendir, no se rindió ninguno', v_c.numero
        using errcode = 'PT409';
    end if;

    v_cobro_id := null;
    v_importe := 0;

    -- Una factura que ya está en Cobrado (p. ej. pagada en mostrador, antes del libro de cobros) no recibe cobro: el envío se
    -- rinde y el estado queda intacto (con una forma que genera deuda, un cobro la haría retroceder a Deuda).
    if v_e.abono > 0 and v_c.estado <> 'cobrado' then
      select * into v_saldo from private.saldo_comprobante(v_c.id);
      -- El tope del cobro es el saldo neto (total − cobros − notas de crédito): nunca se cobra de más.
      v_importe := least(v_e.abono, v_saldo.saldo);
    end if;

    if v_importe > 0 then
      if v_c.estado = 'borrador' then
        raise exception 'La factura % está en borrador: confirmala antes de rendir su envío en moto, no se rindió ninguno', v_c.numero
          using errcode = 'PT409';
      end if;

      -- La forma de pago: la de la factura si la tiene; si no, la forma «Contrarreembolso» de la tienda.
      v_forma_pago_id := v_c.forma_pago_id;
      if v_forma_pago_id is null then
        select f.id into v_forma_pago_id
          from dominio.formas_pago f
         where f.organizacion_id = v_org
           and f.empresa_id = v_c.empresa_id
           and f.tipo = 'contrarreembolso'
           and f.activo
         order by f.orden, f.nombre
         limit 1;
      end if;
      if v_forma_pago_id is null then
        raise exception 'La factura % no tiene forma de pago y la tienda no tiene una forma «Contrarreembolso»: no se puede registrar el cobro, no se rindió ninguno', v_c.numero
          using errcode = '22023';
      end if;

      -- El único camino al libro de cobros: valida el tope, pasa la factura a Cobrado o Deuda y deja su evento.
      v_cobro_id := private.registrar_cobro_interno(
        v_c.id, v_importe, v_forma_pago_id, null, 'contrarreembolso', v_actor);
      v_total_cobrado := v_total_cobrado + v_importe;
    else
      v_sin_cobro := v_sin_cobro + 1;
    end if;

    -- Escribe solo `rendido`, `rendido_en` y `cobro_id` (no toca `updated_at`: la rendición no cambia los datos del envío).
    update dominio.envios_moto e
       set rendido = true,
           rendido_en = now(),
           cobro_id = v_cobro_id
     where e.id = v_e.id;

    v_numeros := v_numeros || v_c.numero;
    v_empresas := v_empresas || v_c.empresa_id;
  end loop;

  -- ── El evento (FR-024): uno por rendición, en la misma transacción ────────
  -- La empresa del evento es la de los envíos si todos son de una sola; si no, queda sin empresa.
  select array_agg(distinct x) into v_empresas from unnest(v_empresas) as x;
  v_empresa := case when cardinality(v_empresas) = 1 then v_empresas[1] else null end;

  select string_agg(n, ', ' order by n) into v_comprobantes from unnest(v_numeros) as n;

  v_detalle := format('Rindió %s envío(s) en moto del mensajero %s: total a rendir %s, costo %s, neto %s, cobrado en el libro %s. Facturas: ',
    v_pendientes, v_mensajero, v_total_abono, v_total_costo, v_total_abono - v_total_costo, v_total_cobrado);
  if length(v_detalle) + length(v_comprobantes) > 500 then
    v_detalle := v_detalle || left(v_comprobantes, greatest(500 - length(v_detalle) - 1, 0)) || '…';
  else
    v_detalle := v_detalle || v_comprobantes;
  end if;

  perform private.registrar_actividad('envio_moto.rendido', v_detalle, v_empresa);

  return jsonb_build_object(
    'cantidad', v_pendientes,
    'mensajero', v_mensajero,
    'total_abono', v_total_abono,
    'total_costo', v_total_costo,
    'neto', v_total_abono - v_total_costo,
    'total_cobrado', v_total_cobrado,
    'sin_cobro', v_sin_cobro);
end;
$$;

comment on function public.rendir_envios_moto(uuid[]) is
  'Rinde envíos en moto, de a uno o en lote (F-VTA-25): todo o nada, idempotente (los ya rendidos se ignoran), solo enviados y no rendidos de un mismo mensajero y de facturas no anuladas (PT409). Registra en el libro de cobros de cada factura, por private.registrar_cobro_interno con origen contrarreembolso, un cobro por el menor entre el abono y el saldo neto. Exige el rol administrador en la empresa de cada envío. Escribe solo rendido, rendido_en y cobro_id. Devuelve {cantidad, mensajero, total_abono, total_costo, neto, total_cobrado, sin_cobro}. Deja un evento envio_moto.rendido. No revierte.';

-- emitir_nota_credito: definición vigente en 20270201200129_lineas_sin_stock.sql (2 55000 a PT409)
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
    raise exception 'La factura está en borrador: confirmala antes de emitir una nota de crédito' using errcode = 'PT409';
  end if;
  if v_c.estado = 'anulada' then
    raise exception 'La factura está anulada: no admite notas de crédito' using errcode = 'PT409';
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

-- facturar_presupuesto: definición vigente en 20270507220100_facturar_presupuesto.sql (3 55000 a PT409)
create or replace function public.facturar_presupuesto(p_presupuesto_id uuid)
returns dominio.comprobantes_venta
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_hoy date := (select private.hoy_argentina());
  v_p dominio.comprobantes_venta;
  v_f dominio.comprobantes_venta;
  v_empresa_nombre text;
  v_defecto uuid;
  v_forma_pago uuid;
  v_envio uuid;
  v_numero integer;
  v_lineas integer;
  v_inactivo text;
  v_sin_iva numeric;
  v_iva numeric;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para facturar presupuestos' using errcode = '42501';
  end if;
  if p_presupuesto_id is null then
    raise exception 'Elegí el presupuesto a facturar' using errcode = '22023', hint = 'presupuesto_id';
  end if;

  -- Serializa las conversiones del mismo presupuesto: la segunda espera y ve `convertido`.
  select * into v_p
    from dominio.comprobantes_venta c
   where c.id = p_presupuesto_id and c.organizacion_id = v_org and c.tipo = 'presupuesto'
   for update;
  if not found or v_p.empresa_id is null then
    raise exception 'El presupuesto no existe' using errcode = 'P0002';
  end if;
  if (select private.nivel_ventas_en_empresa(v_p.empresa_id)) <> 'edicion' then
    raise exception 'Tu rol no puede facturar presupuestos de esta tienda' using errcode = '42501';
  end if;

  -- Idempotente: un presupuesto ya convertido devuelve su factura, sin crear otra ni auditar de nuevo.
  if v_p.estado = 'convertido' then
    select * into v_f
      from dominio.comprobantes_venta f
     where f.origen_presupuesto_id = v_p.id and f.organizacion_id = v_org;
    if not found then
      raise exception 'El presupuesto figura como facturado pero no encontramos su factura' using errcode = '55000';
    end if;
    return v_f;
  end if;
  if v_p.estado = 'pendiente' then
    raise exception 'Aceptá el presupuesto antes de facturarlo' using errcode = 'PT409';
  end if;
  if v_p.estado <> 'aceptado' then
    raise exception 'Este presupuesto ya no se puede facturar' using errcode = 'PT409';
  end if;
  if v_p.valido_hasta is not null and v_p.valido_hasta < v_hoy then
    raise exception 'El presupuesto está vencido y no se puede facturar' using errcode = 'PT409';
  end if;

  select e.nombre into v_empresa_nombre
    from dominio.empresas e
   where e.id = v_p.empresa_id and e.organizacion_id = v_org and e.activa;
  if not found then
    raise exception 'La tienda del presupuesto está desactivada' using errcode = '22023', hint = 'empresa_id';
  end if;
  if not exists (
    select 1 from dominio.clientes c
     where c.id = v_p.cliente_id and c.organizacion_id = v_org and c.archivado_en is null
  ) then
    raise exception 'El cliente del presupuesto ya no está disponible' using errcode = '22023', hint = 'cliente_id';
  end if;

  select count(*) into v_lineas
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org;
  if v_lineas = 0 then
    raise exception 'El presupuesto no tiene líneas para facturar' using errcode = '22023', hint = 'lineas';
  end if;

  select l.descripcion into v_inactivo
    from dominio.comprobantes_venta_lineas l
    join dominio.productos p on p.id = l.producto_id and p.organizacion_id = v_org
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org and not p.activo
   order by l.orden
   limit 1;
  if v_inactivo is not null then
    raise exception 'El producto «%» ya no está activo: reactivalo para facturar el presupuesto', v_inactivo
      using errcode = '22023', hint = 'producto_id';
  end if;

  select d.id into v_defecto
    from dominio.depositos d
    join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_p.empresa_id
   where d.organizacion_id = v_org and d.por_defecto and d.activo;

  -- Forma de pago y de envío: se copian solo si siguen vigentes en la tienda (si no, la factura queda sin elegir).
  v_forma_pago := v_p.forma_pago_id;
  v_envio := v_p.envio_id;
  begin
    perform private.validar_catalogo_comprobante(v_org, v_p.empresa_id, v_forma_pago, null);
  exception when sqlstate '22023' then
    v_forma_pago := null;
  end;
  begin
    perform private.validar_catalogo_comprobante(v_org, v_p.empresa_id, null, v_envio);
  exception when sqlstate '22023' then
    v_envio := null;
  end;

  v_numero := private.siguiente_numero_comprobante(v_p.empresa_id, 'factura');
  insert into dominio.comprobantes_venta (
    organizacion_id, empresa_id, cliente_id, tipo, numero, numero_entero, fecha, estado,
    total_sin_iva, total_con_iva, canal, operador_id, forma_pago_id, envio_id, contacto_id, origen_presupuesto_id
  )
  values (
    v_org, v_p.empresa_id, v_p.cliente_id, 'factura', lpad(v_numero::text, 8, '0'), v_numero, v_hoy, 'borrador',
    0, 0, v_p.canal, v_actor, v_forma_pago, v_envio, v_p.contacto_id, v_p.id
  )
  returning * into v_f;

  -- Líneas congeladas: todo se copia tal cual; solo el depósito se reemplaza si la tienda ya no lo usa. El costo y la cotización
  -- los fija la confirmación, como en cualquier factura.
  insert into dominio.comprobantes_venta_lineas (
    organizacion_id, comprobante_id, orden, producto_id, descripcion, codigo, cantidad, precio_unitario, escala,
    precio_manual, alicuota_id, alicuota_porcentaje, deposito_id, a_pedido, subtotal_sin_iva, iva,
    descuento_pct, sin_stock, precio_referencia, promocion_id, lista_precio_id, lista_ajuste_pct
  )
  select l.organizacion_id, v_f.id, l.orden, l.producto_id, l.descripcion, l.codigo, l.cantidad, l.precio_unitario, l.escala,
         l.precio_manual, l.alicuota_id, l.alicuota_porcentaje,
         case when exists (
           select 1 from dominio.depositos d
             join dominio.depositos_empresas de on de.deposito_id = d.id and de.empresa_id = v_p.empresa_id
            where d.id = l.deposito_id and d.organizacion_id = v_org and d.activo
         ) then l.deposito_id else v_defecto end,
         l.a_pedido, l.subtotal_sin_iva, l.iva,
         l.descuento_pct, l.sin_stock, l.precio_referencia, l.promocion_id, l.lista_precio_id, l.lista_ajuste_pct
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_p.id and l.organizacion_id = v_org
   order by l.orden;

  select coalesce(sum(l.subtotal_sin_iva), 0), coalesce(sum(l.iva), 0) into v_sin_iva, v_iva
    from dominio.comprobantes_venta_lineas l
   where l.comprobante_id = v_f.id and l.organizacion_id = v_org;

  update dominio.comprobantes_venta
     set total_sin_iva = v_sin_iva,
         total_con_iva = v_sin_iva + v_iva,
         updated_at = clock_timestamp()
   where id = v_f.id
  returning * into v_f;

  update dominio.comprobantes_venta
     set estado = 'convertido',
         updated_at = clock_timestamp()
   where id = v_p.id;

  perform private.registrar_actividad(
    'presupuesto.facturado',
    format('Facturó el presupuesto %s como la factura %s en %s', v_p.numero, v_f.numero, v_empresa_nombre),
    v_f.empresa_id
  );
  return v_f;
end;
$$;

-- actualizar_contacto: definición vigente en 20270201100200_contactos_crear_actualizar.sql (1 40001 a PT412)
create or replace function public.actualizar_contacto(
  p_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.contactos%rowtype;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_correo text := nullif(btrim(coalesce(p_correo, '')), '');
  v_tel text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_nuevo timestamptz;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar contactos' using errcode = '42501';
  end if;

  select * into v_c from dominio.contactos c
  where c.id = p_id and c.organizacion_id = v_org
  for update;

  if not found or not exists (select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id) then
    raise exception 'No tenés permiso para editar contactos' using errcode = '42501';
  end if;
  if v_c.anonimizado_en is not null then
    raise exception 'El contacto está anonimizado y no se puede editar' using errcode = '22023', detail = 'anonimizado';
  end if;

  perform private.validar_contacto(v_c.empresa_id, p_id, v_nombre, v_correo, v_tel);

  -- Idempotente: sin cambios no hay conflicto posible ni escritura.
  if (v_c.nombre, v_c.correo, v_c.telefono) is not distinct from (v_nombre, v_correo, v_tel) then
    return v_c.updated_at;
  end if;

  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'El contacto fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.contactos set nombre = v_nombre, correo = v_correo, telefono = v_tel
  where id = p_id
  returning updated_at into v_nuevo;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.actualizado',
    format('Editó un contacto de «%s»', v_empresa), v_c.empresa_id);

  return v_nuevo;
end;
$$;

comment on function public.actualizar_contacto(uuid, text, text, text, timestamptz) is
  'MSF-260: edita nombre, correo y teléfono de un contacto activo (consultas = edición) con la regla de duplicados. PT412 si updated_at no coincide; 23505 duplicado; 22023 inválido o anonimizado; 42501 sin permiso.';

-- anonimizar_contacto: definición vigente en 20270201100500_anonimizar_contacto.sql (1 40001 a PT412)
create or replace function public.anonimizar_contacto(p_id uuid, p_updated_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.contactos%rowtype;
  v_empresa text;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para anonimizar contactos' using errcode = '42501';
  end if;

  select * into v_c from dominio.contactos c
  where c.id = p_id and c.organizacion_id = v_org
  for update;
  if not found or not exists (select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id) then
    raise exception 'No tenés permiso para anonimizar contactos' using errcode = '42501';
  end if;
  if v_c.anonimizado_en is not null then
    raise exception 'El contacto ya está anonimizado' using errcode = '22023', detail = 'anonimizado';
  end if;
  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'El contacto fue modificado por otra persona' using errcode = 'PT412';
  end if;

  update dominio.consultas
     set nombre = 'Anonimizado',
         contacto = 'Anonimizado',
         nota_interna = null,
         mensaje = case when origen = 'whatsapp' and mensaje is null then null
                        else 'Mensaje eliminado por anonimización' end
   where contacto_id = p_id and organizacion_id = v_org;

  update dominio.contactos
     set nombre = 'Anonimizado', correo = null, telefono = null, anonimizado_en = now()
   where id = p_id;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;
  perform private.insertar_actividad(
    v_org, v_actor, 'contacto.anonimizado',
    format('Anonimizó un contacto de «%s»', v_empresa), v_c.empresa_id);
end;
$$;

comment on function public.anonimizar_contacto(uuid, timestamptz) is
  'MSF-260: anonimiza (irreversible) un contacto activo y los datos personales de sus consultas vinculadas; no borra filas ni toca ventas. PT412 conflicto; 22023 ya anonimizado; 42501 sin permiso.';

-- actualizar_consulta: definición vigente en 20261205100500_consultas_devolucion_revisor.sql (1 40001 a PT412)
create or replace function public.actualizar_consulta(
  p_id uuid,
  p_estado text,
  p_responsable_id uuid,
  p_nota_interna text,
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_c dominio.consultas%rowtype;
  v_nota text := nullif(btrim(coalesce(p_nota_interna, '')), '');
  v_empresa text;
  v_responsable text;
  v_nuevo timestamptz;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('consultas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  if p_estado is null or p_estado not in ('nueva', 'en_curso', 'resuelta') then
    raise exception 'Estado inválido' using errcode = '22023', detail = 'estado';
  end if;
  if length(coalesce(v_nota, '')) > 2000 then
    raise exception 'La nota interna es demasiado larga' using errcode = '22023', detail = 'nota_interna';
  end if;

  select * into v_c from dominio.consultas c
  where c.id = p_id and c.organizacion_id = v_org
  for update;

  -- Inexistente, de otra organización o de una empresa sin acceso: misma respuesta.
  if not found or not exists (
    select 1 from private.empresas_accesibles() ea where ea = v_c.empresa_id
  ) then
    raise exception 'No tenés permiso para editar consultas' using errcode = '42501';
  end if;

  -- Solo se valida si el responsable cambia: quien ya estaba asignado puede haber perdido
  -- elegibilidad y aun así se puede editar estado o nota sin reasignar.
  if p_responsable_id is not null
     and p_responsable_id is distinct from v_c.responsable_id
     and not exists (
    select 1 from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id
  ) then
    raise exception 'El responsable no es válido para esta empresa' using errcode = '22023', detail = 'responsable_id';
  end if;

  -- Idempotente: sin cambios no hay conflicto posible ni escritura.
  if (v_c.estado, v_c.responsable_id, v_c.nota_interna)
     is not distinct from (p_estado, p_responsable_id, v_nota) then
    return v_c.updated_at;
  end if;

  if p_updated_at is distinct from v_c.updated_at then
    raise exception 'La consulta fue modificada por otra persona' using errcode = 'PT412';
  end if;

  update dominio.consultas
     set estado = p_estado, responsable_id = p_responsable_id, nota_interna = v_nota
   where id = p_id
  returning updated_at into v_nuevo;

  select e.nombre into v_empresa from dominio.empresas e where e.id = v_c.empresa_id;

  if v_c.estado is distinct from p_estado then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.estado_cambiado',
      format('Cambió el estado de una consulta de «%s» a «%s»', v_empresa,
        case p_estado when 'nueva' then 'Nueva' when 'en_curso' then 'En curso' else 'Resuelta' end),
      v_c.empresa_id);
  end if;
  if v_c.responsable_id is distinct from p_responsable_id then
    select r.nombre into v_responsable
      from private.responsables_posibles(v_org, v_c.empresa_id) r where r.user_id = p_responsable_id;
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.asignada',
      case when p_responsable_id is null
        then format('Quitó el responsable de una consulta de «%s»', v_empresa)
        else format('Asignó una consulta de «%s» a %s', v_empresa, v_responsable) end,
      v_c.empresa_id);
  end if;
  if v_c.nota_interna is distinct from v_nota then
    perform private.insertar_actividad(
      v_org, v_actor, 'consulta.nota_actualizada',
      format('Actualizó la nota interna de una consulta de «%s»', v_empresa),
      v_c.empresa_id);
  end if;

  return v_nuevo;
end;
$$;

comment on function public.actualizar_consulta(uuid, text, uuid, text, timestamptz) is
  'MSF-186: cambia estado, responsable y nota interna de una consulta (sección consultas = edición). PT412 si el sello updated_at no coincide; 42501 sin permiso o sin acceso; 22023 datos inválidos. Registra consulta.estado_cambiado / consulta.asignada / consulta.nota_actualizada solo si el valor cambió.';

-- guardar_correo_avisos_consultas: definición vigente en 20261205200000_consultas_configuracion.sql (2 40001 a PT412)
create or replace function public.guardar_correo_avisos_consultas(
  p_empresa_id uuid,
  p_correo text,
  p_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_correo text := nullif(btrim(coalesce(p_correo, '')), '');
  v_actual dominio.consultas_configuracion%rowtype;
  v_empresa text;
  v_nuevo timestamptz;
begin
  if v_actor is null or v_org is null
     or (select private.nivel_seccion('empresas')) <> 'edicion' then
    raise exception 'No tenés permiso para editar la dirección de avisos' using errcode = '42501';
  end if;

  select e.nombre into v_empresa
    from dominio.empresas e
   where e.id = p_empresa_id and e.organizacion_id = v_org
     and exists (select 1 from private.empresas_accesibles() ea where ea = e.id);
  -- Inexistente, de otra organización o sin acceso: misma respuesta.
  if not found then
    raise exception 'No tenés permiso para editar la dirección de avisos' using errcode = '42501';
  end if;

  if v_correo is not null
     and (length(v_correo) > 254 or v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'El correo de avisos no tiene un formato válido' using errcode = '22023', detail = 'correo_avisos';
  end if;

  select * into v_actual from dominio.consultas_configuracion c
   where c.empresa_id = p_empresa_id for update;

  if not found then
    -- Sin fila todavía, «volver al contacto» ya es el estado vigente: nada que escribir.
    if v_correo is null then
      return null;
    end if;
    insert into dominio.consultas_configuracion (empresa_id, organizacion_id, correo_avisos)
    values (p_empresa_id, v_org, v_correo)
    on conflict (empresa_id) do nothing
    returning updated_at into v_nuevo;
    if v_nuevo is null then
      -- Otra sesión la creó entre el select y el insert: es un conflicto de edición.
      raise exception 'La dirección de avisos fue modificada por otra persona' using errcode = 'PT412';
    end if;
  else
    -- Idempotente: sin cambios no hay conflicto posible ni escritura.
    if v_actual.correo_avisos is not distinct from v_correo then
      return v_actual.updated_at;
    end if;
    if p_updated_at is distinct from v_actual.updated_at then
      raise exception 'La dirección de avisos fue modificada por otra persona' using errcode = 'PT412';
    end if;
    update dominio.consultas_configuracion
       set correo_avisos = v_correo,
           updated_at = greatest(clock_timestamp(), v_actual.updated_at + interval '1 microsecond')
     where empresa_id = p_empresa_id
    returning updated_at into v_nuevo;
  end if;

  perform private.insertar_actividad(
    v_org, v_actor, 'consulta.avisos_actualizados',
    case when v_correo is null
      then format('Volvió la dirección de avisos de consultas de «%s» al correo de contacto', v_empresa)
      else format('Cambió la dirección de avisos de consultas de «%s»', v_empresa) end,
    p_empresa_id);

  return v_nuevo;
end;
$$;

comment on function public.guardar_correo_avisos_consultas(uuid, text, timestamptz) is
  'MSF-207: fija la dirección de avisos de consultas de una empresa (null = correo de contacto). Exige empresas = edición; PT412 si el sello updated_at no coincide; 42501 sin permiso; 22023 formato inválido. La actividad registra el hecho del cambio, no la dirección.';

-- cambiar_estado_estado_consulta: definición vigente en 20261210130200_estados_consulta_activar.sql (1 P0002 a PT404)
create or replace function public.cambiar_estado_estado_consulta(p_id uuid, p_activo boolean)
returns table (id uuid, activo boolean)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede editar las listas' using errcode = '42501';
  end if;

  return query
    update dominio.estados_consulta as e
       set activo = coalesce(p_activo, e.activo)
     where e.id = p_id
       and e.organizacion_id = (select private.organizacion_id())
    returning e.id, e.activo;

  if not found then
    raise exception 'El estado no existe' using errcode = 'PT404';
  end if;
end;
$$;

-- renombrar_estado_consulta: definición vigente en 20261210130100_estados_consulta_rpc.sql (1 P0002 a PT404)
create or replace function public.renombrar_estado_consulta(p_id uuid, p_nombre text)
returns table (id uuid, nombre text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.puede_escribir()) then
    raise exception 'Solo el Administrador puede editar las listas' using errcode = '42501';
  end if;
  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'El nombre del estado no puede estar vacío' using errcode = '23514';
  end if;

  return query
    update dominio.estados_consulta as e
       set nombre = p_nombre
     where e.id = p_id
       and e.organizacion_id = (select private.organizacion_id())
    returning e.id, e.nombre;

  if not found then
    raise exception 'El estado no existe' using errcode = 'PT404';
  end if;
end;
$$;
