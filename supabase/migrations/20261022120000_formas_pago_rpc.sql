-- F-VTA-01 (MSF-210, FR-002): RPC de escritura de `dominio.formas_pago`.
-- `security invoker`: la escritura pasa por la RLS de la tabla (solo Administrador). Cada RPC
-- además corta antes con un mensaje claro (42501) y valida los valores permitidos (22023).
--
--   crear_forma_pago(p_empresa_ids, ...)   alta multiempresa: UN ítem independiente por empresa
--                                          marcada, todo en una transacción (si una empresa ya
--                                          tiene ese nombre, no se crea ninguna: 23505).
--   actualizar_forma_pago(...)             bloqueo optimista por `updated_at` (40001 ante conflicto).
--   cambiar_estado_forma_pago(id, activo)  idempotente.
--
-- Migración aditiva (funciones nuevas). Reversión (migración posterior):
--   drop function public.crear_forma_pago(uuid[], text, text, boolean, boolean, text, integer, boolean);
--   drop function public.actualizar_forma_pago(uuid, timestamptz, text, text, boolean, boolean, text, integer, boolean);
--   drop function public.cambiar_estado_forma_pago(uuid, boolean);

create or replace function public.crear_forma_pago(
  p_empresa_ids uuid[],
  p_nombre text,
  p_tipo text,
  p_exige_cuenta_cobro boolean,
  p_genera_deuda boolean,
  p_estado_inicial text,
  p_orden integer default 1,
  p_activo boolean default true
)
returns setof dominio.formas_pago
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_empresas uuid[];
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede crear formas de pago' using errcode = '42501';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Completá el nombre' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('efectivo', 'transferencia', 'contrarreembolso', 'tarjeta', 'otro') then
    raise exception 'El tipo de forma de pago no es válido' using errcode = '22023';
  end if;
  if p_estado_inicial is null or p_estado_inicial not in ('pendiente', 'aceptado', 'cobrado', 'deuda') then
    raise exception 'El estado inicial del comprobante no es válido' using errcode = '22023';
  end if;
  if p_exige_cuenta_cobro is null or p_genera_deuda is null or p_activo is null then
    raise exception 'Faltan datos de la forma de pago' using errcode = '22023';
  end if;
  if p_orden is null or p_orden < 0 or p_orden > 9999 then
    raise exception 'El orden debe estar entre 0 y 9999' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct e), '{}'::uuid[]) into v_empresas
    from unnest(coalesce(p_empresa_ids, '{}'::uuid[])) as e
   where e is not null;
  if cardinality(v_empresas) = 0 then
    raise exception 'Elegí al menos una empresa' using errcode = '22023';
  end if;
  -- Todas deben ser empresas accesibles de la organización de la sesión.
  if exists (select 1 from unnest(v_empresas) as e where e not in (select private.empresas_accesibles())) then
    raise exception 'Alguna empresa no pertenece a tu organización' using errcode = '42501';
  end if;

  -- RETURN QUERY no admite INSERT ... RETURNING directo: se envuelve en un CTE.
  return query
  with nuevas as (
    insert into dominio.formas_pago (empresa_id, nombre, tipo, exige_cuenta_cobro, genera_deuda, estado_inicial, orden, activo)
    select e, p_nombre, p_tipo, p_exige_cuenta_cobro, p_genera_deuda, p_estado_inicial, p_orden, p_activo
      from unnest(v_empresas) as e
    returning *
  )
  select * from nuevas;
end;
$$;

comment on function public.crear_forma_pago(uuid[], text, text, boolean, boolean, text, integer, boolean) is
  'F-VTA-01: alta de una forma de pago; crea un ítem independiente por empresa de la lista, en una sola transacción. Solo Administrador.';

revoke execute on function public.crear_forma_pago(uuid[], text, text, boolean, boolean, text, integer, boolean) from public, anon;
grant execute on function public.crear_forma_pago(uuid[], text, text, boolean, boolean, text, integer, boolean) to authenticated;


create or replace function public.actualizar_forma_pago(
  p_id uuid,
  p_actualizado_en timestamptz,
  p_nombre text,
  p_tipo text,
  p_exige_cuenta_cobro boolean,
  p_genera_deuda boolean,
  p_estado_inicial text,
  p_orden integer,
  p_activo boolean
)
returns dominio.formas_pago
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actual dominio.formas_pago;
  v_fila dominio.formas_pago;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede editar formas de pago' using errcode = '42501';
  end if;

  if btrim(coalesce(p_nombre, '')) = '' then
    raise exception 'Completá el nombre' using errcode = '22023';
  end if;
  if length(btrim(p_nombre)) > 100 then
    raise exception 'El nombre admite hasta 100 caracteres' using errcode = '22023';
  end if;
  if p_tipo is null or p_tipo not in ('efectivo', 'transferencia', 'contrarreembolso', 'tarjeta', 'otro') then
    raise exception 'El tipo de forma de pago no es válido' using errcode = '22023';
  end if;
  if p_estado_inicial is null or p_estado_inicial not in ('pendiente', 'aceptado', 'cobrado', 'deuda') then
    raise exception 'El estado inicial del comprobante no es válido' using errcode = '22023';
  end if;
  if p_exige_cuenta_cobro is null or p_genera_deuda is null or p_activo is null then
    raise exception 'Faltan datos de la forma de pago' using errcode = '22023';
  end if;
  if p_orden is null or p_orden < 0 or p_orden > 9999 then
    raise exception 'El orden debe estar entre 0 y 9999' using errcode = '22023';
  end if;

  -- Serializa ediciones concurrentes; RLS acota a la organización y a las empresas accesibles.
  select * into v_actual from dominio.formas_pago where id = p_id for update;
  if not found then
    raise exception 'La forma de pago no existe' using errcode = 'P0002';
  end if;
  if p_actualizado_en is null or v_actual.updated_at <> p_actualizado_en then
    raise exception 'La forma de pago fue modificada por otra persona' using errcode = '40001';
  end if;

  update dominio.formas_pago
     set nombre = p_nombre,
         tipo = p_tipo,
         exige_cuenta_cobro = p_exige_cuenta_cobro,
         genera_deuda = p_genera_deuda,
         estado_inicial = p_estado_inicial,
         orden = p_orden,
         activo = p_activo
   where id = p_id
  returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.actualizar_forma_pago(uuid, timestamptz, text, text, boolean, boolean, text, integer, boolean) is
  'F-VTA-01: edita una forma de pago con bloqueo optimista por updated_at (40001 ante conflicto). Solo Administrador; la edición aplica solo a la empresa de la fila.';

revoke execute on function public.actualizar_forma_pago(uuid, timestamptz, text, text, boolean, boolean, text, integer, boolean) from public, anon;
grant execute on function public.actualizar_forma_pago(uuid, timestamptz, text, text, boolean, boolean, text, integer, boolean) to authenticated;


create or replace function public.cambiar_estado_forma_pago(p_id uuid, p_activo boolean)
returns dominio.formas_pago
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fila dominio.formas_pago;
begin
  if (select private.organizacion_id()) is null
     or not (select private.es_administrador_de((select private.organizacion_id()))) then
    raise exception 'Solo el Administrador puede cambiar el estado de las formas de pago' using errcode = '42501';
  end if;
  if p_activo is null then
    raise exception 'El estado es obligatorio' using errcode = '22023';
  end if;

  select * into v_fila from dominio.formas_pago where id = p_id for update;
  if not found then
    raise exception 'La forma de pago no existe' using errcode = 'P0002';
  end if;
  if v_fila.activo = p_activo then
    return v_fila;
  end if;

  update dominio.formas_pago set activo = p_activo where id = p_id returning * into v_fila;
  return v_fila;
end;
$$;

comment on function public.cambiar_estado_forma_pago(uuid, boolean) is
  'F-VTA-01: desactiva o reactiva una forma de pago sin tocar sus datos; idempotente; no existe borrado.';

revoke execute on function public.cambiar_estado_forma_pago(uuid, boolean) from public, anon;
grant execute on function public.cambiar_estado_forma_pago(uuid, boolean) to authenticated;
