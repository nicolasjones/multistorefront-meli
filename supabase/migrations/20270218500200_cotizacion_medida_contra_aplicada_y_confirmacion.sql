-- MSF-352 (revisión de F-PRE-06): tres hallazgos sobre cargar, previsualizar y confirmar el dólar.
--
-- 1. (MEDIO) El umbral de recálculo se medía contra la ÚLTIMA CARGA registrada (`private.cotizacion_vigente_para`),
--    no contra la cotización APLICADA (la que usan los precios). Con umbral 5 %, aplicada 1.000: se cargaba 1.040
--    (4 %, no se aplica) y luego 1.081 (4 % contra 1.040, tampoco): la tienda quedaba en 1.000 con el dólar real 8,1 %
--    arriba y sin aviso. Ahora `cargar_`, `previsualizar_` y `confirmar_cotizacion` miden variación, umbral y variación
--    inusual contra `private.cotizacion_para(org, empresa)` (la aplicada; la general si la empresa no tiene la suya; la
--    inicial si no hay ninguna). `estado_cotizacion` suma `aplicada` (el valor con el que se calculan los precios) y pasa
--    a SECURITY DEFINER con chequeo explícito de `cotizacion_dolar` (antes, invoker: un rol sin `productos` recibía
--    `aplicada` nula por la RLS de `cotizacion_aplicada`). `dominio.cotizaciones.valor_anterior` y `variacion_pct`
--    siguen siendo contra la carga anterior (coherentes con `listar_cotizaciones`).
-- 2. (MEDIO) La «variación inusual» (`confirmacion_pct`) solo avisaba en la pantalla: por API, tipear 149000 en vez de
--    1490 se aplicaba y multiplicaba por 100 los precios en USD. `confirmar_cotizacion` recibe
--    `p_variacion_vista numeric default null` (la variación que el usuario vio) y, si |variación| > `confirmacion_pct`,
--    la exige: sin ella 22023 (hint `variacion_inusual`); si difiere de la real en más de 0,05 puntos (otro usuario
--    cambió el dólar mientras revisaba) 22023 (hint `variacion_cambio`). Sin escribir nada. La pantalla envía la
--    variación del aviso que estaba a la vista.
--    BREAKING compatible: `confirmar_cotizacion(uuid)` se reemplaza por `confirmar_cotizacion(uuid, numeric)`; un cliente
--    que la llame sin `p_variacion_vista` sigue funcionando para variaciones normales.
-- 3. (MEDIO) `previsualizar_cotizacion`: la muestra «hoy / nuevo» solo listaba productos en USD y trataba todo como USD.
--    Ahora incluye también los productos en ARS con precio propio en USD (que sí cambian con el dólar), excluye los
--    que ninguna empresa calcula en USD, y el «nuevo» de un producto en ARS no se multiplica por el dólar.
--
-- Esquema (Principio VII): sin tablas nuevas; solo funciones `public`. Migración aditiva (create or replace; la firma de
-- `confirmar_cotizacion` cambia con `drop function` de la anterior). Reversión (migración posterior): primero hay que BORRAR
--   drop function public.confirmar_cotizacion(uuid, numeric);
-- (si no, quedarían dos funciones con el mismo nombre) y recién después recrear `confirmar_cotizacion(uuid)`,
-- `previsualizar_cotizacion`, `estado_cotizacion` y `cargar_cotizacion` con los cuerpos de 20270213100004 / 20270213100006.

create or replace function public.cargar_cotizacion(p_valor numeric, p_empresa uuid default null)
returns jsonb
language plpgsql
-- Definer: llama a private.cotizacion_vigente_para (sin grant a authenticated); organización, usuario y rol salen de la sesión.
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_empresa uuid;
  v_anterior numeric;
  v_pendiente dominio.cotizacion_pendiente;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede cargar la cotización del dólar' using errcode = '42501';
  end if;
  if p_valor is null or p_valor::text in ('NaN', 'Infinity', '-Infinity') or p_valor <= 0
     or p_valor <> round(p_valor, 4) then
    raise exception 'La cotización debe ser mayor a cero y tener hasta 4 decimales' using errcode = '23514';
  end if;
  if p_valor >= 10000000000 then
    raise exception 'La cotización es demasiado grande' using errcode = '22003';
  end if;
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  -- La variación se mide contra lo que rige los precios (la aplicada), no contra la última carga (MSF-352).
  v_anterior := private.cotizacion_para(v_organizacion, v_empresa);

  insert into dominio.cotizacion_pendiente as p (organizacion_id, empresa_id, valor, cargada_por)
  values (v_organizacion, v_empresa, p_valor, v_usuario)
  on conflict (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
    set valor = excluded.valor, cargada_por = excluded.cargada_por
  returning p.* into v_pendiente;

  return jsonb_build_object(
    'valor', v_pendiente.valor,
    'anterior', v_anterior,
    'variacion_pct', case when v_anterior is null then null else round((v_pendiente.valor / v_anterior - 1) * 100, 4) end,
    'expira_en', v_pendiente.expira_en
  );
end;
$$;

comment on function public.cargar_cotizacion(numeric, uuid) is
  'F-PRE-02/F-PRE-06: carga el dólar como cotización PENDIENTE (de la organización o, con alcance «empresa», de p_empresa; reemplaza la anterior pendiente; vence a las 24 h). No cambia precios. `anterior` y `variacion_pct` se miden contra la cotización aplicada. 42501 sin edición en cotizacion_dolar, 23514 valor inválido, 22003 fuera de rango, 22023 falta empresa, P0002 empresa ajena.';

create or replace function public.estado_cotizacion(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
-- Definer: la cotización aplicada tiene RLS por `productos` y este estado lo ve quien tiene `cotizacion_dolar`. La organización
-- sale de la SESIÓN, todo se filtra por ella y la empresa pasa por `private.empresa_de_cotizacion` (rechaza empresas ajenas).
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_empresa uuid;
  v_config record;
  v_vigente jsonb;
  v_productos integer;
  v_pendiente jsonb;
  v_edita boolean;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;
  v_edita := (select private.nivel_seccion('cotizacion_dolar')) = 'edicion';
  select * into v_config from private.cotizacion_config(v_organizacion);
  -- La pantalla pide el estado de la organización aun con alcance «empresa» y «Todas mis empresas»: ahí no
  -- hay empresa que mostrar y se devuelve la cotización general.
  v_empresa := case when v_config.alcance = 'empresa' and p_empresa is not null
                    then private.empresa_de_cotizacion(v_organizacion, p_empresa) end;

  select jsonb_build_object('valor', c.valor, 'cargada_en', c.cargada_en, 'cargada_por', c.cargada_por_nombre)
    into v_vigente
    from dominio.cotizaciones c
    where c.organizacion_id = v_organizacion and c.empresa_id is not distinct from v_empresa
    order by c.cargada_en desc, c.id desc
    limit 1;

  -- Rige lo más reciente: el valor aplicado al volver a alcance «empresa» pisa el historial viejo de la empresa.
  if v_empresa is not null then
    v_vigente := coalesce((
      select jsonb_build_object('valor', a.valor, 'cargada_en', a.aplicada_en, 'cargada_por', null)
        from dominio.cotizacion_aplicada a
       where a.organizacion_id = v_organizacion and a.empresa_id = v_empresa
         and (v_vigente is null or a.aplicada_en > (v_vigente->>'cargada_en')::timestamptz)
    ), v_vigente);
  end if;

  if v_vigente is null and v_empresa is not null then
    select jsonb_build_object('valor', c.valor, 'cargada_en', c.cargada_en, 'cargada_por', c.cargada_por_nombre)
      into v_vigente
      from dominio.cotizaciones c
      where c.organizacion_id = v_organizacion and c.empresa_id is null
      order by c.cargada_en desc, c.id desc
      limit 1;
  end if;

  if v_vigente is null then
    select jsonb_build_object('valor', i.valor, 'cargada_en', i.updated_at, 'cargada_por', null)
      into v_vigente
      from dominio.cotizacion_inicial i
      where i.organizacion_id = v_organizacion;
  end if;

  select count(*)::integer into v_productos
    from dominio.productos p
    where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD';

  select jsonb_build_object('valor', p.valor, 'expira_en', p.expira_en)
    into v_pendiente
    from dominio.cotizacion_pendiente p
    where v_edita and p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now();

  return jsonb_build_object(
    'vigente', v_vigente, 'aplicada', private.cotizacion_para(v_organizacion, v_empresa), 'productos_usd', v_productos, 'pendiente', v_pendiente, 'alcance', v_config.alcance,
    'umbral_pct', v_config.umbral_pct, 'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.estado_cotizacion(uuid) is
  'F-PRE-02/F-PRE-06: cotización vigente (de la empresa con alcance «empresa»; si no, la general), productos activos en USD, pendiente no vencida y alcance. 42501 sin acceso a cotizacion_dolar, P0002 empresa ajena.';

create or replace function public.previsualizar_cotizacion(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
  v_empresa uuid;
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_recalcula boolean;
  v_empresas jsonb;
  v_muestra jsonb;
begin
  if v_organizacion is null or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede ver la vista previa de la cotización' using errcode = '42501';
  end if;
  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now();
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  -- Contra la cotización APLICADA, la misma que decide `confirmar_cotizacion` (MSF-352).
  v_vigente := private.cotizacion_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ umbral.
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u
   where v_empresa is null or u.empresa_id = v_empresa;

  -- Muestra: productos que alguna empresa del alcance calcula en USD (el producto en USD sin precio propio en pesos, o
  -- cualquier producto con precio propio en USD). «Nuevo» convierte con la cotización pendiente; un precio propio en
  -- pesos no cambia y un producto en ARS no se multiplica por el dólar.
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
                          'nuevo', private.precio_visible_con_cotizacion(
                                   case p.moneda when 'USD' then round(p.precio_lista * v_pendiente.valor, 2) else p.precio_lista end,
                                   p.id, e.id, v_config.redondeo_pesos, v_pendiente.valor)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                   left join dominio.precios_propios_empresa x
                     on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
                  where e.organizacion_id = p.organizacion_id and e.activa
                    and (v_empresa is null or e.id = v_empresa)
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo
         and exists (
           select 1 from dominio.empresas e
             left join dominio.precios_propios_empresa x
               on x.producto_id = p.id and x.empresa_id = e.id and x.organizacion_id = p.organizacion_id
            where e.organizacion_id = p.organizacion_id and e.activa
              and (v_empresa is null or e.id = v_empresa)
              and coalesce(x.moneda, p.moneda) = 'USD')
       order by lower(p.nombre), p.id
       limit 6
    ) m;

  return jsonb_build_object(
    'variacion_pct', v_variacion,
    'recalcula', v_recalcula,
    'empresas', v_empresas,
    'muestra', v_muestra,
    'umbral_pct', v_config.umbral_pct,
    'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.previsualizar_cotizacion(uuid) is
  'F-PRE-03/F-PRE-06/F-PRE-08: vista previa de la cotización pendiente (de la organización o de p_empresa): variación y umbral medidos contra la cotización aplicada; precios por empresa y muestra hoy/nuevo (productos en USD y productos con precio propio en USD, por empresa) con el redondeo configurado. No escribe. 42501 sin edición en cotizacion_dolar, P0002 sin_cotizacion_pendiente o empresa ajena, 22023 falta empresa.';

drop function if exists public.confirmar_cotizacion(uuid);
drop function if exists public.confirmar_cotizacion(uuid, boolean);

create or replace function public.confirmar_cotizacion(p_empresa uuid default null, p_variacion_vista numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_config record;
  v_empresa uuid;
  v_nombre_empresa text;
  v_pendiente dominio.cotizacion_pendiente;
  v_vigente numeric;
  v_variacion numeric;
  v_ultima numeric;
  v_recalcula boolean;
  v_precios integer := 0;
  v_nombre text;
  v_id uuid;
  v_valor_txt text;
  v_donde text := '';
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede confirmar la cotización del dólar' using errcode = '42501';
  end if;
  -- El lock va ANTES de leer la configuración: un guardar_configuracion_cotizacion concurrente (mismo lock) no deja el umbral
  -- ni la confirmación desfasados respecto de lo que se aplica.
  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now()
   for update;
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  -- Umbral y variación inusual: se miden contra la cotización APLICADA (la que usan los precios), no contra la última
  -- carga registrada; así varias cargas bajo el umbral no acumulan una deriva sin aviso (MSF-352).
  v_vigente := private.cotizacion_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  -- Variación inusual: el cliente tiene que mandar la variación que VIO (p_variacion_vista) y debe coincidir con la real
  -- (tolerancia 0,05 puntos: tolera un valor redondeado a 1 decimal). Un booleano no alcanza: si otro usuario aplicó un dólar distinto entre la vista previa y la
  -- confirmación, la variación real pudo pasar de +16 % a +60 % sin que nadie la viera.
  if v_variacion is not null and abs(v_variacion) > v_config.confirmacion_pct then
    if p_variacion_vista is null then
      raise exception 'La variación de la cotización (% %%) supera el % %% configurado: confirmala explícitamente',
        trim_scale(v_variacion)::text, trim_scale(v_config.confirmacion_pct)::text
        using errcode = '22023', hint = 'variacion_inusual';
    elsif abs(v_variacion - p_variacion_vista) > 0.05 then
      raise exception 'El dólar cambió mientras revisabas: revisá de nuevo'
        using errcode = '22023', hint = 'variacion_cambio';
    end if;
  end if;

  -- El historial conserva la carga ANTERIOR (valor_anterior y variacion_pct entre cargas consecutivas, como lo muestra
  -- `listar_cotizaciones`); la decisión de arriba se tomó contra la aplicada.
  v_ultima := private.cotizacion_vigente_para(v_organizacion, v_empresa);

  if v_recalcula then
    select coalesce(sum(u.precios), 0)::integer into v_precios
      from private.precios_usd_por_empresa(v_organizacion) u
     where v_empresa is null or u.empresa_id = v_empresa;
  end if;

  select coalesce(nullif(btrim(concat_ws(' ', pf.nombre, pf.apellido)), ''), u.email::text)
    into v_nombre
    from auth.users u
    left join public.perfiles_usuario pf on pf.user_id = u.id
   where u.id = coalesce(v_pendiente.cargada_por, v_usuario);
  v_nombre := coalesce(v_nombre, 'Usuario');

  insert into dominio.cotizaciones (
    organizacion_id, empresa_id, valor, valor_anterior, variacion_pct, cargada_por, cargada_por_nombre,
    cargada_en, recalculo_aplicado, precios_recalculados, umbral_pct
  ) values (
    v_organizacion, v_empresa, v_pendiente.valor, v_ultima,
    case when v_ultima is null then null else round((v_pendiente.valor / v_ultima - 1) * 100, 4) end, coalesce(v_pendiente.cargada_por, v_usuario), v_nombre,
    clock_timestamp(), v_recalcula, v_precios, v_config.umbral_pct
  ) returning id into v_id;

  if v_recalcula then
    insert into dominio.cotizacion_aplicada as a (organizacion_id, empresa_id, valor, cotizacion_id, aplicada_en)
    values (v_organizacion, v_empresa, v_pendiente.valor, v_id, now())
    on conflict (organizacion_id, (coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update
      set valor = excluded.valor, cotizacion_id = excluded.cotizacion_id, aplicada_en = excluded.aplicada_en;
  end if;

  delete from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa;

  if v_empresa is not null then
    select e.nombre into v_nombre_empresa from dominio.empresas e where e.id = v_empresa;
    v_donde := format(' (%s)', v_nombre_empresa);
  end if;
  v_valor_txt := trim_scale(v_pendiente.valor)::text;
  perform private.insertar_actividad(
    v_organizacion, v_usuario, 'cotizacion.cargada',
    format('Confirmó la cotización del dólar: $ %s%s', v_valor_txt, v_donde), v_empresa
  );
  if v_recalcula then
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.aplicado',
      format('Recalculó %s precios con el dólar a $ %s%s', v_precios, v_valor_txt, v_donde), v_empresa
    );
  else
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'recalculo.omitido',
      format('Registró el dólar a $ %s sin recalcular: la variación es menor al umbral de %s %%%s',
             v_valor_txt, trim_scale(v_config.umbral_pct)::text, v_donde), v_empresa
    );
  end if;

  return jsonb_build_object('id', v_id, 'recalculo_aplicado', v_recalcula, 'precios_recalculados', v_precios);
end;
$$;

comment on function public.confirmar_cotizacion(uuid, numeric) is
  'F-PRE-03/F-PRE-06: confirma la cotización pendiente (de la organización o de p_empresa) en una transacción: historial (con el umbral usado), cotización aplicada (si la variación alcanza el umbral configurado), eventos. El umbral y la variación se miden contra la cotización aplicada; si |variación| supera la confirmación configurada exige p_variacion_vista (la variación que el usuario vio) y que coincida con la real ±0,05 (22023: hint variacion_inusual si falta, variacion_cambio si difiere). 42501 sin edición; P0002 sin_cotizacion_pendiente o empresa ajena; 22023 falta empresa.';

revoke execute on function public.cargar_cotizacion(numeric, uuid) from public, anon;
revoke execute on function public.estado_cotizacion(uuid) from public, anon;
revoke execute on function public.previsualizar_cotizacion(uuid) from public, anon;
revoke execute on function public.confirmar_cotizacion(uuid, numeric) from public, anon;
grant execute on function public.cargar_cotizacion(numeric, uuid) to authenticated;
grant execute on function public.estado_cotizacion(uuid) to authenticated;
grant execute on function public.previsualizar_cotizacion(uuid) to authenticated;
grant execute on function public.confirmar_cotizacion(uuid, numeric) to authenticated;
