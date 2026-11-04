-- F-PRE-06 (MSF-419, épica MSF-352) · FR-004, FR-005: cambio de alcance de la cotización con vista previa.
--   public.previsualizar_cambio_alcance(p_alcance)            SOLO LEE: por empresa, cuántos precios en USD cambian
--                                                             y una muestra «hoy / nuevo».
--   public.cambiar_alcance_cotizacion(p_alcance, p_confirmado) UNA transacción: cambia el alcance, inicializa la
--                                                             cotización de cada empresa con la vigente
--                                                             (sistema→empresa) o descarta las propias y vuelve a la
--                                                             general (empresa→sistema). Exige confirmación y deja
--                                                             el evento `cotizacion.alcance_cambiado`.
--   private.precio_visible_con_redondeo(...)                  lo de `precio_visible_desde_central` con un redondeo
--                                                             opcional que pisa el de la regla de la empresa (lo usan
--                                                             las vistas previas con el redondeo configurado, FR-007).
--                                                             `precio_visible_desde_central` pasa a ser su envoltorio.
--
-- Esquema (Principio VII): sin tablas nuevas. Escribe `dominio.cotizacion_configuracion`,
-- `dominio.cotizacion_aplicada` y `dominio.cotizacion_pendiente` (todas `dominio`).
--
-- Ambas RPC son SECURITY DEFINER (excepción acotada, como `confirmar_cotizacion`): la regla de cada empresa vive
-- bajo la sección `empresas` y las tablas de cotización no tienen escritura para `authenticated`. Verifican
-- `edicion` en `cotizacion_dolar` y toman la organización de la SESIÓN. `anon` sin ejecución.
--
-- Concurrencia: `pg_advisory_xact_lock` por organización (el mismo de confirmar/descartar/guardar): un cambio de
-- alcance y una confirmación nunca se pisan. Ninguna empresa puede quedar con un valor mezclado: o todas tienen
-- fila propia (alcance «empresa») o ninguna (alcance «sistema»).
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.cambiar_alcance_cotizacion(text, boolean);
--   drop function public.previsualizar_cambio_alcance(text);
--   restaurar private.precio_visible_desde_central a su cuerpo de 20261023140200;
--   drop function private.precio_visible_con_redondeo(numeric, uuid, uuid, integer);

create or replace function private.precio_visible_con_redondeo(
  p_central numeric, p_producto uuid, p_empresa uuid, p_redondeo integer
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when coalesce(r.mostrar_con_iva, false)
      then private.aplicar_iva(x.neto, al.porcentaje, coalesce(al.exento, false))
    else x.neto
  end
  from dominio.productos p
  join dominio.empresas e on e.id = p_empresa and e.organizacion_id = p.organizacion_id
  left join dominio.precios_empresa r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id
  cross join lateral (
    select private.aplicar_regla_precio(
      p_central, coalesce(r.base, 'central'), coalesce(r.ajuste_pct, 0), coalesce(p_redondeo, r.redondeo_pesos, 10)
    ) as neto
  ) x
  left join lateral private.alicuota_producto(p.id) al on true
  where p.id = p_producto;
$$;

comment on function private.precio_visible_con_redondeo(numeric, uuid, uuid, integer) is
  'F-PRE-06: precio que ve el cliente partiendo de un central en pesos; el redondeo opcional pisa el de la regla de la empresa (vistas previas con el redondeo configurado).';

create or replace function private.precio_visible_desde_central(p_central numeric, p_producto uuid, p_empresa uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select private.precio_visible_con_redondeo(p_central, p_producto, p_empresa, null);
$$;

comment on function private.precio_visible_desde_central(numeric, uuid, uuid) is
  'F-PRE-03: precio que ve el cliente de un producto en una empresa, partiendo de un central en pesos dado (regla de la empresa + IVA si lo muestra). Envoltorio de private.precio_visible_con_redondeo.';

revoke execute on function private.precio_visible_con_redondeo(numeric, uuid, uuid, integer) from public, anon, authenticated;

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
  v_usd integer;
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
  select count(*)::integer into v_usd
    from dominio.productos p
   where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD';

  -- «Hoy»: el valor que rige a cada empresa ahora. «Nuevo»: el general (sistema→empresa: cada empresa arranca
  -- con la vigente, así que no cambia ninguna; empresa→sistema: todas pasan a la general).
  select coalesce(jsonb_agg(jsonb_build_object(
           'empresa_id', e.id, 'nombre', e.nombre,
           'precios_que_cambian',
             case when p_alcance <> v_config.alcance
                       and private.cotizacion_para(v_organizacion, e.id) is distinct from v_general
                  then v_usd else 0 end
         ) order by lower(e.nombre), e.id), '[]'::jsonb)
    into v_empresas
    from dominio.empresas e
   where e.organizacion_id = v_organizacion and e.activa;

  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', p.precio_lista,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'hoy', private.precio_visible_con_redondeo(
                                   round(p.precio_lista * private.cotizacion_para(v_organizacion, e.id), 2),
                                   p.id, e.id, v_config.redondeo_pesos),
                          'nuevo', private.precio_visible_con_redondeo(
                                   round(p.precio_lista * v_general, 2), p.id, e.id, v_config.redondeo_pesos)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                  where e.organizacion_id = p.organizacion_id and e.activa
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD'
         and p_alcance <> v_config.alcance
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
  'F-PRE-06: vista previa del cambio de alcance (por empresa, precios en USD que cambian y muestra hoy/nuevo). No escribe. 42501 sin edición en cotizacion_dolar; 22023 alcance inválido.';

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
  v_usd integer;
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
    select count(*)::integer into v_usd
      from dominio.productos p
     where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD';
    select (count(*) * v_usd)::integer into v_afectados
      from dominio.empresas e
     where e.organizacion_id = v_organizacion and e.activa
       and private.cotizacion_para(v_organizacion, e.id) is distinct from v_general;
    delete from dominio.cotizacion_pendiente p where p.organizacion_id = v_organizacion and p.empresa_id is not null;
    delete from dominio.cotizacion_aplicada a where a.organizacion_id = v_organizacion and a.empresa_id is not null;
  end if;

  insert into dominio.cotizacion_configuracion as c (organizacion_id, alcance)
  values (v_organizacion, p_alcance)
  on conflict (organizacion_id) do update set alcance = excluded.alcance, updated_at = now();

  perform private.insertar_actividad(
    v_organizacion, v_usuario, 'cotizacion.alcance_cambiado',
    case when p_alcance = 'empresa'
      then 'Cambió la cotización del dólar a una por empresa'
      else 'Cambió la cotización del dólar a una para todo el sistema'
    end,
    null
  );

  return jsonb_build_object('alcance', p_alcance, 'precios_afectados', v_afectados);
end;
$$;

comment on function public.cambiar_alcance_cotizacion(text, boolean) is
  'F-PRE-06: cambia el alcance de la cotización en una transacción (sistema→empresa inicializa cada empresa con la vigente; empresa→sistema descarta las propias). Exige p_confirmado = true. Idempotente. 42501 sin edición; 22023 alcance o confirmación inválidos.';

revoke execute on function public.previsualizar_cambio_alcance(text) from public, anon;
revoke execute on function public.cambiar_alcance_cotizacion(text, boolean) from public, anon;
grant execute on function public.previsualizar_cambio_alcance(text) to authenticated;
grant execute on function public.cambiar_alcance_cotizacion(text, boolean) to authenticated;
