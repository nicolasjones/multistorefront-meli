-- F-PRE-06 (MSF-419, épica MSF-352) · FR-006, FR-007: la carga, la vista previa, la confirmación, el descarte, el
-- historial y el aviso del dólar leen la CONFIGURACIÓN (umbral, confirmación, redondeo, aviso) en lugar de las
-- constantes de MSF-116 (1 %, 15 %, $ 10, aviso siempre activo) y reciben `p_empresa` (obligatoria solo si el
-- alcance es «empresa»). Con la configuración por omisión el resultado es el de MSF-116.
--
-- Esquema (Principio VII): sin tablas nuevas; escribe `dominio.cotizacion_pendiente`, `dominio.cotizaciones` y
-- `dominio.cotizacion_aplicada` (todas `dominio`, alteradas en 20270122100100). El historial guarda además el
-- umbral usado (`cotizaciones.umbral_pct`) y la empresa.
--
-- BREAKING (compatible hacia atrás): `cargar_cotizacion`, `estado_cotizacion`, `previsualizar_cotizacion`,
-- `confirmar_cotizacion`, `descartar_cotizacion`, `cotizacion_del_dia` y `listar_cotizaciones` suman `p_empresa
-- uuid default null`. Como Postgres trata la nueva firma como otra función, se hace `drop function` de la vieja y
-- se la recrea; llamada sin `p_empresa` (alcance «sistema») el contrato es el de siempre. Con alcance «empresa»,
-- omitirla es un error `22023`.
--
-- Redondeo (Decisión abierta 1 de la spec): el configurado rige el «Nuevo» y el «Hoy» de las vistas previas del
-- recálculo (pisa el redondeo de la regla de la empresa SOLO en esas vistas); el redondeo de la regla de cada
-- empresa (F-PRE-07) y el precio que ve el cliente no se tocan.
--
-- Las funciones que escriben (`confirmar_`, `descartar_`) siguen siendo SECURITY DEFINER y `cargar_`,
-- `estado_`, `listar_` SECURITY INVOKER, como en MSF-116. Verifican la sección `cotizacion_dolar` y toman la
-- organización de la SESIÓN. `anon` sin ejecución.
--
-- También redefine `public.recalcular_alertas_inicio` (MSF-361): la alerta `dolar_sin_cargar` respeta «Aviso en
-- Inicio» y, con alcance «empresa», aparece si alguna empresa activa no cargó el dólar de hoy.
--
-- Migración aditiva. Reversión (migración posterior):
--   drop function public.listar_cotizaciones(integer, text, uuid);   y recrear la de 20261023140400
--   drop function public.cotizacion_del_dia(uuid);                    y recrear la de 20261023140500
--   drop function public.descartar_cotizacion(uuid);                  y recrear la de 20261023140300
--   drop function public.confirmar_cotizacion(uuid);                  y recrear la de 20261023140300
--   drop function public.previsualizar_cotizacion(uuid);              y recrear la de 20261023140200
--   drop function public.estado_cotizacion(uuid);                     y recrear la de 20261023140100
--   drop function public.cargar_cotizacion(numeric, uuid);            y recrear la de 20261023140100
--   restaurar public.recalcular_alertas_inicio al cuerpo de 20270121121100;
--   drop function private.empresa_de_cotizacion(uuid, uuid);

-- Empresa a la que se refiere una operación de cotización: nula con alcance «sistema»; con alcance «empresa»
-- exige una empresa de la organización. Definer: quien carga el dólar puede no tener la sección `empresas`.
create or replace function private.empresa_de_cotizacion(p_organizacion uuid, p_empresa uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alcance text;
begin
  -- Definer con grant a authenticated: solo opera sobre la organización de la sesión (sin oráculo entre organizaciones).
  if p_organizacion is distinct from (select private.organizacion_id()) then
    raise exception 'Organización no válida' using errcode = '42501';
  end if;
  select k.alcance into v_alcance from private.cotizacion_config(p_organizacion) k;
  if v_alcance <> 'empresa' then
    return null;
  end if;
  if p_empresa is null then
    raise exception 'Elegí la empresa de la cotización' using errcode = '22023';
  end if;
  if not exists (select 1 from dominio.empresas e where e.id = p_empresa and e.organizacion_id = p_organizacion) then
    raise exception 'La empresa no existe en tu organización' using errcode = 'P0002';
  end if;
  return p_empresa;
end;
$$;

comment on function private.empresa_de_cotizacion(uuid, uuid) is
  'F-PRE-06: empresa de una operación de cotización (nula con alcance «sistema»; con «empresa» exige una de la organización: 22023 si falta, P0002 si es ajena).';

revoke execute on function private.empresa_de_cotizacion(uuid, uuid) from public, anon;
grant execute on function private.empresa_de_cotizacion(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Carga y estado (F-PRE-02)
-- ---------------------------------------------------------------------------

drop function if exists public.cargar_cotizacion(numeric);

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

  v_anterior := private.cotizacion_vigente_para(v_organizacion, v_empresa);

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
  'F-PRE-02/F-PRE-06: carga el dólar como cotización PENDIENTE (de la organización o, con alcance «empresa», de p_empresa; reemplaza la anterior pendiente; vence a las 24 h). No cambia precios. 42501 sin edición en cotizacion_dolar, 23514 valor inválido, 22003 fuera de rango, 22023 falta empresa, P0002 empresa ajena.';

drop function if exists public.estado_cotizacion();

create or replace function public.estado_cotizacion(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_empresa uuid;
  v_config record;
  v_vigente jsonb;
  v_productos integer;
  v_pendiente jsonb;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;
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
    where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now();

  return jsonb_build_object(
    'vigente', v_vigente, 'productos_usd', v_productos, 'pendiente', v_pendiente, 'alcance', v_config.alcance,
    'umbral_pct', v_config.umbral_pct, 'confirmacion_pct', v_config.confirmacion_pct,
    'redondeo_pesos', v_config.redondeo_pesos
  );
end;
$$;

comment on function public.estado_cotizacion(uuid) is
  'F-PRE-02/F-PRE-06: cotización vigente (de la empresa con alcance «empresa»; si no, la general), productos activos en USD, pendiente no vencida y alcance. 42501 sin acceso a cotizacion_dolar, P0002 empresa ajena.';

-- ---------------------------------------------------------------------------
-- Vista previa, confirmación y descarte (F-PRE-03)
-- ---------------------------------------------------------------------------

drop function if exists public.previsualizar_cotizacion();

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

  v_vigente := private.cotizacion_vigente_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  -- Mismo criterio que `confirmar_cotizacion`: sin cotización previa siempre se aplica; si no, |variación| ≥ umbral.
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

  select coalesce(jsonb_agg(jsonb_build_object('empresa_id', u.empresa_id, 'nombre', u.nombre, 'precios', u.precios)
                            order by lower(u.nombre), u.empresa_id), '[]'::jsonb)
    into v_empresas
    from private.precios_usd_por_empresa(v_organizacion) u
   where v_empresa is null or u.empresa_id = v_empresa;

  select coalesce(jsonb_agg(m.fila order by m.orden), '[]'::jsonb) into v_muestra
    from (
      select row_number() over (order by lower(p.nombre), p.id) as orden,
             jsonb_build_object(
               'producto', p.nombre, 'sku', p.sku, 'usd', p.precio_lista,
               'por_empresa', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'empresa_id', e.id,
                          'hoy', private.precio_visible_con_redondeo(
                                   private.a_pesos(p.precio_lista, p.moneda, p.organizacion_id, e.id),
                                   p.id, e.id, v_config.redondeo_pesos),
                          'nuevo', private.precio_visible_con_redondeo(
                                   round(p.precio_lista * v_pendiente.valor, 2), p.id, e.id, v_config.redondeo_pesos)
                        ) order by lower(e.nombre), e.id), '[]'::jsonb)
                   from dominio.empresas e
                  where e.organizacion_id = p.organizacion_id and e.activa
                    and (v_empresa is null or e.id = v_empresa)
               )
             ) as fila
        from dominio.productos p
       where p.organizacion_id = v_organizacion and p.activo and p.moneda = 'USD'
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
  'F-PRE-03/F-PRE-06: vista previa de la cotización pendiente (de la organización o de p_empresa): precios por empresa y muestra hoy/nuevo con el redondeo configurado; el umbral es el configurado. No escribe. 42501 sin edición en cotizacion_dolar, P0002 sin_cotizacion_pendiente o empresa ajena, 22023 falta empresa.';

drop function if exists public.confirmar_cotizacion();

create or replace function public.confirmar_cotizacion(p_empresa uuid default null)
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
  select * into v_config from private.cotizacion_config(v_organizacion);
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  select * into v_pendiente from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa and p.expira_en > now()
   for update;
  if not found then
    raise exception 'sin_cotizacion_pendiente' using errcode = 'P0002';
  end if;

  -- umbral: se mide contra la cotización VIGENTE (Decisión abierta 3 de la spec) con el umbral configurado.
  v_vigente := private.cotizacion_vigente_para(v_organizacion, v_empresa);
  v_variacion := case when v_vigente is null then null else round((v_pendiente.valor / v_vigente - 1) * 100, 4) end;
  v_recalcula := v_vigente is null or abs(v_pendiente.valor - v_vigente) * 100 >= v_vigente * v_config.umbral_pct;

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
    v_organizacion, v_empresa, v_pendiente.valor, v_vigente, v_variacion, coalesce(v_pendiente.cargada_por, v_usuario), v_nombre,
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

comment on function public.confirmar_cotizacion(uuid) is
  'F-PRE-03/F-PRE-06: confirma la cotización pendiente (de la organización o de p_empresa) en una transacción: historial (con el umbral usado), cotización aplicada (si la variación alcanza el umbral configurado), eventos. 42501 sin edición; P0002 sin_cotizacion_pendiente o empresa ajena; 22023 falta empresa.';

drop function if exists public.descartar_cotizacion();

create or replace function public.descartar_cotizacion(p_empresa uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_usuario uuid := (select auth.uid());
  v_empresa uuid;
  v_valor numeric;
begin
  if v_organizacion is null or v_usuario is null
     or (select private.nivel_seccion('cotizacion_dolar')) <> 'edicion' then
    raise exception 'Tu rol no puede descartar la cotización del dólar' using errcode = '42501';
  end if;
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  perform pg_advisory_xact_lock(hashtextextended('cotizacion:' || v_organizacion::text, 0));

  delete from dominio.cotizacion_pendiente p
   where p.organizacion_id = v_organizacion and p.empresa_id is not distinct from v_empresa
  returning p.valor into v_valor;

  -- Sin pendiente no hay nada que descartar: no es un error ni deja evento.
  if found then
    perform private.insertar_actividad(
      v_organizacion, v_usuario, 'cotizacion.descartada',
      format('Descartó la cotización del dólar cargada: $ %s', trim_scale(v_valor)::text), v_empresa
    );
  end if;
end;
$$;

comment on function public.descartar_cotizacion(uuid) is
  'F-PRE-03/F-PRE-06: descarta la cotización pendiente (de la organización o de p_empresa; acción Cancelar). Idempotente: sin pendiente no hace nada. 42501 sin edición.';

-- ---------------------------------------------------------------------------
-- Aviso «¿se cargó hoy?» (F-PRE-05) e historial (F-PRE-04)
-- ---------------------------------------------------------------------------

drop function if exists public.cotizacion_del_dia();

create or replace function public.cotizacion_del_dia(p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_config record;
  v_empresa uuid;
  v_hoy_inicio timestamptz :=
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_carga dominio.cotizaciones;
  v_cargada_hoy boolean;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;
  select * into v_config from private.cotizacion_config(v_organizacion);
  -- Con alcance «empresa» y «Todas mis empresas» (sin empresa) el día está cargado cuando cada empresa activa cargó.
  v_empresa := case when v_config.alcance = 'empresa' and p_empresa is not null
                    then private.empresa_de_cotizacion(v_organizacion, p_empresa) end;

  -- «Hoy» = desde la medianoche de Buenos Aires; la cota superior evita contar cargas con fecha futura.
  select c.* into v_carga
    from dominio.cotizaciones c
    where c.organizacion_id = v_organizacion
      and (v_config.alcance = 'empresa' and p_empresa is null or c.empresa_id is not distinct from v_empresa)
      and c.cargada_en >= v_hoy_inicio
      and c.cargada_en < v_hoy_inicio + interval '1 day'
    order by c.cargada_en desc, c.id desc
    limit 1;

  v_cargada_hoy := v_carga.id is not null;
  if v_config.alcance = 'empresa' and p_empresa is null and v_cargada_hoy then
    v_cargada_hoy := not exists (
      select 1 from dominio.empresas e
       where e.organizacion_id = v_organizacion and e.activa
         and not exists (
           select 1 from dominio.cotizaciones c
            where c.organizacion_id = v_organizacion and c.empresa_id = e.id
              and c.cargada_en >= v_hoy_inicio and c.cargada_en < v_hoy_inicio + interval '1 day'
         )
    );
  end if;

  if not v_cargada_hoy then
    return jsonb_build_object('cargada_hoy', false, 'cargada_en', null, 'cargada_por', null, 'valor', null,
                              'aviso_activo', v_config.aviso_activo, 'alcance', v_config.alcance);
  end if;

  return jsonb_build_object(
    'cargada_hoy', true,
    'cargada_en', v_carga.cargada_en,
    'cargada_por', v_carga.cargada_por_nombre,
    'valor', v_carga.valor,
    'aviso_activo', v_config.aviso_activo,
    'alcance', v_config.alcance
  );
end;
$$;

comment on function public.cotizacion_del_dia(uuid) is
  'F-PRE-05/F-PRE-06: ¿hay una cotización CONFIRMADA hoy (America/Argentina/Buenos_Aires) para la organización o p_empresa? La pendiente no cuenta. Devuelve también aviso_activo y alcance. 42501 sin acceso a cotizacion_dolar.';

drop function if exists public.listar_cotizaciones(integer, text);

-- p_cursor: texto opaco que devuelve `siguiente_cursor` de la página anterior ("<cargada_en>|<id>").
create or replace function public.listar_cotizaciones(p_limite integer default 10, p_cursor text default null, p_empresa uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_organizacion uuid := (select private.organizacion_id());
  v_empresa uuid;
  v_limite integer := least(greatest(coalesce(p_limite, 10), 1), 100);
  v_cursor_en timestamptz;
  v_cursor_id uuid;
  v_filas jsonb;
  v_hay_mas boolean;
  v_siguiente text;
begin
  if v_organizacion is null
     or (select private.nivel_seccion('cotizacion_dolar')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver la cotización del dólar' using errcode = '42501';
  end if;
  v_empresa := private.empresa_de_cotizacion(v_organizacion, p_empresa);

  if p_cursor is not null then
    begin
      v_cursor_en := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
    exception when others then
      raise exception 'Cursor inválido' using errcode = '22023';
    end;
  end if;

  -- Una fila de más: sirve para saber si hay otra página y como «anterior» de la última fila devuelta.
  with pagina as (
    select c.id, c.cargada_en, c.valor, c.cargada_por_nombre, c.recalculo_aplicado, c.precios_recalculados, c.umbral_pct,
           lead(c.valor) over (order by c.cargada_en desc, c.id desc) as valor_previo,
           row_number() over (order by c.cargada_en desc, c.id desc) as posicion
      from dominio.cotizaciones c
     where c.organizacion_id = v_organizacion
       and c.empresa_id is not distinct from v_empresa
       and (v_cursor_en is null or (c.cargada_en, c.id) < (v_cursor_en, v_cursor_id))
     order by c.cargada_en desc, c.id desc
     limit v_limite + 1
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'cargada_en', p.cargada_en,
        'valor', p.valor,
        'variacion_pct', case when p.valor_previo > 0 then round((p.valor / p.valor_previo - 1) * 100, 4) end,
        'cargada_por_nombre', p.cargada_por_nombre,
        'recalculo_aplicado', p.recalculo_aplicado,
        'precios_recalculados', p.precios_recalculados,
        'umbral_pct', p.umbral_pct
      ) order by p.posicion
    ) filter (where p.posicion <= v_limite), '[]'::jsonb),
    coalesce(bool_or(p.posicion > v_limite), false),
    max(p.cargada_en::text || '|' || p.id::text) filter (where p.posicion = v_limite)
  into v_filas, v_hay_mas, v_siguiente
  from pagina p;

  return jsonb_build_object('filas', v_filas, 'siguiente_cursor', case when v_hay_mas then v_siguiente end);
end;
$$;

comment on function public.listar_cotizaciones(integer, text, uuid) is
  'F-PRE-04/F-PRE-06: historial de cotizaciones confirmadas (de la organización o de p_empresa), más nueva primero, paginado por cursor, con variación contra la fila anterior. 42501 sin acceso a cotizacion_dolar; 22023 con cursor inválido o sin empresa con alcance «empresa».';

revoke execute on function public.cargar_cotizacion(numeric, uuid) from public, anon;
revoke execute on function public.estado_cotizacion(uuid) from public, anon;
revoke execute on function public.previsualizar_cotizacion(uuid) from public, anon;
revoke execute on function public.confirmar_cotizacion(uuid) from public, anon;
revoke execute on function public.descartar_cotizacion(uuid) from public, anon;
revoke execute on function public.cotizacion_del_dia(uuid) from public, anon;
revoke execute on function public.listar_cotizaciones(integer, text, uuid) from public, anon;
grant execute on function public.cargar_cotizacion(numeric, uuid) to authenticated;
grant execute on function public.estado_cotizacion(uuid) to authenticated;
grant execute on function public.previsualizar_cotizacion(uuid) to authenticated;
grant execute on function public.confirmar_cotizacion(uuid) to authenticated;
grant execute on function public.descartar_cotizacion(uuid) to authenticated;
grant execute on function public.cotizacion_del_dia(uuid) to authenticated;
grant execute on function public.listar_cotizaciones(integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Alertas de Inicio: «Aviso en Inicio» y alcance (MSF-361)
-- ---------------------------------------------------------------------------

create or replace function public.recalcular_alertas_inicio(p_organizacion uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ahora timestamptz := now();
  v_hoy_inicio timestamptz :=
    date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_total integer;
begin
  if p_organizacion is null or not exists (select 1 from public.organizaciones where id = p_organizacion) then
    raise exception 'La organización no existe' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('alertas_inicio:' || p_organizacion::text, 0));

  delete from dominio.alertas_inicio where organizacion_id = p_organizacion;

  -- Stock (por organización): productos activos sin stock o bajo el mínimo.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en)
  select p_organizacion, null, e.estado, 'stock', count(*)::integer,
         case when count(*) = 1 then (array_agg(e.producto_id))[1] end, '/stock', v_ahora
    from public.stock_estados e
   where e.organizacion_id = p_organizacion
     and e.activo
     and e.estado in ('sin_stock', 'stock_bajo')
   group by e.estado;

  -- Consultas nuevas sin atender, por empresa activa.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, c.empresa_id, 'consultas_sin_atender', 'consultas', count(*)::integer, '/consultas', v_ahora
    from dominio.consultas c
    join dominio.empresas em on em.id = c.empresa_id and em.organizacion_id = c.organizacion_id and em.activa
   where c.organizacion_id = p_organizacion
     and c.estado = 'nueva'
   group by c.empresa_id;

  -- Dólar: sin carga confirmada hoy. No se genera si «Aviso en Inicio» está apagado (F-PRE-06); con alcance
  -- «empresa» aparece si alguna empresa activa no cargó el dólar de hoy.
  insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, enlace, calculada_en)
  select p_organizacion, null, 'dolar_sin_cargar', 'cotizacion_dolar', 1, '/cotizacion', v_ahora
   where (select k.aviso_activo from private.cotizacion_config(p_organizacion) k)
     and case
       when (select k.alcance from private.cotizacion_config(p_organizacion) k) = 'empresa' then exists (
         select 1 from dominio.empresas em
          where em.organizacion_id = p_organizacion and em.activa
            and not exists (
              select 1 from dominio.cotizaciones z
               where z.organizacion_id = p_organizacion and z.empresa_id = em.id
                 and z.cargada_en >= v_hoy_inicio
                 and z.cargada_en < v_hoy_inicio + interval '1 day'
            )
       )
       else not exists (
         select 1 from dominio.cotizaciones z
          where z.organizacion_id = p_organizacion and z.empresa_id is null
            and z.cargada_en >= v_hoy_inicio
            and z.cargada_en < v_hoy_inicio + interval '1 day'
       )
     end;

  -- Margen negativo por empresa, solo si el contrato de rentabilidad existe.
  if to_regclass('analitica.margen_producto_canal') is not null then
    execute $q$
      insert into dominio.alertas_inicio (organizacion_id, empresa_id, tipo, seccion, cantidad, referencia_id, enlace, calculada_en)
      select $1::uuid, m.empresa_id, 'margen_negativo', 'rentabilidad', count(*)::integer,
             case when count(*) = 1 then (array_agg(m.producto_id))[1] end, '/rentabilidad/productos', $2::timestamptz
        from analitica.margen_producto_canal m
       where m.organizacion_id = $1
         and m.estado = 'negativo'
       group by m.empresa_id
    $q$ using p_organizacion, v_ahora;
  end if;

  select count(*)::integer into v_total from dominio.alertas_inicio where organizacion_id = p_organizacion;

  insert into dominio.alertas_inicio_calculos (organizacion_id, calculada_en, alertas)
  values (p_organizacion, v_ahora, v_total)
  on conflict (organizacion_id) do update set calculada_en = excluded.calculada_en, alertas = excluded.alertas;

  return jsonb_build_object('alertas', v_total, 'calculada_en', v_ahora);
end;
$$;

revoke execute on function public.recalcular_alertas_inicio(uuid) from public, anon, authenticated;
grant execute on function public.recalcular_alertas_inicio(uuid) to service_role;
