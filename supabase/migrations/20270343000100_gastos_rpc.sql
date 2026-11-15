-- F-GAS-01 (MSF-469): RPC de gastos. Esquema: `public` (superficie de ejecución; no almacena datos).
-- Son la ÚNICA vía de escritura de `dominio.gastos` (guardar_gasto, anular_gasto). `security definer` + `search_path = ''`:
-- la organización y el rol salen de la sesión, nunca de un parámetro. Escribir exige `edicion` en `rentabilidad` sobre la empresa.
-- Errores: 42501 permiso o empresa no accesible · P0002 no existe · 22023 validación, empresa inactiva o sin cotización · 40001 cambio concurrente.
-- Eventos de Actividad `gasto.creado|editado|anulado`: NO sensibles (son importes operativos, no cambios de acceso o permisos; el seed de
-- `registro_inalterable.test.sql` espera exactamente los seis tipos sensibles de la spec de auditoría). Igual guardan valor anterior y nuevo.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.anular_gasto(uuid, text, timestamptz);
--   drop function public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz);
--   delete from public.tipos_evento_actividad where tipo in ('gasto.creado', 'gasto.editado', 'gasto.anulado', 'gasto.exportado');  -- solo si no quedan eventos

insert into public.tipos_evento_actividad (tipo, sensible, descripcion) values
  ('gasto.creado', false, 'Gasto de la empresa cargado'),
  ('gasto.editado', false, 'Gasto de la empresa editado (valor anterior y nuevo)'),
  ('gasto.anulado', false, 'Gasto de la empresa anulado con motivo'),
  ('gasto.exportado', false, 'Exportación del listado de gastos')
on conflict (tipo) do nothing;

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
    raise exception 'La empresa no existe' using errcode = 'P0002';
  end if;
  if not v_activa then
    raise exception 'No se pueden cargar gastos a una empresa inactiva' using errcode = '22023';
  end if;
  if p_empresa not in (select private.empresas_accesibles()) then
    raise exception 'No podés cargar gastos para esa empresa' using errcode = '42501';
  end if;
  if p_fecha is null or p_fecha > v_hoy + 31 then
    raise exception 'La fecha es obligatoria y no puede superar los 31 días a futuro' using errcode = '22023';
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
      raise exception 'El gasto no existe' using errcode = 'P0002';
    end if;
    if v_actual.empresa_id not in (select private.empresas_accesibles()) then
      raise exception 'No podés editar gastos de esa empresa' using errcode = '42501';
    end if;
    if v_actual.anulado_en is not null then
      raise exception 'Un gasto anulado no se puede editar' using errcode = '22023';
    end if;
    if p_actualizado is null or p_actualizado <> v_actual.updated_at then
      raise exception 'El gasto cambió mientras lo editabas: recargá la lista' using errcode = '40001';
    end if;
  end if;

  -- Cotización congelada (D8): se conserva si nada que la determine cambió; si no, la del dólar aplicado más cercano a la fecha.
  if p_moneda = 'ARS' then
    v_cot := null;
    v_pesos := p_importe;
  else
    if p_id is not null and v_actual.moneda = 'USD' and v_actual.fecha = p_fecha and v_actual.empresa_id = p_empresa then
      v_cot := v_actual.cotizacion_usada;
    else
      v_cot := analitica.cotizacion_cercana(v_org, ((p_fecha::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires'), p_empresa);
    end if;
    if v_cot is null then
      raise exception 'Cargá la cotización del dólar' using errcode = '22023';
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
      format('Cargó un gasto de %s en %s: %s %s', p_categoria, v_nombre, p_moneda, p_importe),
      null,
      jsonb_build_object('importe', p_importe, 'moneda', p_moneda, 'categoria', p_categoria, 'tipo_costo', p_tipo_costo,
                         'fecha', p_fecha, 'empresa', v_nombre),
      p_empresa
    );
  else
    update dominio.gastos
       set empresa_id = p_empresa, fecha = p_fecha, categoria = p_categoria, tipo_costo = p_tipo_costo, detalle = v_detalle,
           importe = p_importe, moneda = p_moneda, cotizacion_usada = v_cot, importe_pesos = v_pesos,
           recurrente = coalesce(p_recurrente, false), updated_at = clock_timestamp()
     where id = p_id;
    v_id := p_id;
    perform private.insertar_cambio_actividad(
      v_org, v_uid, 'gasto.editado',
      format('Editó un gasto de %s en %s', p_categoria, v_nombre),
      jsonb_build_object('importe', v_actual.importe, 'moneda', v_actual.moneda, 'categoria', v_actual.categoria,
                         'tipo_costo', v_actual.tipo_costo, 'fecha', v_actual.fecha,
                         'empresa', (select e.nombre from dominio.empresas e where e.id = v_actual.empresa_id)),
      jsonb_build_object('importe', p_importe, 'moneda', p_moneda, 'categoria', p_categoria, 'tipo_costo', p_tipo_costo,
                         'fecha', p_fecha, 'empresa', v_nombre),
      p_empresa
    );
  end if;
  return v_id;
end;
$$;

comment on function public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz) is
  'F-GAS-01: alta (p_id null) o edición de un gasto (solo edición en rentabilidad). Congela cotización e importe en pesos. 42501, P0002, 22023, 40001.';

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
begin
  if v_org is null or (select private.nivel_seccion('rentabilidad')) <> 'edicion' then
    raise exception 'Tu rol no puede anular gastos' using errcode = '42501';
  end if;
  select * into v_g from dominio.gastos g where g.id = p_id and g.organizacion_id = v_org for update;
  if not found then
    raise exception 'El gasto no existe' using errcode = 'P0002';
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
    raise exception 'El gasto cambió mientras lo editabas: recargá la lista' using errcode = '40001';
  end if;
  update dominio.gastos
     set anulado_en = clock_timestamp(), anulado_por = v_uid, motivo_anulacion = v_motivo, updated_at = clock_timestamp()
   where id = p_id;
  perform private.insertar_cambio_actividad(
    v_org, v_uid, 'gasto.anulado',
    format('Anuló un gasto de %s por %s %s. Motivo: %s', v_g.categoria, v_g.moneda, v_g.importe, v_motivo),
    jsonb_build_object('importe', v_g.importe, 'moneda', v_g.moneda, 'categoria', v_g.categoria, 'vigente', true),
    jsonb_build_object('importe', v_g.importe, 'moneda', v_g.moneda, 'categoria', v_g.categoria, 'vigente', false, 'motivo', v_motivo),
    v_g.empresa_id
  );
end;
$$;

comment on function public.anular_gasto(uuid, text, timestamptz) is
  'F-GAS-01: anula un gasto con motivo obligatorio; idempotente; sin borrado físico. 42501, P0002, 22023, 40001.';

revoke execute on function public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz) from public, anon;
revoke execute on function public.anular_gasto(uuid, text, timestamptz) from public, anon;
grant execute on function public.guardar_gasto(uuid, uuid, date, text, text, text, numeric, text, boolean, timestamptz) to authenticated;
grant execute on function public.anular_gasto(uuid, text, timestamptz) to authenticated;
