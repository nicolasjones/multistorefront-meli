-- F-VTA-33 (MSF-349, spec 20261027-100000-ventas-mejoras, FR-021, FR-023, FR-025, FR-026):
-- RPC del cierre de caja.
--
-- Esquema (Principio VII): solo funciones; las tablas son `dominio.cierres_caja*` (migración
-- 20270115100000). Las RPC viven en `public` (superficie que llama la app), el helper en `private`.
--
-- · `private.caja_cerrada(empresa, fecha)`: true si hay un cierre `cerrada` de ese día. No la ejecuta
--   `authenticated`: la usa el disparador de cobros (20270115100200).
-- · `public.cerrar_caja(empresa, fecha)`: Administrador. Resume los cobros del día por forma de pago y
--   cuenta, guarda cierre + detalle. Idempotente: si ya está cerrada devuelve el cierre existente;
--   si estaba `reabierta`, la vuelve a cerrar rehaciendo el detalle.
-- · `public.reabrir_caja(cierre)`: Administrador. `cerrada` → `reabierta`; idempotente.
-- · `public.listar_cierres_caja(empresa, página, tamaño)`: lectura de `ventas`.
-- Eventos `caja.cerrada` / `caja.reabierta` en la misma transacción (FR-026).
--
-- Concurrencia: cerrar y registrar un cobro del mismo día toman el mismo candado transaccional
-- (`private.candado_caja`), así un cobro no se cuela entre el resumen y el cierre.
--
-- Migración aditiva. Reversión:
--   drop function public.listar_cierres_caja(uuid, integer, integer);
--   drop function public.reabrir_caja(uuid);
--   drop function public.cerrar_caja(uuid, date);
--   drop function private.caja_cerrada(uuid, date);
--   drop function private.candado_caja(uuid, date);

create or replace function private.candado_caja(p_empresa_id uuid, p_fecha date)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || '|' || p_fecha::text, 0));
$$;

revoke execute on function private.candado_caja(uuid, date) from public, anon, authenticated;

create or replace function private.caja_cerrada(p_empresa_id uuid, p_fecha date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from dominio.cierres_caja c
     where c.empresa_id = p_empresa_id
       and c.fecha = p_fecha
       and c.estado = 'cerrada'
  );
$$;

revoke execute on function private.caja_cerrada(uuid, date) from public, anon, authenticated;

-- ============================================================================
-- public.cerrar_caja (FR-021)
-- ============================================================================

create or replace function public.cerrar_caja(p_empresa_id uuid, p_fecha date)
returns dominio.cierres_caja
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cierre dominio.cierres_caja;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para cerrar la caja' using errcode = '42501';
  end if;
  if not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un administrador puede cerrar la caja' using errcode = '42501';
  end if;
  if p_empresa_id is null or p_fecha is null then
    raise exception 'La tienda y la fecha son obligatorias' using errcode = '22023';
  end if;
  if not exists (
    select 1 from dominio.empresas e
     where e.id = p_empresa_id and e.organizacion_id = v_org
  ) or p_empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'La tienda no existe o no es de tu organización' using errcode = '42501';
  end if;
  if p_fecha > current_date then
    raise exception 'No se puede cerrar la caja de un día futuro' using errcode = '22023';
  end if;

  perform private.candado_caja(p_empresa_id, p_fecha);

  select * into v_cierre
    from dominio.cierres_caja c
   where c.organizacion_id = v_org and c.empresa_id = p_empresa_id and c.fecha = p_fecha
     for update;

  -- Idempotente: un segundo cierre del mismo día devuelve el existente.
  if found and v_cierre.estado = 'cerrada' then
    return v_cierre;
  end if;

  if found then
    update dominio.cierres_caja
       set estado = 'cerrada', cerrado_por = v_actor, cerrado_en = now()
     where id = v_cierre.id
     returning * into v_cierre;
    delete from dominio.cierres_caja_detalle where cierre_id = v_cierre.id;
  else
    insert into dominio.cierres_caja (organizacion_id, empresa_id, fecha, estado, cerrado_por, cerrado_en)
    values (v_org, p_empresa_id, p_fecha, 'cerrada', v_actor, now())
    returning * into v_cierre;
  end if;

  insert into dominio.cierres_caja_detalle (organizacion_id, cierre_id, forma_pago_id, cuenta_cobro_id, total)
  select v_org, v_cierre.id, cc.forma_pago_id, cc.cuenta_cobro_id, sum(cc.importe)
    from dominio.cobros_comprobante cc
   where cc.organizacion_id = v_org
     and cc.empresa_id = p_empresa_id
     and cc.registrado_en::date = p_fecha
   group by cc.forma_pago_id, cc.cuenta_cobro_id;

  perform private.registrar_actividad(
    'caja.cerrada',
    format('Cerró la caja del %s', to_char(p_fecha, 'DD/MM/YYYY')),
    p_empresa_id
  );

  return v_cierre;
end;
$$;

revoke execute on function public.cerrar_caja(uuid, date) from public, anon;
grant execute on function public.cerrar_caja(uuid, date) to authenticated;

-- ============================================================================
-- public.reabrir_caja (FR-023)
-- ============================================================================

create or replace function public.reabrir_caja(p_cierre_id uuid)
returns dominio.cierres_caja
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_actor uuid := (select auth.uid());
  v_cierre dominio.cierres_caja;
begin
  if v_org is null or v_actor is null then
    raise exception 'Necesitás una sesión con organización para reabrir la caja' using errcode = '42501';
  end if;
  if not (select private.es_administrador_de(v_org)) then
    raise exception 'Solo un administrador puede reabrir la caja' using errcode = '42501';
  end if;

  select * into v_cierre
    from dominio.cierres_caja c
   where c.id = p_cierre_id and c.organizacion_id = v_org
     for update;
  if not found or v_cierre.empresa_id not in (select private.empresas_accesibles()) then
    raise exception 'El cierre no existe' using errcode = 'P0002';
  end if;

  perform private.candado_caja(v_cierre.empresa_id, v_cierre.fecha);

  -- Idempotente: ya reabierta devuelve el cierre tal cual.
  if v_cierre.estado <> 'cerrada' then
    return v_cierre;
  end if;

  update dominio.cierres_caja
     set estado = 'reabierta', reabierto_por = v_actor, reabierto_en = now()
   where id = v_cierre.id
   returning * into v_cierre;

  perform private.registrar_actividad(
    'caja.reabierta',
    format('Reabrió la caja del %s', to_char(v_cierre.fecha, 'DD/MM/YYYY')),
    v_cierre.empresa_id
  );

  return v_cierre;
end;
$$;

revoke execute on function public.reabrir_caja(uuid) from public, anon;
grant execute on function public.reabrir_caja(uuid) to authenticated;

-- ============================================================================
-- public.listar_cierres_caja (FR-024, FR-025)
-- ============================================================================

create or replace function public.listar_cierres_caja(
  p_empresa_id uuid default null,
  p_pagina integer default 1,
  p_tamano integer default 10
)
returns table (
  id uuid,
  empresa_id uuid,
  empresa text,
  fecha date,
  estado text,
  total numeric,
  cerrado_por uuid,
  cerrado_en timestamptz,
  detalle jsonb,
  filas bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select private.organizacion_id());
  v_tamano integer := least(greatest(coalesce(p_tamano, 10), 1), 100);
  v_pagina integer := greatest(coalesce(p_pagina, 1), 1);
begin
  if v_org is null then
    raise exception 'Necesitás una sesión con organización' using errcode = '42501';
  end if;

  -- La RLS de las tablas recorta por organización, empresa accesible y sección `ventas`.
  return query
  select c.id, c.empresa_id, e.nombre::text, c.fecha, c.estado,
         coalesce((select sum(d.total) from dominio.cierres_caja_detalle d where d.cierre_id = c.id), 0)::numeric,
         c.cerrado_por, c.cerrado_en,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'forma_pago_id', d.forma_pago_id,
                    'forma_pago', f.nombre,
                    'cuenta_cobro_id', d.cuenta_cobro_id,
                    'cuenta_cobro', cu.nombre,
                    'total', d.total)
                  order by f.nombre, cu.nombre nulls first)
             from dominio.cierres_caja_detalle d
             join dominio.formas_pago f on f.id = d.forma_pago_id
             left join dominio.cuentas_cobro cu on cu.id = d.cuenta_cobro_id
            where d.cierre_id = c.id
         ), '[]'::jsonb),
         count(*) over ()
    from dominio.cierres_caja c
    join dominio.empresas e on e.id = c.empresa_id
   where c.organizacion_id = v_org
     and (p_empresa_id is null or c.empresa_id = p_empresa_id)
   order by c.fecha desc, e.nombre, c.id
   limit v_tamano offset (v_pagina - 1) * v_tamano;
end;
$$;

revoke execute on function public.listar_cierres_caja(uuid, integer, integer) from public, anon;
grant execute on function public.listar_cierres_caja(uuid, integer, integer) to authenticated;
