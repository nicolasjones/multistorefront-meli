-- MSF-187 / MSF-953 / MSF-954 / MSF-957: RPC de comisiones de técnicos (sobre 20270515010000).
--
--  * `public.mis_comisiones(desde, hasta)`: lo del propio técnico (el usuario sale del JWT, nunca de un parámetro), con
--    total y detalle por reparación; nunca devuelve costos internos ni márgenes ni lo de otros técnicos. Exige al menos
--    `lectura` en `service_tecnico`; NO exige `ver_comisiones` ni `ver_costos`.
--  * `public.comisiones_resumen` y `public.comisiones_de_tecnico`: todos los técnicos; exigen `ver_comisiones` (que no
--    implica ni es implicado por `ver_costos`) y se limitan a las tiendas accesibles de quien consulta.
--  * `public.guardar_regla_comision` y `public.listar_reglas_comision`: reglas de comisión (`edicion` + `ver_comisiones`).
--  * `public.obtener_reparto_comision` y `public.guardar_reparto_comision`: reparto entre N técnicos con porcentajes que
--    suman 100 (validado acá y por un disparador diferido). Antes de la entrega alcanza `edicion`; después de la entrega
--    exige `ver_comisiones` + motivo. Cada cambio queda en `reparacion_comision_historial` (antes y después; solo con
--    `ver_comisiones`) y la Actividad recibe un evento neutro, sin nombres ni porcentajes.
--  * Un solo cálculo: `private.comisiones_calculadas` alimenta resumen y detalle (resumen = suma del detalle).
--
-- Los errores de negocio siguen docs/errores-negocio-postgrest.md: validaciones `22023` con `hint` del campo, permisos
-- `42501`, inexistente o fuera de alcance `PT404` (mismo mensaje, sin oráculo de existencia), estado `55000`, duplicado `23505`.
--
-- Todas las `public.*` son `security definer`, con `search_path` vacío, sin SQL dinámico y con `revoke ... from public, anon`.
--
-- Migración aditiva (create or replace). Reversión (migración posterior):
--   drop function public.guardar_reparto_comision(uuid, jsonb, text); drop function public.obtener_reparto_comision(uuid);
--   drop function public.listar_reglas_comision(); drop function public.guardar_regla_comision(uuid, numeric, date);
--   drop function public.comisiones_de_tecnico(uuid, date, date); drop function public.comisiones_resumen(date, date);
--   drop function public.mis_comisiones(date, date); drop function private.comisiones_detalle_json(uuid, uuid, date, date, boolean);
--   drop function private.comisiones_calculadas(uuid, date, date, uuid); drop function private.nombre_de_tecnico(uuid);
--   drop function private.validar_periodo_comisiones(date, date);

create or replace function private.nombre_de_tecnico(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Mismo criterio que `tecnicos_de_service`: nombre del perfil o un texto neutro (nunca el correo).
  select case when p_user is null then 'Técnico dado de baja'
    else coalesce(
      (select nullif(btrim(concat_ws(' ', p.nombre, p.apellido)), '')
         from public.perfiles_usuario p where p.user_id = p_user),
      'Técnico sin nombre')
  end;
$$;

revoke execute on function private.nombre_de_tecnico(uuid) from public, anon, authenticated;

create or replace function private.validar_periodo_comisiones(p_desde date, p_hasta date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_desde is null then
    raise exception 'Indicá desde qué fecha' using errcode = '22023', hint = 'desde';
  end if;
  if p_hasta is null then
    raise exception 'Indicá hasta qué fecha' using errcode = '22023', hint = 'hasta';
  end if;
  if p_desde > p_hasta then
    raise exception 'La fecha desde no puede ser posterior a la fecha hasta' using errcode = '22023', hint = 'desde';
  end if;
  if p_hasta - p_desde > 365 then
    raise exception 'El período no puede superar 366 días' using errcode = '22023', hint = 'hasta';
  end if;
end;
$$;

revoke execute on function private.validar_periodo_comisiones(date, date) from public, anon, authenticated;

-- Una fila por (reparación entregada y no anulada en el período, técnico del reparto). La base es la mano de obra al cliente
-- (sin IVA); no lee costos internos. La regla se resuelve por la fecha de ENTREGA: del técnico y, si no hay, la general.
create or replace function private.comisiones_calculadas(p_org uuid, p_desde date, p_hasta date, p_tecnico uuid default null)
returns table (
  reparacion_id uuid, empresa_id uuid, numero integer, modelo_id uuid, entrega_real date, tecnico_id uuid,
  base numeric, porcentaje_reparto numeric, porcentaje_regla numeric, comision numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with rep as (
    select r.id, r.empresa_id, r.numero, r.modelo_id, r.entrega_real, r.tecnico_id as asignado,
           coalesce((select sum(i.subtotal) from dominio.reparacion_items i
                      where i.reparacion_id = r.id and i.organizacion_id = r.organizacion_id and i.tipo = 'mano_obra'), 0) as base
      from dominio.reparaciones r
     where r.organizacion_id = p_org and r.anulada_en is null and r.entrega_real between p_desde and p_hasta
  ),
  repartos as (
    select rep.id, rep.empresa_id, rep.numero, rep.modelo_id, rep.entrega_real, rep.base, x.tecnico_id, x.porcentaje
      from rep
      cross join lateral (
        select t.tecnico_id, t.porcentaje
          from dominio.reparacion_comision_reparto t
         where t.reparacion_id = rep.id and t.organizacion_id = p_org
        union all
        -- Sin reparto guardado: 100 % al técnico asignado.
        select rep.asignado, 100::numeric
         where rep.asignado is not null
           and not exists (select 1 from dominio.reparacion_comision_reparto t
                            where t.reparacion_id = rep.id and t.organizacion_id = p_org)
      ) x
  )
  select p.id, p.empresa_id, p.numero, p.modelo_id, p.entrega_real, p.tecnico_id, p.base, p.porcentaje, g.porcentaje,
         round(p.base * coalesce(g.porcentaje, 0) / 100 * p.porcentaje / 100, 2)
    from repartos p
    left join lateral (
      select c.porcentaje
        from dominio.comision_reglas c
       where c.organizacion_id = p_org
         and c.vigente_desde <= p.entrega_real
         and (c.tecnico_id = p.tecnico_id or c.tecnico_id is null)
       order by (c.tecnico_id is not null) desc, c.vigente_desde desc
       limit 1
    ) g on true
   where p_tecnico is null or p.tecnico_id = p_tecnico;
$$;

revoke execute on function private.comisiones_calculadas(uuid, date, date, uuid) from public, anon, authenticated;

-- Detalle por reparación de un técnico (tope de filas; el total y el conteo salen de TODAS las filas).
create or replace function private.comisiones_detalle_json(
  p_org uuid, p_tecnico uuid, p_desde date, p_hasta date, p_solo_accesibles boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from private.comisiones_calculadas(p_org, p_desde, p_hasta, p_tecnico) k
     where not p_solo_accesibles or k.empresa_id in (select private.empresas_accesibles())
  ),
  filas as (
    select c.*, e.nombre as empresa, m.equipo || ' ' || m.modelo as equipo
      from c
      left join dominio.empresas e on e.id = c.empresa_id
      left join dominio.modelos_equipo m on m.id = c.modelo_id
     order by c.entrega_real desc, c.numero desc
     limit 1000
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'total', coalesce((select sum(comision) from c), 0),
    'reparaciones', (select count(*) from c),
    'sin_regla', (select count(*) from c where porcentaje_regla is null),
    'truncado', (select count(*) from c) > 1000,
    'filas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reparacion_id', f.reparacion_id,
        'codigo', private.codigo_reparacion(f.numero),
        'empresa', f.empresa,
        'equipo', f.equipo,
        'entrega_real', f.entrega_real,
        'base', f.base,
        'porcentaje_reparto', f.porcentaje_reparto,
        'porcentaje_regla', f.porcentaje_regla,
        'comision', f.comision
      ) order by f.entrega_real desc, f.numero desc)
      from filas f), '[]'::jsonb)
  );
$$;

revoke execute on function private.comisiones_detalle_json(uuid, uuid, date, date, boolean) from public, anon, authenticated;

-- «Mis comisiones»: el técnico es SIEMPRE quien llama (JWT).
create or replace function public.mis_comisiones(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
begin
  if v_org is null or v_uid is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver comisiones' using errcode = '42501';
  end if;
  perform private.validar_periodo_comisiones(p_desde, p_hasta);
  return private.comisiones_detalle_json(v_org, v_uid, p_desde, p_hasta, false);
end;
$$;

comment on function public.mis_comisiones(date, date) is
  'MSF-954: comisiones del propio técnico (usuario del JWT) en el período, con total y detalle por reparación. Sin costos ni márgenes ni datos de otros técnicos.';

revoke execute on function public.mis_comisiones(date, date) from public, anon;
grant execute on function public.mis_comisiones(date, date) to authenticated;

create or replace function public.comisiones_resumen(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or not (select private.puede_accion('service_tecnico', 'ver_comisiones')) then
    raise exception 'Tu rol no puede ver las comisiones del equipo' using errcode = '42501';
  end if;
  perform private.validar_periodo_comisiones(p_desde, p_hasta);
  return (
    with c as (
      select * from private.comisiones_calculadas(v_org, p_desde, p_hasta) k
       where k.empresa_id in (select private.empresas_accesibles())
    ),
    por_tecnico as (
      select c.tecnico_id,
             count(distinct c.reparacion_id) as reparaciones,
             round(sum(c.base * c.porcentaje_reparto / 100), 2) as base,
             sum(c.comision) as comision,
             count(*) filter (where c.porcentaje_regla is null) as sin_regla
        from c group by c.tecnico_id
    )
    select jsonb_build_object(
      'desde', p_desde,
      'hasta', p_hasta,
      'total', coalesce((select sum(comision) from c), 0),
      'reparaciones', (select count(distinct reparacion_id) from c),
      'sin_regla', (select count(*) from c where porcentaje_regla is null),
      'tecnicos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'tecnico_id', t.tecnico_id,
          'nombre', private.nombre_de_tecnico(t.tecnico_id),
          'reparaciones', t.reparaciones,
          'base', t.base,
          'comision', t.comision,
          'sin_regla', t.sin_regla
        ) order by t.comision desc, private.nombre_de_tecnico(t.tecnico_id), t.tecnico_id)
        from por_tecnico t), '[]'::jsonb)
    )
  );
end;
$$;

comment on function public.comisiones_resumen(date, date) is
  'MSF-957: comisiones de todos los técnicos por período (tiendas accesibles). Exige ver_comisiones, que no depende de ver_costos.';

revoke execute on function public.comisiones_resumen(date, date) from public, anon;
grant execute on function public.comisiones_resumen(date, date) to authenticated;

create or replace function public.comisiones_de_tecnico(p_tecnico uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
begin
  if v_org is null or (select auth.uid()) is null
     or not (select private.puede_accion('service_tecnico', 'ver_comisiones')) then
    raise exception 'Tu rol no puede ver las comisiones del equipo' using errcode = '42501';
  end if;
  if p_tecnico is null then
    raise exception 'Elegí un técnico' using errcode = '22023', hint = 'tecnico_id';
  end if;
  perform private.validar_periodo_comisiones(p_desde, p_hasta);
  return private.comisiones_detalle_json(v_org, p_tecnico, p_desde, p_hasta, true);
end;
$$;

comment on function public.comisiones_de_tecnico(uuid, date, date) is
  'MSF-957: detalle por reparación de un técnico en el período (tiendas accesibles). Exige ver_comisiones; la suma del detalle es la fila del resumen.';

revoke execute on function public.comisiones_de_tecnico(uuid, date, date) from public, anon;
grant execute on function public.comisiones_de_tecnico(uuid, date, date) to authenticated;

-- Reglas de comisión (solo se agregan).
create or replace function public.guardar_regla_comision(p_tecnico uuid, p_porcentaje numeric, p_vigente_desde date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_id uuid;
begin
  if v_org is null or v_uid is null
     or (select private.nivel_seccion('service_tecnico')) <> 'edicion'
     or not (select private.puede_accion('service_tecnico', 'ver_comisiones')) then
    raise exception 'Tu rol no puede cargar reglas de comisión' using errcode = '42501';
  end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 then
    raise exception 'El porcentaje tiene que estar entre 0 y 100' using errcode = '22023', hint = 'porcentaje';
  end if;
  if round(p_porcentaje, 2) <> p_porcentaje then
    raise exception 'El porcentaje admite hasta dos decimales' using errcode = '22023', hint = 'porcentaje';
  end if;
  -- Desde mañana como pronto: una entrega nunca es futura, así que una regla nueva no puede cambiar lo ya entregado.
  if p_vigente_desde is null or p_vigente_desde < v_hoy + 1 or p_vigente_desde > v_hoy + 90 then
    raise exception 'La vigencia tiene que estar entre mañana y 90 días adelante' using errcode = '22023', hint = 'vigente_desde';
  end if;
  if p_tecnico is not null and not exists (
    select 1 from public.usuarios_organizacion u where u.user_id = p_tecnico and u.organizacion_id = v_org
  ) then
    raise exception 'El técnico no pertenece a la organización' using errcode = '22023', hint = 'tecnico_id';
  end if;

  begin
    insert into dominio.comision_reglas (organizacion_id, tecnico_id, porcentaje, vigente_desde, creado_por)
    values (v_org, p_tecnico, p_porcentaje, p_vigente_desde, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.' using errcode = '23505', hint = 'vigente_desde';
  end;

  -- La Actividad se lee con otro permiso: el evento no lleva porcentaje ni técnico (la regla se ve con ver_comisiones).
  perform private.registrar_actividad('comision.regla_guardada', 'Cargó una regla de comisión', null);

  return jsonb_build_object('id', v_id, 'tecnico_id', p_tecnico, 'porcentaje', p_porcentaje, 'vigente_desde', p_vigente_desde);
end;
$$;

comment on function public.guardar_regla_comision(uuid, numeric, date) is
  'MSF-187: agrega una regla de comisión (porcentaje sobre la mano de obra; técnico nulo = general) que rige desde mañana como pronto, por fecha de entrega. Solo se agregan. Exige edición y ver_comisiones.';

revoke execute on function public.guardar_regla_comision(uuid, numeric, date) from public, anon;
grant execute on function public.guardar_regla_comision(uuid, numeric, date) to authenticated;

create or replace function public.listar_reglas_comision()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if v_org is null or (select auth.uid()) is null
     or not (select private.puede_accion('service_tecnico', 'ver_comisiones')) then
    raise exception 'Tu rol no puede ver las reglas de comisión' using errcode = '42501';
  end if;
  return coalesce((
    with r as (
      select c.*,
             row_number() over (
               partition by coalesce(c.tecnico_id, '00000000-0000-0000-0000-000000000000'::uuid), (c.vigente_desde <= v_hoy)
               order by c.vigente_desde desc) as orden_vigente
        from dominio.comision_reglas c
       where c.organizacion_id = v_org
    )
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'tecnico_id', r.tecnico_id,
      'tecnico', case when r.tecnico_id is null then null else private.nombre_de_tecnico(r.tecnico_id) end,
      'porcentaje', r.porcentaje,
      'vigente_desde', r.vigente_desde,
      'estado', case when r.vigente_desde > v_hoy then 'futura' when r.orden_vigente = 1 then 'vigente' else 'reemplazada' end
    ) order by (r.tecnico_id is not null), private.nombre_de_tecnico(r.tecnico_id), r.vigente_desde desc, r.id)
    from r), '[]'::jsonb);
end;
$$;

comment on function public.listar_reglas_comision() is
  'MSF-187: reglas de comisión de la organización con su estado (vigente, futura o reemplazada). Exige ver_comisiones.';

revoke execute on function public.listar_reglas_comision() from public, anon;
grant execute on function public.listar_reglas_comision() to authenticated;

-- Reparto de la comisión de una reparación.
create or replace function public.obtener_reparto_comision(p_reparacion uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_rep dominio.reparaciones;
  v_filas jsonb;
  v_personalizado boolean;
begin
  if v_org is null or (select auth.uid()) is null
     or (select private.nivel_seccion('service_tecnico')) not in ('lectura', 'edicion') then
    raise exception 'Tu rol no puede ver el reparto de comisión' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org;
  if not found or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tecnico_id', t.tecnico_id, 'nombre', private.nombre_de_tecnico(t.tecnico_id), 'porcentaje', t.porcentaje
         ) order by t.porcentaje desc, private.nombre_de_tecnico(t.tecnico_id), t.id), '[]'::jsonb),
         count(*) > 0
    into v_filas, v_personalizado
    from dominio.reparacion_comision_reparto t
   where t.reparacion_id = v_rep.id;

  if not v_personalizado and v_rep.tecnico_id is not null then
    v_filas := jsonb_build_array(jsonb_build_object(
      'tecnico_id', v_rep.tecnico_id, 'nombre', private.nombre_de_tecnico(v_rep.tecnico_id), 'porcentaje', 100));
  end if;

  return jsonb_build_object(
    'reparacion_id', v_rep.id,
    -- Congelado: la reparación ya se entregó; cambiarlo exige ver_comisiones y un motivo.
    'congelado', v_rep.entrega_real is not null,
    'anulada', v_rep.anulada_en is not null,
    'por_defecto', not v_personalizado,
    'puede_editar', v_rep.anulada_en is null
      and (select private.nivel_seccion('service_tecnico')) = 'edicion'
      and (v_rep.entrega_real is null or (select private.puede_accion('service_tecnico', 'ver_comisiones'))),
    'reparto', v_filas
  );
end;
$$;

comment on function public.obtener_reparto_comision(uuid) is
  'MSF-953: reparto de la comisión de una reparación (sin filas guardadas, 100 % al técnico asignado). Sin importes ni costos.';

revoke execute on function public.obtener_reparto_comision(uuid) from public, anon;
grant execute on function public.obtener_reparto_comision(uuid) to authenticated;

create or replace function public.guardar_reparto_comision(p_reparacion uuid, p_reparto jsonb, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_uid uuid := (select auth.uid());
  v_rep dominio.reparaciones;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_elem jsonb;
  v_tecnico uuid;
  v_pct numeric;
  v_suma numeric := 0;
  v_vistos uuid[] := '{}';
  v_antes jsonb;
  v_despues jsonb;
  v_entregada boolean;
begin
  if v_org is null or v_uid is null or (select private.nivel_seccion('service_tecnico')) <> 'edicion' then
    raise exception 'Tu rol no puede cambiar el reparto de comisión' using errcode = '42501';
  end if;
  select * into v_rep from dominio.reparaciones r where r.id = p_reparacion and r.organizacion_id = v_org for update;
  if not found or not exists (select 1 from private.empresas_accesibles() a(id) where a.id = v_rep.empresa_id) then
    raise exception 'La reparación no existe' using errcode = 'PT404';
  end if;
  if v_rep.anulada_en is not null then
    raise exception 'La reparación está anulada y no se puede modificar' using errcode = '55000';
  end if;
  v_entregada := v_rep.entrega_real is not null;
  if v_entregada and not (select private.puede_accion('service_tecnico', 'ver_comisiones')) then
    raise exception 'La reparación ya fue entregada: solo quien ve comisiones puede cambiar el reparto' using errcode = '42501';
  end if;

  if p_reparto is null or jsonb_typeof(p_reparto) <> 'array' then
    raise exception 'El reparto tiene que ser una lista de técnicos con su porcentaje' using errcode = '22023', hint = 'reparto';
  end if;
  if jsonb_array_length(p_reparto) > 10 then
    raise exception 'El reparto admite hasta 10 técnicos' using errcode = '22023', hint = 'reparto';
  end if;
  -- Lista vacía: vuelve al reparto por defecto (100 % al técnico asignado). Una entregada conserva siempre un reparto.
  if jsonb_array_length(p_reparto) = 0 and v_entregada then
    raise exception 'Una reparación entregada necesita un reparto que sume 100 %%' using errcode = '22023', hint = 'reparto';
  end if;
  if v_entregada and (length(v_motivo) < 3 or length(v_motivo) > 500) then
    raise exception 'Indicá el motivo del cambio (entre 3 y 500 caracteres)' using errcode = '22023', hint = 'motivo';
  end if;

  for v_elem in select e from jsonb_array_elements(p_reparto) e loop
    if jsonb_typeof(v_elem) <> 'object'
       or jsonb_typeof(v_elem -> 'tecnico_id') is distinct from 'string'
       or (v_elem ->> 'tecnico_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_elem -> 'porcentaje') is distinct from 'number' then
      raise exception 'Cada línea del reparto lleva un técnico y un porcentaje' using errcode = '22023', hint = 'reparto';
    end if;
    v_tecnico := (v_elem ->> 'tecnico_id')::uuid;
    v_pct := (v_elem ->> 'porcentaje')::numeric;
    if v_pct <= 0 or v_pct > 100 or round(v_pct, 2) <> v_pct then
      raise exception 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo' using errcode = '22023', hint = 'reparto';
    end if;
    if v_tecnico = any (v_vistos) then
      raise exception 'Un técnico no puede repetirse en el reparto' using errcode = '22023', hint = 'reparto';
    end if;
    if not exists (select 1 from public.usuarios_organizacion u where u.user_id = v_tecnico and u.organizacion_id = v_org) then
      raise exception 'El técnico no pertenece a la organización' using errcode = '22023', hint = 'reparto';
    end if;
    v_vistos := v_vistos || v_tecnico;
    v_suma := v_suma + v_pct;
  end loop;
  if jsonb_array_length(p_reparto) > 0 and v_suma <> 100 then
    raise exception 'Los porcentajes del reparto tienen que sumar 100 %%' using errcode = '22023', hint = 'reparto';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('tecnico', private.nombre_de_tecnico(t.tecnico_id), 'porcentaje', t.porcentaje)
                            order by t.porcentaje desc, t.id), '[]'::jsonb)
    into v_antes from dominio.reparacion_comision_reparto t where t.reparacion_id = v_rep.id;
  if jsonb_array_length(v_antes) = 0 and v_rep.tecnico_id is not null then
    v_antes := jsonb_build_array(jsonb_build_object('tecnico', private.nombre_de_tecnico(v_rep.tecnico_id), 'porcentaje', 100));
  end if;

  delete from dominio.reparacion_comision_reparto where reparacion_id = v_rep.id;
  insert into dominio.reparacion_comision_reparto (organizacion_id, reparacion_id, tecnico_id, porcentaje, creado_por)
  select v_org, v_rep.id, (e ->> 'tecnico_id')::uuid, (e ->> 'porcentaje')::numeric, v_uid
    from jsonb_array_elements(p_reparto) e;

  if jsonb_array_length(p_reparto) = 0 then
    v_despues := case when v_rep.tecnico_id is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('tecnico', private.nombre_de_tecnico(v_rep.tecnico_id), 'porcentaje', 100)) end;
  else
    select jsonb_agg(jsonb_build_object('tecnico', private.nombre_de_tecnico((e ->> 'tecnico_id')::uuid), 'porcentaje', (e ->> 'porcentaje')::numeric)
                     order by (e ->> 'porcentaje')::numeric desc, e ->> 'tecnico_id')
      into v_despues from jsonb_array_elements(p_reparto) e;
  end if;

  -- Antes y después (nombres y porcentajes) y motivo van al historial propio, que solo lee quien tiene ver_comisiones; la
  -- Actividad, que se lee con otro permiso, recibe un evento neutro.
  insert into dominio.reparacion_comision_historial (organizacion_id, reparacion_id, usuario_id, entregada, motivo, antes, despues)
  values (v_org, v_rep.id, v_uid, v_entregada, case when v_entregada then v_motivo else null end, v_antes, v_despues);
  perform private.registrar_actividad(
    'comision.reparto_cambiado',
    format('Cambió el reparto de comisión de %s', private.codigo_reparacion(v_rep.numero)),
    v_rep.empresa_id);

  return public.obtener_reparto_comision(v_rep.id);
end;
$$;

comment on function public.guardar_reparto_comision(uuid, jsonb, text) is
  'MSF-953: reemplaza el reparto de la comisión de una reparación entre N técnicos (porcentajes que suman 100). Antes de la entrega exige edición; después, ver_comisiones y motivo. Registra antes y después en el historial de reparto (solo con ver_comisiones).';

revoke execute on function public.guardar_reparto_comision(uuid, jsonb, text) from public, anon;
grant execute on function public.guardar_reparto_comision(uuid, jsonb, text) to authenticated;
