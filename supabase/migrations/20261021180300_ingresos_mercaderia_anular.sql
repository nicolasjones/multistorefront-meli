-- F-PRV-06 (MSF-404, épica MSF-219): anular un ingreso de mercadería.
-- No edita ni borra: marca la cabecera como anulada y crea una salida por línea con
-- el motivo «Anulación de ingreso de mercadería». Si falta stock en cualquier línea,
-- toda la anulación se revierte. El bloqueo de la cabecera serializa dos anulaciones.
--
-- Migración aditiva. Reversión (en una migración posterior):
--   drop function public.anular_ingreso_mercaderia(uuid, text);

create or replace function public.anular_ingreso_mercaderia(
  p_ingreso uuid,
  p_motivo text
)
returns dominio.ingresos_mercaderia
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ingreso dominio.ingresos_mercaderia;
  v_motivo_movimiento uuid;
  v_linea record;
  v_movimiento uuid;
  v_unidades integer := 0;
  v_productos integer := 0;
  v_proveedor text;
  v_empresa text;
  v_detalle text;
begin
  if v_actor is null or v_organizacion is null
     or (select private.nivel_seccion('stock')) <> 'edicion' then
    raise exception 'Tu rol no puede anular ingresos de mercadería' using errcode = '42501';
  end if;

  if v_motivo is null or length(v_motivo) < 3 or length(v_motivo) > 500 then
    raise exception 'El motivo de la anulación debe tener entre 3 y 500 caracteres' using errcode = '22023';
  end if;

  select * into v_ingreso
    from dominio.ingresos_mercaderia i
   where i.id = p_ingreso
     and i.organizacion_id = v_organizacion
   for update;

  if not found then
    raise exception 'No encontramos ese ingreso de mercadería' using errcode = '22023';
  end if;
  if v_ingreso.estado = 'anulado' then
    raise exception 'Ese ingreso ya está anulado' using errcode = '22023';
  end if;

  select m.id into v_motivo_movimiento
    from dominio.motivos_movimiento m
   where m.organizacion_id = v_organizacion
     and lower(btrim(m.nombre)) = 'anulación de ingreso de mercadería'
     and m.activo
     and 'salida' = any (m.aplica_a);
  if v_motivo_movimiento is null then
    raise exception 'Falta el motivo «Anulación de ingreso de mercadería» en la organización' using errcode = '22023';
  end if;

  select p.razon_social into v_proveedor
    from dominio.proveedores p where p.id = v_ingreso.proveedor_id;
  select e.nombre into v_empresa
    from dominio.empresas e where e.id = v_ingreso.empresa_id;

  -- Orden por producto: dos anulaciones concurrentes bloquean en el mismo orden y
  -- no se cruzan. Si una salida no tiene stock, la RPC de stock lanza y todo vuelve.
  for v_linea in
    select l.id, l.producto_id, l.cantidad
      from dominio.ingresos_mercaderia_lineas l
     where l.ingreso_id = v_ingreso.id
     order by l.producto_id
  loop
    v_movimiento := (public.registrar_movimiento_stock(
      v_linea.producto_id,
      'salida',
      v_linea.cantidad,
      v_motivo_movimiento,
      format('Anulación del ingreso %s', v_ingreso.id),
      current_date
    )).id;

    update dominio.ingresos_mercaderia_lineas
       set movimiento_anulacion_id = v_movimiento
     where id = v_linea.id;

    v_unidades := v_unidades + v_linea.cantidad;
    v_productos := v_productos + 1;
  end loop;

  update dominio.ingresos_mercaderia
     set estado = 'anulado',
         motivo_anulacion = v_motivo,
         anulado_por = v_actor,
         anulado_en = now()
   where id = v_ingreso.id
   returning * into v_ingreso;

  v_detalle := format(
    'Anulación del ingreso de mercadería de %s para %s: %s unidades en %s %s (%s)',
    v_proveedor, v_empresa, v_unidades, v_productos,
    case when v_productos = 1 then 'producto' else 'productos' end,
    v_motivo
  );
  perform private.registrar_actividad('ingreso.anulado', v_detalle, v_ingreso.empresa_id);

  return v_ingreso;
end;
$$;

comment on function public.anular_ingreso_mercaderia(uuid, text) is
  'F-PRV-06: anula un ingreso registrado con motivo y revierte el stock por línea. Exige edición en Stock; es atómica.';

revoke execute on function public.anular_ingreso_mercaderia(uuid, text) from public, anon;
grant execute on function public.anular_ingreso_mercaderia(uuid, text) to authenticated;
