-- MSF-352 (revisión de F-PRE-06): configuración y alcance de la cotización.
--
-- 1. (MEDIO, Code y QA) `previsualizar_cambio_alcance` contaba como «precios que cambian» los productos activos en USD
--    (`v_usd`), sin mirar el precio propio: un producto en USD con precio propio en pesos se contaba de más y un precio
--    propio en USD de un producto en ARS no se contaba. Además el «nuevo» de la muestra convertía el precio propio con
--    el alcance ACTUAL. Ahora cuenta con `private.precios_usd_por_empresa` (la misma lógica que la confirmación del
--    dólar), simula con la cotización DESTINO (la general, que es la que rige en ambos sentidos: sistema→empresa arranca
--    cada empresa con ella y empresa→sistema las lleva a ella) y la muestra incluye los productos en ARS con precio
--    propio en USD. `cambiar_alcance_cotizacion` calcula `precios_afectados` con la misma regla.
-- 2. (BAJO, Code) `guardar_configuracion_cotizacion` y `cambiar_alcance_cotizacion` no reejecutaban
--    `recalcular_alertas_inicio`: apagar el aviso o cambiar el alcance dejaba la alerta `dolar_sin_cargar` desfasada
--    hasta el próximo barrido. Ahora la recalculan en la misma transacción (la función es idempotente y toma su propio
--    advisory lock).
-- 3. (MEDIO, Code) La actividad de `guardar_configuracion_cotizacion` y del cambio de alcance no llevaba el valor
--    anterior ni el nuevo. Ahora usa `private.insertar_cambio_actividad` (registro inalterable, F-AUD-02) con ambos
--    como objetos jsonb: redondeo, umbral, confirmación, aviso y alcance. Son parámetros de configuración, no secretos.
--
-- Esquema (Principio VII): sin tablas nuevas. Migración aditiva (create or replace, mismas firmas y grants).
-- Reversión (migración posterior): restaurar `previsualizar_cambio_alcance` y `cambiar_alcance_cotizacion` a su cuerpo de
-- 20270213100003 y `guardar_configuracion_cotizacion` al de 20270213100001.

create or replace function public.guardar_configuracion_cotizacion(
  p_redondeo integer, p_umbral numeric, p_confirmacion numeric, p_aviso boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_actual record;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar la configuración de la cotización' using errcode = '42501';
  end if;
  if p_redondeo is null or p_redondeo not in (1, 10, 50, 100) then
    raise exception 'Elegí un redondeo válido' using errcode = '22023';
  end if;
  if p_umbral is null or p_umbral::text in ('NaN', 'Infinity', '-Infinity') or p_umbral < 0 or p_umbral > 100
     or p_umbral <> round(p_umbral, 3) then
    raise exception 'El umbral debe estar entre 0 y 100 %% y tener hasta 3 decimales' using errcode = '22023';
  end if;
  if p_confirmacion is null or p_confirmacion::text in ('NaN', 'Infinity', '-Infinity')
     or p_confirmacion <= p_umbral or p_confirmacion > 100 or p_confirmacion <> round(p_confirmacion, 3) then
    raise exception 'La confirmación debe ser mayor al umbral y de hasta 100 %%' using errcode = '22023';
  end if;
  if p_aviso is null then
    raise exception 'Indicá si querés el aviso en Inicio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_actual from private.cotizacion_config(v_organizacion);
  -- Idempotente: guardar lo mismo no escribe ni deja evento.
  if (v_actual.redondeo_pesos, v_actual.umbral_pct, v_actual.confirmacion_pct, v_actual.aviso_activo)
     is not distinct from (p_redondeo, p_umbral, p_confirmacion, p_aviso)
     and exists (select 1 from dominio.cotizacion_configuracion c where c.organizacion_id = v_organizacion) then
    return jsonb_build_object('actualizado', false);
  end if;

  insert into dominio.cotizacion_configuracion as c
    (organizacion_id, redondeo_pesos, umbral_pct, confirmacion_pct, aviso_activo)
  values (v_organizacion, p_redondeo, p_umbral, p_confirmacion, p_aviso)
  on conflict (organizacion_id) do update
    set redondeo_pesos = excluded.redondeo_pesos, umbral_pct = excluded.umbral_pct,
        confirmacion_pct = excluded.confirmacion_pct, aviso_activo = excluded.aviso_activo,
        updated_at = now();

  perform private.insertar_cambio_actividad(
    v_organizacion, v_usuario, 'cotizacion.configuracion_guardada',
    'Cambió la configuración de la cotización del dólar',
    jsonb_build_object('redondeo_pesos', v_actual.redondeo_pesos, 'umbral_pct', v_actual.umbral_pct,
                       'confirmacion_pct', v_actual.confirmacion_pct, 'aviso_activo', v_actual.aviso_activo),
    jsonb_build_object('redondeo_pesos', p_redondeo, 'umbral_pct', p_umbral,
                       'confirmacion_pct', p_confirmacion, 'aviso_activo', p_aviso),
    null
  );

  -- El aviso en Inicio cambia la alerta «dólar sin cargar»: se recalcula ya, no en el próximo barrido.
  perform public.recalcular_alertas_inicio(v_organizacion);

  return jsonb_build_object('actualizado', true);
end;
$$;

comment on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) is
  'F-PRE-06: guarda redondeo, umbral, confirmación y aviso (no cambia el alcance), deja el valor anterior y el nuevo en la actividad y recalcula las alertas de Inicio. Idempotente. 42501 sin edición en cotizacion_dolar; 22023 valor fuera de rango.';

create or replace function public.previsualizar_cambio_alcance(p_alcance text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
  v_general numeric;
  v_empresas jsonb;
  v_muestra jsonb;
begin
  if v_organizacion is null or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el alcance de la cotización' using errcode = '42501';
  end if;
  if p_alcance is null or p_alcance not in ('sistema', 'empresa') then
    raise exception 'Elegí un alcance válido' using errcode = '22023';
  end if;

  select * into v_config from private.cotizacion_config(v_organizacion);
  v_general := private.cotizacion_para(v_organizacion, null);
  -- «Hoy»: el valor que rige a cada empresa ahora. «Nuevo»: el general (sistema→empresa: cada empresa arranca
  -- con la vigente, así que no cambia ninguna; empresa→sistema: todas pasan a la general).
  select coalesce(jsonb_agg(jsonb_build_object(
           'empresa_id', e.id, 'nombre', e.nombre,
           'precios_que_cambian',
             case when p_alcance <> v_config.alcance
                       and private.cotizacion_para(v_organizacion, e.id) is distinct from v_general
                  then (select u.precios from private.precios_usd_por_empresa(v_organizacion) u where u.empresa_id = e.id)
                  else 0 end
         ) order by lower(e.nombre), e.id), '[]'::jsonb)
    into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_organizacion and e.activa;

  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', case when p.moneda = 'USD' then p.precio_lista end,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'usd', case when x.moneda is not null then case when x.moneda = 'USD' then x.importe end
                                      when p.moneda = 'USD' then p.precio_lista end,
                          'hoy', private.precio_visible_con_redondeo(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                                   p.id, e.id, v_config.redondeo_pesos),
                          -- «Nuevo»: con la cotización DESTINO (la general), también para el precio propio en USD.
                          'nuevo', private.precio_visible_con_cotizacion(
                                   case p.moneda when 'USD' then round(p.precio_lista * v_general, 2) else p.precio_lista end,
                                   p.id, e.id, v_config.redondeo_pesos, v_general)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                   left join dominio.precios_propios_empresa x
                     on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
                  where e.organizacion_id = p.organizacion_id and e.activa
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
         and p_alcance <> v_config.alcance
         and exists (
           select 1 from dominio.empresas e
             left join dominio.precios_propios_empresa x
               on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
            where e.organizacion_id = p.organizacion_id and e.activa and coalesce(x.moneda, p.moneda) = 'USD')
       order by lower(p.nombre), p.id
       limit 6
    ) m;

  return jsonb_build_object(
    'alcance_actual', v_config.alcance, 'empresas', v_empresas, 'muestra', v_muestra,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.previsualizar_cambio_alcance(text) is
  'F-PRE-06: vista previa del cambio de alcance (por empresa, precios que dependen del dólar y cambian, y muestra hoy/nuevo con la cotización destino; cuenta el precio propio en USD). No escribe. 42501 sin edición en cotizacion_dolar; 22023 alcance inválido.';

create or replace function public.cambiar_alcance_cotizacion(p_alcance text, p_confirmado boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_actual text;
  v_general numeric;
  v_afectados integer := 0;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el alcance de la cotización' using errcode = '42501';
  end if;
  if p_alcance is null or p_alcance not in ('sistema', 'empresa') then
    raise exception 'Elegí un alcance válido' using errcode = '22023';
  end if;
  if p_confirmado is distinct from true then
    raise exception 'Confirmá el cambio de alcance después de ver la vista previa' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select k.alcance into v_actual from private.cotizacion_config(v_organizacion) k;
  -- Idempotente: pedir el alcance que ya rige no cambia nada ni deja evento.
  if v_actual = p_alcance then
    return jsonb_build_object('alcance', v_actual, 'precios_afectados', 0);
  end if;

  v_general := private.cotizacion_para(v_organizacion, null);

  if p_alcance = 'empresa' then
    -- Cada empresa activa arranca con la cotización vigente: no cambia ningún precio.
    if v_general is not null then
      insert into dominio.cotizacion_aplicada (organizacion_id, empresa_id, valor, aplicada_en)
      select v_organizacion, e.id, v_general, now()
        from dominio.empresas e
       where e.organizacion_id = v_organizacion and e.activa
      on conflict (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        do update set valor = excluded.valor, cotizacion_id = null, aplicada_en = excluded.aplicada_en;
    end if;
    -- Una carga general pendiente no se hereda: cada empresa carga la suya.
    delete from dominio.cotizacion_pendiente p where p.organizacion_id = v_organizacion and p.empresa_id is null;
  else
    -- Precios que dependen del dólar (con precio propio, por empresa) de las empresas cuya cotización cambia.
    select coalesce(sum(u.precios), 0)::integer into v_afectados
      from private.precios_usd_por_empresa(v_organizacion) u
     where private.cotizacion_para(v_organizacion, u.empresa_id) is distinct from v_general;
    delete from dominio.cotizacion_pendiente p where p.organizacion_id = v_organizacion and p.empresa_id is not null;
    delete from dominio.cotizacion_aplicada a where a.organizacion_id = v_organizacion and a.empresa_id is not null;
  end if;

  insert into dominio.cotizacion_configuracion as c (organizacion_id, alcance)
  values (v_organizacion, p_alcance)
  on conflict (organizacion_id) do update set alcance = excluded.alcance, updated_at = now();

  perform private.insertar_cambio_actividad(
    v_organizacion, v_usuario, 'cotizacion.alcance_cambiado',
    case when p_alcance = 'empresa'
      then 'Cambió la cotización del dólar a una por empresa'
      else 'Cambió la cotización del dólar a una para todo el sistema'
    end,
    jsonb_build_object('alcance', v_actual), jsonb_build_object('alcance', p_alcance), null
  );

  -- La alerta «dólar sin cargar» depende del alcance: se recalcula ya, no en el próximo barrido.
  perform public.recalcular_alertas_inicio(v_organizacion);

  return jsonb_build_object('alcance', p_alcance, 'precios_afectados', v_afectados);
end;
$$;

comment on function public.cambiar_alcance_cotizacion(text, boolean) is
  'F-PRE-06: cambia el alcance de la cotización en una transacción (sistema→empresa inicializa cada empresa con la vigente; empresa→sistema descarta las propias), deja el alcance anterior y el nuevo en la actividad y recalcula las alertas de Inicio. Exige p_confirmado = true. Idempotente. 42501 sin edición; 22023 alcance o confirmación inválidos.';

revoke execute on function public.previsualizar_cambio_alcance(text) from public, anon;
revoke execute on function public.cambiar_alcance_cotizacion(text, boolean) from public, anon;
revoke execute on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) from public, anon;
grant execute on function public.previsualizar_cambio_alcance(text) to authenticated;
grant execute on function public.cambiar_alcance_cotizacion(text, boolean) to authenticated;
grant execute on function public.guardar_configuracion_cotizacion(integer, numeric, numeric, boolean) to authenticated;
